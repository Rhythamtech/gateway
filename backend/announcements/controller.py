from typing import Annotated, Literal
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from backend.auth.models import User
from backend.core.database import get_db
from backend.dependencies import get_current_user, require_superuser
from backend.announcements import service
from backend.announcements.models import Announcement
from backend.announcements.dtos import AnnouncementInput, AnnouncementResponse, BannerResponse

router = APIRouter(prefix="/announcements", tags=["Announcements"])
Database = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]
Superuser = Annotated[User, Depends(require_superuser)]


@router.get("/public", response_model=list[BannerResponse])
def public(db: Database):
    return service.banners(db, "landing")


@router.get("/me", response_model=list[BannerResponse])
def mine(db: Database, user: CurrentUser):
    return service.banners(db, "dashboard", user)


@router.post("/{id}/dismiss", status_code=204)
def dismiss(id: str, user: CurrentUser, version: int = Query(ge=1)):
    service.dismiss(id, version, user)


@router.get("", response_model=list[AnnouncementResponse])
def list_items(db: Database, _: Superuser):
    return db.query(Announcement).order_by(Announcement.created_at.desc()).all()


@router.post("", response_model=AnnouncementResponse, status_code=201)
def create(data: AnnouncementInput, user: Superuser):
    return service.save(data, user.id)


@router.put("/{id}", response_model=AnnouncementResponse)
def update(id: str, data: AnnouncementInput, user: Superuser):
    return service.save(data, user.id, id)


@router.post("/{id}/republish", response_model=AnnouncementResponse)
def republish(id: str, _: Superuser):
    return service.republish(id)
