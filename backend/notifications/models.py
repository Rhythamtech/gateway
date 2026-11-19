from datetime import datetime
from uuid import uuid4
from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from backend.core.database import Base
from backend.credits.models import utcnow


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (UniqueConstraint("user_id", "event_key"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    event_key: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(40))
    title: Mapped[str] = mapped_column(String(200))
    message: Mapped[str] = mapped_column(Text)
    action_url: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class NotificationPreference(Base):
    __tablename__ = "notification_preferences"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    low_credit_threshold: Mapped[int] = mapped_column(default=10_000_000)
    low_credit_enabled: Mapped[bool] = mapped_column(default=True)
    key_expiry_enabled: Mapped[bool] = mapped_column(default=True)
    credit_state: Mapped[str] = mapped_column(String(20), default="healthy")
    credit_episode: Mapped[int] = mapped_column(default=0)
