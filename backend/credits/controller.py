from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.auth.models import User
from backend.core.database import get_db
from backend.credits import service
from backend.credits.dtos import (
    CreditAddition,
    CreditBalance,
    CreditEntryResponse,
    CreditHistory,
    CreditUsagePage,
    CreditUsageResponse,
    ModelRateResponse,
    ModelRateUpdate,
    UsageResolution,
)
from backend.dependencies import get_current_user, require_superuser

router = APIRouter(tags=["Credits"])
Database = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]
Superuser = Annotated[User, Depends(require_superuser)]
Page = Annotated[int, Query(ge=1)]
PageSize = Annotated[int, Query(ge=1, le=100)]
UsageStatus = Literal[
    "reserved", "dispatched", "usage_recorded", "needs_review", "settled", "released"
]


@router.get("/credits/me", response_model=CreditBalance)
def get_my_credits(db: Database, user: CurrentUser):
    return service.get_balance(db, "user", user.id)


@router.get("/credits/me/history", response_model=CreditHistory)
def get_my_history(
    db: Database, user: CurrentUser, page: Page = 1, page_size: PageSize = 20
):
    return service.get_history(db, "user", user.id, page, page_size)


@router.get("/credits/me/usage", response_model=CreditUsagePage)
def get_my_usage(
    db: Database, user: CurrentUser, page: Page = 1, page_size: PageSize = 20
):
    return service.list_usage(db, page, page_size, user_id=user.id)


@router.get("/credits/users/{user_id}", response_model=CreditBalance)
def get_user_credits(user_id: str, db: Database, _: Superuser):
    return service.get_balance(db, "user", user_id)


@router.get("/credits/users/{user_id}/history", response_model=CreditHistory)
def get_user_history(
    user_id: str, db: Database, _: Superuser, page: Page = 1, page_size: PageSize = 20
):
    return service.get_history(db, "user", user_id, page, page_size)


@router.post("/credits/users/{user_id}/add", response_model=CreditEntryResponse)
def add_user_credits(user_id: str, data: CreditAddition, actor: Superuser):
    return service.add_credits("user", user_id, data, actor.id)


@router.get("/provider/{provider_id}/credits", response_model=CreditBalance)
def get_provider_credits(provider_id: str, db: Database, _: Superuser):
    return service.get_balance(db, "provider", provider_id)


@router.get("/provider/{provider_id}/credits/history", response_model=CreditHistory)
def get_provider_history(
    provider_id: str,
    db: Database,
    _: Superuser,
    page: Page = 1,
    page_size: PageSize = 20,
):
    return service.get_history(db, "provider", provider_id, page, page_size)


@router.post("/provider/{provider_id}/credits/add", response_model=CreditEntryResponse)
def add_provider_credits(provider_id: str, data: CreditAddition, actor: Superuser):
    return service.add_credits("provider", provider_id, data, actor.id)


@router.get("/provider/models/{model_id}/credit-rate", response_model=ModelRateResponse)
def get_model_rate(model_id: str, db: Database, _: Superuser):
    return service.get_model_rate(db, model_id)


@router.put("/provider/models/{model_id}/credit-rate", response_model=ModelRateResponse)
def set_model_rate(model_id: str, data: ModelRateUpdate, actor: Superuser):
    return service.set_model_rate(model_id, data, actor.id)


@router.get("/credits/usage", response_model=CreditUsagePage)
def get_usage(
    db: Database,
    _: Superuser,
    page: Page = 1,
    page_size: PageSize = 20,
    status: UsageStatus | None = None,
    user_id: str | None = None,
):
    return service.list_usage(db, page, page_size, status, user_id)


@router.post("/credits/usage/{usage_id}/resolve", response_model=CreditUsageResponse)
def resolve_usage(usage_id: str, data: UsageResolution, actor: Superuser):
    return service.resolve_usage(usage_id, data, actor.id)
