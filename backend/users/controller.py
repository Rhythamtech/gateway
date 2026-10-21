from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.core.database import get_db
from backend.dependencies import get_current_user, require_superuser
from backend.auth.models import User
from backend.users.dtos import CurrentUserResponse, UserUpdateRequest
from backend.users.service import list_users, to_user_response, update_user_active

router = APIRouter(prefix="/users", tags=["Users"])


@router.get("/me", response_model=CurrentUserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return to_user_response(current_user)


@router.get("", response_model=list[CurrentUserResponse])
def get_users(
    db: Session = Depends(get_db),
    _: User = Depends(require_superuser),
):
    return [to_user_response(user) for user in list_users(db)]


@router.patch("/{user_id}", response_model=CurrentUserResponse)
def update_user(
    user_id: str,
    data: UserUpdateRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_superuser),
):
    return to_user_response(update_user_active(db, user_id, data.is_active))
