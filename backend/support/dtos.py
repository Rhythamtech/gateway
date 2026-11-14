from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

SupportCategory = Literal[
    "billing", "api_keys", "model_routing", "latency", "account", "other"
]
SupportPriority = Literal["low", "normal", "high", "urgent"]
SupportStatus = Literal["open", "in_progress", "resolved", "closed"]


class TicketCreate(BaseModel):
    subject: str = Field(min_length=3, max_length=255)
    category: SupportCategory = "other"
    priority: SupportPriority = "normal"
    message: str = Field(min_length=5, max_length=10000)


class TicketMessageCreate(BaseModel):
    message: str = Field(min_length=1, max_length=10000)


class TicketStatusUpdate(BaseModel):
    status: SupportStatus


class TicketMessageResponse(BaseModel):
    id: str
    ticket_id: str
    sender_id: str
    sender_role: str
    sender_email: str | None = None
    message: str
    created_at: datetime


class TicketResponse(BaseModel):
    id: str
    user_id: str
    user_email: str | None = None
    subject: str
    category: str
    priority: str
    status: str
    message_count: int = 1
    last_message_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class TicketDetailResponse(TicketResponse):
    messages: list[TicketMessageResponse] = []


class TicketPage(BaseModel):
    items: list[TicketResponse]
    total: int
    page: int
    page_size: int


class SupportStatsResponse(BaseModel):
    total: int
    open: int
    in_progress: int
    resolved: int
    closed: int
