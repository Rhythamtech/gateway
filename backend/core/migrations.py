"""Idempotent, versioned schema migrations for existing databases.

``Base.metadata.create_all()`` creates tables that do not exist yet, but it
cannot evolve tables that already exist (missing columns, index backfills).
Instead of ad hoc ``ALTER TABLE`` calls at startup, narrowly scoped migrations
live here, run in order exactly once per database, and record their version in
the ``schema_migrations`` tracking table.

Rules for migrations:

* each entry is a ``(version, callable)`` pair appended to ``MIGRATIONS``;
  applied versions are never edited — schema changes get a new entry,
* a migration may run on a database that already contains (part of) the
  change, so every migration body stays idempotent,
* migration bodies receive a live ``Connection`` inside an explicit
  transaction together with their version bookkeeping.
"""

import logging
from collections.abc import Callable

from sqlalchemy import Connection, Engine, text

logger = logging.getLogger(__name__)

_TRACKING_TABLE = "schema_migrations"


def _sqlite_columns(connection: Connection, table: str) -> set[str]:
    return {row[1] for row in connection.execute(text(f"PRAGMA table_info({table})"))}


def _migration_0001_users_tracing_enabled(connection: Connection) -> None:
    """Backfill ``users.tracing_enabled`` on databases created before it."""

    if "tracing_enabled" not in _sqlite_columns(connection, "users"):
        connection.execute(
            text("ALTER TABLE users ADD COLUMN tracing_enabled BOOLEAN NOT NULL DEFAULT 0")
        )


def _migration_0002_users_telemetry_enabled(connection: Connection) -> None:
    """Backfill ``users.telemetry_enabled`` on databases created before it."""

    if "telemetry_enabled" not in _sqlite_columns(connection, "users"):
        connection.execute(
            text("ALTER TABLE users ADD COLUMN telemetry_enabled BOOLEAN NOT NULL DEFAULT 0")
        )


MIGRATIONS: list[tuple[str, Callable[[Connection], None]]] = [
    ("0001_users_tracing_enabled", _migration_0001_users_tracing_enabled),
    ("0002_users_telemetry_enabled", _migration_0002_users_telemetry_enabled),
]


def run_pending_migrations(engine: Engine) -> list[str]:
    """Apply all not-yet-applied migrations and return the versions applied.

    Returns an empty list when the database is already up to date. Only
    SQLite engines are supported (the gateway's storage engine); other
    backends are skipped with a warning rather than failing startup.
    """

    if not engine.url.get_backend_name().startswith("sqlite"):
        logger.warning("Schema migrations are SQLite-only; skipped for %s", engine.url)
        return []

    applied_now: list[str] = []

    with engine.connect() as connection:
        with connection.begin():
            connection.execute(
                text(
                    f"CREATE TABLE IF NOT EXISTS {_TRACKING_TABLE} ("
                    "version VARCHAR(64) PRIMARY KEY, "
                    "applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)"
                )
            )
            applied = {
                row[0]
                for row in connection.execute(
                    text(f"SELECT version FROM {_TRACKING_TABLE}")
                )
            }

        for version, migrate in MIGRATIONS:
            if version in applied:
                continue

            logger.info("Applying schema migration %s", version)
            with connection.begin():
                migrate(connection)
                connection.execute(
                    text(f"INSERT INTO {_TRACKING_TABLE} (version) VALUES (:version)"),
                    {"version": version},
                )

            applied_now.append(version)

    return applied_now
