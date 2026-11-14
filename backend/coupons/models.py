"""Durable coupon definitions, grants and administrative history."""
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from backend.core.database import Base
from backend.credits.models import new_id, utcnow


class Coupon(Base):
    __tablename__ = "coupons"
    __table_args__ = (
        CheckConstraint("amount > 0 AND amount <= 9000000000000000000"),
        CheckConstraint("per_user_limit >= 1"),
        CheckConstraint("max_redemptions IS NULL OR max_redemptions >= 1"),
        CheckConstraint("starts_at IS NULL OR expires_at IS NULL OR expires_at > starts_at"),
        CheckConstraint("code = UPPER(TRIM(code)) AND length(code) BETWEEN 3 AND 64"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    code: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(150))
    amount: Mapped[int] = mapped_column(BigInteger)
    enabled: Mapped[bool] = mapped_column(default=True)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    max_redemptions: Mapped[int | None]
    per_user_limit: Mapped[int] = mapped_column(default=1)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class CouponRedemption(Base):
    __tablename__ = "coupon_redemptions"
    __table_args__ = (
        UniqueConstraint("user_id", "idempotency_key"),
        CheckConstraint("amount > 0"),
        Index("ix_coupon_redemptions_coupon_user", "coupon_id", "user_id"),
        Index("ix_coupon_redemptions_user_created", "user_id", "created_at"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    coupon_id: Mapped[str] = mapped_column(ForeignKey("coupons.id", ondelete="RESTRICT"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    amount: Mapped[int] = mapped_column(BigInteger)
    idempotency_key: Mapped[str] = mapped_column(String(128))
    credit_entry_id: Mapped[str] = mapped_column(ForeignKey("credit_entries.id", ondelete="RESTRICT"), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CouponAudit(Base):
    __tablename__ = "coupon_audit"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    coupon_id: Mapped[str] = mapped_column(ForeignKey("coupons.id", ondelete="RESTRICT"), index=True)
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    action: Mapped[str] = mapped_column(String(20))
    old_values: Mapped[dict | None] = mapped_column(JSON)
    new_values: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
