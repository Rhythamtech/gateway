from datetime import datetime
from pydantic import BaseModel, ConfigDict


class NotificationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    kind: str
    title: str
    message: str
    action_url: str
    created_at: datetime
    read_at: datetime | None


class NotificationPage(BaseModel):
    items: list[NotificationResponse]
    unread_count: int
    total: int
    page: int
    credit_warning: str | None = None
    available_credits: str = "0.000000"


class NotificationSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    low_credit_enabled: bool = True
    key_expiry_enabled: bool = True
    low_credit_threshold: str = "10"
