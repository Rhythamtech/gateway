from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class APIKeyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class APIKeyCreated(BaseModel):
    id: str
    name: str
    api_key: str
    key_prefix: str
    owner_id: str
    created_at: datetime
    last_used_at: datetime | None
    revoked: bool
    revoked_at: datetime | None


class APIKeyItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    key_prefix: str
    owner_id: str
    created_at: datetime
    last_used_at: datetime | None
    revoked: bool
    revoked_at: datetime | None


class APIKeyList(BaseModel):
    items: list[APIKeyItem]
    total: int


class APIKeyRevoked(BaseModel):
    id: str
    name: str
    key_prefix: str
    revoked: bool
    revoked_at: datetime
