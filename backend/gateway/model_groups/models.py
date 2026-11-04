from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.core.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ModelGroup(Base):
    __tablename__ = "model_groups"
    __table_args__ = (
        CheckConstraint("length(trim(name)) > 0", name="ck_model_groups_name_not_empty"),
        CheckConstraint("length(trim(model_id)) > 0", name="ck_model_groups_id_not_empty"),
        UniqueConstraint("model_id", name="uq_model_groups_model_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    model_id: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    routing_strategy: Mapped[str] = mapped_column(String(32), nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)
    members: Mapped[list["ModelGroupMember"]] = relationship(
        back_populates="group",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="ModelGroupMember.priority",
    )


class ModelGroupMember(Base):
    __tablename__ = "model_group_members"
    __table_args__ = (
        UniqueConstraint("model_group_id", "provider_model_id", name="uq_model_group_member_model"),
        CheckConstraint("weight > 0", name="ck_model_group_member_weight_positive"),
        CheckConstraint("priority > 0", name="ck_model_group_member_priority_positive"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    model_group_id: Mapped[str] = mapped_column(ForeignKey("model_groups.id", ondelete="CASCADE"), nullable=False, index=True)
    provider_model_id: Mapped[str] = mapped_column(ForeignKey("provider_models.id", ondelete="CASCADE"), nullable=False, index=True)
    weight: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    group: Mapped[ModelGroup] = relationship(back_populates="members")
