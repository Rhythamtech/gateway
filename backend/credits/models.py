from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from backend.auth.models import User
from backend.core.database import Base
from backend.gateway.provider_models.models import ProviderModel
from backend.gateway.providers.models import Provider


def utcnow() -> datetime:
    return datetime.now(UTC)


def new_id() -> str:
    return str(uuid4())


class UserCredits(Base):
    __tablename__ = "credit_users"
    __table_args__ = (
        CheckConstraint("remaining >= 0 AND reserved >= 0 AND reserved <= remaining"),
    )

    user_id: Mapped[str] = mapped_column(
        ForeignKey(User.id, ondelete="RESTRICT"), primary_key=True
    )
    remaining: Mapped[int] = mapped_column(BigInteger, default=0)
    reserved: Mapped[int] = mapped_column(BigInteger, default=0)


class ProviderCredits(Base):
    __tablename__ = "credit_providers"
    __table_args__ = (
        CheckConstraint("remaining >= 0 AND reserved >= 0 AND reserved <= remaining"),
    )

    provider_id: Mapped[str] = mapped_column(
        ForeignKey(Provider.id, ondelete="RESTRICT"), primary_key=True
    )
    remaining: Mapped[int] = mapped_column(BigInteger, default=0)
    reserved: Mapped[int] = mapped_column(BigInteger, default=0)


class ModelCreditRate(Base):
    __tablename__ = "credit_model_rates"
    __table_args__ = (
        UniqueConstraint("provider_model_id", "version"),
        CheckConstraint("tokens_per_credit_micros > 0"),
        CheckConstraint("max_request_tokens > 0"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    provider_model_id: Mapped[str] = mapped_column(
        ForeignKey(ProviderModel.id, ondelete="RESTRICT"), index=True
    )
    version: Mapped[int]
    tokens_per_credit_micros: Mapped[int] = mapped_column(BigInteger)
    max_request_tokens: Mapped[int | None]
    actor_id: Mapped[str] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )


class CreditUsage(Base):
    __tablename__ = "credit_usage"
    __table_args__ = (
        CheckConstraint(
            "status IN ('reserved','dispatched','usage_recorded','needs_review','settled','released')"
        ),
        CheckConstraint("reserved >= 0 AND charged >= 0 AND charged <= reserved"),
        CheckConstraint("input_tokens IS NULL OR input_tokens >= 0"),
        CheckConstraint("output_tokens IS NULL OR output_tokens >= 0"),
        Index("ix_credit_usage_status_updated", "status", "updated_at"),
        Index("ix_credit_usage_user_created", "user_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    request_id: Mapped[str] = mapped_column(String(36), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey(User.id, ondelete="RESTRICT"))
    provider_id: Mapped[str] = mapped_column(
        ForeignKey(Provider.id, ondelete="RESTRICT")
    )
    provider_model_id: Mapped[str] = mapped_column(
        ForeignKey(ProviderModel.id, ondelete="RESTRICT")
    )
    api_key_id: Mapped[str] = mapped_column(String(36))
    rate_id: Mapped[str] = mapped_column(
        ForeignKey("credit_model_rates.id", ondelete="RESTRICT")
    )
    tokens_per_credit_micros: Mapped[int] = mapped_column(BigInteger)
    max_request_tokens: Mapped[int]
    reserved: Mapped[int] = mapped_column(BigInteger)
    charged: Mapped[int] = mapped_column(BigInteger, default=0)
    input_tokens: Mapped[int | None]
    output_tokens: Mapped[int | None]
    provider_request_id: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(20), default="reserved")
    reason: Mapped[str | None] = mapped_column(String(1000))
    resolved_by: Mapped[str | None] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class CreditEntry(Base):
    __tablename__ = "credit_entries"
    __table_args__ = (
        UniqueConstraint("owner_type", "owner_id", "idempotency_key"),
        UniqueConstraint("owner_type", "usage_id"),
        CheckConstraint("owner_type IN ('user','provider')"),
        Index(
            "ix_credit_entries_owner_created", "owner_type", "owner_id", "created_at"
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_type: Mapped[str] = mapped_column(String(10))
    owner_id: Mapped[str] = mapped_column(String(36))
    amount: Mapped[int] = mapped_column(BigInteger)
    remaining_after: Mapped[int] = mapped_column(BigInteger)
    idempotency_key: Mapped[str | None] = mapped_column(String(128))
    usage_id: Mapped[str | None] = mapped_column(
        ForeignKey("credit_usage.id", ondelete="RESTRICT")
    )
    actor_id: Mapped[str | None] = mapped_column(String(36))
    reason: Mapped[str] = mapped_column(String(1000))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )
