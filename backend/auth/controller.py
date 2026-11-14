from fastapi import APIRouter, Depends, status
from sqlalchemy import text
from sqlalchemy.orm import Session
from pydantic import BaseModel

from backend.auth import service
from backend.auth.dtos import (
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)
from backend.core.database import get_db, get_write_db
from backend.dependencies import require_superuser
from backend.auth.models import User

router = APIRouter(prefix="/auth", tags=["Auth"])


@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
)
def register(
    data: RegisterRequest,
    db: Session = Depends(get_write_db),
):
    user = service.register_user(db, data)
    return user


class SignupSettings(BaseModel):
    signups_enabled: bool


@router.get("/signup-settings", response_model=SignupSettings)
def get_signup_settings(
    user: User = Depends(require_superuser), db: Session = Depends(get_db)
):
    enabled = db.execute(text("SELECT signups_enabled FROM gateway_settings WHERE id=1")).scalar_one()
    return SignupSettings(signups_enabled=bool(enabled))


@router.patch("/signup-settings", response_model=SignupSettings)
def update_signup_settings(
    data: SignupSettings,
    user: User = Depends(require_superuser),
    db: Session = Depends(get_write_db),
):
    db.execute(text("UPDATE gateway_settings SET signups_enabled=:enabled WHERE id=1"),
               {"enabled": int(data.signups_enabled)})
    db.commit()
    return data


@router.post(
    "/login",
    response_model=TokenResponse,
)
def login(
    data: LoginRequest,
    db: Session = Depends(get_db),
):
    user = service.authenticate_user(db, data.email, data.password)
    return service.create_auth_tokens(user)


@router.post(
    "/refresh",
    response_model=TokenResponse,
)
def refresh(data: RefreshRequest):
    return service.rotate_refresh_token(data.refresh_token)
