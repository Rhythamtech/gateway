from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.core.database import get_db
from backend.dependencies import get_current_user, require_superuser
from backend.auth.models import User
from backend.users.dtos import (
    CurrentUserResponse,
    UserPreferencesUpdate,
    UserUpdateRequest,
    UserAdminAuditItem,
)
from backend.users.service import list_users, to_user_response
from backend.users import service as users_service

router = APIRouter(prefix="/users", tags=["Users"])


@router.get("/me", response_model=CurrentUserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return to_user_response(current_user)


@router.patch("/me/preferences", response_model=CurrentUserResponse)
def update_my_preferences(
    data: UserPreferencesUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Any authenticated user may toggle their own telemetry preference."""
    return to_user_response(
        users_service.update_own_preferences(db, current_user, data)
    )


@router.get("", response_model=list[CurrentUserResponse])
def get_users(
    db: Session = Depends(get_db),
    _: User = Depends(require_superuser),
):
    return [to_user_response(user) for user in list_users(db)]


@router.patch("/{user_id}", response_model=CurrentUserResponse)
def update_user_endpoint(
    user_id: str,
    data: UserUpdateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(require_superuser),
):
    return to_user_response(users_service.update_user(db, user_id, data, actor))


@router.get("/{user_id}/audit", response_model=list[UserAdminAuditItem])
def get_user_audit(user_id: str, db: Session = Depends(get_db), _: User = Depends(require_superuser)):
    if db.get(User, user_id) is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="User not found")
    return [
        UserAdminAuditItem(id=entry.id, actor_email=email, action=entry.action, detail=entry.detail, created_at=entry.created_at)
        for entry, email in users_service.list_user_audit(db, user_id)
    ]
