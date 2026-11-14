from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import event, inspect, text

from tests.test_credits import credits_db  # noqa: F401
from backend.auth.models import User
from backend.core.database import get_db
from backend.core.migrations import _migration_0019_credit_coupons
from backend.coupons import service
from backend.coupons.controller import router
from backend.coupons.dtos import CouponCreate, CouponUpdate, RedeemCoupon
from backend.coupons.models import Coupon, CouponAudit, CouponRedemption
from backend.credits.calculation import MAX_AMOUNT
from backend.credits.models import CreditEntry, ProviderCredits, UserCredits, utcnow
from backend.dependencies import get_current_user


@pytest.fixture
def coupons_db(credits_db, monkeypatch):
    monkeypatch.setattr(service, "SessionLocal", credits_db.writes)
    return credits_db


def create(**changes):
    return service.create_coupon(CouponCreate(**dict(dict(code="WELCOME100", name="Welcome", credits="100"), **changes)), "admin")


def redeem(code="WELCOME100", key="request-001", user="user"):
    return service.redeem(RedeemCoupon(code=code, idempotency_key=key), user)


def test_grant_replay_and_audit(coupons_db):
    coupon = create(code=" welcome100 ")
    receipt = redeem("welcome100")
    assert receipt.credits == "100.000000"
    assert receipt.credit_entry.actor_id == "user"
    service.update_coupon(coupon.id, CouponUpdate(enabled=False, name="Closed"), "admin")
    assert redeem() == receipt
    with coupons_db.reads() as db:
        assert db.get(UserCredits, "user").remaining == 100_000_000
        assert db.get(ProviderCredits, "provider") is None
        assert db.query(CreditEntry).count() == 1
        assert db.query(CouponAudit).count() == 2
        assert service.list_redemptions(db, 1, 20, user_id="admin").total == 0
        assert service.list_redemptions(db, 1, 20, user_id="user").total == 1
        assert service.list_coupons(db, 1, 20).items[0].redemption_count == 1


@pytest.mark.parametrize("changes", [
    {"credits": "0"}, {"credits": "-1"}, {"credits": "0.0000001"},
    {"credits": "9000000000001"}, {"max_redemptions": 0}, {"per_user_limit": 0},
    {"code": "A B"}, {"code": "ab"}, {"code": "éABC"},
    {"starts_at": "2026-01-01T00:00:00"},
    {"starts_at": "2026-01-02T00:00:00Z", "expires_at": "2026-01-01T00:00:00Z"},
])
def test_invalid_create(changes):
    with pytest.raises(ValidationError):
        CouponCreate(**dict(dict(code="WELCOME", name="Welcome", credits="100"), **changes))


@pytest.mark.parametrize("changes", [{}, {"name": None}, {"enabled": None}, {"credits": "3"}])
def test_invalid_patch(changes):
    with pytest.raises(ValidationError):
        CouponUpdate(**changes)


def test_uniqueness_and_limits(coupons_db):
    create(per_user_limit=2)
    with pytest.raises(HTTPException) as error:
        create(code="welcome100")
    assert error.value.status_code == 409
    redeem()
    redeem(key="request-002")
    with pytest.raises(HTTPException) as error:
        redeem(key="request-003")
    assert error.value.status_code == 409
    create(code="OTHER")
    with pytest.raises(HTTPException) as error:
        redeem("OTHER")
    assert error.value.status_code == 409


@pytest.mark.parametrize("changes", [
    {"enabled": False}, {"starts_at": utcnow() + timedelta(days=1)},
    {"expires_at": utcnow() - timedelta(days=1)},
])
def test_unavailable_has_no_effect(coupons_db, changes):
    create(**changes)
    with pytest.raises(HTTPException) as error:
        redeem()
    assert error.value.status_code == 409
    with coupons_db.reads() as db:
        assert db.query(CouponRedemption).count() == db.query(CreditEntry).count() == 0


def test_window_boundaries_and_failed_key_reuse(coupons_db, monkeypatch):
    start = utcnow()
    create(starts_at=start, expires_at=start + timedelta(hours=1), per_user_limit=2)
    monkeypatch.setattr(service, "utcnow", lambda: start)
    redeem()
    monkeypatch.setattr(service, "utcnow", lambda: start + timedelta(hours=1))
    with pytest.raises(HTTPException):
        redeem(key="request-002")
    monkeypatch.setattr(service, "utcnow", lambda: start + timedelta(minutes=1))
    redeem(key="request-002")


@pytest.mark.parametrize("same_user,same_key", [(False, False), (True, False), (True, True)])
def test_concurrent_redemptions(coupons_db, same_user, same_key):
    create(max_redemptions=None if same_user else 1)
    def attempt(pair):
        user, key = pair
        try:
            return redeem(user=user, key=key).id
        except HTTPException as error:
            assert error.status_code == 409
            return None
    pairs = [("user", "request-001"), ("user" if same_user else "admin", "request-001" if same_key else "request-002")]
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt, pairs))
    assert len({result for result in results if result}) == 1
    assert sum(result is not None for result in results) == (2 if same_key else 1)
    with coupons_db.reads() as db:
        assert db.query(CouponRedemption).count() == db.query(CreditEntry).count() == 1


def test_atomic_rollback(coupons_db):
    create()
    def fail(mapper, conn, target):
        raise RuntimeError("Injected persistence failure")
    event.listen(CouponRedemption, "before_insert", fail)
    try:
        with pytest.raises(RuntimeError):
            redeem()
    finally:
        event.remove(CouponRedemption, "before_insert", fail)
    with coupons_db.reads() as db:
        assert db.get(UserCredits, "user") is None
        assert db.query(CouponRedemption).count() == db.query(CreditEntry).count() == 0
    redeem()


def test_overflow(coupons_db):
    create()
    with coupons_db.writes.begin() as db:
        db.add(UserCredits(user_id="user", remaining=MAX_AMOUNT, reserved=0))
    with pytest.raises(HTTPException) as error:
        redeem()
    assert error.value.status_code == 409
    with coupons_db.reads() as db:
        assert db.query(CouponRedemption).count() == db.query(CreditEntry).count() == 0


def test_api_authorization_and_contract(coupons_db):
    app = FastAPI()
    app.include_router(router)
    def database():
        with coupons_db.reads() as db:
            yield db
    app.dependency_overrides[get_db] = database
    client = TestClient(app)
    assert client.post("/coupons/redeem", json={"code": "WELCOME100", "idempotency_key": "request-001"}).status_code == 401
    identity = "user"
    def current_user():
        with coupons_db.reads() as db:
            return db.get(User, identity)
    app.dependency_overrides[get_current_user] = current_user
    assert client.get("/coupons").status_code == 403
    assert client.post("/coupons", json={"code": "WELCOME100", "name": "Welcome", "credits": "100"}).status_code == 403
    coupon = create()
    assert client.patch(f"/coupons/{coupon.id}", json={"enabled": False}).status_code == 403
    assert client.get(f"/coupons/{coupon.id}/redemptions").status_code == 403
    assert client.post("/coupons/redeem", json={"code": "UNKNOWN", "idempotency_key": "request-001"}).status_code == 404
    assert client.post("/coupons/redeem", json={"code": "WELCOME100", "idempotency_key": "request-001"}).status_code == 200
    assert client.get("/coupons/me/redemptions").json()["total"] == 1
    assert client.get("/coupons/me/redemptions?page_size=101").status_code == 422
    identity = "admin"
    assert client.get("/coupons/me/redemptions").json()["total"] == 0
    assert client.get(f"/coupons/{coupon.id}/redemptions").json()["total"] == 1
    assert client.get("/coupons").json()["items"][0]["redemption_count"] == 1
    assert client.patch(f"/coupons/{coupon.id}", json={"credits": "200"}).status_code == 422
    assert client.patch(f"/coupons/{coupon.id}", json={"enabled": False}).status_code == 200
    assert client.post("/coupons", json={"code": "SECOND", "name": "Second", "credits": "1"}).status_code == 201


def test_migration_upgrade_and_repeat(coupons_db):
    with coupons_db.writer.begin() as conn:
        for table in ("coupon_audit", "coupon_redemptions", "coupons"):
            conn.execute(text(f"DROP TABLE {table}"))
        _migration_0019_credit_coupons(conn)
        _migration_0019_credit_coupons(conn)
        assert {"coupons", "coupon_audit", "coupon_redemptions"} <= set(inspect(conn).get_table_names())
        assert conn.execute(text("SELECT count(*) FROM users")).scalar() == 2
    create()
    redeem()


def test_starts_at_defaults_to_now(coupons_db):
    before = utcnow()
    coupon = create(code="AUTOTIME")
    after = utcnow()
    assert coupon.starts_at is not None
    assert before <= coupon.starts_at <= after
