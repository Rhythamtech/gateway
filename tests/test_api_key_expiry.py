from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from backend.api_keys.controller import router
from backend.api_keys.middleware import APIKeyAuthMiddleware
from backend.api_keys.models import APIKey, APIKeyUsage
from backend.core.database import get_db, get_write_db
from backend.core.migrations import _migration_0022_api_key_expiry
from backend.dependencies import get_current_user
from tests.test_credits import credits_db  # noqa: F401


@pytest.fixture
def key_client(credits_db):
    app = FastAPI()
    app.include_router(router)
    app.add_middleware(APIKeyAuthMiddleware)

    def read_db():
        with credits_db.reads() as db:
            yield db

    def write_db():
        with credits_db.writes() as db:
            yield db

    app.dependency_overrides[get_db] = read_db
    app.dependency_overrides[get_write_db] = write_db
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id="user")

    @app.api_route("/v1/{path:path}", methods=["GET", "POST"])
    def inference(path: str):
        return {"dispatched": True}

    with TestClient(app) as client:
        yield client


@pytest.mark.parametrize("expiry,hours", [("1h", 1), ("24h", 24), ("1week", 168), ("never", None), ("", None), (None, None), ("omitted", None)])
def test_create_and_list_expiry(key_client, expiry, hours):
    payload = {"name": "Integration"}
    if expiry != "omitted":
        payload["expires_in"] = expiry
    result = key_client.post("/api-keys", json=payload)
    assert result.status_code == 201
    created = result.json()
    if hours is None:
        assert created["expires_at"] is None
    else:
        start = datetime.fromisoformat(created["created_at"])
        end = datetime.fromisoformat(created["expires_at"])
        assert end - start == timedelta(hours=hours)
        assert created["expires_at"].endswith("Z")
    listed = key_client.get("/api-keys").json()["items"][0]
    assert listed["expires_at"] == created["expires_at"]
    assert "api_key" not in listed and "key_hash" not in listed
    assert key_client.get("/v1/models", headers={"Authorization": f"Bearer {created['api_key']}"}).status_code == 200


@pytest.mark.parametrize("expiry", ["2h", "1w", -1, 3600, {}, []])
def test_invalid_expiry_rejected(key_client, expiry):
    assert key_client.post("/api-keys", json={"name": "Invalid", "expires_in": expiry}).status_code == 422


@pytest.mark.parametrize("path", ["models", "chat/completions", "messages", "responses"])
@pytest.mark.parametrize("offset", [-1, 0, 1])
def test_expiry_boundary_blocks_dispatch_and_usage(key_client, credits_db, monkeypatch, path, offset):
    created = key_client.post("/api-keys", json={"name": "Boundary", "expires_in": "1h"}).json()
    boundary = datetime(2030, 1, 1, tzinfo=timezone.utc)
    with credits_db.writes.begin() as db:
        db.get(APIKey, created["id"]).expires_at = boundary

    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return boundary + timedelta(microseconds=offset)

    monkeypatch.setattr("backend.api_keys.middleware.datetime", FrozenDateTime)
    result = key_client.post(f"/v1/{path}", headers={"x-api-key": created["api_key"]})
    assert result.status_code == (200 if offset < 0 else 401)
    with credits_db.reads() as db:
        key = db.get(APIKey, created["id"])
        assert db.query(APIKeyUsage).filter_by(key_id=key.id).count() == (1 if offset < 0 else 0)
        assert (key.last_used_at is None) == (offset >= 0)
    if offset >= 0:
        body = result.json()
        assert body["error"]["message"] == "API key has expired"
        if path == "messages":
            assert body["type"] == "error"
        else:
            assert body["error"]["code"] == "authentication_error"


def test_expiry_does_not_bypass_revocation(key_client, credits_db):
    created = key_client.post("/api-keys", json={"name": "Revoked", "expires_in": "1h"}).json()
    with credits_db.writes.begin() as db:
        db.get(APIKey, created["id"]).revoked = True
    assert key_client.get("/v1/models", headers={"x-api-key": created["api_key"]}).status_code == 401


def test_migration_preserves_existing_keys_and_is_repeatable():
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE api_keys (id TEXT PRIMARY KEY, name TEXT NOT NULL)"))
        connection.execute(text("INSERT INTO api_keys VALUES ('existing', 'Legacy key')"))
        _migration_0022_api_key_expiry(connection)
        _migration_0022_api_key_expiry(connection)
        assert connection.execute(text("SELECT id, name, expires_at FROM api_keys")).one() == ("existing", "Legacy key", None)
    engine.dispose()
