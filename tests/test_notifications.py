import pytest
from fastapi import HTTPException
from tests.test_credits import credits_db  # noqa: F401
from backend.credits import service as credits
from backend.credits.dtos import CreditAddition
from backend.notifications import service
from backend.notifications.models import Notification


def test_grant_atomic_and_deduplicated(credits_db, monkeypatch):
    monkeypatch.setattr(service, "SessionLocal", credits_db.writes)
    data = CreditAddition(credits="50", reason="Private admin note", idempotency_key="notification-grant")
    credits.add_credits("user", "user", data, "admin")
    credits.add_credits("user", "user", data, "admin")
    with credits_db.reads() as db:
        page = service.list_notifications(db, "user", 1)
        assert page.total == page.unread_count == 1
        assert "Private" not in page.items[0].message
        nid = page.items[0].id
        assert service.list_notifications(db, "admin", 1).total == 0
    with pytest.raises(HTTPException):
        service.mark_read("admin", nid)
    service.mark_read("user", nid)
    service.mark_read("user", nid)
    with credits_db.reads() as db:
        assert service.list_notifications(db, "user", 1).unread_count == 0
    with pytest.raises(RuntimeError):
        with credits_db.writes.begin() as db:
            service.emit(db, "user", "rollback", "test", "Test", "test")
            raise RuntimeError()
    with credits_db.reads() as db:
        assert db.query(Notification).count() == 1


def test_alerts_threshold_reset_expiry_and_preferences(credits_db, monkeypatch):
    from datetime import timedelta
    from backend.api_keys.models import APIKey
    from backend.credits.models import UserCredits, utcnow
    from backend.notifications.dtos import NotificationSettings
    monkeypatch.setattr(service, "SessionLocal", credits_db.writes)
    with credits_db.writes.begin() as db:
        db.add(UserCredits(user_id="user", remaining=5_000_000, reserved=0))
        db.get(APIKey, "key").expires_at = utcnow() + timedelta(days=2)
    for _ in range(2):
        assert service.refresh_alerts("user")[0] == "low"
    with credits_db.reads() as db:
        assert db.query(Notification).count() == 2
    with credits_db.writes.begin() as db:
        db.get(UserCredits, "user").remaining = 0
        db.get(APIKey, "key").expires_at = utcnow() - timedelta(days=1)
    assert service.refresh_alerts("user")[0] == "exhausted"
    with credits_db.reads() as db:
        assert db.query(Notification).count() == 4
    service.save_settings("user", NotificationSettings(low_credit_enabled=False, key_expiry_enabled=False, low_credit_threshold="20.25"))
    with credits_db.writes.begin() as db:
        db.get(UserCredits, "user").remaining = 30_000_000
    assert service.refresh_alerts("user")[0] is None
    with credits_db.writes.begin() as db:
        db.get(UserCredits, "user").remaining = 1_000_000
    assert service.refresh_alerts("user")[0] == "low"
    with credits_db.reads() as db:
        assert db.query(Notification).count() == 4
    for threshold in ("NaN", "-1", "0", "1.0000001"):
        with pytest.raises(HTTPException):
            service.save_settings("user", NotificationSettings(low_credit_threshold=threshold))


def test_http_recipient_permissions(credits_db, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.auth.models import User
    from backend.core.database import get_db
    from backend.dependencies import get_current_user
    from backend.notifications.controller import router
    monkeypatch.setattr(service, "SessionLocal", credits_db.writes)
    app = FastAPI()
    app.include_router(router)
    def database():
        with credits_db.reads() as db:
            yield db
    with credits_db.reads() as db:
        user = db.get(User, "user")
        admin = db.get(User, "admin")
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = lambda: user
    with TestClient(app) as client:
        result = client.get("/notifications")
        assert result.status_code == 200
        assert result.json()["credit_warning"] == "exhausted"
        nid = result.json()["items"][0]["id"]
        assert client.get("/notifications/settings").status_code == 200
        assert client.put("/notifications/settings", json={"low_credit_threshold": "NaN"}).status_code == 422
        app.dependency_overrides[get_current_user] = lambda: admin
        assert client.post(f"/notifications/{nid}/read").status_code == 404
        app.dependency_overrides[get_current_user] = lambda: user
        assert client.post("/notifications/read-all").status_code == 204
        assert client.get("/notifications").json()["unread_count"] == 0


def test_new_migrations_idempotent(credits_db):
    from backend.core.migrations import _migration_0023_notifications, _migration_0024_announcements, _migration_0025_notification_preferences
    with credits_db.writes.kw["bind"].begin() as conn:
        for _ in range(2):
            for migrate in (_migration_0023_notifications, _migration_0024_announcements, _migration_0025_notification_preferences):
                migrate(conn)
