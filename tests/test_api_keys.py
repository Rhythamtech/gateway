import hashlib

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api_keys import middleware
from backend.api_keys.models import APIKey, APIKeyUsage
from backend.auth.models import User, UserRole
from backend.core.database import Base, get_db
from backend.core.security import create_access_token
from backend.main import app


@pytest.fixture
def client(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    from sqlalchemy import event

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    testing_session = sessionmaker(bind=engine, autoflush=False)

    def override_db():
        db = testing_session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_db
    monkeypatch.setattr(middleware, "SessionLocal", testing_session)
    with testing_session() as db:
        admin = User(email="admin@example.com", hashed_password="x", role=UserRole.SUPERUSER)
        user = User(email="user@example.com", hashed_password="x", role=UserRole.USER)
        other = User(email="other@example.com", hashed_password="x", role=UserRole.USER)
        db.add_all([admin, user, other])
        db.commit()
        ids = {"admin": admin.id, "user": user.id, "other": other.id}
    with TestClient(app) as test_client:
        test_client.user_ids = ids
        yield test_client
    app.dependency_overrides.clear()
    Base.metadata.drop_all(engine)
    engine.dispose()


def auth(client, who="user"):
    return {"Authorization": f"Bearer {create_access_token(client.user_ids[who])}"}


def test_key_endpoint_schemas_auth_and_owner_permissions(client):
    assert client.post("/api-keys", json={"name": "test"}).status_code == 401
    created = client.post("/api-keys", json={"name": "primary"}, headers=auth(client)).json()
    assert set(created) == {"id", "name", "api_key", "key_prefix", "owner_id", "created_at", "last_used_at", "revoked", "revoked_at"}
    assert created["owner_id"] == client.user_ids["user"]
    assert created["api_key"].startswith("gw_") and created["last_used_at"] is None
    key_id = created["id"]
    listed = client.get("/api-keys", headers=auth(client)).json()
    assert set(listed) == {"items", "total"} and listed["total"] == 1
    assert set(listed["items"][0]) == {"id", "name", "key_prefix", "owner_id", "created_at", "last_used_at", "revoked", "revoked_at"}
    assert created["api_key"] not in str(listed) and "key_hash" not in str(listed)
    assert client.get("/api-keys", headers=auth(client, "other")).json() == {"items": [], "total": 0}
    assert client.post(f"/api-keys/{key_id}/revoke", headers=auth(client, "other")).status_code == 403
    assert client.delete(f"/api-keys/{key_id}", headers=auth(client)).status_code == 403
    revoked = client.post(f"/api-keys/{key_id}/revoke", headers=auth(client)).json()
    assert set(revoked) == {"id", "name", "key_prefix", "revoked", "revoked_at"} and revoked["revoked"] is True
    assert client.post(f"/api-keys/{key_id}/revoke", headers=auth(client)).json() == revoked
    assert client.get("/v1/models", headers={"Authorization": f"Bearer {created['api_key']}"}).status_code == 401
    assert client.delete(f"/api-keys/{key_id}", headers=auth(client, "admin")).status_code == 204
    assert client.delete(f"/api-keys/{key_id}", headers=auth(client, "admin")).status_code == 404


def test_active_api_key_authenticates_anthropic_header_and_cascade(client, monkeypatch):
    created = client.post("/api-keys", json={"name": "inference"}, headers=auth(client)).json()
    # The models route reaches the existing registry after centralized key validation.
    response = client.get("/v1/models", headers={"x-api-key": created["api_key"]})
    assert response.status_code == 200
    with middleware.SessionLocal() as db:
        key = db.query(APIKey).filter_by(id=created["id"]).one()
        key_id = key.id
        assert key.key_hash == hashlib.sha256(created["api_key"].encode()).hexdigest()
        assert key.last_used_at is not None
        assert db.query(APIKeyUsage).filter_by(key_id=key.id).count() == 1
        user = db.query(User).filter_by(id=key.owner_id).one()
        db.delete(user)
        db.commit()
        assert db.query(APIKey).filter_by(id=key_id).first() is None
        assert db.query(APIKeyUsage).filter_by(key_id=key_id).count() == 0
