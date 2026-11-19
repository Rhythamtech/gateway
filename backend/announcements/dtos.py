from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, AwareDatetime, model_validator


class AnnouncementInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=200)
    message: str = Field(min_length=1, max_length=2000)
    placement: Literal["landing", "dashboard", "both"] = "dashboard"
    audience: Literal["public", "users", "superusers"] = "users"
    status: Literal["draft", "published", "withdrawn"] = "draft"
    priority: int = Field(default=0, ge=0, le=100)
    dismissible: bool = True
    starts_at: AwareDatetime | None = None
    ends_at: AwareDatetime | None = None
    coupon_id: str | None = None
    action_label: str | None = Field(default=None, max_length=80)
    action_url: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def validate_settings(self):
        if self.starts_at and self.ends_at and self.ends_at <= self.starts_at:
            raise ValueError("End time must be after start time")
        if self.placement in ("landing", "both") and self.audience != "public":
            raise ValueError("Landing announcements must be public")
        if bool(self.action_url) != bool(self.action_label):
            raise ValueError("Action label and URL must be provided together")
        if self.action_url and (not self.action_url.startswith("/") or self.action_url.startswith("//") or "\\" in self.action_url or any(ord(c) < 32 for c in self.action_url)):
            raise ValueError("Actions must use a local application path")
        return self


class AnnouncementResponse(AnnouncementInput):
    model_config = ConfigDict(from_attributes=True)
    id: str
    version: int
    created_at: datetime


class BannerResponse(BaseModel):
    id: str
    version: int
    title: str
    message: str
    dismissible: bool
    action_label: str | None
    action_url: str | None
    ends_at: datetime | None
    coupon_code: str | None = None
    coupon_credits: str | None = None
