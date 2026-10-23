"""Versioned JSON response schemas for the LLM tracing API.

All identifiers are UUIDs, timestamps are UTC ISO 8601, token counts and
latency values are integers >= 0 (nullable where unavailable), and field
names are snake_case.
"""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel

SubjectType = Literal["api_key", "gateway_model", "user"]
TraceStatus = Literal["pending", "success", "failed", "timeout"]


class MessageTraceItem(BaseModel):
    id: UUID
    user_id: UUID
    message_id: str | None
    api_key_id: UUID | None
    request: dict[str, Any] | None
    status: TraceStatus
    call_count: int
    successful_call_count: int
    failed_call_count: int
    input_tokens: int | None
    output_tokens: int | None
    cache_tokens: int | None
    total_latency_ms: int | None
    created_at: datetime
    finished_at: datetime | None


class MessageTraceDetail(MessageTraceItem):
    calls: list["CallTraceItem"]


class MessagesPage(BaseModel):
    items: list[MessageTraceItem]
    page: int
    page_size: int
    total: int


class GatewayModelRef(BaseModel):
    id: UUID | None
    model_id: str


class ProviderModelRef(BaseModel):
    id: UUID
    model_id: str
    provider_id: UUID
    provider_name: str
    provider_alias: str


class CallTraceItem(BaseModel):
    id: UUID
    message_trace_id: UUID
    user_id: UUID
    message_id: str | None
    api_key_id: UUID | None
    gateway_model: GatewayModelRef | None
    provider_model: ProviderModelRef | None
    request: dict[str, Any] | None
    input_tokens: int | None
    output_tokens: int | None
    cache_tokens: int | None
    # Normalized token components and accounting charges (superuser view).
    uncached_input_tokens: int | None
    cache_read_tokens: int | None
    cache_write_tokens: int | None
    billable_token_units: int | None
    token_usage_source: str | None
    user_credits_charged: int
    credit_multiplier_ppm: int | None
    provider_budget_credits_consumed: int
    provider_cost_nanos: int
    currency_code: str | None
    latency_ms: int | None
    status: TraceStatus
    error_code: str | None
    created_at: datetime
    finished_at: datetime | None


class CallsPage(BaseModel):
    items: list[CallTraceItem]
    page: int
    page_size: int
    total: int


class UsageTotals(BaseModel):
    call_count: int
    successful_call_count: int
    failed_call_count: int
    input_tokens: int
    output_tokens: int
    cache_tokens: int
    total_latency_ms: int
    average_latency_ms: int | None


class DailyUsageEntry(BaseModel):
    date: str
    call_count: int
    successful_call_count: int
    failed_call_count: int
    input_tokens: int
    output_tokens: int
    cache_tokens: int
    total_latency_ms: int
    average_latency_ms: int | None


class UsageAnalytics(BaseModel):
    subject_type: SubjectType
    subject_id: UUID
    from_date: str
    to_date: str
    totals: UsageTotals
    daily: list[DailyUsageEntry]
