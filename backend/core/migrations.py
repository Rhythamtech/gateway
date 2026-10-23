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


_ACCOUNTING_COLUMNS = {
    "uncached_input_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "billable_token_units",
    "token_usage_source",
    "user_credits_charged",
    "credit_multiplier_ppm",
    "provider_budget_credits_consumed",
    "provider_cost_nanos",
    "currency_code",
    "provider_usage_json",
    "provider_rate_snapshot_json",
}


def _sqlite_create_sql(connection: Connection, table: str) -> str:
    row = connection.execute(
        text("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = :name"),
        {"name": table},
    ).first()
    return row[0] if row and row[0] else ""


def _migration_0003_llm_call_traces_accounting(connection: Connection) -> None:
    """Extends ``llm_call_traces`` with normalized usage/charge columns.

    Created databases get the full schema from metadata. Existing databases
    carry the old status CHECK, which SQLite cannot alter in place, so the
    table is rebuilt (create-copy-drop-rename) and its indexes recreated.
    Historical rows keep their token columns; the new charge columns default
    to zero/no-source, marking them as pre-accounting attempts.
    """

    columns = _sqlite_columns(connection, "llm_call_traces")
    if not columns:
        return  # no table yet: metadata handles the fresh schema

    create_sql = _sqlite_create_sql(connection, "llm_call_traces")
    up_to_date = _ACCOUNTING_COLUMNS <= columns and "'pending'" in create_sql
    if up_to_date:
        return

    connection.execute(
        text(
            """
            CREATE TABLE llm_call_traces__accounting (
                id VARCHAR(36) NOT NULL,
                message_trace_id VARCHAR(36) NOT NULL,
                user_id VARCHAR(36) NOT NULL,
                api_key_id VARCHAR(36),
                gateway_model_id VARCHAR(36),
                provider_model_id VARCHAR(36),
                input_tokens INTEGER,
                output_tokens INTEGER,
                cache_tokens INTEGER,
                uncached_input_tokens INTEGER,
                cache_read_tokens INTEGER,
                cache_write_tokens INTEGER,
                billable_token_units INTEGER,
                token_usage_source VARCHAR(16),
                user_credits_charged INTEGER NOT NULL DEFAULT 0,
                credit_multiplier_ppm INTEGER,
                provider_budget_credits_consumed INTEGER NOT NULL DEFAULT 0,
                provider_cost_nanos INTEGER NOT NULL DEFAULT 0,
                currency_code VARCHAR(8),
                provider_usage_json TEXT,
                provider_rate_snapshot_json TEXT,
                latency_ms INTEGER,
                status VARCHAR(16) NOT NULL,
                error_code VARCHAR(64),
                created_at TIMESTAMP NOT NULL,
                finished_at TIMESTAMP,
                PRIMARY KEY (id),
                FOREIGN KEY(message_trace_id) REFERENCES llm_message_traces (id) ON DELETE CASCADE,
                FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
                FOREIGN KEY(api_key_id) REFERENCES api_keys (id) ON DELETE CASCADE,
                FOREIGN KEY(gateway_model_id) REFERENCES model_groups (id) ON DELETE CASCADE,
                FOREIGN KEY(provider_model_id) REFERENCES provider_models (id) ON DELETE CASCADE,
                CHECK (input_tokens IS NULL OR input_tokens >= 0),
                CHECK (output_tokens IS NULL OR output_tokens >= 0),
                CHECK (cache_tokens IS NULL OR cache_tokens >= 0),
                CHECK (uncached_input_tokens IS NULL OR uncached_input_tokens >= 0),
                CHECK (cache_read_tokens IS NULL OR cache_read_tokens >= 0),
                CHECK (cache_write_tokens IS NULL OR cache_write_tokens >= 0),
                CHECK (billable_token_units IS NULL OR billable_token_units >= 0),
                CHECK (user_credits_charged >= 0),
                CHECK (provider_budget_credits_consumed >= 0),
                CHECK (provider_cost_nanos >= 0),
                CHECK (latency_ms IS NULL OR latency_ms >= 0),
                CHECK (status IN ('pending','success','failed','timeout')),
                CHECK (token_usage_source IS NULL OR token_usage_source IN ('reported','estimated','unavailable'))
            )
            """
        )
    )

    # Copy every column that exists in both schemas; absent future columns
    # take their CREATE defaults (zero charges / NULL usage).
    shared = ", ".join(sorted(columns & _rebuild_columns()))
    connection.execute(
        text(
            f"INSERT INTO llm_call_traces__accounting ({shared}) "
            f"SELECT {shared} FROM llm_call_traces"
        )
    )

    connection.execute(text("DROP TABLE llm_call_traces"))
    connection.execute(
        text("ALTER TABLE llm_call_traces__accounting RENAME TO llm_call_traces")
    )

    for index_sql in (
        ("CREATE INDEX IF NOT EXISTS ix_llm_call_traces_message_trace_id "
         "ON llm_call_traces (message_trace_id)"),
        ("CREATE INDEX IF NOT EXISTS ix_llm_call_traces_user_created "
         "ON llm_call_traces (user_id, created_at)"),
        ("CREATE INDEX IF NOT EXISTS ix_llm_call_traces_api_key_created "
         "ON llm_call_traces (api_key_id, created_at)"),
        ("CREATE INDEX IF NOT EXISTS ix_llm_call_traces_gateway_model_created "
         "ON llm_call_traces (gateway_model_id, created_at)"),
        ("CREATE INDEX IF NOT EXISTS ix_llm_call_traces_provider_model_created "
         "ON llm_call_traces (provider_model_id, created_at)"),
    ):
        connection.execute(text(index_sql))


def _rebuild_columns() -> set[str]:
    """Full column set of the rebuilt ``llm_call_traces`` table."""

    return {
        "id",
        "message_trace_id",
        "user_id",
        "api_key_id",
        "gateway_model_id",
        "provider_model_id",
        "input_tokens",
        "output_tokens",
        "cache_tokens",
        *_ACCOUNTING_COLUMNS,
        "latency_ms",
        "status",
        "error_code",
        "created_at",
        "finished_at",
    }


def _migration_0004_model_groups_pricing(connection: Connection) -> None:
    """Adds the user-credit multiplier and pricing version to model groups.

    ALTER TABLE cannot attach CHECK constraints in SQLite; fresh databases
    get them from metadata, existing ones are guarded by the service layer.
    """

    columns = _sqlite_columns(connection, "model_groups")
    if not columns:
        return  # no table yet: metadata handles the fresh schema

    if "credit_multiplier_ppm" not in columns:
        # 1x defaults keep pre-existing groups billing at base rate.
        connection.execute(
            text(
                "ALTER TABLE model_groups ADD COLUMN credit_multiplier_ppm "
                "INTEGER NOT NULL DEFAULT 1000000"
            )
        )

    if "pricing_version" not in columns:
        connection.execute(
            text(
                "ALTER TABLE model_groups ADD COLUMN pricing_version "
                "VARCHAR(32) NOT NULL DEFAULT '1'"
            )
        )


def _migration_0005_wallet_budget_schema(connection: Connection) -> None:
    """Creates wallet, budget, reservation, rate and daily billing tables."""

    from backend.core.database import Base
    from backend.wallet import models as _wallet_models  # noqa: F401 (registers)

    wallet_table_names = (
        "user_wallets",
        "wallet_ledger_entries",
        "wallet_reservations",
        "system_budget_accounts",
        "system_budget_ledger",
        "provider_budget_accounts",
        "provider_budget_ledger",
        "provider_model_rates",
        "user_usage_daily",
        "api_key_usage_daily",
        "gateway_model_usage_daily",
        "provider_model_usage_daily",
        "provider_usage_daily",
        "system_usage_daily",
    )
    tables = [Base.metadata.tables[name] for name in wallet_table_names]
    # Idempotent: existing tables are skipped, fresh ones created here.
    Base.metadata.create_all(bind=connection, tables=tables)


MIGRATIONS: list[tuple[str, Callable[[Connection], None]]] = [
    ("0001_users_tracing_enabled", _migration_0001_users_tracing_enabled),
    ("0002_users_telemetry_enabled", _migration_0002_users_telemetry_enabled),
    (
        "0003_llm_call_traces_accounting",
        _migration_0003_llm_call_traces_accounting,
    ),
    ("0004_model_groups_pricing", _migration_0004_model_groups_pricing),
    ("0005_wallet_budget_schema", _migration_0005_wallet_budget_schema),
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
