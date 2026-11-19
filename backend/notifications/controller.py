from typing import Annotated
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from backend.auth.models import User
from backend.core.database import get_db
from backend.dependencies import get_current_user
from backend.notifications import service
from backend.notifications.dtos import NotificationPage, NotificationSettings

router = APIRouter(prefix="/notifications", tags=["Notifications"])
CurrentUser = Annotated[User, Depends(get_current_user)]
Database = Annotated[Session, Depends(get_db)]


@router.get("", response_model=NotificationPage)
def list_notifications(db: Database, user: CurrentUser, page: int = Query(1, ge=1)):
    warning, available = service.refresh_alerts(user.id)
    result = service.list_notifications(db, user.id, page)
    result.credit_warning = warning
    result.available_credits = available
    return result


@router.get("/settings", response_model=NotificationSettings)
def settings(user: CurrentUser):
    return service.get_settings(user.id)


@router.put("/settings", response_model=NotificationSettings)
def update_settings(data: NotificationSettings, user: CurrentUser):
    return service.save_settings(user.id, data)


@router.post("/read-all", status_code=204)
def read_all(user: CurrentUser):
    service.mark_read(user.id)


@router.post("/{notification_id}/read", status_code=204)
def read_one(notification_id: str, user: CurrentUser):
    service.mark_read(user.id, notification_id)
