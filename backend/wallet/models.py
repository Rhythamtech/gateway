"""Transactional accounting schema: user wallets, budgets and daily usage.

All amounts are integer credits:

* user credits — the billable-facing unit; one normalized token unit is one
  base user credit scaled by the model-group ``credit_multiplier_ppm``.
* provider/system budget credits — internal token-equivalent units,
  independent of user credits and model multipliers.
* provider capacity tokens — SEPARATE from budget; the physical token
  throughput capacity a provider can serve, managed manually by Super Admin.
  Adding capacity never draws from the system budget pool.

Three distinct resource dimensions per reservation:
  1. user_wallet       — user credits (billing)
  2. provider_budget   — financial token-equivalent (cost accounting)
  3. provider_capacity — physical throughput capacity (independent of cost)

Ledgers (``wallet_ledger_entries``, ``system_budget_ledger``,
``provider_budget_ledger``, ``provider_capacity_ledger``) are append-only
financial records: they carry NO foreign keys to operational entities (same
as ``ProviderAuditLog``), so deleting a user/provider never removes
accounting history. Account balances are transactionally maintained
projections of their ledgers.
"""

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from backend.core.database import Base

PRICING_VERSION_LENGTH = 32

# Wallet states. Inference requires "active"; a wallet with recorded debt is
# "debt" and is blocked from further inference until topped up.
WALLET_STATUS_ACTIVE = "active"
WALLET_STATUS_DEBT = "debt"
WALLET_STATUS_BLOCKED = "blocked"

# Reservation lifecycle. Reconciling tools only release "active" ones.
RESERVATION_ACTIVE = "active"
RESERVATION_SETTLED = "settled"
RESERVATION_RELEASED = "released"

# Ledger entry types.
WALLET_ENTRY_TYPES = ("top_up", "reserve", "settle", "release")
SYSTEM_ENTRY_TYPES = ("fund", "allocate", "consume")
PROVIDER_ENTRY_TYPES = ("allocate", "reserve", "settle", "release")
# Capacity ledger: "add" = Super Admin manually adds tokens;
# "reserve"/"settle"/"release" mirror the budget lifecycle.
CAPACITY_ENTRY_TYPES = ("add", "reserve", "settle", "release")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> str:
    return str(uuid4())


class UserWallet(Base):
    """One wallet per user; the balance columns are ledger projections."""

    __tablename__ = "user_wallets"
    __table_args__ = (
        CheckConstraint(
            "available_credits >= 0", name="ck_user_wallets_available_nonneg"
        ),
        CheckConstraint("reserved_credits >= 0", name="ck_user_wallets_reserved_nonneg"),
        CheckConstraint("debt_credits >= 0", name="ck_user_wallets_debt_nonneg"),
        CheckConstraint(
            "lifetime_credited_credits >= 0", name="ck_user_wallets_lifetime_credited_nonneg"
        ),
        CheckConstraint(
            "lifetime_spent_credits >= 0", name="ck_user_wallets_lifetime_spent_nonneg"
        ),
        CheckConstraint(
            "status IN ('active','debt','blocked')", name="ck_user_wallets_status"
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    # RESTRICT: a user with wallet history cannot be dropped by a cascade,
    # keeping financial accounting auditable.
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"),
        unique=True,
        index=True,
        nullable=False,
    )
    available_credits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reserved_credits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    debt_credits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    lifetime_credited_credits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    lifetime_spent_credits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=WALLET_STATUS_ACTIVE)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )


class WalletLedgerEntry(Base):
    """Append-only wallet accounting record; the source of truth.

    ``wallet_id``/``user_id``/``actor_user_id`` are audit identifiers without
    FKs (history survives user deletion); ``source_call_trace_id`` ties the
    entry to the specific upstream attempt when one exists.
    """

    __tablename__ = "wallet_ledger_entries"
    __table_args__ = (
        CheckConstraint(
            "charged_credits >= 0", name="ck_wallet_ledger_charged_nonneg"
        ),
        CheckConstraint(
            "balance_after_credits >= 0", name="ck_wallet_ledger_balance_after_nonneg"
        ),
        CheckConstraint(
            "reserved_after_credits >= 0", name="ck_wallet_ledger_reserved_after_nonneg"
        ),
        CheckConstraint(
            "debt_after_credits >= 0", name="ck_wallet_ledger_debt_after_nonneg"
        ),
        CheckConstraint(
            "entry_type IN ('top_up','reserve','settle','release')",
            name="ck_wallet_ledger_entry_type",
        ),
        UniqueConstraint("idempotency_key", name="uq_wallet_ledger_idempotency"),
        Index("ix_wallet_ledger_wallet_created", "wallet_id", "created_at"),
        Index("ix_wallet_ledger_user_created", "user_id", "created_at"),
        Index("ix_wallet_ledger_call_trace", "source_call_trace_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    wallet_id: Mapped[str] = mapped_column(String(36), nullable=False)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    entry_type: Mapped[str] = mapped_column(String(16), nullable=False)
    available_delta_credits: Mapped[int] = mapped_column(Integer, nullable=False)
    reserved_delta_credits: Mapped[int] = mapped_column(Integer, nullable=False)
    # Actual charge (after the fact) when one applies, else zero.
    charged_credits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Debt is the auditable extension of the charge columns: an overage that
    # the wallet could not cover is recorded here instead of a negative balance.
    debt_delta_credits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    balance_after_credits: Mapped[int] = mapped_column(Integer, nullable=False)
    reserved_after_credits: Mapped[int] = mapped_column(Integer, nullable=False)
    debt_after_credits: Mapped[int] = mapped_column(Integer, nullable=False)
    source_call_trace_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    reason: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    actor_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )


class WalletReservation(Base):
    """Per-attempt credit hold (user credits and provider budget together).

    One reservation per upstream attempt (retries get their own); committed
    before any network call. ``provider_reserved_credits`` records the
    provider-side hold so an interrupted attempt can be reconciled without a
    separate provider-reservation table.
    """

    __tablename__ = "wallet_reservations"
    __table_args__ = (
        CheckConstraint("reserved_credits >= 0", name="ck_wallet_reservations_nonneg"),
        CheckConstraint(
            "provider_reserved_credits >= 0",
            name="ck_wallet_reservations_provider_credits_nonneg",
        ),
        CheckConstraint(
            "estimated_input_tokens >= 0",
            name="ck_wallet_reservations_est_input_nonneg",
        ),
        CheckConstraint(
            "estimated_output_tokens >= 0",
            name="ck_wallet_reservations_est_output_nonneg",
        ),
        CheckConstraint(
            "status IN ('active','settled','released')",
            name="ck_wallet_reservations_status",
        ),
        Index("ix_wallet_reservations_wallet_status", "wallet_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    wallet_id: Mapped[str] = mapped_column(
        ForeignKey("user_wallets.id", ondelete="CASCADE"), nullable=False
    )
    call_trace_id: Mapped[str] = mapped_column(
        ForeignKey("llm_call_traces.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    # Provider whose budget is held; plain id (audit survives provider changes).
    provider_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    reserved_credits: Mapped[int] = mapped_column(Integer, nullable=False)
    # Set at settlement; NULL while the reservation is still held.
    charged_credits: Mapped[int | None] = mapped_column(Integer, nullable=True)
    provider_reserved_credits: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    # Capacity tokens held (separate from budget credits).
    # Zero when the provider has no capacity account (legacy / unconfigured).
    capacity_reserved_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Request-derived estimates the reservation was based on (restores the
    # estimate for missing-usage policy settlements after a restart).
    estimated_input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    estimated_output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    multiplier_snapshot_ppm: Mapped[int] = mapped_column(Integer, nullable=False)
    pricing_version: Mapped[str] = mapped_column(
        String(PRICING_VERSION_LENGTH), nullable=False
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=RESERVATION_ACTIVE)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SystemBudgetAccount(Base):
    """Singleton funding pool: one row, id = 1."""

    __tablename__ = "system_budget_accounts"
    __table_args__ = (
        CheckConstraint("unallocated_credits >= 0", name="ck_system_budget_unallocated_nonneg"),
        CheckConstraint("allocated_credits >= 0", name="ck_system_budget_allocated_nonneg"),
        CheckConstraint("consumed_credits >= 0", name="ck_system_budget_consumed_nonneg"),
        CheckConstraint(
            "lifetime_funded_credits >= 0", name="ck_system_budget_lifetime_funded_nonneg"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    unallocated_credits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    allocated_credits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Mirrors total provider-level consumption so
    # lifetime_funded == unallocated + allocated + consumed holds.
    consumed_credits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    lifetime_funded_credits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )


class SystemBudgetLedger(Base):
    """Append-only system funding/allocation/consumption record."""

    __tablename__ = "system_budget_ledger"
    __table_args__ = (
        CheckConstraint("amount_credits >= 0", name="ck_system_budget_ledger_amount_nonneg"),
        CheckConstraint(
            "entry_type IN ('fund','allocate','consume')",
            name="ck_system_budget_ledger_entry_type",
        ),
        UniqueConstraint("idempotency_key", name="uq_system_budget_ledger_idempotency"),
        Index("ix_system_budget_ledger_created", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    entry_type: Mapped[str] = mapped_column(String(16), nullable=False)
    amount_credits: Mapped[int] = mapped_column(Integer, nullable=False)
    unallocated_delta_credits: Mapped[int] = mapped_column(Integer, nullable=False)
    allocated_delta_credits: Mapped[int] = mapped_column(Integer, nullable=False)
    consumed_delta_credits: Mapped[int] = mapped_column(Integer, nullable=False)
    provider_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    actor_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    reason: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )


class ProviderBudgetAccount(Base):
    """Provider token-equivalent budget; balances are ledger projections."""

    __tablename__ = "provider_budget_accounts"
    __table_args__ = (
        CheckConstraint("available_credits >= 0", name="ck_provider_budget_available_nonneg"),
        CheckConstraint("reserved_credits >= 0", name="ck_provider_budget_reserved_nonneg"),
        CheckConstraint("consumed_credits >= 0", name="ck_provider_budget_consumed_nonneg"),
        CheckConstraint(
            "lifetime_allocated_credits >= 0",
            name="ck_provider_budget_lifetime_allocated_nonneg",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    # RESTRICT: providers with a budget account cannot be cascade-dropped;
    # existing provider-delete flow surfaces this as a 409 conflict.
    provider_id: Mapped[str] = mapped_column(
        ForeignKey("providers.id", ondelete="RESTRICT"),
        unique=True,
        index=True,
        nullable=False,
    )
    available_credits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reserved_credits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    consumed_credits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    lifetime_allocated_credits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )


class ProviderBudgetLedger(Base):
    """Append-only provider budget record (no FK; history is preserved)."""

    __tablename__ = "provider_budget_ledger"
    __table_args__ = (
        CheckConstraint("amount_credits >= 0", name="ck_provider_budget_ledger_amount_nonneg"),
        CheckConstraint(
            "entry_type IN ('allocate','reserve','settle','release')",
            name="ck_provider_budget_ledger_entry_type",
        ),
        UniqueConstraint("idempotency_key", name="uq_provider_budget_ledger_idempotency"),
        Index("ix_provider_budget_ledger_account_created", "provider_budget_account_id", "created_at"),
        Index("ix_provider_budget_ledger_call_trace", "source_call_trace_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    provider_budget_account_id: Mapped[str] = mapped_column(String(36), nullable=False)
    entry_type: Mapped[str] = mapped_column(String(16), nullable=False)
    amount_credits: Mapped[int] = mapped_column(Integer, nullable=False)
    available_delta_credits: Mapped[int] = mapped_column(Integer, nullable=False)
    reserved_delta_credits: Mapped[int] = mapped_column(Integer, nullable=False)
    consumed_delta_credits: Mapped[int] = mapped_column(Integer, nullable=False)
    source_call_trace_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    actor_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    reason: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )


class ProviderModelRate(Base):
    """Upstream financial rates (nanos per million tokens, integers only).

    Optional provider-model configuration; the applicable snapshot and the
    computed cost are stored on every call trace, so a rate change never
    rewrites historical charges. No API surface is required to keep rates.
    """

    __tablename__ = "provider_model_rates"
    __table_args__ = (
        CheckConstraint(
            "input_price_nanos_per_million_tokens >= 0",
            name="ck_provider_model_rates_input_nonneg",
        ),
        CheckConstraint(
            "cache_read_price_nanos_per_million_tokens >= 0",
            name="ck_provider_model_rates_cache_read_nonneg",
        ),
        CheckConstraint(
            "cache_write_price_nanos_per_million_tokens >= 0",
            name="ck_provider_model_rates_cache_write_nonneg",
        ),
        CheckConstraint(
            "output_price_nanos_per_million_tokens >= 0",
            name="ck_provider_model_rates_output_nonneg",
        ),
        Index(
            "ix_provider_model_rates_model_effective",
            "provider_model_id",
            "effective_from",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    provider_model_id: Mapped[str] = mapped_column(
        ForeignKey("provider_models.id", ondelete="CASCADE"), nullable=False
    )
    currency_code: Mapped[str] = mapped_column(String(8), nullable=False, default="USD")
    input_price_nanos_per_million_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cache_read_price_nanos_per_million_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cache_write_price_nanos_per_million_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_price_nanos_per_million_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    effective_from: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    effective_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    pricing_version: Mapped[str] = mapped_column(
        String(PRICING_VERSION_LENGTH), nullable=False, default="1"
    )


# ---------------------------------------------------------------------------
# Daily usage aggregates (rebuildable from call traces and ledgers)
# ---------------------------------------------------------------------------


def _billing_daily_constraints(table: str) -> tuple:
    return (
        CheckConstraint("call_count >= 0", name=f"ck_{table}_call_count_nonneg"),
        CheckConstraint(
            "successful_call_count >= 0", name=f"ck_{table}_successful_call_count_nonneg"
        ),
        CheckConstraint(
            "failed_call_count >= 0", name=f"ck_{table}_failed_call_count_nonneg"
        ),
        CheckConstraint(
            "uncached_input_tokens >= 0", name=f"ck_{table}_uncached_input_nonneg"
        ),
        CheckConstraint("cache_read_tokens >= 0", name=f"ck_{table}_cache_read_nonneg"),
        CheckConstraint("cache_write_tokens >= 0", name=f"ck_{table}_cache_write_nonneg"),
        CheckConstraint("output_tokens >= 0", name=f"ck_{table}_output_nonneg"),
        CheckConstraint("billable_token_units >= 0", name=f"ck_{table}_billable_nonneg"),
        CheckConstraint(
            "user_credits_charged >= 0", name=f"ck_{table}_user_credits_nonneg"
        ),
        CheckConstraint(
            "provider_budget_credits_consumed >= 0",
            name=f"ck_{table}_provider_credits_nonneg",
        ),
        CheckConstraint("provider_cost_nanos >= 0", name=f"ck_{table}_provider_cost_nonneg"),
        CheckConstraint("total_latency_ms >= 0", name=f"ck_{table}_total_latency_nonneg"),
        CheckConstraint("length(usage_date) = 10", name=f"ck_{table}_usage_date_format"),
    )


# Bulked daily aggregate columns (used by the settlement upsert).
BILLING_DAILY_COLUMNS = (
    "call_count",
    "successful_call_count",
    "failed_call_count",
    "uncached_input_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "output_tokens",
    "billable_token_units",
    "user_credits_charged",
    "provider_budget_credits_consumed",
    "provider_cost_nanos",
    "total_latency_ms",
)


class UserUsageDaily(Base):
    """Per-user daily billed usage; one row per (user_id, usage_date)."""

    __tablename__ = "user_usage_daily"
    __table_args__ = _billing_daily_constraints("user_usage_daily")

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    usage_date: Mapped[str] = mapped_column(String(10), primary_key=True)
    call_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    successful_call_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_call_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    uncached_input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cache_read_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cache_write_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    billable_token_units: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    user_credits_charged: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    provider_budget_credits_consumed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    provider_cost_nanos: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_latency_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class APIKeyUsageDaily(Base):
    """Per-API-key daily billed usage; one row per (api_key_id, usage_date)."""

    __tablename__ = "api_key_usage_daily"
    __table_args__ = _billing_daily_constraints("api_key_usage_daily")

    api_key_id: Mapped[str] = mapped_column(
        ForeignKey("api_keys.id", ondelete="CASCADE"), primary_key=True
    )
    usage_date: Mapped[str] = mapped_column(String(10), primary_key=True)
    call_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    successful_call_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_call_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    uncached_input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cache_read_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cache_write_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    billable_token_units: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    user_credits_charged: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    provider_budget_credits_consumed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    provider_cost_nanos: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_latency_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class GatewayModelUsageDaily(Base):
    """Per-gateway-model daily billed usage; one row per (model, date)."""

    __tablename__ = "gateway_model_usage_daily"
    __table_args__ = _billing_daily_constraints("gateway_model_usage_daily")

    gateway_model_id: Mapped[str] = mapped_column(
        ForeignKey("model_groups.id", ondelete="CASCADE"), primary_key=True
    )
    usage_date: Mapped[str] = mapped_column(String(10), primary_key=True)
    call_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    successful_call_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_call_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    uncached_input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cache_read_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cache_write_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    billable_token_units: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    user_credits_charged: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    provider_budget_credits_consumed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    provider_cost_nanos: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_latency_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class ProviderModelUsageDaily(Base):
    """Per-provider-model daily billed usage."""

    __tablename__ = "provider_model_usage_daily"
    __table_args__ = _billing_daily_constraints("provider_model_usage_daily")

    provider_model_id: Mapped[str] = mapped_column(
        ForeignKey("provider_models.id", ondelete="CASCADE"), primary_key=True
    )
    usage_date: Mapped[str] = mapped_column(String(10), primary_key=True)
    call_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    successful_call_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_call_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    uncached_input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cache_read_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cache_write_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    billable_token_units: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    user_credits_charged: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    provider_budget_credits_consumed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    provider_cost_nanos: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_latency_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class ProviderUsageDaily(Base):
    """Per-provider daily billed usage."""

    __tablename__ = "provider_usage_daily"
    __table_args__ = _billing_daily_constraints("provider_usage_daily")

    provider_id: Mapped[str] = mapped_column(
        ForeignKey("providers.id", ondelete="CASCADE"), primary_key=True
    )
    usage_date: Mapped[str] = mapped_column(String(10), primary_key=True)
    call_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    successful_call_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_call_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    uncached_input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cache_read_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cache_write_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    billable_token_units: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    user_credits_charged: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    provider_budget_credits_consumed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    provider_cost_nanos: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_latency_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class SystemUsageDaily(Base):
    """Whole-system daily billed usage; one row per usage_date."""

    __tablename__ = "system_usage_daily"
    __table_args__ = _billing_daily_constraints("system_usage_daily")

    usage_date: Mapped[str] = mapped_column(String(10), primary_key=True)
    call_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    successful_call_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_call_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    uncached_input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cache_read_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cache_write_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    billable_token_units: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    user_credits_charged: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    provider_budget_credits_consumed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    provider_cost_nanos: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_latency_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


# ---------------------------------------------------------------------------
# Provider capacity (separate from financial budget)
# ---------------------------------------------------------------------------


class ProviderCapacityAccount(Base):
    """Per-provider token throughput capacity, managed manually by Super Admin.

    Completely separate from ProviderBudgetAccount (financial accounting).
    All models/model-groups using the same provider share this single pool.

    * total_tokens     — cumulative tokens added by admins (never decremented)
    * consumed_tokens  — tokens used by settled requests
    * reserved_tokens  — tokens held for in-flight requests
    * available_tokens — total - consumed - reserved (maintained transactionally)

    Adding capacity increases total_tokens and available_tokens without
    touching consumed/reserved so existing reservations are never disturbed.
    """

    __tablename__ = "provider_capacity_accounts"
    __table_args__ = (
        CheckConstraint("total_tokens >= 0", name="ck_provider_capacity_total_nonneg"),
        CheckConstraint("consumed_tokens >= 0", name="ck_provider_capacity_consumed_nonneg"),
        CheckConstraint("reserved_tokens >= 0", name="ck_provider_capacity_reserved_nonneg"),
        CheckConstraint("available_tokens >= 0", name="ck_provider_capacity_available_nonneg"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    # No FK: capacity history must survive provider deletion.
    provider_id: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        index=True,
        nullable=False,
    )
    total_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    consumed_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reserved_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    available_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )


class ProviderCapacityLedger(Base):
    """Append-only capacity audit log (no FK; history survives deletion).

    entry_type:
      "add"     — Super Admin adds tokens (increases total + available)
      "reserve" — pre-dispatch hold (decreases available, increases reserved)
      "settle"  — actual usage consumed (decreases reserved, increases consumed)
      "release" — pre-dispatch failure returns hold (increases available)
    """

    __tablename__ = "provider_capacity_ledger"
    __table_args__ = (
        CheckConstraint("amount_tokens >= 0", name="ck_capacity_ledger_amount_nonneg"),
        CheckConstraint(
            "entry_type IN ('add','reserve','settle','release')",
            name="ck_capacity_ledger_entry_type",
        ),
        UniqueConstraint("idempotency_key", name="uq_capacity_ledger_idempotency"),
        Index("ix_capacity_ledger_account_created", "provider_capacity_account_id", "created_at"),
        Index("ix_capacity_ledger_call_trace", "source_call_trace_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    provider_capacity_account_id: Mapped[str] = mapped_column(String(36), nullable=False)
    provider_id: Mapped[str] = mapped_column(String(36), nullable=False)
    entry_type: Mapped[str] = mapped_column(String(16), nullable=False)
    amount_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    total_delta_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    consumed_delta_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reserved_delta_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    available_delta_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    source_call_trace_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    actor_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    reason: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
