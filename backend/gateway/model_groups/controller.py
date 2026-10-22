from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from backend.auth.models import User
from backend.core.database import get_db
from backend.dependencies import require_superuser
from backend.gateway.model_groups import service
from backend.gateway.model_groups.dtos import (
    ModelGroupCreate,
    ModelGroupListResponse,
    ModelGroupMemberCreate,
    ModelGroupMemberPatch,
    ModelGroupPatch,
    ModelGroupResponse,
    RoutingStrategy,
)

router = APIRouter(prefix="/model-groups", tags=["Model Groups"])


@router.post("", response_model=ModelGroupResponse, status_code=status.HTTP_201_CREATED)
def create_model_group(
    data: ModelGroupCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_superuser),
):
    return service.create_model_group(db, data, user.id)


@router.get("", response_model=ModelGroupListResponse)
def list_model_groups(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    is_enabled: bool | None = None,
    routing_strategy: RoutingStrategy | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_superuser),
):
    return service.list_model_groups(db, page, page_size, is_enabled, routing_strategy)


@router.get("/{group_id}", response_model=ModelGroupResponse)
def get_model_group(
    group_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(require_superuser),
):
    return service.get_model_group(db, group_id)


@router.patch("/{group_id}", response_model=ModelGroupResponse)
def update_model_group(
    group_id: UUID,
    data: ModelGroupPatch,
    db: Session = Depends(get_db),
    _: User = Depends(require_superuser),
):
    return service.update_model_group(db, group_id, data)


@router.post("/{group_id}/members", response_model=ModelGroupResponse)
def add_model_group_member(
    group_id: UUID,
    data: ModelGroupMemberCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_superuser),
):
    return service.add_model_group_member(db, group_id, data)


@router.patch("/{group_id}/members/{member_id}", response_model=ModelGroupResponse)
def update_model_group_member(
    group_id: UUID,
    member_id: UUID,
    data: ModelGroupMemberPatch,
    db: Session = Depends(get_db),
    _: User = Depends(require_superuser),
):
    return service.update_model_group_member(
        db,
        group_id,
        member_id,
        data.weight,
        data.priority,
    )


@router.delete("/{group_id}/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_model_group_member(
    group_id: UUID,
    member_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(require_superuser),
):
    service.delete_model_group_member(db, group_id, member_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
