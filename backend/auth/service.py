import jwt
from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.auth.dtos import RegisterRequest
from backend.auth.models import User, UserRole
from backend.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)


def get_user_by_email(db: Session, email: str) -> User | None:
    return db.query(User).filter(User.email == email).first()


def register_user(db: Session, data: RegisterRequest) -> User:
    enabled = db.execute(text("SELECT signups_enabled FROM gateway_settings WHERE id=1")).scalar_one()
    if not enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="New signups are disabled. Please sign in.")

    if get_user_by_email(db, data.email):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )

    is_first_user = db.query(User).count() == 0

    user = User(
        email=data.email,
        hashed_password=hash_password(data.password),
        role=UserRole.SUPERUSER if is_first_user else UserRole.USER,
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    return user


def authenticate_user(db: Session, email: str, password: str) -> User:
    user = get_user_by_email(db, email)

    if not user or not verify_password(password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User is inactive",
        )

    return user


def create_auth_tokens(user: User) -> dict:
    return {
        "access_token": create_access_token(user.id),
        "refresh_token": create_refresh_token(user.id),
        "token_type": "bearer",
    }


def rotate_refresh_token(refresh_token: str) -> dict:
    try:
        payload = decode_token(refresh_token, expected_type="refresh")
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )

    user_id = payload["sub"]

    return {
        "access_token": create_access_token(user_id),
        "refresh_token": create_refresh_token(user_id),
        "token_type": "bearer",
    }
