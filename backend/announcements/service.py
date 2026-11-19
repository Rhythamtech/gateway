from urllib.parse import urlencode
from fastapi import HTTPException
from sqlalchemy.orm import Session
from backend.auth.models import UserRole
from backend.core.database import SessionLocal
from backend.core.datetime_safety import to_utc
from backend.credits.models import utcnow
from backend.credits.calculation import format_credits
from backend.coupons.models import Coupon, CouponRedemption
from backend.announcements.models import Announcement, AnnouncementDismissal
from backend.announcements.dtos import AnnouncementInput, AnnouncementResponse, BannerResponse


def require(db, id):
    item = db.get(Announcement, id)
    if not item:
        raise HTTPException(404, "Announcement not found")
    return item


def save(data: AnnouncementInput, actor_id: str, id: str | None = None):
    with SessionLocal.begin() as db:
        if data.coupon_id and not db.get(Coupon, data.coupon_id):
            raise HTTPException(404, "Coupon not found")
        item = require(db, id) if id else Announcement(created_by=actor_id)
        for key, value in data.model_dump().items():
            setattr(item, key, value)
        db.add(item)
        db.flush()
        return AnnouncementResponse.model_validate(item)


def republish(id: str):
    with SessionLocal.begin() as db:
        item = require(db, id)
        item.version += 1
        item.status = "published"
        db.flush()
        return AnnouncementResponse.model_validate(item)


def banners(db: Session, placement: str, user=None):
    now = utcnow()
    query = db.query(Announcement).filter_by(status="published").filter(Announcement.placement.in_([placement, "both"]))
    items = []
    for item in query.order_by(Announcement.priority.desc(), Announcement.created_at.desc(), Announcement.id.desc()):
        if item.starts_at and to_utc(item.starts_at) > now or item.ends_at and to_utc(item.ends_at) <= now:
            continue
        if item.audience != "public" and (not user or item.audience == "superusers" and user.role != UserRole.SUPERUSER):
            continue
        if user and db.query(AnnouncementDismissal.id).filter_by(user_id=user.id, announcement_id=item.id, version=item.version).first():
            continue
        code = amount = None
        url, label, end = item.action_url, item.action_label, item.ends_at
        if item.coupon_id:
            coupon = db.get(Coupon, item.coupon_id)
            if not coupon or not coupon.enabled or coupon.starts_at and to_utc(coupon.starts_at) > now or coupon.expires_at and to_utc(coupon.expires_at) <= now:
                continue
            redemptions = db.query(CouponRedemption).filter_by(coupon_id=coupon.id)
            if coupon.max_redemptions is not None and redemptions.count() >= coupon.max_redemptions:
                continue
            if user and redemptions.filter_by(user_id=user.id).count() >= coupon.per_user_limit:
                continue
            code, amount = coupon.code, format_credits(coupon.amount)
            if coupon.expires_at and (end is None or to_utc(coupon.expires_at) < to_utc(end)):
                end = coupon.expires_at
            destination = "/dashboard/credits?" + urlencode({"coupon": code})
            url = destination if user else "/login?" + urlencode({"next": destination})
            label = "Redeem coupon" if user else "Sign in to redeem"
        items.append(BannerResponse(id=item.id, version=item.version, title=item.title, message=item.message,
            dismissible=item.dismissible, action_label=label, action_url=url, ends_at=end,
            coupon_code=code, coupon_credits=amount))
    return items


def dismiss(id: str, version: int, user):
    with SessionLocal.begin() as db:
        item = require(db, id)
        if item.version != version:
            raise HTTPException(409, "Announcement has changed. Refresh and try again.")
        if not item.dismissible:
            raise HTTPException(409, "This announcement cannot be dismissed")
        if item.audience == "superusers" and user.role != UserRole.SUPERUSER:
            raise HTTPException(404, "Announcement not found")
        if not db.query(AnnouncementDismissal.id).filter_by(user_id=user.id, announcement_id=id, version=version).first():
            db.add(AnnouncementDismissal(user_id=user.id, announcement_id=id, version=version))
