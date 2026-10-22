from datetime import timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.auth.models import User
from backend.core.database import get_db
from backend.dependencies import require_superuser
from backend.gateway.provider_models import service
from backend.gateway.model_groups.service import list_enabled_groups
from backend.gateway.provider_models.dtos import (
    ModelSyncResponse,
    ProviderModelResponse,
)

router = APIRouter(prefix="/provider", tags=["Provider Models"])
gateway_router = APIRouter(prefix="/v1", tags=["Gateway"])


def _epoch_seconds(value) -> int:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)

    return int(value.timestamp())


@router.get("/models/{provider_id}", response_model=list[ProviderModelResponse])
def list_provider_models(
    provider_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_superuser),
):
    return service.list_provider_models(db, provider_id)


@router.post("/models/{provider_id}", response_model=ModelSyncResponse)
async def sync_provider_models(
    provider_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_superuser),
):
    return await service.sync_provider_models(db, provider_id)


@gateway_router.get("/models")
def list_models(db: Session = Depends(get_db)) -> dict:
    data = []

    for group in list_enabled_groups(db):
        data.append(
            {
                "id": group.model_id,
                "object": "model",
                "created": _epoch_seconds(group.created_at),
                "owned_by": "gateway",
            }
        )

    return {"object": "list", "data": data}
