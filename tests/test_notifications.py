import pytest
from fastapi import HTTPException
from tests.test_credits import credits_db  # noqa: F401
from backend.credits import service as credits
from backend.credits.dtos import CreditAddition
from backend.notifications import service
from backend.notifications.models import Notification
from backend.support import service as support_service
from backend.support.controller import router as support_router


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


def test_support_notifications_and_sidebar_count(credits_db, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.auth.models import User, UserRole
    from backend.core.database import get_db
    from backend.dependencies import get_current_user
    from backend.notifications.controller import router as notifications_router

    monkeypatch.setattr(service, "SessionLocal", credits_db.writes)
    monkeypatch.setattr(support_service, "SessionLocal", credits_db.writes)
    with credits_db.writes.begin() as db:
        for user_id, role, is_active in (
            ("second-admin", UserRole.SUPERUSER, True),
            ("inactive-admin", UserRole.SUPERUSER, False),
            ("other-user", UserRole.USER, True),
        ):
            db.add(User(id=user_id, email=f"{user_id}@example.com", hashed_password="hash",
                        role=role, is_active=is_active))

    app = FastAPI()
    app.include_router(support_router)
    app.include_router(notifications_router)

    def database():
        with credits_db.reads() as db:
            yield db

    app.dependency_overrides[get_db] = database
    account_id = "user"

    def current_user():
        with credits_db.reads() as db:
            return db.get(User, account_id)

    app.dependency_overrides[get_current_user] = current_user

    with TestClient(app) as client:
        response = client.post("/support/tickets", json={
            "subject": "Please add more credits",
            "category": "billing",
            "message": "Details for the support team.",
        })
        assert response.status_code == 201
        ticket_id = response.json()["id"]
        ticket_path = f"/support/tickets/{ticket_id}"
        for account_id in ("admin", "second-admin"):
            inbox = client.get("/notifications").json()
            assert inbox["unread_support_count"] == 1
            item, = [item for item in inbox["items"] if item["kind"] == "support_ticket"]
            assert item["read_at"] is None
            assert item["message"] == "Please add more credits"
            assert item["action_url"] == f"/dashboard/support?id={ticket_id}"
            assert client.get(ticket_path).status_code == 200
            assert client.get("/notifications?page=2").json()["unread_support_count"] == 1

        account_id = "other-user"
        assert client.get("/notifications").json()["unread_support_count"] == 0
        assert client.post(f"/notifications/{item['id']}/read").status_code == 404
        assert client.get(ticket_path).status_code == 403

        account_id = "admin"
        assert client.post(f"{ticket_path}/messages", json={"message": "I can help."}).status_code == 201
        for _ in range(2):
            assert client.patch(f"{ticket_path}/status", json={"status": "resolved"}).status_code == 200
        assert client.get("/notifications").json()["unread_support_count"] == 1

        account_id = "user"
        inbox = client.get("/notifications").json()
        assert inbox["unread_support_count"] == 2
        assert {item["title"] for item in inbox["items"] if item["kind"] == "support_ticket"} == {
            "New reply to your support request", "Support request marked resolved"
        }
        assert client.post("/notifications/read-all").status_code == 204
        assert client.get("/notifications").json()["unread_support_count"] == 0
        assert client.post(f"{ticket_path}/messages", json={"message": "Thank you."}).status_code == 201
        assert client.get("/notifications").json()["unread_support_count"] == 0

        for account_id in ("admin", "second-admin"):
            assert client.get("/notifications").json()["unread_support_count"] == 2

    with credits_db.reads() as db:
        assert service.list_notifications(db, "inactive-admin", 1).total == 0
