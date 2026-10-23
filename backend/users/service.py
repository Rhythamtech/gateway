from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from backend.auth.models import User, UserRole
from backend.users.dtos import (
    CurrentUserResponse,
    UserPreferencesUpdate,
    UserUpdateRequest,
)


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

    if user.telemetry_enabled != data.telemetry_enabled:
        user.telemetry_enabled = bool(data.telemetry_enabled)
        db.commit()
        db.refresh(user)

    return user


def update_user(db: Session, user_id: str, data: UserUpdateRequest) -> User:
    user = db.query(User).filter(User.id == user_id).first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    changed = False

    if data.is_active is not None:
        if user.role == UserRole.SUPERUSER and not data.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot deactivate a superuser",
            )

        if user.is_active != data.is_active:
            user.is_active = data.is_active
            changed = True

    if data.tracing_enabled is not None and user.tracing_enabled != data.tracing_enabled:
        user.tracing_enabled = data.tracing_enabled
        changed = True

    if changed:
        db.commit()
        db.refresh(user)

    return user
