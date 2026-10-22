from datetime import datetime

from pydantic import BaseModel


class ProviderModelResponse(BaseModel):
    id: str
    provider_id: str
    model_name: str
    model_id: str
    is_available: bool
    last_seen_at: datetime | None
    created_at: datetime
    updated_at: datetime


class SyncedModel(BaseModel):
    model_name: str
    model_id: str


class ModelSyncResponse(BaseModel):
    provider_id: str
    provider_alias: str
    synced: int
    created: int
    updated: int
    unavailable: int
    models: list[SyncedModel]
