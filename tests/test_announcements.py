from datetime import timedelta
import pytest
from pydantic import ValidationError
from tests.test_coupons import coupons_db, create, redeem  # noqa: F401
from tests.test_credits import credits_db  # noqa: F401
from backend.announcements import service
from backend.announcements.dtos import AnnouncementInput
from backend.auth.models import User
from backend.credits.models import utcnow


def test_banner_lifecycle_and_eligibility(coupons_db, monkeypatch):
    monkeypatch.setattr(service, "SessionLocal", coupons_db.writes)
    coupon = create()
    data = AnnouncementInput(title="Welcome", message="Get credits", audience="public", placement="both", coupon_id=coupon.id)
    item = service.save(data, "admin")
    with coupons_db.reads() as db:
        assert not service.banners(db, "landing")
    data.status = "published"
    service.save(data, "admin", item.id)
    with coupons_db.reads() as db:
        assert service.banners(db, "landing")[0].coupon_code == coupon.code
        user = db.get(User, "user")
        assert len(service.banners(db, "dashboard", user)) == 1
    service.dismiss(item.id, 1, user)
    service.dismiss(item.id, 1, user)
    with coupons_db.reads() as db:
        assert not service.banners(db, "dashboard", user)
    service.save(data.model_copy(update={"title": "Minor edit"}), "admin", item.id)
    with coupons_db.reads() as db:
        assert not service.banners(db, "dashboard", user)
    service.republish(item.id)
    with coupons_db.reads() as db:
        assert len(service.banners(db, "dashboard", user)) == 1
    redeem()
    with coupons_db.reads() as db:
        assert not service.banners(db, "dashboard", user)
    service.save(data.model_copy(update={"ends_at": utcnow()-timedelta(seconds=1)}), "admin", item.id)
    with coupons_db.reads() as db:
        assert not service.banners(db, "landing")


@pytest.mark.parametrize("values", [dict(action_label="Go", action_url="//evil.test"), dict(action_label="Go", action_url="/\\evil.test"), dict(placement="landing", audience="users"), dict(action_label="Missing URL"), dict(starts_at="2026-11-20T00:00:00Z", ends_at="2026-11-19T00:00:00Z")])
def test_invalid_announcement(values):
    with pytest.raises(ValidationError):
        AnnouncementInput(title="Title", message="Message", **values)


def test_audience_and_http_permissions(coupons_db, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.core.database import get_db
    from backend.dependencies import get_current_user
    from backend.announcements.controller import router
    monkeypatch.setattr(service, "SessionLocal", coupons_db.writes)
    service.save(AnnouncementInput(title="Admin only", message="Operational notice", audience="superusers", status="published"), "admin")
    app = FastAPI()
    app.include_router(router)
    with coupons_db.reads() as db:
        user = db.get(User, "user")
        assert not service.banners(db, "landing")
        assert not service.banners(db, "dashboard", user)
        admin = db.get(User, "admin")
        assert len(service.banners(db, "dashboard", admin)) == 1
    def database():
        with coupons_db.reads() as db:
            yield db
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = lambda: user
    with TestClient(app) as client:
        assert client.get("/announcements/public").json() == []
        assert client.get("/announcements/me").json() == []
        assert client.get("/announcements").status_code == 403
        assert client.post("/announcements", json={"title": "Test", "message": "Test"}).status_code == 403
        app.dependency_overrides[get_current_user] = lambda: admin
        assert client.get("/announcements").status_code == 200
