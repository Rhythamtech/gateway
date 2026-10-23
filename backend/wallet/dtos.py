"""Versioned JSON contracts for wallet, ledger and budget endpoints.

All amounts are integer credits or token units, timestamps are UTC ISO 8601
and identifiers are UUID strings. Wallet endpoints are JWT-user scoped;
budget endpoints are superuser-only.
"""

from datetime import datetime, timezone
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_serializer

WalletStatus = Literal["active", "debt", "blocked"]
LedgerEntryType = Literal["top_up", "reserve", "settle", "release"]
IdempotencyKey = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=8, max_length=128)
]
NonEmptyReason = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)
]


class UTCResponseModel(BaseModel):
    """Serialize database timestamps as explicit UTC ISO 8601 values."""

    @field_serializer("*", when_used="json")
    def serialize_utc_datetimes(self, value):
        if isinstance(value, datetime):
            if value.tzinfo is None:
                value = value.replace(tzinfo=timezone.utc)
            else:
                value = value.astimezone(timezone.utc)
        return value


# ---------------------------------------------------------------------------
# Requests
# ---------------------------------------------------------------------------


class WalletTopUpRequest(BaseModel):
    """Superuser top-up for one user's wallet."""

    model_config = ConfigDict(extra="forbid")

    amount_credits: int = Field(gt=0, strict=True)
    idempotency_key: IdempotencyKey
    reason: NonEmptyReason


class SystemBudgetTopUpRequest(BaseModel):
    """Funds the unallocated system budget pool."""

    model_config = ConfigDict(extra="forbid")

    amount_credits: int = Field(gt=0, strict=True)
    idempotency_key: IdempotencyKey
    reason: NonEmptyReason


class ProviderBudgetTopUpRequest(BaseModel):
    """Transfers credits from the system pool into a provider budget."""

    model_config = ConfigDict(extra="forbid")

    amount_credits: int = Field(gt=0, strict=True)
    idempotency_key: IdempotencyKey
    reason: NonEmptyReason


# ---------------------------------------------------------------------------
# Wallet responses
# ---------------------------------------------------------------------------


class WalletBalance(BaseModel):
    """GET /wallet — the caller's own wallet projection."""

    user_id: str
    available_credits: int
    reserved_credits: int
    debt_credits: int
    lifetime_credited_credits: int
    lifetime_spent_credits: int
    status: WalletStatus
    version: int
    created_at: datetime
    updated_at: datetime


class WalletTransaction(BaseModel):
    """One append-only wallet ledger row."""

    id: str
    wallet_id: str
    user_id: str
    entry_type: LedgerEntryType
    available_delta_credits: int
    reserved_delta_credits: int
    charged_credits: int
    debt_delta_credits: int
    balance_after_credits: int
    reserved_after_credits: int
    debt_after_credits: int
    source_call_trace_id: str | None
    idempotency_key: str
    reason: str
    actor_user_id: str | None
    created_at: datetime


class WalletTransactionPage(BaseModel):
    """GET /wallet/transactions — paginated ledger rows, newest first."""

    items: list[WalletTransaction]
    page: int
    page_size: int
    total: int


class WalletTopUpCreated(UTCResponseModel):
    """POST /users/{user_id}/wallet/top-ups — 201 response."""

    transaction_id: str
    user_id: str
    amount_credits: int
    available_credits: int
    reserved_credits: int
    reason: str
    actor_user_id: str | None
    created_at: datetime


# ---------------------------------------------------------------------------
# Budget responses
# ---------------------------------------------------------------------------


class SystemBudgetResponse(UTCResponseModel):
    """GET /system-budget."""

    unallocated_credits: int
    allocated_credits: int
    consumed_credits: int
    lifetime_funded_credits: int
    available_for_allocation_credits: int
    updated_at: datetime


class SystemBudgetTopUpCreated(UTCResponseModel):
    """POST /system-budget/top-ups — 201 response."""

    transaction_id: str
    amount_credits: int
    unallocated_credits: int
    allocated_credits: int
    consumed_credits: int
    actor_user_id: str | None
    reason: str
    created_at: datetime


class ProviderBudgetResponse(UTCResponseModel):
    """GET /providers/{provider_id}/budget."""

    provider_id: str
    provider_name: str
    available_credits: int
    reserved_credits: int
    consumed_credits: int
    lifetime_allocated_credits: int
    updated_at: datetime


class ProviderBudgetTopUpCreated(UTCResponseModel):
    """POST /providers/{provider_id}/budget/top-ups — 201 response."""

    transaction_id: str
    provider_id: str
    amount_credits: int
    provider_available_credits: int
    system_unallocated_credits: int
    actor_user_id: str | None
    reason: str
    created_at: datetime
