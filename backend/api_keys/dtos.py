from pydantic import BaseModel, ConfigDict, Field

from backend.core.datetime_safety import UTCDateTime


class APIKeyCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)


class APIKeyCreated(BaseModel):
    id: str
    name: str
    api_key: str
    key_prefix: str
    owner_id: str
    created_at: UTCDateTime
    last_used_at: UTCDateTime | None
    revoked: bool
    revoked_at: UTCDateTime | None


class APIKeyItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    key_prefix: str
    owner_id: str
    created_at: UTCDateTime
    last_used_at: UTCDateTime | None
    revoked: bool
    revoked_at: UTCDateTime | None


class APIKeyList(BaseModel):
    items: list[APIKeyItem]
    total: int


class APIKeyRevoked(BaseModel):
    id: str
    name: str
    key_prefix: str
    owner_id: str
    revoked: bool
    revoked_at: UTCDateTime
