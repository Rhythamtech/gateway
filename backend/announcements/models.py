from datetime import datetime
from uuid import uuid4
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from backend.core.database import Base
from backend.credits.models import utcnow


class Announcement(Base):
    __tablename__ = "announcements"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    title: Mapped[str] = mapped_column(String(200))
    message: Mapped[str] = mapped_column(Text)
    placement: Mapped[str] = mapped_column(String(20))
    audience: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(20), default="draft")
    priority: Mapped[int] = mapped_column(Integer, default=0)
    dismissible: Mapped[bool] = mapped_column(Boolean, default=True)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    coupon_id: Mapped[str | None] = mapped_column(ForeignKey("coupons.id"), nullable=True)
    action_label: Mapped[str | None] = mapped_column(String(80), nullable=True)
    action_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AnnouncementDismissal(Base):
    __tablename__ = "announcement_dismissals"
    __table_args__ = (UniqueConstraint("user_id", "announcement_id", "version"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    announcement_id: Mapped[str] = mapped_column(ForeignKey("announcements.id", ondelete="CASCADE"))
    version: Mapped[int] = mapped_column(Integer)
