from datetime import datetime, timezone
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.core.database import Base

if TYPE_CHECKING:
    from backend.gateway.providers.models import Provider


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ProviderModel(Base):
    __tablename__ = "provider_models"
    __table_args__ = (
        UniqueConstraint(
            "provider_id",
            "model_name",
            name="uq_provider_models_provider_model",
        ),
        CheckConstraint("length(trim(model_name)) > 0", name="ck_provider_models_name_not_empty"),
        CheckConstraint("length(trim(model_id)) > 0", name="ck_provider_models_id_not_empty"),
    )

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid4()),
    )

    provider_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("providers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Exact upstream identifier. Never rewritten.
    model_name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Public identifier: ``{provider.aliases}/{model_name}``.
    model_id: Mapped[str] = mapped_column(
        String(320),
        unique=True,
        index=True,
        nullable=False,
    )

    is_available: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
    )

    last_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_utcnow,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_utcnow,
        onupdate=_utcnow,
    )

    provider: Mapped["Provider"] = relationship(back_populates="models")
