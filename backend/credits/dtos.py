from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.core.datetime_safety import UTCDateTime

CreditAmount = Annotated[
    Decimal, Field(gt=0, le=9_000_000_000_000, max_digits=19, decimal_places=6)
]


class CreditAddition(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    credits: CreditAmount
    idempotency_key: str = Field(min_length=8, max_length=128)
    reason: str = Field(min_length=1, max_length=1000)


class CreditBalance(BaseModel):
    remaining_credits: str
    reserved_credits: str
    available_credits: str


class CreditEntryResponse(BaseModel):
    id: str
    credits: str
    remaining_credits: str
    usage_id: str | None
    actor_id: str | None
    reason: str
    created_at: UTCDateTime


class CreditHistory(BaseModel):
    items: list[CreditEntryResponse]
    page: int
    page_size: int
    total: int


class ModelRateUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tokens_per_credit: Annotated[
        Decimal, Field(gt=0, le=1_000_000_000, max_digits=16, decimal_places=6)
    ]
    max_request_tokens: int | None = Field(default=None, gt=0, le=10_000_000, strict=True)


class ModelRateResponse(BaseModel):
    id: str
    provider_model_id: str
    version: int
    tokens_per_credit: str
    max_request_tokens: int | None
    created_at: UTCDateTime


class CreditUsageResponse(BaseModel):
    id: str
    request_id: str
    user_id: str
    provider_id: str
    provider_model_id: str
    model_id: str | None = None
    api_key_id: str
    rate_id: str
    tokens_per_credit: str
    max_request_tokens: int
    reserved_credits: str
    charged_credits: str
    input_tokens: int | None
    output_tokens: int | None
    provider_request_id: str | None
    status: str
    reason: str | None
    resolved_by: str | None
    created_at: UTCDateTime
    updated_at: UTCDateTime


class CreditUsagePage(BaseModel):
    items: list[CreditUsageResponse]
    page: int
    page_size: int
    total: int


class UsageResolution(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    action: Literal["settle", "release"]
    input_tokens: int | None = Field(default=None, ge=0, le=10_000_000, strict=True)
    output_tokens: int | None = Field(default=None, ge=0, le=10_000_000, strict=True)
    reason: str = Field(min_length=1, max_length=1000)

    @model_validator(mode="after")
    def validate_usage(self):
        if self.action == "settle" and (
            self.input_tokens is None or self.output_tokens is None
        ):
            raise ValueError("Settlement requires input_tokens and output_tokens")
        if self.action == "release" and (
            self.input_tokens is not None or self.output_tokens is not None
        ):
            raise ValueError("Release must not include token usage")
        return self
