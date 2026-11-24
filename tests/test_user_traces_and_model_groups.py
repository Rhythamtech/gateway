from datetime import datetime, timezone
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

import backend.api_keys.models  # noqa: F401
import backend.auth.models  # noqa: F401
import backend.gateway.model_groups.models  # noqa: F401
import backend.gateway.provider_models.models  # noqa: F401
import backend.gateway.providers.models  # noqa: F401
import backend.traces.models  # noqa: F401
from backend.auth.models import User, UserRole
from backend.core.database import Base
from backend.credits.models import ModelCreditRate
from backend.gateway.model_groups.models import ModelGroup, ModelGroupMember
from backend.gateway.provider_models.models import ProviderModel
from backend.gateway.providers.models import Provider
from backend.traces.models import LLMCallTrace, LLMMessageTrace


@pytest.fixture
def test_db(monkeypatch, tmp_path):
    path = tmp_path / "app.db"
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
    from backend.core.migrations import _migration_0017_gateway_log_retention
    with writer.begin() as connection:
        _migration_0017_gateway_log_retention(connection)
    writes = sessionmaker(writer, expire_on_commit=False)
    reads = sessionmaker(reader, expire_on_commit=False)

    monkeypatch.setattr("backend.core.database.write_engine", writer)
    monkeypatch.setattr("backend.core.database.engine", reader)
    monkeypatch.setattr("backend.core.database.SessionLocal", writes)
    monkeypatch.setattr("backend.credits.service.SessionLocal", writes)
    monkeypatch.setattr("backend.traces.service.SessionLocal", writes)
    monkeypatch.setattr("backend.api_keys.middleware.SessionLocal", writes)

    class DB:
        pass

    db_obj = DB()
    db_obj.writes = writes
    db_obj.reads = reads
    return db_obj


@pytest.fixture
def client(test_db):
    from backend.core.database import get_db
    from backend.main import app

    def read_database():
        with test_db.reads() as db:
            yield db

    app.dependency_overrides[get_db] = read_database
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def make_token(user_id: str) -> dict[str, str]:
    from backend.core.security import create_access_token

    return {"Authorization": f"Bearer {create_access_token(user_id)}"}


def test_model_catalog_lists_enabled_groups_with_current_rates(test_db, client):
    user_id = str(uuid4())
    with test_db.writes.begin() as db:
        user = User(id=user_id, email="catalog@example.com", hashed_password="hash")
        db.add(user)
        provider = Provider(id="p", name="Provider", aliases="p", base_url="https://example.com")
        disabled = Provider(
            id="off", name="Disabled", aliases="off",
            base_url="https://example.org", is_enabled=False,
        )
        db.add_all([provider, disabled])
        db.flush()

        for name, provider_id, available in (
            ("first", "p", True),
            ("second", "p", True),
            ("unpriced", "p", True),
            ("unavailable", "p", False),
            ("private", "off", True),
        ):
            db.add(ProviderModel(
                id=name, provider_id=provider_id, model_name=name,
                model_id=f"{provider_id}/{name}", is_available=available,
            ))
        for group_id, name, enabled in (
            ("public", "Public group", True),
            ("unpriced", "Unpriced group", True),
            ("unavailable", "Unavailable group", True),
            ("disabled", "Disabled group", False),
        ):
            db.add(ModelGroup(
                id=group_id, name=name, model_id=f"group/{group_id}",
                routing_strategy="priority", created_by=user_id, is_enabled=enabled,
            ))
        db.flush()

        for model in ("first", "second", "unpriced", "unavailable", "private"):
            db.add(ModelGroupMember(model_group_id="public", provider_model_id=model))
        for group_id, model in (
            ("unpriced", "unpriced"), ("unavailable", "unavailable"), ("disabled", "first"),
        ):
            db.add(ModelGroupMember(model_group_id=group_id, provider_model_id=model))
        for model, version, rate in (
            ("first", 1, 500), ("first", 2, 2000), ("second", 1, 4000),
            ("unavailable", 1, 50), ("private", 1, 25),
        ):
            db.add(ModelCreditRate(
                provider_model_id=model, version=version,
                tokens_per_credit_micros=rate * 1_000_000, actor_id=user_id,
            ))

    assert client.get("/models").status_code == 401
    token = make_token(user_id)
    assert client.get("/v1/models", headers=token).status_code == 401
    response = client.get("/models", headers=token)
    assert response.status_code == 200
    catalog = response.json()
    assert catalog["requests_per_minute_per_key"] == 60
    models = {model["model_id"]: model for model in catalog["models"]}
    assert set(models) == {"group/public", "group/unpriced", "group/unavailable"}
    assert models["group/public"] == {
        "name": "Public group",
        "model_id": "group/public",
        "status": "ready",
        "tokens_per_credit": {"min": "2000.000000", "max": "4000.000000"},
        "credits_per_million_tokens": {"min": "250", "max": "500"},
    }
    assert models["group/unpriced"]["status"] == "rate_needed"
    assert models["group/unavailable"]["status"] == "unavailable"
    assert models["group/unavailable"]["tokens_per_credit"] is None


def test_user_preferences_toggle_tracing(test_db, client):
    now = datetime.now(timezone.utc)
    user_id = str(uuid4())
    with test_db.writes() as db:
        user = User(
            id=user_id,
            email="user@example.com",
            hashed_password="hash",
            role=UserRole.USER,
            is_active=True,
            tracing_enabled=False,
            telemetry_enabled=False,
            created_at=now,
        )
        db.add(user)
        db.commit()

    token = make_token(user_id)

    # Check initial user info
    res = client.get("/users/me", headers=token)
    assert res.status_code == 200
    assert res.json()["tracing_enabled"] is False

    # Regular user can enable tracing
    patch_res = client.patch(
        "/users/me/preferences",
        json={"tracing_enabled": True},
        headers=token,
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["tracing_enabled"] is True

    # Regular user can disable tracing
    patch_res = client.patch(
        "/users/me/preferences",
        json={"tracing_enabled": False},
        headers=token,
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["tracing_enabled"] is False


def test_regular_user_can_view_model_groups(test_db, client):
    now = datetime.now(timezone.utc)
    user_id = str(uuid4())
    admin_id = str(uuid4())
    group_id = str(uuid4())
    with test_db.writes() as db:
        user = User(
            id=user_id,
            email="user2@example.com",
            hashed_password="hash",
            role=UserRole.USER,
            is_active=True,
            created_at=now,
        )
        admin = User(
            id=admin_id,
            email="admin2@example.com",
            hashed_password="hash",
            role=UserRole.SUPERUSER,
            is_active=True,
            created_at=now,
        )
        group = ModelGroup(
            id=group_id,
            name="Test Group",
            model_id="alias/test-model",
            routing_strategy="round_robin",
            is_enabled=True,
            created_by=admin.id,
            created_at=now,
            updated_at=now,
        )
        db.add_all([user, admin, group])
        db.commit()

    user_token = make_token(user_id)

    # Regular user can list model groups
    list_res = client.get("/model-groups", headers=user_token)
    assert list_res.status_code == 200
    body = list_res.json()
    assert body["total"] == 1
    assert body["items"][0]["model_id"] == "alias/test-model"

    # Regular user can get model group detail
    get_res = client.get(f"/model-groups/{group_id}", headers=user_token)
    assert get_res.status_code == 200
    assert get_res.json()["model_id"] == "alias/test-model"

    # Regular user cannot create or patch model groups
    create_res = client.post(
        "/model-groups",
        json={"name": "Bad", "model_id": "alias/model", "routing_strategy": "round_robin"},
        headers=user_token,
    )
    assert create_res.status_code == 403


def test_traces_scoped_to_user(test_db, client):
    now = datetime.now(timezone.utc)
    user1_id = str(uuid4())
    user2_id = str(uuid4())
    admin_id = str(uuid4())

    msg1_id = str(uuid4())
    msg2_id = str(uuid4())
    call1_id = str(uuid4())
    call2_id = str(uuid4())

    with test_db.writes() as db:
        u1 = User(
            id=user1_id,
            email="u1@example.com",
            hashed_password="hash",
            role=UserRole.USER,
            is_active=True,
            tracing_enabled=True,
            created_at=now,
        )
        u2 = User(
            id=user2_id,
            email="u2@example.com",
            hashed_password="hash",
            role=UserRole.USER,
            is_active=True,
            tracing_enabled=True,
            created_at=now,
        )
        admin = User(
            id=admin_id,
            email="admin@example.com",
            hashed_password="hash",
            role=UserRole.SUPERUSER,
            is_active=True,
            created_at=now,
        )
        db.add_all([u1, u2, admin])
        db.flush()

        msg1 = LLMMessageTrace(
            id=msg1_id,
            user_id=user1_id,
            message_id="m-1",
            request_json='{"prompt": "hello"}',
            created_at=now,
        )
        msg2 = LLMMessageTrace(
            id=msg2_id,
            user_id=user2_id,
            message_id="m-2",
            request_json='{"prompt": "world"}',
            created_at=now,
        )
        db.add_all([msg1, msg2])
        db.flush()

        call1 = LLMCallTrace(
            id=call1_id,
            message_trace_id=msg1_id,
            user_id=user1_id,
            status="failed",
            error_code="upstream_error",
            error_details={
                "provider_status": 429,
                "provider_message": "Quota exceeded",
                "provider_response": {"error": {"message": "Quota exceeded"}},
            },
            created_at=now,
        )
        call2 = LLMCallTrace(
            id=call2_id,
            message_trace_id=msg2_id,
            user_id=user2_id,
            status="success",
            created_at=now,
        )
        db.add_all([call1, call2])
        db.commit()

    token1 = make_token(user1_id)
    token2 = make_token(user2_id)
    admin_token = make_token(admin_id)

    # User 1 lists messages -> only msg1
    res1 = client.get("/traces/messages", headers=token1)
    assert res1.status_code == 200
    assert res1.json()["total"] == 1
    assert res1.json()["items"][0]["id"] == msg1_id

    # User 1 can view own message trace
    detail1 = client.get(f"/traces/messages/{msg1_id}", headers=token1)
    assert detail1.status_code == 200
    assert detail1.json()["id"] == msg1_id
    assert detail1.json()["calls"][0]["error_details"]["provider_status"] == 429

    # User 1 CANNOT view user 2's message trace (403)
    forbidden_detail = client.get(f"/traces/messages/{msg2_id}", headers=token1)
    assert forbidden_detail.status_code == 403

    # User 1 lists calls -> only call1
    calls_res1 = client.get("/traces/calls", headers=token1)
    assert calls_res1.status_code == 200
    assert calls_res1.json()["total"] == 1
    assert calls_res1.json()["items"][0]["id"] == call1_id
    assert calls_res1.json()["items"][0]["error_details"] is None

    # User 1 can view own call trace
    call_detail1 = client.get(f"/traces/calls/{call1_id}", headers=token1)
    assert call_detail1.status_code == 200
    assert call_detail1.json()["id"] == call1_id
    assert call_detail1.json()["error_details"]["provider_response"] == {
        "error": {"message": "Quota exceeded"}
    }

    # User 1 CANNOT view user 2's call trace (403)
    call_forbidden = client.get(f"/traces/calls/{call2_id}", headers=token1)
    assert call_forbidden.status_code == 403
    assert client.get(f"/traces/calls/{call1_id}", headers=token2).status_code == 403

    # Superuser sees both messages and both calls
    admin_msgs = client.get("/traces/messages", headers=admin_token)
    assert admin_msgs.status_code == 200
    assert admin_msgs.json()["total"] == 2

    admin_calls = client.get("/traces/calls", headers=admin_token)
    assert admin_calls.status_code == 200
    assert admin_calls.json()["total"] == 2

    for path, own_id, other_id in (
        ("/traces/messages", msg1_id, msg2_id),
        ("/traces/calls", call1_id, call2_id),
    ):
        def search(headers, request_id):
            response = client.get(path, headers=headers, params={"request_id": request_id})
            assert response.status_code == 200
            data = response.json()
            assert data["total"] == len(data["items"])
            return [item["id"] for item in data["items"]]

        assert search(token1, msg1_id) == [own_id]
        assert search(token1, msg2_id) == []
        assert search(admin_token, msg2_id) == [other_id]
        assert search(admin_token, "m-2") == [other_id]
        assert search(admin_token, "m-") == []


def test_superuser_can_clear_completed_traces_for_every_user(test_db, client):
    from backend.traces import service
    from backend.traces.models import LLMUserUsageDaily

    admin_id = str(uuid4())
    user_id = str(uuid4())
    with test_db.writes.begin() as db:
        db.add_all([
            User(
                id=admin_id,
                email="admin@example.com",
                hashed_password="hash",
                role=UserRole.SUPERUSER,
            ),
            User(
                id=user_id,
                email="regular@example.com",
                hashed_password="hash",
                role=UserRole.USER,
            ),
        ])

    completed = [
        service.record_attempt(user_id=owner_id, status=service.STATUS_SUCCESS)
        for owner_id in (admin_id, user_id)
    ]
    pending_message, pending_call = service.start_pending_attempt(user_id=user_id)

    assert client.delete("/traces/messages").status_code == 401
    forbidden = client.delete("/traces/messages", headers=make_token(user_id))
    assert forbidden.status_code == 403
    assert forbidden.json()["error"]["code"] == "FORBIDDEN"

    admin_token = make_token(admin_id)
    response = client.delete("/traces/messages", headers=admin_token)
    assert response.status_code == 200
    assert response.json() == {"deleted_count": 2}
    with test_db.reads() as db:
        assert [row.id for row in db.query(LLMMessageTrace).all()] == [pending_message]
        assert [row.id for row in db.query(LLMCallTrace).all()] == [pending_call]
        assert db.query(LLMUserUsageDaily).count() == 2

    assert client.get(f"/traces/messages/{completed[1]}", headers=admin_token).status_code == 404
    assert client.delete("/traces/messages", headers=admin_token).json() == {"deleted_count": 0}

    service.finish_pending_attempt(call_trace_id=pending_call, status=service.STATUS_SUCCESS)
    assert client.delete("/traces/messages", headers=admin_token).json() == {"deleted_count": 1}


def test_gateway_model_usage_reports_no_cost(test_db, client):
    now = datetime.now(timezone.utc)
    user_id = str(uuid4())
    admin_id = str(uuid4())
    group_id = str(uuid4())
    with test_db.writes() as db:
        user = User(
            id=user_id,
            email="cost-user@example.com",
            hashed_password="hash",
            role=UserRole.USER,
            is_active=True,
            created_at=now,
        )
        admin = User(
            id=admin_id,
            email="cost-admin@example.com",
            hashed_password="hash",
            role=UserRole.SUPERUSER,
            is_active=True,
            created_at=now,
        )
        group = ModelGroup(
            id=group_id,
            name="Cost Group",
            model_id="alias/cost-model",
            routing_strategy="round_robin",
            is_enabled=True,
            created_by=admin_id,
            created_at=now,
            updated_at=now,
        )
        db.add_all([user, admin, group])
        db.commit()

    # Gateway-model usage cannot attribute charges to a model, so cost is
    # always null there — daily trace totals stay the only series.
    body = client.get(
        f"/traces/usage/gateway-models/{group_id}", headers=make_token(user_id)
    ).json()
    assert body["cost"] is None

    # The same endpoint for a user subject always carries a cost block, even
    # when the ledger is empty.
    body = client.get("/traces/usage/me", headers=make_token(user_id)).json()
    assert body["cost"]["totals"]["charged_credits"] == "0.000000"
    assert body["cost"]["daily"] == []
