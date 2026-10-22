import re
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

RoutingStrategy = Literal["round_robin", "weighted_round_robin"]
_MODEL_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*/\S+$")


def _validate_model_id(value: str) -> str:
    value = value.strip()
    if not _MODEL_ID.fullmatch(value):
        raise ValueError("model_id must use the {alias}/{model_name} format")
    return value


class ModelGroupMemberCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider_model_id: UUID
    weight: int = Field(default=1, gt=0, strict=True)
    priority: int = Field(default=1, gt=0, strict=True)


class ModelGroupMemberPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    weight: int | None = Field(default=None, gt=0, strict=True)
    priority: int | None = Field(default=None, gt=0, strict=True)

    @model_validator(mode="after")
    def require_patch_fields(self):
        if not self.model_fields_set:
            raise ValueError("At least one member field must be supplied")
        if any(getattr(self, field) is None for field in self.model_fields_set):
            raise ValueError("Member fields must not be null")
        return self


class ModelGroupCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=255)
    model_id: str = Field(min_length=1, max_length=320)
    routing_strategy: RoutingStrategy
    is_enabled: bool = True
    members: list[ModelGroupMemberCreate] = Field(default_factory=list)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("name must not be empty")
        return value

    @field_validator("model_id")
    @classmethod
    def validate_model_id(cls, value: str) -> str:
        return _validate_model_id(value)


class ModelGroupPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=255)
    model_id: str | None = Field(default=None, min_length=1, max_length=320)
    routing_strategy: RoutingStrategy | None = None
    is_enabled: bool | None = None
    members: list[ModelGroupMemberCreate] | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("name must not be empty")
        return value

    @field_validator("model_id")
    @classmethod
    def validate_model_id(cls, value: str | None) -> str | None:
        return None if value is None else _validate_model_id(value)

    @model_validator(mode="after")
    def require_patch_fields(self):
        if not self.model_fields_set:
            raise ValueError("At least one mutable field must be supplied")
        if any(getattr(self, field) is None for field in self.model_fields_set):
            raise ValueError("Mutable fields must not be null")
        return self


class ModelGroupMemberResponse(BaseModel):
    id: UUID
    provider_model_id: UUID
    provider_id: UUID
    provider_name: str
    provider_alias: str
    model_name: str
    provider_model_id_public: str
    weight: int
    priority: int
    is_available: bool


class ModelGroupResponse(BaseModel):
    id: UUID
    name: str
    model_id: str
    routing_strategy: RoutingStrategy
    is_enabled: bool
    members: list[ModelGroupMemberResponse]
    member_count: int
    created_by: UUID
    created_at: datetime
    updated_at: datetime


class ModelGroupListResponse(BaseModel):
    items: list[ModelGroupResponse]
    page: int
    page_size: int
    total: int
