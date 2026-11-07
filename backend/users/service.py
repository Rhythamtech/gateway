from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from backend.auth.models import User, UserRole
from backend.users.dtos import (
    CurrentUserResponse,
    UserPreferencesUpdate,
    UserUpdateRequest,
)
from backend.users.audit import UserAdminAudit


def to_user_response(user: User) -> CurrentUserResponse:
    return CurrentUserResponse.model_validate(user)


def list_users(db: Session) -> list[User]:
    return db.query(User).order_by(User.created_at).all()


def update_own_preferences(
    db: Session,
    user: User,
    data: UserPreferencesUpdate,
) -> User:
    """Self-service preference update; the caller is always the user itself."""

    changed = False
    if data.telemetry_enabled is not None and user.telemetry_enabled != data.telemetry_enabled:
        user.telemetry_enabled = bool(data.telemetry_enabled)
        changed = True

    if data.tracing_enabled is not None and user.tracing_enabled != data.tracing_enabled:
        user.tracing_enabled = bool(data.tracing_enabled)
        changed = True

    if changed:
        db.commit()
        db.refresh(user)

    return user


def update_user(db: Session, user_id: str, data: UserUpdateRequest, actor: User) -> User:
    user = db.query(User).filter(User.id == user_id).first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    changed = False
    changes: list[str] = []

    if data.is_active is not None:
        if user.role == UserRole.SUPERUSER and not data.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot deactivate a superuser",
            )

        if user.is_active != data.is_active:
            changes.append("Account enabled" if data.is_active else "Account deactivated")
            user.is_active = data.is_active
            changed = True

    if data.tracing_enabled is not None and user.tracing_enabled != data.tracing_enabled:
        changes.append("Tracing enabled" if data.tracing_enabled else "Tracing disabled")
        user.tracing_enabled = data.tracing_enabled
        changed = True

    if changed:
        for detail in changes:
            db.add(UserAdminAudit(actor_id=actor.id, user_id=user.id, action="account_updated", detail=detail))
        db.commit()
        db.refresh(user)

    return user


def list_user_audit(db: Session, user_id: str) -> list[tuple[UserAdminAudit, str]]:
    return (
        db.query(UserAdminAudit, User.email)
        .join(User, User.id == UserAdminAudit.actor_id)
        .filter(UserAdminAudit.user_id == user_id)
        .order_by(UserAdminAudit.created_at.desc(), UserAdminAudit.id.desc())
        .limit(100)
        .all()
    )
