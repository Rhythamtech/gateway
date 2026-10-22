import enum
from datetime import datetime, timezone
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.core.database import Base

if TYPE_CHECKING:
    from backend.gateway.provider_models.models import ProviderModel


class ProviderProtocol(str, enum.Enum):
    OPENAI = "openai"
    ANTHROPIC = "anthropic"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Provider(Base):
    __tablename__ = "providers"
    __table_args__ = (
        CheckConstraint("length(trim(name)) > 0", name="ck_providers_name_not_empty"),
        CheckConstraint("length(trim(aliases)) > 0", name="ck_providers_alias_not_empty"),
        CheckConstraint("aliases NOT LIKE '%/%'", name="ck_providers_alias_no_slash"),
        CheckConstraint("length(trim(base_url)) > 0", name="ck_providers_base_url_not_empty"),
    )

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid4()),
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Public prefix used when constructing model IDs: ``{aliases}/{model_name}``.
    aliases: Mapped[str] = mapped_column(
        String(64),
        unique=True,
        index=True,
        nullable=False,
    )

    base_url: Mapped[str] = mapped_column(Text, nullable=False)

    # Ciphertext. Never exposed through API responses or logs.
    api_key: Mapped[str] = mapped_column(Text, nullable=False, default="")

    # Encrypted canonical JSON object of custom headers, or NULL.
    custom_header: Mapped[str | None] = mapped_column(Text, nullable=True)

    protocol: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=ProviderProtocol.OPENAI.value,
    )

    is_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
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

    models: Mapped[list["ProviderModel"]] = relationship(
        back_populates="provider",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class ProviderAuditLog(Base):
    """Audit trail for administrative provider actions.

    ``provider_id`` intentionally has no foreign key so the audit record
    survives provider deletion.
    """

    __tablename__ = "provider_audit_logs"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid4()),
    )

    provider_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)

    actor_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)

    action: Mapped[str] = mapped_column(String(32), nullable=False)

    details: Mapped[str] = mapped_column(Text, nullable=False, default="{}")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_utcnow,
    )
