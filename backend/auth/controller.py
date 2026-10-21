from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from backend.auth import service
from backend.auth.dtos import (
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)
from backend.core.database import get_db

router = APIRouter(prefix="/auth", tags=["Auth"])


@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
)
def register(
    data: RegisterRequest,
    db: Session = Depends(get_db),
):
    user = service.register_user(db, data)
    return user


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
