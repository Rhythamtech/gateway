from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.core.database import SessionLocal
from backend.core.datetime_safety import to_utc
from backend.coupons.dtos import CouponCreate, CouponPage, CouponResponse, CouponUpdate, RedeemCoupon, RedemptionPage, RedemptionResponse
from backend.coupons.models import Coupon, CouponAudit, CouponRedemption
from backend.credits.calculation import format_credits, to_microcredits
from backend.credits.models import CreditEntry, utcnow
from backend.credits.service import entry_response, grant_credits


def require_coupon(db: Session, coupon_id: str) -> Coupon:
    coupon = db.get(Coupon, coupon_id)
    if coupon is None:
        raise HTTPException(404, "Coupon not found")
    return coupon


def coupon_response(db: Session, coupon: Coupon, count: int | None = None) -> CouponResponse:
    if count is None:
        count = db.query(CouponRedemption).filter_by(coupon_id=coupon.id).count()
    return CouponResponse(
        id=coupon.id, code=coupon.code, name=coupon.name,
        credits=format_credits(coupon.amount), enabled=coupon.enabled,
        starts_at=coupon.starts_at, expires_at=coupon.expires_at,
        max_redemptions=coupon.max_redemptions, per_user_limit=coupon.per_user_limit,
        redemption_count=count, created_by=coupon.created_by,
        created_at=coupon.created_at, updated_at=coupon.updated_at,
    )


def create_coupon(data: CouponCreate, actor_id: str) -> CouponResponse:
    with SessionLocal.begin() as db:
        if db.query(Coupon).filter_by(code=data.code).first():
            raise HTTPException(409, "Coupon code already exists")
        values = data.model_dump(exclude={"credits"})
        coupon = Coupon(**values, amount=to_microcredits(data.credits), created_by=actor_id)
        db.add(coupon)
        db.flush()
        response = coupon_response(db, coupon)
        db.add(CouponAudit(coupon_id=coupon.id, actor_id=actor_id, action="created",
                           old_values=None, new_values=response.model_dump(mode="json")))
        return response


def update_coupon(coupon_id: str, data: CouponUpdate, actor_id: str) -> CouponResponse:
    with SessionLocal.begin() as db:
        coupon = require_coupon(db, coupon_id)
        changes = data.model_dump(exclude_unset=True)
        old = {key: getattr(coupon, key) for key in changes}
        if old != changes:
            for key, value in changes.items():
                setattr(coupon, key, value)
            db.add(CouponAudit(coupon_id=coupon.id, actor_id=actor_id, action="updated",
                               old_values=old, new_values=changes))
            db.flush()
        return coupon_response(db, coupon)


def list_coupons(db: Session, page: int, page_size: int) -> CouponPage:
    counts = select(CouponRedemption.coupon_id, func.count().label("total")).group_by(CouponRedemption.coupon_id).subquery()
    rows = (db.query(Coupon, func.coalesce(counts.c.total, 0))
            .outerjoin(counts, counts.c.coupon_id == Coupon.id)
            .order_by(Coupon.created_at.desc(), Coupon.id.desc())
            .offset((page - 1) * page_size).limit(page_size).all())
    return CouponPage(items=[coupon_response(db, coupon, count) for coupon, count in rows],
                      page=page, page_size=page_size, total=db.query(Coupon).count())


def redemption_response(db: Session, row: CouponRedemption) -> RedemptionResponse:
    return RedemptionResponse(
        id=row.id, coupon_id=row.coupon_id, code=db.get(Coupon, row.coupon_id).code,
        user_id=row.user_id, credits=format_credits(row.amount), created_at=row.created_at,
        credit_entry=entry_response(db.get(CreditEntry, row.credit_entry_id)),
    )


def redeem(data: RedeemCoupon, user_id: str) -> RedemptionResponse:
    # BEGIN IMMEDIATE serializes limit checks with grants, including retries.
    # Check replay before current availability so a committed receipt stays retrievable.
    with SessionLocal.begin() as db:
        previous = db.query(CouponRedemption).filter_by(user_id=user_id, idempotency_key=data.idempotency_key).first()
        if previous:
            if db.get(Coupon, previous.coupon_id).code != data.code:
                raise HTTPException(409, "Idempotency key was already used for a different coupon")
            return redemption_response(db, previous)
        coupon = db.query(Coupon).filter_by(code=data.code).first()
        if coupon is None:
            raise HTTPException(404, "Coupon not found")
        now = utcnow()
        if not coupon.enabled:
            raise HTTPException(409, "Coupon is disabled")
        if coupon.starts_at and now < to_utc(coupon.starts_at):
            raise HTTPException(409, "Coupon has not started")
        if coupon.expires_at and now >= to_utc(coupon.expires_at):
            raise HTTPException(409, "Coupon has expired")
        redemptions = db.query(CouponRedemption).filter_by(coupon_id=coupon.id)
        if coupon.max_redemptions is not None and redemptions.count() >= coupon.max_redemptions:
            raise HTTPException(409, "Coupon redemption limit reached")
        if redemptions.filter_by(user_id=user_id).count() >= coupon.per_user_limit:
            raise HTTPException(409, "Your coupon redemption limit was reached")
        entry = grant_credits(db, "user", user_id, coupon.amount, user_id, f"Coupon {coupon.code}")
        row = CouponRedemption(coupon_id=coupon.id, user_id=user_id, amount=coupon.amount,
                               idempotency_key=data.idempotency_key, credit_entry_id=entry.id)
        db.add(row)
        db.flush()
        return redemption_response(db, row)


def list_redemptions(db: Session, page: int, page_size: int, *, user_id: str | None = None, coupon_id: str | None = None) -> RedemptionPage:
    query = db.query(CouponRedemption)
    if user_id is not None:
        query = query.filter_by(user_id=user_id)
    if coupon_id is not None:
        require_coupon(db, coupon_id)
        query = query.filter_by(coupon_id=coupon_id)
    total = query.count()
    rows = query.order_by(CouponRedemption.created_at.desc(), CouponRedemption.id.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return RedemptionPage(items=[redemption_response(db, row) for row in rows], page=page, page_size=page_size, total=total)
