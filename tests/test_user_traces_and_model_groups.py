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
from backend.gateway.model_groups.models import ModelGroup
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
            status="success",
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

    # User 1 CANNOT view user 2's message trace (403)
    forbidden_detail = client.get(f"/traces/messages/{msg2_id}", headers=token1)
    assert forbidden_detail.status_code == 403

    # User 1 lists calls -> only call1
    calls_res1 = client.get("/traces/calls", headers=token1)
    assert calls_res1.status_code == 200
    assert calls_res1.json()["total"] == 1
    assert calls_res1.json()["items"][0]["id"] == call1_id

    # User 1 can view own call trace
    call_detail1 = client.get(f"/traces/calls/{call1_id}", headers=token1)
    assert call_detail1.status_code == 200
    assert call_detail1.json()["id"] == call1_id

    # User 1 CANNOT view user 2's call trace (403)
    call_forbidden = client.get(f"/traces/calls/{call2_id}", headers=token1)
    assert call_forbidden.status_code == 403

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
