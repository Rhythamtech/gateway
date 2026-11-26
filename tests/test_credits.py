import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker

from backend.auth.models import User, UserRole
from backend.core.database import Base
from backend.core.errors import GatewayError
from backend.credits import service
from backend.credits.calculation import calculate_credit_charge, to_microcredits
from backend.credits.dtos import CreditAddition, ModelRateUpdate, UsageResolution
from backend.credits.models import CreditEntry, CreditUsage, ModelCreditRate, utcnow
from backend.gateway.execution import provider_token_usage
from backend.gateway.provider_models.models import ProviderModel
from backend.gateway.providers.models import Provider
from backend.gateway.routing import RouteCandidate


@pytest.fixture
def credits_db(monkeypatch, tmp_path):
    from backend.api_keys.models import APIKey

    path = tmp_path / "credits.db"
    writer = create_engine(
        f"sqlite:///{path}", connect_args={"check_same_thread": False, "timeout": 10}
    )
    reader = create_engine(
        f"sqlite:///{path}", connect_args={"check_same_thread": False}
    )

    @event.listens_for(writer, "connect")
    def configure_writer(connection, record):
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA journal_mode=WAL")
        connection.isolation_level = None

    @event.listens_for(writer, "begin")
    def begin_write(connection):
        connection.exec_driver_sql("BEGIN IMMEDIATE")

    @event.listens_for(reader, "connect")
    def configure_reader(connection, record):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(writer)
    # Lifespan retention reads this migration-owned (non-ORM) table.
    from backend.core.migrations import _migration_0017_gateway_log_retention
    with writer.begin() as connection:
        _migration_0017_gateway_log_retention(connection)
    writes = sessionmaker(writer, expire_on_commit=False)
    reads = sessionmaker(reader)
    for module in (
        "backend.core.database",
        "backend.credits.service",
        "backend.gateway.routing",
        "backend.gateway.providers.service",
        "backend.api_keys.middleware",
        "backend.traces.service",
    ):
        monkeypatch.setattr(f"{module}.SessionLocal", writes)
    monkeypatch.setattr("backend.core.database.write_engine", writer)
    monkeypatch.setattr("backend.core.database.engine", reader)

    with writes.begin() as db:
        user = User(
            id="user", email="user@example.com", hashed_password="x", role=UserRole.USER
        )
        admin = User(
            id="admin",
            email="admin@example.com",
            hashed_password="x",
            role=UserRole.SUPERUSER,
        )
        provider = Provider(
            id="provider",
            name="Provider A",
            aliases="a",
            base_url="https://example.com",
            api_key="",
        )
        db.add_all([user, admin, provider])
        db.flush()
        model = ProviderModel(
            id="model",
            provider_id=provider.id,
            model_name="model-a",
            model_id="a/model-a",
        )
        db.add(model)
        db.add(
            APIKey(
                id="key",
                owner_id=user.id,
                name="key",
                key_hash=hashlib.sha256(b"test-key").hexdigest(),
                key_prefix="test",
            )
        )
    result = SimpleNamespace(writes=writes, reads=reads, writer=writer)
    yield result
    reader.dispose()
    writer.dispose()


def addition(credits="1000", key="funding-001"):
    return CreditAddition(
        credits=Decimal(credits), idempotency_key=key, reason="Funding"
    )


def configure_rate(rate="10", max_tokens=1000):
    return service.set_model_rate(
        "model",
        ModelRateUpdate(
            tokens_per_credit=Decimal(rate),
            max_request_tokens=max_tokens,
        ),
        "admin",
    )


def fund_request(credits_db, credits="1000"):
    service.add_credits("user", "user", addition(credits), "admin")
    service.add_credits("provider", "provider", addition(credits), "admin")
    configure_rate()


def candidate(provider_id="provider", model_id="model"):
    return RouteCandidate("a", provider_id, "model-a", model_id, None, "openai")


def reserve(output=100):
    return service.reserve_request_credits(
        candidate(), "user", "key", "request", output, 100
    )


def balances(credits_db):
    with credits_db.reads() as db:
        return service.get_balance(db, "user", "user"), service.get_balance(
            db, "provider", "provider"
        )


def test_fractional_charges_and_rounding():
    assert calculate_credit_charge(15, to_microcredits(Decimal(10))) == 1_500_000
    assert calculate_credit_charge(1, to_microcredits(Decimal(3))) == 333333
    assert (
        calculate_credit_charge(1, to_microcredits(Decimal(3)), reserve=True) == 333334
    )
    assert calculate_credit_charge(1, to_microcredits(Decimal(128))) == 7812
    with pytest.raises(ValueError):
        to_microcredits(Decimal("0.0000001"))


def test_additions_are_idempotent_and_conflicts_are_rejected(credits_db):
    first = service.add_credits("user", "user", addition(), "admin")
    second = service.add_credits("user", "user", addition(), "admin")
    assert first.id == second.id
    with pytest.raises(HTTPException) as error:
        service.add_credits("user", "user", addition("1001"), "admin")
    assert error.value.status_code == 409
    assert balances(credits_db)[0].remaining_credits == "1000.000000"


def test_reservation_settles_both_balances_once(credits_db):
    fund_request(credits_db)
    hold = reserve()
    assert balances(credits_db)[0].reserved_credits == "20.000000"
    service.mark_dispatched(hold.usage_id)
    service.record_usage(hold.usage_id, 100, 50, "upstream-id")
    service.settle_request_usage(hold.usage_id)
    service.settle_request_usage(hold.usage_id)
    for balance in balances(credits_db):
        assert balance.remaining_credits == "985.000000"
        assert balance.reserved_credits == "0.000000"
    with credits_db.reads() as db:
        assert db.query(CreditEntry).filter_by(usage_id=hold.usage_id).count() == 2
        assert db.get(CreditUsage, hold.usage_id).charged == 15_000_000


def test_rate_changes_do_not_reprice_inflight_usage(credits_db):
    fund_request(credits_db)
    hold = reserve()
    configure_rate("20")
    service.record_usage(hold.usage_id, 100, 0, None)
    service.settle_request_usage(hold.usage_id)
    assert balances(credits_db)[0].remaining_credits == "990.000000"
    with credits_db.reads() as db:
        assert db.query(ModelCreditRate).count() == 2


def test_concurrent_requests_cannot_overspend(credits_db):
    fund_request(credits_db, "100")

    def attempt(index):
        try:
            return service.reserve_request_credits(
                candidate(), "user", "key", str(index), 900, 100
            )
        except GatewayError as error:
            return error.code

    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(attempt, range(6)))
    assert sum(isinstance(result, service.CreditReservation) for result in results) == 1
    assert results.count("provider_credits_exhausted") == 5
    assert balances(credits_db)[0].available_credits == "0.000000"


def test_user_credit_failure_rolls_back_provider_hold(credits_db):
    configure_rate()
    service.add_credits("provider", "provider", addition(), "admin")
    with pytest.raises(GatewayError) as error:
        reserve()
    assert error.value.code == "insufficient_credits"
    assert balances(credits_db)[1].reserved_credits == "0.000000"


def test_unpriced_models_cannot_dispatch(credits_db):
    with pytest.raises(GatewayError) as error:
        reserve()
    assert error.value.code == "model_rate_missing"


def test_unknown_outcome_retains_hold_until_resolution(credits_db):
    fund_request(credits_db)
    hold = reserve()
    service.mark_dispatched(hold.usage_id)
    service.mark_for_review(hold.usage_id, "Timeout")
    service.release_undispatched_request(hold.usage_id)
    assert balances(credits_db)[0].reserved_credits == "20.000000"
    resolution = UsageResolution(
        action="settle",
        input_tokens=40,
        output_tokens=10,
        reason="Verified upstream usage export",
    )
    service.resolve_usage(hold.usage_id, resolution, "admin")
    service.resolve_usage(hold.usage_id, resolution, "admin")
    assert balances(credits_db)[0].remaining_credits == "995.000000"
    with pytest.raises(HTTPException):
        service.resolve_usage(
            hold.usage_id,
            UsageResolution(action="release", reason="Different outcome"),
            "admin",
        )


def test_reconciliation_retries_recorded_usage_and_retains_unknown_holds(credits_db):
    from datetime import timedelta

    fund_request(credits_db)
    known = reserve()
    unknown = reserve()
    service.record_usage(known.usage_id, 10, 10, None)
    service.mark_dispatched(unknown.usage_id)
    with credits_db.writes.begin() as db:
        db.get(CreditUsage, unknown.usage_id).updated_at = utcnow() - timedelta(hours=1)
    service.recover_pending_usage(900)
    with credits_db.reads() as db:
        assert db.get(CreditUsage, known.usage_id).status == "settled"
        assert db.get(CreditUsage, unknown.usage_id).status == "needs_review"
    assert balances(credits_db)[0].reserved_credits == "20.000000"


def test_excessive_provider_usage_is_not_silently_undercharged(credits_db):
    fund_request(credits_db)
    hold = reserve()
    service.record_usage(hold.usage_id, 1001, 0, None)
    service.settle_request_usage(hold.usage_id)
    with credits_db.reads() as db:
        assert db.get(CreditUsage, hold.usage_id).status == "needs_review"
    assert balances(credits_db)[0].remaining_credits == "1000.000000"


def test_cache_tokens_are_counted_once_and_missing_usage_is_unknown():
    assert provider_token_usage(
        {
            "prompt_tokens": 100,
            "completion_tokens": 10,
            "prompt_tokens_details": {"cached_tokens": 40},
        },
        "openai",
    ) == (100, 10)
    assert provider_token_usage(
        {
            "input_tokens": 10,
            "cache_read_input_tokens": 20,
            "cache_creation_input_tokens": 30,
            "output_tokens": 5,
        },
        "anthropic",
    ) == (60, 5)
    assert provider_token_usage({"output_tokens": 5}, "anthropic") is None
    assert (
        provider_token_usage({"prompt_tokens": True, "completion_tokens": 5}, "openai")
        is None
    )


@pytest.fixture
def client(credits_db):
    from backend.core.database import get_db
    from backend.main import app

    def read_database():
        with credits_db.reads() as db:
            yield db

    app.dependency_overrides[get_db] = read_database
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def user_token(user_id="user"):
    from backend.core.security import create_access_token

    return {"Authorization": f"Bearer {create_access_token(user_id)}"}


def test_new_account_traces_by_default_and_can_turn_it_off(client, credits_db):
    from backend.core.migrations import (
        _migration_0021_signup_settings,
        _migration_0026_block_disposable_emails,
    )

    with credits_db.writes.begin() as connection:
        _migration_0021_signup_settings(connection)
        _migration_0026_block_disposable_emails(connection)

    response = client.post(
        "/auth/register",
        json={"email": "new-tracer@example.com", "password": "test-password-123"},
    )
    assert response.status_code == 201
    headers = user_token(response.json()["id"])
    settings = client.get("/users/me", headers=headers).json()
    assert settings["tracing_enabled"] is True
    assert settings["telemetry_enabled"] is False

    disabled = client.patch(
        "/users/me/preferences", headers=headers, json={"tracing_enabled": False}
    )
    assert disabled.status_code == 200
    assert client.get("/users/me", headers=headers).json()["tracing_enabled"] is False


def upstream_response(protocol="openai"):
    if protocol == "anthropic":
        return {
            "id": "msg-1",
            "type": "message",
            "role": "assistant",
            "content": [{"type": "text", "text": "Hello"}],
            "usage": {
                "input_tokens": 20,
                "cache_read_input_tokens": 5,
                "output_tokens": 10,
            },
        }
    return {
        "id": "chat-1",
        "object": "chat.completion",
        "created": 1,
        "model": "model-a",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": "Hello"},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 25, "completion_tokens": 10},
    }


@pytest.mark.parametrize(
    "path,payload",
    [
        ("/v1/chat/completions", {"messages": [{"role": "user", "content": "Hello"}]}),
        (
            "/v1/messages",
            {"messages": [{"role": "user", "content": "Hello"}]},
        ),
        ("/v1/responses", {"input": "Hello"}),
    ],
)
@pytest.mark.parametrize("protocol", ["openai", "anthropic"])
def test_inference_settles_with_tracing_disabled(
    client, credits_db, monkeypatch, path, payload, protocol
):
    fund_request(credits_db)
    with credits_db.writes.begin() as db:
        db.get(User, "user").tracing_enabled = False
        db.get(Provider, "provider").protocol = protocol
    send = AsyncMock(return_value=httpx.Response(200, json=upstream_response(protocol)))
    monkeypatch.setattr("backend.gateway.execution.call_provider", send)
    result = client.post(
        path, headers={"x-api-key": "test-key"}, json={"model": "a/model-a", **payload}
    )
    assert result.status_code == 200, result.text
    for balance in balances(credits_db):
        assert balance.remaining_credits == "996.500000"
        assert balance.reserved_credits == "0.000000"
    with credits_db.reads() as db:
        assert db.execute(text("SELECT COUNT(*) FROM llm_call_traces")).scalar() == 0


def test_automatic_rate_caps_output_to_available_credits(client, credits_db, monkeypatch):
    result = client.put(
        "/provider/models/model/credit-rate",
        headers=user_token("admin"),
        json={"tokens_per_credit": "10"},
    )
    assert result.status_code == 200, result.text
    assert result.json()["max_request_tokens"] is None
    service.add_credits("user", "user", addition("10"), "admin")
    service.add_credits("provider", "provider", addition("100"), "admin")

    async def send(_, payload, stream, *, capture_error, detect_tool_rejection):
        assert balances(credits_db)[0].reserved_credits == "10.000000"
        assert 10 <= payload["max_tokens"] < 100
        return httpx.Response(200, json=upstream_response())

    upstream = AsyncMock(side_effect=send)
    monkeypatch.setattr("backend.gateway.execution.call_provider", upstream)
    payload = {"model": "a/model-a", "messages": [{"role": "user", "content": "Hello"}]}
    headers = {"x-api-key": "test-key"}
    rejected = client.post(
        "/v1/chat/completions", headers=headers, json={**payload, "max_tokens": 100}
    )
    assert rejected.status_code == 402, rejected.text
    upstream.assert_not_called()

    accepted = client.post("/v1/chat/completions", headers=headers, json=payload)
    assert accepted.status_code == 200, accepted.text
    upstream.assert_awaited_once()
    user, provider = balances(credits_db)
    assert user.available_credits == "6.500000"
    assert provider.available_credits == "96.500000"


def test_rest_permissions_and_idempotency(client):
    assert client.get("/credits/me").status_code == 401
    assert client.get("/credits/me", headers=user_token()).status_code == 200
    assert client.get("/credits/users/admin", headers=user_token()).status_code == 403
    payload = {
        "credits": "25.5",
        "idempotency_key": "test-add-001",
        "reason": "Admin funding",
    }
    assert (
        client.post(
            "/credits/users/user/add", headers=user_token(), json=payload
        ).status_code
        == 403
    )
    first = client.post(
        "/credits/users/user/add", headers=user_token("admin"), json=payload
    )
    second = client.post(
        "/credits/users/user/add", headers=user_token("admin"), json=payload
    )
    assert first.status_code == 200, first.text
    assert first.json() == second.json()
    assert (
        client.get("/credits/me/history?page=0", headers=user_token()).status_code
        == 422
    )
    assert (
        client.put(
            "/provider/models/model/credit-rate",
            headers=user_token("admin"),
            json={
                "tokens_per_credit": "10",
                "max_request_tokens": 1000,
            },
        ).status_code
        == 200
    )


def test_missing_usage_retains_reservation(client, credits_db, monkeypatch):
    fund_request(credits_db)
    data = upstream_response()
    data.pop("usage")
    monkeypatch.setattr(
        "backend.gateway.execution.call_provider",
        AsyncMock(return_value=httpx.Response(200, json=data)),
    )
    result = client.post(
        "/v1/chat/completions",
        headers={"x-api-key": "test-key"},
        json={"model": "a/model-a"},
    )
    assert result.status_code == 200
    assert balances(credits_db)[0].reserved_credits == "100.000000"
    with credits_db.reads() as db:
        assert db.query(CreditUsage).one().status == "needs_review"


@pytest.mark.parametrize(
    "payload",
    [
        {"max_tokens": 1001},
        {"n": 2},
        {
            "messages": [
                {
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": "https://example.com/a.png"},
                        }
                    ]
                }
            ]
        },
    ],
)
def test_unsupported_requests_never_dispatch(client, credits_db, monkeypatch, payload):
    fund_request(credits_db)
    send = AsyncMock()
    monkeypatch.setattr("backend.gateway.execution.call_provider", send)
    result = client.post(
        "/v1/chat/completions",
        headers={"x-api-key": "test-key"},
        json={"model": "a/model-a", **payload},
    )
    assert result.status_code == 400
    send.assert_not_called()
    assert balances(credits_db)[0].reserved_credits == "0.000000"


@pytest.mark.parametrize("protocol", ["openai", "anthropic"])
@pytest.mark.parametrize(
    "path", ["/v1/chat/completions", "/v1/messages", "/v1/responses"]
)
def test_streaming_captures_raw_usage_before_conversion(
    client, credits_db, monkeypatch, protocol, path
):
    fund_request(credits_db)
    with credits_db.writes.begin() as db:
        db.get(Provider, "provider").protocol = protocol
    if protocol == "openai":
        events = [
            {
                "id": "chat-1",
                "choices": [{"delta": {"content": "Hel"}, "finish_reason": None}],
            },
            {"id": "chat-1", "choices": [{"delta": {"content": "lo"}}]},
            {"choices": [], "usage": {"prompt_tokens": 25, "completion_tokens": 10}},
        ]
        content = (
            "".join(f"data: {json.dumps(event)}\n\n" for event in events)
            + "data: [DONE]\n\n"
        )
    else:
        events = [
            {
                "type": "message_start",
                "message": {
                    "id": "msg-1",
                    "usage": {"input_tokens": 20, "cache_read_input_tokens": 5},
                },
            },
            {
                "type": "content_block_delta",
                "delta": {"type": "text_delta", "text": "Hel"},
            },
            {
                "type": "content_block_delta",
                "delta": {"type": "text_delta", "text": "lo"},
            },
            {
                "type": "message_delta",
                "delta": {"stop_reason": "end_turn"},
                "usage": {"output_tokens": 10},
            },
            {"type": "message_stop"},
        ]
        content = "".join(f"data: {json.dumps(event)}\n\n" for event in events)
    monkeypatch.setattr(
        "backend.gateway.execution.call_provider",
        AsyncMock(return_value=httpx.Response(200, content=content)),
    )
    result = client.post(
        path,
        headers={"x-api-key": "test-key"},
        json={"model": "a/model-a", "stream": True, "max_tokens": 100},
    )
    assert result.status_code == 200, result.text
    if path == "/v1/responses":
        events = [
            json.loads(line.removeprefix("data: "))
            for line in result.text.splitlines()
            if line.startswith("data: ")
        ]
        assert events[-1]["type"] == "response.completed"
        assert events[-1]["response"]["output"][0]["content"][0]["text"] == "Hello"
    else:
        assert "Hel" in result.text
    assert balances(credits_db)[0].remaining_credits == "996.500000"
    assert balances(credits_db)[0].reserved_credits == "0.000000"


def test_budget_exhaustion_uses_next_candidate(client, credits_db, monkeypatch):
    fund_request(credits_db)
    unavailable = RouteCandidate(
        "empty", "missing", "model-a", "missing", None, "openai"
    )
    monkeypatch.setattr(
        "backend.gateway.execution.plan", lambda model: [unavailable, candidate()]
    )
    send = AsyncMock(return_value=httpx.Response(200, json=upstream_response()))
    monkeypatch.setattr("backend.gateway.execution.call_provider", send)
    result = client.post(
        "/v1/chat/completions",
        headers={"x-api-key": "test-key"},
        json={"model": "group"},
    )
    assert result.status_code == 200
    assert send.call_args.args[0].id == "provider"


@pytest.fixture
def fallback_group(credits_db):
    from backend.gateway.model_groups.models import ModelGroup, ModelGroupMember

    fund_request(credits_db)
    with credits_db.writes.begin() as db:
        db.get(User, "user").tracing_enabled = True
        db.add_all([
            ModelGroup(
                id="group", name="Fallback", model_id="group",
                routing_strategy="runtime_fallback", created_by="admin",
            ),
            Provider(
                id="backup", name="Backup", aliases="backup",
                base_url="https://example.org", api_key="",
            ),
        ])
        db.flush()
        db.add(ProviderModel(
            id="backup-model", provider_id="backup", model_name="model-b",
            model_id="backup/model-b",
        ))
        db.flush()
        db.add_all([
            ModelGroupMember(model_group_id="group", provider_model_id="model", priority=1),
            ModelGroupMember(model_group_id="group", provider_model_id="backup-model", priority=2),
        ])
    service.set_model_rate(
        "backup-model", ModelRateUpdate(tokens_per_credit=10, max_request_tokens=1000), "admin"
    )
    service.add_credits("provider", "backup", addition(), "admin")


def test_disabled_model_and_group_are_removed_from_compatible_endpoints(
    client, credits_db, fallback_group, monkeypatch
):
    from backend.gateway.model_groups.models import ModelGroup

    headers = {"x-api-key": "test-key"}
    send = AsyncMock(return_value=httpx.Response(200, json=upstream_response()))
    monkeypatch.setattr("backend.gateway.execution.call_provider", send)

    def catalog_ids():
        response = client.get("/v1/models", headers=headers)
        assert response.status_code == 200
        return {item["id"] for item in response.json()["data"]}

    def assert_removed(path, model, **payload):
        response = client.post(path, headers=headers, json={"model": model, **payload})
        assert response.status_code == 404, response.text
        error = response.json()["error"]
        if path != "/v1/messages":
            assert error["code"] == "model_not_found"
        assert "does not exist or has been removed" in error["message"]

    assert catalog_ids() == {"group"}
    with credits_db.writes.begin() as db:
        db.get(ProviderModel, "backup-model").is_available = False
    assert catalog_ids() == {"group"}
    assert_removed("/v1/chat/completions", "backup/model-b")

    with credits_db.writes.begin() as db:
        db.get(Provider, "provider").is_enabled = False
    assert catalog_ids() == set()
    assert_removed("/v1/chat/completions", "a/model-a")
    assert_removed("/v1/responses", "group", input="Hello")

    with credits_db.writes.begin() as db:
        db.get(Provider, "provider").is_enabled = True
        group = db.get(ModelGroup, "group")
        # This public name is also an available direct provider route.
        group.model_id = "a/model-a"
        group.is_enabled = False
    assert catalog_ids() == set()
    assert_removed("/v1/chat/completions", "a/model-a")
    assert_removed("/v1/responses", "a/model-a", input="Hello")
    assert_removed("/v1/messages", "a/model-a", max_tokens=20)
    send.assert_not_awaited()
    with credits_db.reads() as db:
        assert db.query(CreditUsage).count() == 0

    with credits_db.writes.begin() as db:
        db.get(ModelGroup, "group").is_enabled = True
    assert catalog_ids() == {"a/model-a"}
    response = client.post(
        "/v1/chat/completions", headers=headers,
        json={"model": "a/model-a", "max_tokens": 20},
    )
    assert response.status_code == 200, response.text
    send.assert_awaited_once()


@pytest.mark.parametrize(
    "path,first_result",
    [
        ("/v1/chat/completions", 503),
        ("/v1/messages", 429),
        ("/v1/responses", 408),
        ("/v1/chat/completions", "connect"),
        ("/v1/chat/completions", "timeout"),
        ("/v1/chat/completions", "tool_rejection"),
    ],
)
def test_runtime_fallback_retries_and_settles_winning_attempt(
    client, credits_db, fallback_group, monkeypatch, path, first_result
):
    from backend.traces.models import LLMCallTrace

    requests = []
    if path == "/v1/messages":
        with credits_db.writes.begin() as db:
            db.get(Provider, "backup").protocol = "anthropic"
    if first_result == "tool_rejection":
        with credits_db.writes.begin() as db:
            db.get(User, "user").tracing_enabled = False

    def upstream(request):
        requests.append((request.url.path, json.loads(request.content)))
        if request.url.host == "example.org":
            protocol = "anthropic" if path == "/v1/messages" else "openai"
            return httpx.Response(200, json=upstream_response(protocol))
        if first_result == "connect":
            raise httpx.ConnectError("unreachable")
        if first_result == "timeout":
            raise httpx.ReadTimeout("timed out")
        if first_result == "tool_rejection":
            return httpx.Response(400, json={"error": {"message": (
                '"auto" tool choice requires --enable-auto-tool-choice '
                'and --tool-call-parser to be set'
            )}})
        return httpx.Response(first_result, json={"error": {"message": "Unavailable"}})

    upstream_client = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
    monkeypatch.setattr("backend.gateway.providers.service.get_client", lambda: upstream_client)
    payload = {"model": "group", "max_tokens": 20}
    if path == "/v1/responses":
        payload = {"model": "group", "input": "Hello", "max_output_tokens": 20}
    if first_result == "tool_rejection":
        payload["tools"] = [{"type": "function", "function": {"name": "check"}}]
    response = client.post(path, headers={"x-api-key": "test-key"}, json=payload)

    assert response.status_code == 200, response.text
    assert [req["model"] for _, req in requests] == ["model-a", "model-b"]
    assert [req["max_tokens"] for _, req in requests] == [20, 20]
    assert requests[0][1].get("tools") == requests[1][1].get("tools")
    assert requests[0][0] == "/v1/chat/completions"
    assert requests[1][0] == (
        "/v1/messages" if path == "/v1/messages" else "/v1/chat/completions"
    )
    with credits_db.reads() as db:
        usage = {row.provider_id: row for row in db.query(CreditUsage).all()}
        assert usage["provider"].status == "needs_review"
        assert usage["backup"].status == "settled"
        assert usage["provider"].charged == 0
        assert usage["backup"].charged > 0
        assert usage["provider"].request_id == usage["backup"].request_id
        calls = db.query(LLMCallTrace).order_by(LLMCallTrace.created_at).all()
        if first_result == "tool_rejection":
            assert calls == []
        else:
            assert [call.provider_model_id for call in calls] == ["model", "backup-model"]
            assert [call.status for call in calls] == [
                "timeout" if first_result == "timeout" else "failed", "success",
            ]
            assert all(call.message_trace_id == usage["backup"].request_id for call in calls)


@pytest.mark.parametrize(
    "strategy,first_status,backup_status,backup_funded,expected,count",
    [
        ("runtime_fallback", 400, 200, True, 400, 1),
        ("runtime_fallback", 503, 429, True, 429, 2),
        ("runtime_fallback", 503, 200, False, 503, 1),
        ("round_robin", 503, 503, True, 503, 1),
        ("weighted_round_robin", 503, 503, True, 503, 1),
    ],
)
def test_runtime_fallback_error_boundaries(
    client, credits_db, fallback_group, monkeypatch,
    strategy, first_status, backup_status, backup_funded, expected, count,
):
    from backend.credits.models import ProviderCredits
    from backend.gateway.model_groups.models import ModelGroup

    with credits_db.writes.begin() as db:
        db.get(ModelGroup, "group").routing_strategy = strategy
        if not backup_funded:
            db.get(ProviderCredits, "backup").remaining = 0

    hosts = []

    def upstream(request):
        hosts.append(request.url.host)
        status = first_status if request.url.host == "example.com" else backup_status
        return httpx.Response(status, json={"error": {"message": "Provider rejection"}})

    upstream_client = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
    monkeypatch.setattr("backend.gateway.providers.service.get_client", lambda: upstream_client)
    result = client.post(
        "/v1/chat/completions", headers={"x-api-key": "test-key"},
        json={"model": "group", "max_tokens": 20},
    )
    assert result.status_code == expected
    assert len(hosts) == len(set(hosts)) == count


@pytest.mark.parametrize("model", ["group", "a/model-a"])
def test_accepted_stream_failure_does_not_retry(
    client, credits_db, fallback_group, monkeypatch, model
):
    send = AsyncMock(return_value=httpx.Response(
        200, text='data: {"error":{"message":"Overloaded"}}\n\n'
    ))
    monkeypatch.setattr("backend.gateway.execution.call_provider", send)
    result = client.post(
        "/v1/chat/completions", headers={"x-api-key": "test-key"},
        json={"model": model, "max_tokens": 20, "stream": True},
    )
    assert result.status_code == 200
    assert "Overloaded" in result.text
    send.assert_awaited_once()


def test_request_deadline_cancels_dispatch_and_returns_504(
    client, credits_db, fallback_group, monkeypatch
):
    import asyncio

    from backend.traces.models import LLMCallTrace

    cancelled = False

    async def slow_provider(*args, **kwargs):
        nonlocal cancelled
        try:
            await asyncio.sleep(10)
        finally:
            cancelled = True

    send = AsyncMock(side_effect=slow_provider)
    monkeypatch.setattr("backend.traces.capture.REQUEST_TIMEOUT_SECONDS", 0.2)
    monkeypatch.setattr("backend.gateway.execution.call_provider", send)
    result = client.post(
        "/v1/chat/completions", headers={"x-api-key": "test-key"},
        json={"model": "group", "max_tokens": 20},
    )

    assert result.status_code == 504
    assert result.json()["error"]["code"] == "request_timeout"
    assert cancelled
    send.assert_awaited_once()
    with credits_db.reads() as db:
        assert db.query(CreditUsage).one().status == "needs_review"
        trace = db.query(LLMCallTrace).one()
        assert (trace.status, trace.error_code) == ("timeout", "request_timeout")


@pytest.mark.parametrize(
    "path,payload,expected",
    [
        ("/v1/chat/completions", {"max_tokens": 20}, "request_timeout"),
        ("/v1/messages", {"max_tokens": 20}, "timeout_error"),
        ("/v1/responses", {"input": "Hello", "max_output_tokens": 20}, "response.failed"),
    ],
)
def test_request_deadline_closes_open_stream(
    client, credits_db, fallback_group, monkeypatch, path, payload, expected
):
    import asyncio

    from backend.traces.models import LLMCallTrace

    class StalledStream(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b'data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n'
            await asyncio.sleep(10)

    upstream = httpx.Response(200, stream=StalledStream())
    send = AsyncMock(return_value=upstream)
    monkeypatch.setattr("backend.traces.capture.REQUEST_TIMEOUT_SECONDS", 0.2)
    monkeypatch.setattr("backend.gateway.execution.call_provider", send)
    result = client.post(
        path, headers={"x-api-key": "test-key"},
        json={"model": "group", "stream": True, **payload},
    )

    assert result.status_code == 200
    assert expected in result.text
    assert "five-minute time limit" in result.text
    assert "response.completed" not in result.text
    assert upstream.is_closed
    send.assert_awaited_once()
    with credits_db.reads() as db:
        assert db.query(CreditUsage).one().status == "needs_review"
        trace = db.query(LLMCallTrace).one()
        assert (trace.status, trace.error_code) == ("timeout", "request_timeout")


def test_expiration_closes_only_stale_pending_traces(credits_db):
    from datetime import timedelta

    from backend.traces import service as traces
    from backend.traces.models import LLMCallTrace, LLMMessageTrace

    message_id, stale_id = traces.start_pending_attempt(
        user_id="user", created_at=utcnow() - timedelta(minutes=6)
    )
    traces.start_pending_attempt(user_id="user", created_at=utcnow() - timedelta(minutes=7))
    _, active_id = traces.start_pending_attempt(user_id="user")

    assert traces.expire_pending_attempts() == 2
    assert traces.expire_pending_attempts() == 0
    traces.finish_pending_attempt(call_trace_id=stale_id, status="success")
    with credits_db.reads() as db:
        stale = db.get(LLMCallTrace, stale_id)
        assert (stale.status, stale.error_code) == ("timeout", "request_timeout")
        assert stale.finished_at is not None
        assert db.get(LLMMessageTrace, message_id).finished_at is not None
        assert db.get(LLMCallTrace, active_id).status == "pending"
        assert db.execute(text("SELECT call_count FROM llm_user_usage_daily")).scalar() == 2


def test_stale_usage_can_be_released_without_charging(credits_db):
    fund_request(credits_db)
    hold = reserve()
    service.mark_for_review(hold.usage_id, "Upstream confirmed no work")
    data = UsageResolution(
        action="release", reason="Verified upstream request was rejected without usage"
    )
    service.resolve_usage(hold.usage_id, data, "admin")
    service.resolve_usage(hold.usage_id, data, "admin")
    for balance in balances(credits_db):
        assert balance.remaining_credits == "1000.000000"
        assert balance.reserved_credits == "0.000000"


def test_above_limit_usage_can_be_settled_after_funding_shortfall(credits_db):
    fund_request(credits_db, "100")
    hold = reserve()
    service.record_usage(hold.usage_id, 1500, 0, "over-limit")
    data = UsageResolution(
        action="settle",
        input_tokens=1500,
        output_tokens=0,
        reason="Verified provider export; corrected model limit separately",
    )
    with pytest.raises(HTTPException) as error:
        service.resolve_usage(hold.usage_id, data, "admin")
    assert error.value.status_code == 409
    for owner_type, owner_id in (("user", "user"), ("provider", "provider")):
        service.add_credits(
            owner_type, owner_id, addition("50", "shortfall-001"), "admin"
        )
    service.resolve_usage(hold.usage_id, data, "admin")
    for balance in balances(credits_db):
        assert balance.remaining_credits == "0.000000"
        assert balance.reserved_credits == "0.000000"


def test_live_usage_cannot_be_manually_released(credits_db):
    fund_request(credits_db)
    hold = reserve()
    service.mark_dispatched(hold.usage_id)
    with pytest.raises(HTTPException) as error:
        service.resolve_usage(
            hold.usage_id,
            UsageResolution(action="release", reason="Too early"),
            "admin",
        )
    assert error.value.status_code == 409
    assert balances(credits_db)[0].reserved_credits == "20.000000"


def test_fresh_and_existing_schema_migrations_are_idempotent(credits_db):
    from backend.core.migrations import run_pending_migrations

    fund_request(credits_db)
    applied = run_pending_migrations(credits_db.writer)
    assert "0013_usage_credits" in applied
    assert "0027_trace_error_details" in applied
    assert run_pending_migrations(credits_db.writer) == []
    with credits_db.reads() as db:
        assert db.query(ModelCreditRate).count() == 1
        assert db.execute(text("PRAGMA foreign_key_check")).all() == []
    assert balances(credits_db)[0].remaining_credits == "1000.000000"


def test_model_sync_preserves_credit_rates(credits_db):
    from backend.gateway.provider_models.service import _persist_models

    configure_rate()
    with credits_db.writes() as db:
        _persist_models(db, "provider", ["model-a", "new-model"])
    with credits_db.reads() as db:
        assert service.get_model_rate(db, "model").tokens_per_credit == "10.000000"
        new_model = db.query(ProviderModel).filter_by(model_name="new-model").one()
        assert service.latest_model_rate(db, new_model.id) is None


def test_provider_creation_supports_initial_credits(client, monkeypatch, credits_db):
    monkeypatch.setattr(
        "backend.gateway.providers.service.normalize_base_url", lambda value: value
    )
    result = client.post(
        "/provider/create",
        headers=user_token("admin"),
        json={
            "name": "Provider B",
            "aliases": "b",
            "base_url": "https://provider.example.com",
            "initial_credits": "1000000",
        },
    )
    assert result.status_code == 201, result.text
    provider_id = result.json()["id"]
    balance = client.get(
        f"/provider/{provider_id}/credits", headers=user_token("admin")
    )
    assert balance.json()["available_credits"] == "1000000.000000"
    assert (
        client.delete(
            f"/provider/delete/{provider_id}", headers=user_token("admin")
        ).status_code
        == 409
    )


def test_user_usage_is_scoped_to_the_authenticated_user(client, credits_db):
    fund_request(credits_db)
    reserve()
    assert client.get("/credits/me/usage", headers=user_token()).json()["total"] == 1
    assert (
        client.get("/credits/me/usage", headers=user_token("admin")).json()["total"]
        == 0
    )
    assert client.get("/credits/usage", headers=user_token()).status_code == 403


def test_usage_analytics_report_charged_credits(client, credits_db):
    from datetime import datetime, timedelta, timezone
    from uuid import uuid4

    from backend.api_keys.models import APIKey

    user_id = str(uuid4())
    other_id = str(uuid4())
    key_id = str(uuid4())
    with credits_db.writes.begin() as db:
        db.add_all(
            [
                User(
                    id=user_id,
                    email="cost-user@example.com",
                    hashed_password="x",
                    role=UserRole.USER,
                ),
                User(
                    id=other_id,
                    email="cost-other@example.com",
                    hashed_password="x",
                    role=UserRole.USER,
                ),
            ]
        )
        db.flush()
        db.add(
            APIKey(
                id=key_id,
                owner_id=user_id,
                name="cost key",
                key_hash=hashlib.sha256(b"cost-key").hexdigest(),
                key_prefix="cost",
            )
        )

    # Fund the new user and settle one request's token usage (150 tokens at
    # 10 tokens per credit → 15 credits actually charged).
    service.add_credits("user", user_id, addition(), "admin")
    service.add_credits("provider", "provider", addition(), "admin")
    configure_rate()
    hold = service.reserve_request_credits(
        candidate(), user_id, key_id, "request-cost", 100, 100
    )
    service.mark_dispatched(hold.usage_id)
    service.record_usage(hold.usage_id, 100, 50, "upstream-id")
    service.settle_request_usage(hold.usage_id)
    today = datetime.now(timezone.utc).date().isoformat()

    body = client.get("/traces/usage/me", headers=user_token(user_id)).json()
    assert body["cost"]["totals"]["charged_credits"] == "15.000000"
    assert body["cost"]["daily"] == [
        {"date": today, "charged_credits": "15.000000"}
    ]

    # The same charge is attributed to the API key that made the request.
    body = client.get(
        f"/traces/usage/api-keys/{key_id}", headers=user_token(user_id)
    ).json()
    assert body["cost"]["totals"]["charged_credits"] == "15.000000"

    # Each subject sees only its own ledger.
    body = client.get("/traces/usage/me", headers=user_token(other_id)).json()
    assert body["cost"]["totals"]["charged_credits"] == "0.000000"
    assert body["cost"]["daily"] == []

    # A window outside the charge day yields an empty cost summary.
    tomorrow = (datetime.now(timezone.utc).date() + timedelta(days=1)).isoformat()
    body = client.get(
        "/traces/usage/me",
        params={"from": tomorrow, "to": tomorrow},
        headers=user_token(user_id),
    ).json()
    assert body["cost"]["totals"]["charged_credits"] == "0.000000"
    assert body["cost"]["daily"] == []


@pytest.mark.parametrize("protocol", ["openai", "anthropic"])
def test_incomplete_streams_keep_holds(client, credits_db, monkeypatch, protocol):
    fund_request(credits_db)
    with credits_db.writes.begin() as db:
        db.get(Provider, "provider").protocol = protocol
    if protocol == "anthropic":
        events = [
            {
                "type": "message_start",
                "message": {
                    "id": "partial-id",
                    "usage": {"input_tokens": 10, "output_tokens": 0},
                },
            },
            {"type": "message_stop"},
        ]
    else:
        events = [
            {
                "id": "partial-id",
                "choices": [],
                "usage": {"prompt_tokens": 10, "completion_tokens": 5},
            }
        ]
    content = "".join(f"data: {json.dumps(event)}\n\n" for event in events)
    response = httpx.Response(200, content=content)
    monkeypatch.setattr(
        "backend.gateway.execution.call_provider", AsyncMock(return_value=response)
    )
    result = client.post(
        "/v1/chat/completions",
        headers={"x-api-key": "test-key"},
        json={"model": "a/model-a", "stream": True},
    )
    assert result.status_code == 200
    assert balances(credits_db)[0].reserved_credits == "100.000000"
    with credits_db.reads() as db:
        usage = db.query(CreditUsage).one()
        assert usage.status == "needs_review"
        assert usage.provider_request_id == "partial-id"
    assert response.is_closed


def test_timeout_preserves_credits_for_review(client, credits_db, monkeypatch):
    from backend.traces.models import LLMCallTrace

    fund_request(credits_db)
    monkeypatch.setattr(
        "backend.gateway.execution.call_provider",
        AsyncMock(side_effect=GatewayError(504, "upstream_timeout", "Timed out")),
    )
    result = client.post(
        "/v1/chat/completions",
        headers={"x-api-key": "test-key"},
        json={"model": "a/model-a"},
    )
    assert result.status_code == 504
    assert balances(credits_db)[0].reserved_credits == "100.000000"
    with credits_db.reads() as db:
        usage = db.query(CreditUsage).one()
        assert usage.status == "needs_review"
        assert usage.reason == "Provider timed out before usage could be confirmed."
        attempt = db.query(LLMCallTrace).filter_by(message_trace_id=usage.request_id).one()
        assert attempt.status == "timeout"
        assert attempt.error_code == "upstream_timeout"


def test_invalid_upstream_json_returns_provider_error(client, credits_db, monkeypatch):
    fund_request(credits_db)
    monkeypatch.setattr(
        "backend.gateway.execution.call_provider",
        AsyncMock(return_value=httpx.Response(200, content="invalid json")),
    )
    result = client.post(
        "/v1/chat/completions",
        headers={"x-api-key": "test-key"},
        json={"model": "a/model-a"},
    )
    assert result.status_code == 502
    assert balances(credits_db)[0].reserved_credits == "100.000000"


def test_priced_provider_with_zero_credits_is_skipped(client, credits_db, monkeypatch):
    fund_request(credits_db)
    with credits_db.writes.begin() as db:
        db.add(
            Provider(
                id="empty",
                name="Empty",
                aliases="empty",
                base_url="https://example.com",
            )
        )
        db.flush()
        db.add(
            ProviderModel(
                id="empty-model",
                provider_id="empty",
                model_name="model-a",
                model_id="empty/model-a",
            )
        )
    service.set_model_rate(
        "empty-model",
        ModelRateUpdate(
            tokens_per_credit=10, max_request_tokens=1000
        ),
        "admin",
    )
    unavailable = RouteCandidate(
        "empty", "empty", "model-a", "empty-model", None, "openai"
    )
    monkeypatch.setattr(
        "backend.gateway.execution.plan", lambda model: [unavailable, candidate()]
    )
    send = AsyncMock(return_value=httpx.Response(200, json=upstream_response()))
    monkeypatch.setattr("backend.gateway.execution.call_provider", send)
    result = client.post(
        "/v1/chat/completions",
        headers={"x-api-key": "test-key"},
        json={"model": "group"},
    )
    assert result.status_code == 200
    assert send.call_args.args[0].id == "provider"


@pytest.mark.parametrize(
    ("path", "payload"),
    [
        ("/v1/chat/completions", {}),
        ("/v1/messages", {}),
        ("/v1/responses", {"input": "Hello"}),
    ],
)
def test_insufficient_user_credits_returns_402_before_dispatch(
    client, credits_db, monkeypatch, path, payload
):
    configure_rate()
    service.add_credits("provider", "provider", addition(), "admin")
    send = AsyncMock()
    monkeypatch.setattr("backend.gateway.execution.call_provider", send)
    result = client.post(
        path,
        headers={"x-api-key": "test-key"},
        json={"model": "a/model-a", **payload},
    )
    assert result.status_code == 402
    error = result.json()["error"]
    if path == "/v1/messages":
        assert result.json()["type"] == "error"
        assert error["type"] == "invalid_request_error"
    else:
        assert error["code"] == "insufficient_credits"
    assert error["message"] == (
        "You have no available credits. Open Credits to check your balance and pending holds."
    )
    send.assert_not_called()


@pytest.mark.parametrize(
    "input_tokens,output_tokens,model_limit,provider_credits,status,code,guidance",
    [
        pytest.param(
            20_000, 880_000, 1_000_000, "100000", 402, "insufficient_credits",
            ("up to 900,000 tokens", "cover 100,000",
             "Lower the reply limit to 80,000 tokens or choose a cheaper model."),
            id="reply-unaffordable",
        ),
        pytest.param(
            100_000, None, 1_000_000, "100000", 402, "insufficient_credits",
            ("The prompt and chat history use an estimated 100,000 tokens",
             "Shorten the prompt, start a new chat, or choose a cheaper model."),
            id="input-uses-budget",
        ),
        pytest.param(
            20_000, 80_000, 1_000_000, "0", 503, "provider_credits_exhausted",
            ("This model is currently unavailable. Try another model or contact your administrator.",),
            id="provider-balance",
        ),
        pytest.param(
            20_000, 880_000, 60_000, "100000", 400, "output_limit_exceeded",
            ("This model can reply with up to 40,000 tokens for this prompt.", "Lower the reply limit"),
            id="model-reply-limit",
        ),
        pytest.param(
            60_000, None, 60_000, "100000", 400, "output_limit_exceeded",
            ("The prompt and chat history leave no room for a reply on this model.", "Shorten the prompt"),
            id="model-input-limit",
        ),
    ],
)
def test_admission_errors_explain_how_to_fix_request(
    client, credits_db, monkeypatch, input_tokens, output_tokens, model_limit,
    provider_credits, status, code, guidance,
):
    configure_rate(max_tokens=model_limit)
    service.add_credits("user", "user", addition("10000"), "admin")
    if provider_credits != "0":
        service.add_credits("provider", "provider", addition(provider_credits), "admin")
    before = balances(credits_db)
    monkeypatch.setattr(
        "backend.gateway.execution.estimate_input_tokens", lambda payload, candidate: input_tokens
    )
    send = AsyncMock()
    monkeypatch.setattr("backend.gateway.execution.call_provider", send)
    result = client.post(
        "/v1/chat/completions",
        headers={"x-api-key": "test-key"},
        json={"model": "a/model-a", "max_tokens": output_tokens},
    )
    assert result.status_code == status, result.text
    error = result.json()["error"]
    assert error["code"] == code
    assert all(part in error["message"] for part in guidance), error["message"]
    if code == "insufficient_credits" and output_tokens is None:
        assert "reply limit" not in error["message"]
    send.assert_not_called()
    assert balances(credits_db) == before
    with credits_db.reads() as db:
        assert db.query(CreditUsage).count() == 0


@pytest.mark.parametrize(
    ("protocol", "count_times_out"),
    [("openai", False), ("anthropic", False), ("anthropic", True)],
)
def test_provider_aware_count_allows_request_rejected_by_byte_estimate(
    client, credits_db, monkeypatch, protocol, count_times_out
):
    configure_rate()
    service.add_credits("provider", "provider", addition(), "admin")
    service.add_credits("user", "user", addition("15"), "admin")
    model = "gpt-4o-mini" if protocol == "openai" else "claude-sonnet-4-6"
    model_id = f"a/{model}"
    with credits_db.writes.begin() as db:
        synced_model = db.get(ProviderModel, "model")
        synced_model.model_name = model
        synced_model.model_id = model_id
        provider = db.get(Provider, "provider")
        provider.protocol = protocol
        if protocol == "anthropic":
            provider.base_url = "https://api.anthropic.com/v1"

    def count(url, *, headers, json, timeout):
        assert url == "https://api.anthropic.com/v1/messages/count_tokens"
        assert json["model"] == model
        assert json["messages"][0]["content"] == [{"type": "text", "text": prompt}]
        assert "max_tokens" not in json
        if count_times_out:
            raise httpx.ReadTimeout("Token counter timed out")
        return httpx.Response(
            200, json={"input_tokens": 65}, request=httpx.Request("POST", url)
        )

    prompt = "hello " * 60
    body = upstream_response(protocol)
    if protocol == "anthropic":
        monkeypatch.setattr("backend.gateway.providers.service.httpx.post", count)
    else:

        def encoding_for_model(name):
            assert name == model
            return SimpleNamespace(encode_ordinary=lambda text: range(65))

        monkeypatch.setattr(
            "backend.gateway.execution.tiktoken.encoding_for_model", encoding_for_model
        )
    send = AsyncMock(return_value=httpx.Response(200, json=body))
    monkeypatch.setattr("backend.gateway.execution.call_provider", send)
    result = client.post(
        "/v1/chat/completions",
        headers={"x-api-key": "test-key"},
        json={
            "model": model_id,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 20,
        },
    )
    if count_times_out:
        assert result.status_code == 402, result.text
        assert result.json()["error"]["code"] == "insufficient_credits"
        send.assert_not_awaited()
        with credits_db.reads() as db:
            assert db.query(CreditUsage).count() == 0
        return

    assert result.status_code == 200, result.text
    send.assert_awaited_once()
    assert send.call_args.args[1]["max_tokens"] == 20
    with credits_db.reads() as db:
        usage = db.query(CreditUsage).one()
        assert usage.status == "settled"
        assert (usage.input_tokens, usage.output_tokens) == (25, 10)


@pytest.mark.parametrize("protocol", ["openai", "anthropic"])
def test_converted_streams_finalize_successful_traces_once(
    client, credits_db, monkeypatch, protocol
):
    fund_request(credits_db)
    with credits_db.writes.begin() as db:
        db.get(User, "user").tracing_enabled = True
        db.get(Provider, "provider").protocol = protocol
    if protocol == "anthropic":
        events = [
            {
                "type": "message_start",
                "message": {"id": "msg-traced", "usage": {"input_tokens": 25}},
            },
            {
                "type": "message_delta",
                "delta": {"stop_reason": "end_turn"},
                "usage": {"output_tokens": 10},
            },
            {"type": "message_stop"},
        ]
        path = "/v1/chat/completions"
        content = "".join(f"data: {json.dumps(event)}\n\n" for event in events)
    else:
        path = "/v1/messages"
        content = f"data: {json.dumps({'id': 'chat-traced', 'choices': [], 'usage': {'prompt_tokens': 25, 'completion_tokens': 10}})}\n\ndata: [DONE]\n\n"
    monkeypatch.setattr(
        "backend.gateway.execution.call_provider",
        AsyncMock(return_value=httpx.Response(200, content=content)),
    )
    result = client.post(
        path,
        headers={"x-api-key": "test-key"},
        json={"model": "a/model-a", "stream": True, "max_tokens": 100},
    )
    assert result.status_code == 200
    with credits_db.reads() as db:
        row = db.execute(
            text("SELECT status, input_tokens, output_tokens FROM llm_call_traces")
        ).one()
        assert tuple(row) == ("success", 25, 10)
        assert (
            db.execute(text("SELECT call_count FROM llm_api_key_usage_daily")).scalar()
            == 1
        )


def test_closing_stream_keeps_unfinished_usage_reserved(credits_db, monkeypatch):
    import asyncio
    import json

    from backend.gateway.execution import dispatch_request
    from backend.gateway.streaming import sse
    from backend.traces.capture import CallCapture

    fund_request(credits_db)
    request = SimpleNamespace(
        state=SimpleNamespace(api_key_owner_id="user", api_key_id="key")
    )
    capture = CallCapture(user_id="user", api_key_id="key", request_json=None)
    content = f"data: {json.dumps({'id': 'disconnected', 'choices': [{'delta': {'content': 'Hello'}}]})}\n\n"
    response = httpx.Response(200, content=content)
    monkeypatch.setattr(
        "backend.gateway.execution.call_provider", AsyncMock(return_value=response)
    )

    async def disconnect():
        execution, _ = await dispatch_request(
            request, {"model": "a/model-a", "stream": True}, capture
        )
        events = execution.stream_events()

        async def pieces():
            async for item in events:
                yield sse(item)

        stream = execution.stream_response(pieces()).body_iterator
        await anext(stream)
        await stream.aclose()

    asyncio.run(disconnect())
    assert response.is_closed
    assert balances(credits_db)[0].reserved_credits == "100.000000"
    with credits_db.reads() as db:
        assert db.query(CreditUsage).one().status == "needs_review"


def test_migration_0014_renames_stale_tokens_per_credit_columns(tmp_path):
    """Databases migrated by an intermediate usage-credits build carry a
    `tokens_per_credit` column that the final models never read; 0014 renames
    it in place (CHECK constraints and indexes follow in SQLite)."""
    import sqlite3
    from pathlib import Path

    from backend.core.migrations import MIGRATIONS, run_pending_migrations

    path = tmp_path / "stale-credit-schema.db"
    db = sqlite3.connect(str(path))
    db.executescript(
        """
        CREATE TABLE schema_migrations (
            version VARCHAR(64) PRIMARY KEY,
            applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE credit_model_rates (
            id VARCHAR(36) PRIMARY KEY,
            provider_model_id VARCHAR(36) NOT NULL,
            version INTEGER NOT NULL,
            tokens_per_credit BIGINT NOT NULL CHECK (tokens_per_credit > 0),
            max_request_tokens INTEGER NOT NULL,
            max_output_tokens INTEGER NOT NULL,
            actor_id VARCHAR(36) NOT NULL,
            created_at TIMESTAMP NOT NULL
        );
        CREATE TABLE credit_usage (
            id VARCHAR(36) PRIMARY KEY,
            tokens_per_credit BIGINT NOT NULL CHECK (tokens_per_credit > 0),
            reserved BIGINT NOT NULL,
            charged BIGINT NOT NULL DEFAULT 0,
            status VARCHAR(20) NOT NULL
        );
        INSERT INTO credit_model_rates VALUES
            ('rate-1', 'model-1', 1, 5000000, 1000, 100, 'actor-1', '2026-01-01');
        INSERT INTO credit_usage VALUES ('usage-1', 5000000, 100, 50, 'needs_review');
        """
    )
    # The intermediate build recorded every earlier migration as applied; only
    # the 0014 rename is pending.
    stale_version = "0014_credit_micros_rename"
    for version, _ in MIGRATIONS:
        if version != stale_version:
            db.execute("INSERT INTO schema_migrations (version) VALUES (?)", (version,))
    db.commit()
    db.close()

    engine = create_engine(f"sqlite:///{path}")
    applied = run_pending_migrations(engine)
    engine.dispose()

    assert "0014_credit_micros_rename" in applied

    db = sqlite3.connect(str(path))
    rate_columns = {row[1] for row in db.execute("PRAGMA table_info(credit_model_rates)")}
    usage_columns = {row[1] for row in db.execute("PRAGMA table_info(credit_usage)")}
    assert "tokens_per_credit" not in rate_columns | usage_columns
    assert "tokens_per_credit_micros" in rate_columns
    assert "tokens_per_credit_micros" in usage_columns
    # The renamed column still feeds its CHECK constraint.
    try:
        db.execute(
            "INSERT INTO credit_model_rates VALUES"
            " ('rate-2', 'model-1', 2, 0, 1000, 100, 'actor-1', '2026-01-02')"
        )
        raise AssertionError("expected the CHECK constraint to reject tokens_per_credit_micros = 0")
    except sqlite3.IntegrityError:
        pass
    assert db.execute("SELECT tokens_per_credit_micros FROM credit_model_rates").fetchall() == [(5000000,)]
    assert db.execute("SELECT tokens_per_credit_micros, charged FROM credit_usage").fetchall() == [(5000000, 50)]
    assert db.execute("PRAGMA foreign_key_check").fetchall() == []
    db.close()
    assert Path(path).exists()


def test_migration_0015_removes_max_output_tokens(tmp_path):
    import sqlite3
    from pathlib import Path

    from backend.core.migrations import MIGRATIONS, run_pending_migrations

    path = tmp_path / "migration-0015.db"
    db = sqlite3.connect(str(path))
    db.executescript(
        """
        CREATE TABLE schema_migrations (
            version VARCHAR(64) PRIMARY KEY,
            applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE provider_models (
            id VARCHAR(36) PRIMARY KEY
        );
        CREATE TABLE credit_model_rates (
            id VARCHAR(36) PRIMARY KEY,
            provider_model_id VARCHAR(36) NOT NULL,
            version INTEGER NOT NULL,
            tokens_per_credit_micros BIGINT NOT NULL CHECK (tokens_per_credit_micros > 0),
            max_request_tokens INTEGER NOT NULL,
            max_output_tokens INTEGER NOT NULL,
            actor_id VARCHAR(36) NOT NULL,
            created_at TIMESTAMP NOT NULL,
            UNIQUE (provider_model_id, version),
            CHECK (max_request_tokens > 0 AND max_output_tokens > 0 AND max_output_tokens <= max_request_tokens)
        );
        CREATE TABLE credit_usage (
            id VARCHAR(36) PRIMARY KEY,
            max_request_tokens INTEGER NOT NULL,
            max_output_tokens INTEGER NOT NULL
        );
        INSERT INTO provider_models VALUES ('pm-1');
        INSERT INTO credit_model_rates VALUES
            ('rate-1', 'pm-1', 1, 5000000, 1000, 100, 'actor-1', '2026-01-01');
        INSERT INTO credit_usage VALUES ('usage-1', 1000, 100);
        """
    )
    for version, _ in MIGRATIONS:
        if version not in {"0015_remove_max_output_tokens", "0016_optional_model_token_ceiling"}:
            db.execute("INSERT INTO schema_migrations (version) VALUES (?)", (version,))
    db.commit()
    db.close()

    engine = create_engine(f"sqlite:///{path}")
    applied = run_pending_migrations(engine)
    engine.dispose()

    assert "0015_remove_max_output_tokens" in applied
    assert "0016_optional_model_token_ceiling" in applied

    db = sqlite3.connect(str(path))
    rate_columns = {row[1] for row in db.execute("PRAGMA table_info(credit_model_rates)")}
    usage_columns = {row[1] for row in db.execute("PRAGMA table_info(credit_usage)")}
    assert "max_output_tokens" not in rate_columns
    assert "max_output_tokens" not in usage_columns
    assert "max_request_tokens" in rate_columns
    assert "max_request_tokens" in usage_columns

    assert db.execute(
        "SELECT max_request_tokens FROM credit_model_rates WHERE id = 'rate-1'"
    ).fetchone() == (1000,)
    db.execute(
        "INSERT INTO credit_model_rates VALUES"
        " ('automatic', 'pm-1', 3, 5000000, NULL, 'actor-1', '2026-01-02')"
    )

    # Verify check constraint: max_request_tokens must still be > 0
    try:
        db.execute(
            "INSERT INTO credit_model_rates VALUES"
            " ('rate-2', 'pm-1', 2, 5000000, 0, 'actor-1', '2026-01-02')"
        )
        raise AssertionError("expected CHECK constraint to reject max_request_tokens = 0")
    except sqlite3.IntegrityError:
        pass

    assert db.execute("PRAGMA foreign_key_check").fetchall() == []
    db.close()


@pytest.mark.parametrize("protocol", ["openai", "anthropic"])
@pytest.mark.parametrize("error_then_terminal", [False, True])
def test_responses_stream_reports_upstream_failure(
    client, credits_db, monkeypatch, protocol, error_then_terminal
):
    fund_request(credits_db)
    with credits_db.writes.begin() as db:
        db.get(Provider, "provider").protocol = protocol

    if protocol == "anthropic":
        content = 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"partial"}}\n\n'
        terminal = 'data: {"type":"message_stop"}\n\n'
    else:
        content = 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'
        terminal = "data: [DONE]\n\n"
    if error_then_terminal:
        content += 'data: {"type":"error","error":{"message":"private details"}}\n\n'
        content += terminal
    monkeypatch.setattr(
        "backend.gateway.execution.call_provider",
        AsyncMock(return_value=httpx.Response(200, content=content)),
    )

    result = client.post(
        "/v1/responses",
        headers={"x-api-key": "test-key"},
        json={"model": "a/model-a", "input": "Hello", "stream": True},
    )

    assert result.status_code == 200
    assert "event: response.output_text.delta" in result.text
    assert "event: response.failed" in result.text
    assert "event: response.completed" not in result.text
    assert "private details" not in result.text
    with credits_db.reads() as db:
        assert db.query(CreditUsage).one().status == "needs_review"


@pytest.mark.parametrize("stream", [False, True])
def test_provider_error_is_closed_without_reading_body(client, credits_db, monkeypatch, stream):
    fund_request(credits_db)
    with credits_db.writes.begin() as db:
        db.get(User, "user").tracing_enabled = False

    class ProviderErrorBody(httpx.AsyncByteStream):
        async def __aiter__(self):
            pytest.fail("The error response body should not be read")
            yield b"private diagnostic"

    upstream_response = httpx.Response(429, stream=ProviderErrorBody())
    transport = httpx.MockTransport(lambda request: upstream_response)
    upstream_client = httpx.AsyncClient(transport=transport)
    monkeypatch.setattr("backend.gateway.providers.service.get_client", lambda: upstream_client)
    result = client.post(
        "/v1/chat/completions",
        headers={"x-api-key": "test-key"},
        json={"model": "a/model-a", "stream": stream},
    )

    assert result.status_code == 429
    assert result.json()["error"]["message"] == "Provider returned an error"
    assert upstream_response.is_closed


@pytest.mark.parametrize(
    "protocol,status,body,stream_event,message,code",
    [
        ("openai", 429, '{"error":{"message":"Quota exceeded","code":"insufficient_quota"}}',
         False, "Quota exceeded", "insufficient_quota"),
        ("anthropic", 403, '{"type":"error","error":{"type":"permission_error","message":"Access denied"}}',
         False, "Access denied", None),
        ("openai", 503, "Provider maintenance", False, "Provider maintenance", None),
        (
            "openai", 200,
            '{"error":{"message":"Invalid model test-key provider-secret","code":"model_not_found","token":"private"}}',
            False, "Invalid model [REDACTED] [REDACTED]", "model_not_found",
        ),
        ("openai", 200, '{"error":{"message":"Server overloaded","code":"overloaded"}}',
         True, "Server overloaded", "overloaded"),
    ],
)
def test_trace_records_provider_failure(
    client, credits_db, monkeypatch, protocol, status, body, stream_event, message, code
):
    from backend.core.crypto import encrypt_secret
    from backend.traces.models import LLMCallTrace

    fund_request(credits_db)
    with credits_db.writes.begin() as db:
        db.get(User, "user").tracing_enabled = True
        provider = db.get(Provider, "provider")
        provider.protocol = protocol
        provider.api_key = encrypt_secret("provider-secret")

    if stream_event:
        body = f"event: error\ndata: {body}\n\ndata: [DONE]\n\n"
    response = httpx.Response(status, text=body)
    upstream_client = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: response))
    monkeypatch.setattr("backend.gateway.providers.service.get_client", lambda: upstream_client)

    result = client.post(
        "/v1/responses",
        headers={"x-api-key": "test-key"},
        json={"model": "a/model-a", "input": "Hello", "stream": stream_event},
    )

    assert result.status_code == (502 if status == 200 and not stream_event else status)
    assert message not in result.text
    assert response.is_closed
    with credits_db.reads() as db:
        call = db.query(LLMCallTrace).one()
        assert call.status == "failed"
        assert call.error_code == "upstream_error"
        details = call.error_details
        assert details["provider_status"] == status
        assert details["provider_message"] == message
        assert details["provider_code"] == code
        assert details["upstream_model"] == "model-a"
        assert details["operation"] == (
            "POST /v1/messages" if protocol == "anthropic" else "POST /v1/chat/completions"
        )
        if protocol == "anthropic":
            assert details["provider_type"] == "permission_error"
        if code == "model_not_found":
            assert details["provider_response"]["error"]["token"] == "[REDACTED]"
            assert "test-key" not in json.dumps(details)
            assert "provider-secret" not in json.dumps(details)
        assert details["provider_response"] is not None


@pytest.mark.parametrize("slow_body", [False, True])
def test_trace_keeps_upstream_status_when_body_exceeds_capture_budget(
    client, credits_db, monkeypatch, slow_body
):
    import asyncio

    from backend.traces.models import LLMCallTrace

    fund_request(credits_db)
    with credits_db.writes.begin() as db:
        db.get(User, "user").tracing_enabled = True

    class ProviderErrorBody(httpx.AsyncByteStream):
        async def __aiter__(self):
            if slow_body:
                await asyncio.sleep(5)
                pytest.fail("The error body read was not interrupted")
            yield b"x" * (32 * 1024)

    response = httpx.Response(429, stream=ProviderErrorBody())
    transport = httpx.MockTransport(lambda request: response)
    upstream_client = httpx.AsyncClient(transport=transport)
    monkeypatch.setattr("backend.gateway.providers.service.get_client", lambda: upstream_client)

    result = client.post(
        "/v1/responses",
        headers={"x-api-key": "test-key"},
        json={"model": "a/model-a", "input": "Hello"},
    )

    assert result.status_code == 429
    assert response.is_closed
    with credits_db.reads() as db:
        details = db.query(LLMCallTrace).one().error_details
        assert details["provider_status"] == 429
        assert details.get("provider_response") is None


def test_messages_pass_stop_sequences_to_openai(client, credits_db, monkeypatch):
    fund_request(credits_db)
    send = AsyncMock(return_value=httpx.Response(200, json=upstream_response()))
    monkeypatch.setattr("backend.gateway.execution.call_provider", send)

    result = client.post(
        "/v1/messages",
        headers={"x-api-key": "test-key"},
        json={
            "model": "a/model-a",
            "messages": [{"role": "user", "content": "Hello"}],
            "stop_sequences": ["END"],
        },
    )

    assert result.status_code == 200
    assert send.call_args.args[1]["stop"] == ["END"]


def test_refresh_requires_an_active_user(client, credits_db):
    from backend.core.security import create_refresh_token

    token = create_refresh_token("user")
    assert client.post("/auth/refresh", json={"refresh_token": token}).status_code == 200

    with credits_db.writes.begin() as db:
        db.get(User, "user").is_active = False
    assert client.post("/auth/refresh", json={"refresh_token": token}).status_code == 401

    missing_token = create_refresh_token("deleted-user")
    assert client.post("/auth/refresh", json={"refresh_token": missing_token}).status_code == 401
