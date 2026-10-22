from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from backend.auth.models import User
from backend.core.database import get_db
from backend.dependencies import require_superuser
from backend.gateway.providers import service
from backend.gateway.providers.dtos import (
    ProviderCreateRequest,
    ProviderDeleteResponse,
    ProviderResponse,
    ProviderUpdateRequest,
)

router = APIRouter(prefix="/provider", tags=["Providers"])


@router.get("", response_model=list[ProviderResponse])
def list_providers(
    db: Session = Depends(get_db),
    _: User = Depends(require_superuser),
):
    return service.list_providers(db)


@router.get("/{provider_id}", response_model=ProviderResponse)
def get_provider(
    provider_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_superuser),
):
    return service.get_provider_by_id(db, provider_id)


@router.post(
    "/create",
    response_model=ProviderResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_provider(
    data: ProviderCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_superuser),
):
    return service.create_provider(db, data, actor_id=current_user.id)


@router.patch("/update/{provider_id}", response_model=ProviderResponse)
def update_provider(
    provider_id: str,
    data: ProviderUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_superuser),
):
    return service.update_provider(db, provider_id, data, actor_id=current_user.id)


@router.delete("/delete/{provider_id}", response_model=ProviderDeleteResponse)
def delete_provider(
    provider_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_superuser),
):
    service.delete_provider(db, provider_id, actor_id=current_user.id)
    return ProviderDeleteResponse(provider_id=provider_id, deleted=True)


@router.post("/disable/{provider_id}", response_model=ProviderResponse)
def disable_provider(
    provider_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_superuser),
):
    return service.disable_provider(db, provider_id, actor_id=current_user.id)
