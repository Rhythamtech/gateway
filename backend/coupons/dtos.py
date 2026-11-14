from typing import Annotated

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator

from backend.core.datetime_safety import UTCDateTime, to_utc
from backend.credits.dtos import CreditAmount, CreditEntryResponse


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class CodeInput(Input):
    code: str = Field(min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")

    @field_validator("code", mode="before")
    @classmethod
    def normalize_code(cls, value):
        return value.strip().upper() if isinstance(value, str) else value


class CouponCreate(CodeInput):
    name: str = Field(min_length=1, max_length=150)
    credits: CreditAmount
    enabled: bool = Field(default=True, strict=True)
    starts_at: AwareDatetime | None = None
    expires_at: AwareDatetime | None = None
    max_redemptions: Annotated[int, Field(ge=1, le=2_147_483_647, strict=True)] | None = None
    per_user_limit: int = Field(default=1, ge=1, le=2_147_483_647, strict=True)

    @field_validator("starts_at", "expires_at")
    @classmethod
    def normalize_time(cls, value):
        return to_utc(value) if value else None

    @model_validator(mode="after")
    def validate_window(self):
        if self.starts_at and self.expires_at and self.expires_at <= self.starts_at:
            raise ValueError("Expiry must be after start")
        return self


class CouponUpdate(Input):
    name: str = Field(default=None, min_length=1, max_length=150)
    enabled: bool = Field(default=None, strict=True)

    @model_validator(mode="after")
    def validate_changes(self):
        if not self.model_fields_set or any(getattr(self, key) is None for key in self.model_fields_set):
            raise ValueError("Supply name or enabled; null is not allowed")
        return self


class RedeemCoupon(CodeInput):
    idempotency_key: str = Field(min_length=8, max_length=128)


class CouponResponse(BaseModel):
    id: str
    code: str
    name: str
    credits: str
    enabled: bool
    starts_at: UTCDateTime | None
    expires_at: UTCDateTime | None
    max_redemptions: int | None
    per_user_limit: int
    redemption_count: int
    created_by: str
    created_at: UTCDateTime
    updated_at: UTCDateTime


class RedemptionResponse(BaseModel):
    id: str
    coupon_id: str
    code: str
    user_id: str
    credits: str
    created_at: UTCDateTime
    credit_entry: CreditEntryResponse


class CouponPage(BaseModel):
    items: list[CouponResponse]
    page: int
    page_size: int
    total: int


class RedemptionPage(BaseModel):
    items: list[RedemptionResponse]
    page: int
    page_size: int
    total: int
