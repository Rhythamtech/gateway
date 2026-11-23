from fastapi import HTTPException
from sqlalchemy.orm import Session
from backend.core.database import SessionLocal
from backend.credits.models import utcnow
from backend.notifications.models import Notification
from backend.notifications.dtos import NotificationPage, NotificationResponse


def emit(db: Session, user_id: str, event_key: str, kind: str, title: str,
         message: str, action_url: str = "/dashboard/credits") -> None:
    if not db.query(Notification.id).filter_by(user_id=user_id, event_key=event_key).first():
        db.add(Notification(user_id=user_id, event_key=event_key, kind=kind,
                            title=title, message=message, action_url=action_url))
        db.flush()


def list_notifications(db: Session, user_id: str, page: int) -> NotificationPage:
    query = db.query(Notification).filter_by(user_id=user_id)
    unread = query.filter(Notification.read_at.is_(None))
    items = (
        query.order_by(Notification.created_at.desc(), Notification.id.desc())
        .offset((page - 1) * 20)
        .limit(20)
    )
    return NotificationPage(
        items=[NotificationResponse.model_validate(item) for item in items],
        unread_count=unread.count(),
        unread_support_count=unread.filter_by(kind="support_ticket").count(),
        total=query.count(),
        page=page,
    )


def mark_read(user_id: str, notification_id: str | None = None) -> None:
    with SessionLocal.begin() as db:
        query = db.query(Notification).filter_by(user_id=user_id)
        if notification_id:
            query = query.filter_by(id=notification_id)
            if not query.first():
                raise HTTPException(404, "Notification not found")
        query.filter(Notification.read_at.is_(None)).update({Notification.read_at: utcnow()})


def preference(db, user_id):
    from backend.notifications.models import NotificationPreference
    settings = db.get(NotificationPreference, user_id)
    if settings is None:
        settings = NotificationPreference(user_id=user_id)
        db.add(settings)
        db.flush()
    return settings


def check_credit_alert(db, user_id):
    from backend.credits.models import UserCredits
    from backend.credits.calculation import format_credits
    settings = preference(db, user_id)
    balance = db.get(UserCredits, user_id)
    available = max(0, balance.remaining - balance.reserved) if balance else 0
    state = "exhausted" if available == 0 else "low" if available < settings.low_credit_threshold else "healthy"
    if state != settings.credit_state:
        if settings.credit_state == "healthy":
            settings.credit_episode += 1
        if state != "healthy" and settings.low_credit_enabled:
            emit(db, user_id, f"credit-alert:{settings.credit_episode}:{state}", "credit_alert",
                 "No credits available" if state == "exhausted" else "Your credits are running low",
                 f"Available credits: {format_credits(available)}. Add credits or redeem a coupon to continue using the gateway.")
        settings.credit_state = state
    return state if state != "healthy" else None, format_credits(available)


def refresh_alerts(user_id):
    from datetime import timedelta
    from backend.api_keys.models import APIKey
    from backend.core.datetime_safety import to_utc
    with SessionLocal.begin() as db:
        warning, available = check_credit_alert(db, user_id)
        settings = preference(db, user_id)
        if settings.key_expiry_enabled:
            now = utcnow()
            keys = db.query(APIKey).filter(APIKey.owner_id == user_id, APIKey.revoked.is_(False), APIKey.expires_at.is_not(None), APIKey.expires_at <= now + timedelta(days=7))
            for key in keys:
                expired = to_utc(key.expires_at) <= now
                event = "expired" if expired else "expiring"
                emit(db, user_id, f"key:{key.id}:{event}:{to_utc(key.expires_at).isoformat()}", "key_expiry",
                     f"API key {event}", f'Your API key "{key.name}" ' + ("has expired." if expired else f"expires on {to_utc(key.expires_at).isoformat()}."),
                     "/dashboard/api-keys")
        return warning, available


def settings_response(settings):
    from backend.notifications.dtos import NotificationSettings
    from backend.credits.calculation import format_credits
    return NotificationSettings(low_credit_enabled=settings.low_credit_enabled,
        key_expiry_enabled=settings.key_expiry_enabled, low_credit_threshold=format_credits(settings.low_credit_threshold))


def get_settings(user_id):
    with SessionLocal.begin() as db:
        return settings_response(preference(db, user_id))


def save_settings(user_id, data):
    from backend.credits.calculation import to_microcredits
    from decimal import Decimal, InvalidOperation
    try:
        value = Decimal(data.low_credit_threshold)
        if not value.is_finite() or value <= 0 or value > 9_000_000_000_000 or value.as_tuple().exponent < -6:
            raise ValueError()
        amount = to_microcredits(value)
    except (ValueError, InvalidOperation):
        raise HTTPException(422, "Threshold must be a positive credit amount with at most six decimals")
    with SessionLocal.begin() as db:
        settings = preference(db, user_id)
        settings.low_credit_threshold = amount
        settings.low_credit_enabled = data.low_credit_enabled
        settings.key_expiry_enabled = data.key_expiry_enabled
        return settings_response(settings)
