import idna
import jwt
from disposable_email_domains import blocklist
from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.auth.dtos import RegisterRequest, SignupSettings, SignupSettingsUpdate
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


def get_signup_settings(db: Session, *, lock: bool = False) -> SignupSettings:
    query = "SELECT signups_enabled, block_disposable_emails FROM gateway_settings WHERE id = 1"
    if lock and db.get_bind().dialect.name == "postgresql":
        query += " FOR UPDATE"
    row = db.execute(text(query)).mappings().one()
    return SignupSettings.model_validate(row)


def update_signup_settings(db: Session, data: SignupSettingsUpdate) -> SignupSettings:
    row = db.execute(
        text("""
            UPDATE gateway_settings
            SET signups_enabled = COALESCE(:signups_enabled, signups_enabled),
                block_disposable_emails = COALESCE(:block_disposable_emails, block_disposable_emails)
            WHERE id = 1
            RETURNING signups_enabled, block_disposable_emails
        """),
        {key: int(value) if value is not None else None for key, value in data.model_dump().items()},
    ).mappings().one()
    settings = SignupSettings.model_validate(row)
    db.commit()
    return settings


def _is_disposable_email(email: str) -> bool:
    # EmailStr normalizes the address to Unicode. The blocklist uses ASCII domains.
    domain = email.rsplit("@", 1)[1]
    if not domain.isascii():
        domain = idna.encode(domain).decode("ascii")
    labels = domain.split(".")
    return any(".".join(labels[index:]) in blocklist for index in range(len(labels) - 1))


def register_user(db: Session, data: RegisterRequest) -> User:
    settings = get_signup_settings(db, lock=True)
    if not settings.signups_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="New signups are disabled. Please sign in.",
        )
    if settings.block_disposable_emails and _is_disposable_email(data.email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Disposable email addresses are not allowed. Use a permanent email address.",
        )

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
