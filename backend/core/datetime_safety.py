"""UTC datetime contract shared by response DTOs.

Storage writes every timestamp as UTC (``datetime.now(timezone.utc)``), but
SQLite round-trips drop ``tzinfo`` and return naive datetimes. Naive values on
the storage read path are therefore UTC wall time and get their zone re-attached
here; values that already carry a zone are *converted* to UTC rather than
assumed, so a non-UTC input can never leak into a response.

Pydantic 2.12+ serializes timezone-aware UTC datetimes with a trailing ``Z``
(e.g. ``2026-11-04T02:23:00Z``), which is the API contract: timestamps are
always instants in UTC and never formatted in a user's local timezone —
display-side conversion happens in the frontend (``src/lib/datetime.ts``).
"""

from datetime import datetime, timezone
from typing import Annotated

from pydantic import BeforeValidator


def to_utc(value: datetime) -> datetime:
    """Coerce a storage round-trip datetime to timezone-aware UTC."""

    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


UTCDateTime = Annotated[datetime, BeforeValidator(to_utc)]
