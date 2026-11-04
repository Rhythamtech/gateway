from pydantic import BaseModel

from backend.core.datetime_safety import UTCDateTime


class ProviderModelResponse(BaseModel):
    id: str
    provider_id: str
    model_name: str
    model_id: str
    is_available: bool
    last_seen_at: UTCDateTime | None
    created_at: UTCDateTime
    updated_at: UTCDateTime


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
