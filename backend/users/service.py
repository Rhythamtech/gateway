from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from backend.auth.models import User, UserRole
from backend.users.dtos import CurrentUserResponse


def to_user_response(user: User) -> CurrentUserResponse:
    return CurrentUserResponse.model_validate(user)


def list_users(db: Session) -> list[User]:
    return db.query(User).order_by(User.created_at).all()


def update_user_active(db: Session, user_id: str, is_active: bool) -> User:
    user = db.query(User).filter(User.id == user_id).first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    if user.role == UserRole.SUPERUSER and not is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot deactivate a superuser",
        )

    if user.is_active != is_active:
        user.is_active = is_active
        db.commit()
        db.refresh(user)

    return user
