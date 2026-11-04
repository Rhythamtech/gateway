from typing import Literal

from pydantic import BaseModel, Field

from backend.core.datetime_safety import UTCDateTime
from backend.credits.dtos import CreditAmount

ProviderProtocol = Literal["openai", "anthropic"]


class ProviderCreateRequest(BaseModel):
    initial_credits: CreditAmount | None = None
    name: str = Field(min_length=1, max_length=255)
    aliases: str = Field(min_length=1, max_length=64)
    base_url: str = Field(min_length=1)
    api_key: str | None = None
    custom_header: str | dict[str, str] | None = None
    protocol: ProviderProtocol = "openai"


class ProviderUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    aliases: str | None = Field(default=None, min_length=1, max_length=64)
    base_url: str | None = Field(default=None, min_length=1)
    api_key: str | None = None
    custom_header: str | dict[str, str] | None = None
    protocol: ProviderProtocol | None = None
    is_enabled: bool | None = None


class ProviderResponse(BaseModel):
    id: str
    name: str
    aliases: str
    base_url: str
    protocol: ProviderProtocol
    is_enabled: bool
    has_api_key: bool
    has_custom_header: bool
    created_at: UTCDateTime
    updated_at: UTCDateTime


class ProviderDeleteResponse(BaseModel):
    provider_id: str
    deleted: bool
