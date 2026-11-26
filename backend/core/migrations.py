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
* destructive schema changes that must disarm foreign key enforcement list
  their version in ``_FOREIGN_KEYS_OFF_MIGRATIONS``; ``run_pending_migrations``
  then runs them on a dedicated checkout with FKs off at checkout time
  (``PRAGMA foreign_keys`` is a no-op inside a transaction, so the state is
  applied by a checkout listener, not in the migration body).
"""

import logging
from collections.abc import Callable

from sqlalchemy import Connection, Engine, event, text

logger = logging.getLogger(__name__)

_TRACKING_TABLE = "schema_migrations"

# Versions run with foreign key enforcement disabled. Rebuild-based teardowns
# (for example the wallet removal in 0012) require this: with FKs armed, a
# DROP TABLE fires ON DELETE actions on referencing rows (SQLite simulates
# dropping with an implicit DELETE), which would silently cascade-delete live
# child rows such as model group members.
_FOREIGN_KEYS_OFF_MIGRATIONS: set[str] = {
    "0012_remove_wallet_credit_schema",
    "0016_optional_model_token_ceiling",
}

_foreign_keys_guard = {"off": False}


def _foreign_keys_state_on_checkout(
    dbapi_connection, connection_record, connection_proxy
) -> None:
    """Checkout-time SQLite FK state for guarded migrations.

    ``PRAGMA foreign_keys`` is a no-op inside a transaction, so the state is
    applied when a connection is checked out: the connect-time handler in
    ``backend/core/database.py`` enables FKs on fresh connections, and this
    listener re-asserts the state for every checkout, which also restores
    enforcement for pooled connections opened during the FK-off window.
    """

    dbapi_connection.execute(
        "PRAGMA foreign_keys=OFF" if _foreign_keys_guard["off"] else "PRAGMA foreign_keys=ON"
    )


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
    """No-op: the wallet/budget schema was removed by migration 0012.

    The version stays recorded so applied databases keep a complete history
    and ordering of later versions is preserved. Fresh databases jump
    straight to the 0012 teardown.
    """
    return


def _migration_0006_provider_capacity(connection: Connection) -> None:
    """No-op: provider token capacity tables were removed by migration 0012."""
    return


def _migration_0007_token_credit_billing(connection: Connection) -> None:
    """No-op: token-to-credit billing was removed by migration 0012."""
    return


def _migration_0008_drop_legacy_reservations(connection: Connection) -> None:
    """Final idempotent cleanup for databases that recreated the old table."""
    connection.execute(text("DROP TABLE IF EXISTS wallet_reservations"))


def _migration_0009_remove_credit_pools(connection: Connection) -> None:
    """Retire system/provider credit pools; user wallets are the sole billing ledger."""
    for table in (
        "provider_budget_ledger",
        "provider_budget_accounts",
        "system_budget_ledger",
        "system_budget_accounts",
    ):
        connection.execute(text(f"DROP TABLE IF EXISTS {table}"))


def _migration_0010_retry_estimate_policy(connection: Connection) -> None:
    columns = _sqlite_columns(connection, "usage_billing_retries")
    if columns and "estimate_allowed" not in columns:
        connection.execute(text(
            "ALTER TABLE usage_billing_retries ADD COLUMN estimate_allowed BOOLEAN NOT NULL DEFAULT 1"
        ))


def _migration_0011_soft_capacity_accounting(connection: Connection) -> None:
    """No-op: provider soft-capacity accounting was removed by migration 0012."""
    return


_WALLET_SCHEMA_TABLES = (
    # Wallets, ledgers and reservations
    "user_wallets",
    "wallet_ledger_entries",
    "wallet_credit_ledger",
    "wallet_reservations",
    # Budget pools
    "system_budget_accounts",
    "system_budget_ledger",
    "provider_budget_accounts",
    "provider_budget_ledger",
    # Per-model rates
    "provider_model_rates",
    "provider_model_credit_rates",
    # Provider capacity
    "provider_capacity_accounts",
    "provider_capacity_ledger",
    # Billing retry queue
    "usage_billing_retries",
    # Wallet-side daily billing aggregates (operational analytics live in the
    # ``llm_*_usage_daily`` tables, which are NOT dropped here).
    "user_usage_daily",
    "api_key_usage_daily",
    "gateway_model_usage_daily",
    "provider_model_usage_daily",
    "provider_usage_daily",
    "system_usage_daily",
)


def _migration_0012_remove_wallet_credit_schema(connection: Connection) -> None:
    """Drops the wallet/credit/billing/capacity schema and rebuilds the two
    tables whose shape was entangled with billing.

    * every wallet, ledger, reservation, budget, capacity, rate and
      billing-daily table is dropped (``IF EXISTS``; fresh databases have
      none),
    * ``model_groups`` is rebuilt without ``credit_multiplier_ppm`` /
      ``pricing_version``,
    * ``llm_call_traces`` is rebuilt without its twelve billing columns,
      keeping the operational analytics columns (tokens, latency, status).

    Table rebuilds are required because SQLite cannot drop columns referenced
    by CHECK constraints. With foreign keys armed, ``DROP TABLE`` fires ``ON
    DELETE`` actions on referencing rows — e.g. ``model_group_members`` would
    be cascade-deleted — so this migration runs with foreign keys OFF (see
    ``run_pending_migrations``) and every FK set is validated via
    ``PRAGMA foreign_key_check`` before commit.
    """

    for table in _WALLET_SCHEMA_TABLES:
        connection.execute(text(f"DROP TABLE IF EXISTS {table}"))

    group_columns = _sqlite_columns(connection, "model_groups")
    if group_columns & {"credit_multiplier_ppm", "pricing_version"}:
        connection.execute(
            text(
                """
                CREATE TABLE model_groups__remove_billing (
                    id VARCHAR(36) NOT NULL,
                    name VARCHAR(255) NOT NULL,
                    model_id VARCHAR(320) NOT NULL,
                    routing_strategy VARCHAR(32) NOT NULL,
                    is_enabled BOOLEAN NOT NULL,
                    created_by VARCHAR(36) NOT NULL,
                    created_at TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP NOT NULL,
                    PRIMARY KEY (id),
                    FOREIGN KEY(created_by) REFERENCES users (id) ON DELETE CASCADE,
                    UNIQUE (model_id),
                    CHECK (length(trim(name)) > 0),
                    CHECK (length(trim(model_id)) > 0)
                )
                """
            )
        )
        connection.execute(
            text(
                """
                INSERT INTO model_groups__remove_billing
                    (id, name, model_id, routing_strategy, is_enabled,
                     created_by, created_at, updated_at)
                SELECT id, name, model_id, routing_strategy, is_enabled,
                       created_by, created_at, updated_at
                FROM model_groups
                """
            )
        )
        connection.execute(text("DROP TABLE model_groups"))
        connection.execute(
            text("ALTER TABLE model_groups__remove_billing RENAME TO model_groups")
        )
        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_model_groups_model_id "
                "ON model_groups (model_id)"
            )
        )

    removed_trace_columns = {
        "billable_token_units",
        "token_usage_source",
        "user_credits_charged",
        "credit_multiplier_ppm",
        "tokens_per_credit",
        "credits_charged",
        "billing_status",
        "provider_budget_credits_consumed",
        "provider_cost_nanos",
        "currency_code",
        "provider_usage_json",
        "provider_rate_snapshot_json",
    }
    trace_columns = _sqlite_columns(connection, "llm_call_traces")
    if trace_columns & removed_trace_columns:
        connection.execute(
            text(
                """
                CREATE TABLE llm_call_traces__remove_billing (
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
                    CHECK (latency_ms IS NULL OR latency_ms >= 0),
                    CHECK (status IN ('pending','success','failed','timeout'))
                )
                """
            )
        )

        # Explicit column list keeps the copy to the operational analytics
        # schema; billing columns vanish, and pre-rebuild layouts that lack a
        # component column simply skip it.
        trace_copy_columns = (
            "id", "message_trace_id", "user_id", "api_key_id",
            "gateway_model_id", "provider_model_id",
            "input_tokens", "output_tokens", "cache_tokens",
            "uncached_input_tokens", "cache_read_tokens", "cache_write_tokens",
            "latency_ms", "status", "error_code", "created_at", "finished_at",
        )
        shared = ", ".join(c for c in trace_copy_columns if c in trace_columns)
        connection.execute(
            text(
                f"INSERT INTO llm_call_traces__remove_billing ({shared}) "
                f"SELECT {shared} FROM llm_call_traces"
            )
        )
        connection.execute(text("DROP TABLE llm_call_traces"))
        connection.execute(
            text("ALTER TABLE llm_call_traces__remove_billing RENAME TO llm_call_traces")
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

    violations = connection.execute(text("PRAGMA foreign_key_check")).fetchall()
    if violations:
        raise RuntimeError(
            "Migration 0012 detected foreign key violations after teardown: "
            f"{[tuple(row) for row in violations[:10]]}"
        )


def _migration_0013_usage_credits(connection: Connection) -> None:
    from backend.credits.models import (
        CreditEntry,
        CreditUsage,
        ModelCreditRate,
        ProviderCredits,
        UserCredits,
    )

    for model in (
        UserCredits,
        ProviderCredits,
        ModelCreditRate,
        CreditUsage,
        CreditEntry,
    ):
        model.__table__.create(connection, checkfirst=True)


def _migration_0014_credit_micros_rename(connection: Connection) -> None:
    """Rename the intermediate `tokens_per_credit` columns to the micros naming.

    Databases migrated by an intermediate usage-credits build created
    ``credit_model_rates`` / ``credit_usage`` with a ``tokens_per_credit``
    column, which the models never read. SQLite updates column references
    inside CHECK constraints and indexes together with a rename.
    """

    for table in ("credit_model_rates", "credit_usage"):
        columns = _sqlite_columns(connection, table)
        if "tokens_per_credit" in columns and "tokens_per_credit_micros" not in columns:
            connection.execute(
                text(
                    f"ALTER TABLE {table} RENAME COLUMN tokens_per_credit "
                    "TO tokens_per_credit_micros"
                )
            )


def _migration_0015_remove_max_output_tokens(connection: Connection) -> None:
    """Remove max_output_tokens from credit_model_rates and credit_usage."""

    rate_columns = _sqlite_columns(connection, "credit_model_rates")
    if "max_output_tokens" in rate_columns:
        connection.execute(text("PRAGMA foreign_keys = OFF"))
        connection.execute(
            text(
                """
                CREATE TABLE credit_model_rates__v15 (
                    id VARCHAR(36) PRIMARY KEY,
                    provider_model_id VARCHAR(36) NOT NULL,
                    version INTEGER NOT NULL,
                    tokens_per_credit_micros BIGINT NOT NULL CHECK (tokens_per_credit_micros > 0),
                    max_request_tokens INTEGER NOT NULL CHECK (max_request_tokens > 0),
                    actor_id VARCHAR(36) NOT NULL,
                    created_at TIMESTAMP NOT NULL,
                    UNIQUE (provider_model_id, version),
                    FOREIGN KEY(provider_model_id) REFERENCES provider_models (id) ON DELETE RESTRICT
                )
                """
            )
        )
        col_list = (
            "tokens_per_credit_micros"
            if "tokens_per_credit_micros" in rate_columns
            else "tokens_per_credit"
        )
        connection.execute(
            text(
                f"""
                INSERT INTO credit_model_rates__v15 (
                    id, provider_model_id, version, tokens_per_credit_micros,
                    max_request_tokens, actor_id, created_at
                )
                SELECT id, provider_model_id, version, {col_list},
                       max_request_tokens, actor_id, created_at
                FROM credit_model_rates
                """
            )
        )
        connection.execute(text("DROP TABLE credit_model_rates"))
        connection.execute(
            text("ALTER TABLE credit_model_rates__v15 RENAME TO credit_model_rates")
        )
        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_credit_model_rates_provider_model_id "
                "ON credit_model_rates (provider_model_id)"
            )
        )
        connection.execute(text("PRAGMA foreign_keys = ON"))

    usage_columns = _sqlite_columns(connection, "credit_usage")
    if "max_output_tokens" in usage_columns:
        connection.execute(text("ALTER TABLE credit_usage DROP COLUMN max_output_tokens"))


def _migration_0016_optional_model_token_ceiling(connection: Connection) -> None:
    columns = connection.execute(text("PRAGMA table_info(credit_model_rates)")).all()
    if not any(row[1] == "max_request_tokens" and row[3] for row in columns):
        return

    connection.execute(text("""
        CREATE TABLE credit_model_rates__v16 (
            id VARCHAR(36) NOT NULL PRIMARY KEY,
            provider_model_id VARCHAR(36) NOT NULL,
            version INTEGER NOT NULL,
            tokens_per_credit_micros BIGINT NOT NULL CHECK (tokens_per_credit_micros > 0),
            max_request_tokens INTEGER CHECK (max_request_tokens > 0),
            actor_id VARCHAR(36) NOT NULL,
            created_at TIMESTAMP NOT NULL,
            UNIQUE (provider_model_id, version),
            FOREIGN KEY(provider_model_id) REFERENCES provider_models (id) ON DELETE RESTRICT
        )
    """))
    connection.execute(text("""
        INSERT INTO credit_model_rates__v16 (
            id, provider_model_id, version, tokens_per_credit_micros,
            max_request_tokens, actor_id, created_at
        )
        SELECT id, provider_model_id, version, tokens_per_credit_micros,
               max_request_tokens, actor_id, created_at
        FROM credit_model_rates
    """))
    connection.execute(text("DROP TABLE credit_model_rates"))
    connection.execute(text("ALTER TABLE credit_model_rates__v16 RENAME TO credit_model_rates"))
    connection.execute(text(
        "CREATE INDEX ix_credit_model_rates_provider_model_id "
        "ON credit_model_rates (provider_model_id)"
    ))


def _migration_0017_gateway_log_retention(connection: Connection) -> None:
    connection.execute(text(
        "CREATE TABLE IF NOT EXISTS gateway_settings ("
        "id INTEGER PRIMARY KEY CHECK (id = 1), "
        "log_retention VARCHAR(8) NOT NULL DEFAULT 'never' "
        "CHECK (log_retention IN ('24h','7d','30d','never')))"
    ))
    connection.execute(text(
        "INSERT OR IGNORE INTO gateway_settings (id, log_retention) VALUES (1, 'never')"
    ))


def _migration_0018_user_admin_audit(connection: Connection) -> None:
    connection.execute(text("""
        CREATE TABLE IF NOT EXISTS user_admin_audit (
            id VARCHAR(36) PRIMARY KEY,
            actor_id VARCHAR(36) NOT NULL REFERENCES users(id),
            user_id VARCHAR(36) NOT NULL REFERENCES users(id),
            action VARCHAR(48) NOT NULL,
            detail VARCHAR(255) NOT NULL,
            created_at DATETIME NOT NULL
        )
    """))
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_user_admin_audit_user_created ON user_admin_audit (user_id, created_at)"))


def _migration_0019_credit_coupons(connection: Connection) -> None:
    # Freeze this schema here so future model edits cannot change migration 0019.
    connection.execute(text("""
        CREATE TABLE IF NOT EXISTS coupons (
            id VARCHAR(36) PRIMARY KEY,
            code VARCHAR(64) NOT NULL UNIQUE,
            name VARCHAR(150) NOT NULL,
            amount BIGINT NOT NULL CHECK (amount > 0 AND amount <= 9000000000000000000),
            enabled BOOLEAN NOT NULL,
            starts_at DATETIME,
            expires_at DATETIME,
            max_redemptions INTEGER CHECK (max_redemptions IS NULL OR max_redemptions >= 1),
            per_user_limit INTEGER NOT NULL CHECK (per_user_limit >= 1),
            created_by VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            CHECK (starts_at IS NULL OR expires_at IS NULL OR expires_at > starts_at),
            CHECK (code = UPPER(TRIM(code)) AND length(code) BETWEEN 3 AND 64)
        )
    """))
    connection.execute(text("""
        CREATE TABLE IF NOT EXISTS coupon_redemptions (
            id VARCHAR(36) PRIMARY KEY,
            coupon_id VARCHAR(36) NOT NULL REFERENCES coupons(id) ON DELETE RESTRICT,
            user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            amount BIGINT NOT NULL CHECK (amount > 0),
            idempotency_key VARCHAR(128) NOT NULL,
            credit_entry_id VARCHAR(36) NOT NULL UNIQUE REFERENCES credit_entries(id) ON DELETE RESTRICT,
            created_at DATETIME NOT NULL,
            UNIQUE (user_id, idempotency_key)
        )
    """))
    connection.execute(text("""
        CREATE TABLE IF NOT EXISTS coupon_audit (
            id VARCHAR(36) PRIMARY KEY,
            coupon_id VARCHAR(36) NOT NULL REFERENCES coupons(id) ON DELETE RESTRICT,
            actor_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            action VARCHAR(20) NOT NULL,
            old_values JSON,
            new_values JSON NOT NULL,
            created_at DATETIME NOT NULL
        )
    """))
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_coupon_redemptions_coupon_user ON coupon_redemptions (coupon_id, user_id)"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_coupon_redemptions_user_created ON coupon_redemptions (user_id, created_at)"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_coupon_audit_coupon_id ON coupon_audit (coupon_id)"))


def _migration_0020_support_tickets(connection: Connection) -> None:
    connection.execute(text("""
        CREATE TABLE IF NOT EXISTS support_tickets (
            id VARCHAR(36) PRIMARY KEY,
            user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            subject VARCHAR(255) NOT NULL,
            category VARCHAR(64) NOT NULL,
            priority VARCHAR(32) NOT NULL DEFAULT 'normal',
            status VARCHAR(32) NOT NULL DEFAULT 'open',
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL
        )
    """))
    connection.execute(text("""
        CREATE TABLE IF NOT EXISTS support_ticket_messages (
            id VARCHAR(36) PRIMARY KEY,
            ticket_id VARCHAR(36) NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
            sender_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            sender_role VARCHAR(32) NOT NULL,
            message TEXT NOT NULL,
            created_at DATETIME NOT NULL
        )
    """))
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_support_tickets_user_created ON support_tickets (user_id, created_at)"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_support_tickets_status ON support_tickets (status)"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_support_ticket_messages_ticket_created ON support_ticket_messages (ticket_id, created_at)"))


def _migration_0021_signup_settings(connection: Connection) -> None:
    if "signups_enabled" not in _sqlite_columns(connection, "gateway_settings"):
        connection.execute(text(
            "ALTER TABLE gateway_settings ADD COLUMN signups_enabled INTEGER NOT NULL DEFAULT 1 "
            "CHECK (signups_enabled IN (0, 1))"
        ))


def _migration_0022_api_key_expiry(connection: Connection) -> None:
    if "expires_at" not in _sqlite_columns(connection, "api_keys"):
        connection.execute(text("ALTER TABLE api_keys ADD COLUMN expires_at DATETIME"))


def _migration_0023_notifications(connection: Connection) -> None:
    from backend.notifications.models import Notification
    Notification.__table__.create(connection, checkfirst=True)


def _migration_0024_announcements(connection: Connection) -> None:
    from backend.announcements.models import Announcement, AnnouncementDismissal
    Announcement.__table__.create(connection, checkfirst=True)
    AnnouncementDismissal.__table__.create(connection, checkfirst=True)


def _migration_0025_notification_preferences(connection: Connection) -> None:
    from backend.notifications.models import NotificationPreference
    NotificationPreference.__table__.create(connection, checkfirst=True)


def _migration_0026_block_disposable_emails(connection: Connection) -> None:
    if "block_disposable_emails" not in _sqlite_columns(connection, "gateway_settings"):
        connection.execute(text(
            "ALTER TABLE gateway_settings ADD COLUMN block_disposable_emails "
            "INTEGER NOT NULL DEFAULT 1 CHECK (block_disposable_emails IN (0, 1))"
        ))


def _migration_0027_trace_error_details(connection: Connection) -> None:
    if "error_details" not in _sqlite_columns(connection, "llm_call_traces"):
        connection.execute(text("ALTER TABLE llm_call_traces ADD COLUMN error_details JSON"))


def _migration_0028_runtime_fallback(connection: Connection) -> None:
    connection.execute(text(
        "UPDATE model_groups SET routing_strategy = 'runtime_fallback' "
        "WHERE routing_strategy = 'priority'"
    ))


MIGRATIONS: list[tuple[str, Callable[[Connection], None]]] = [
    ("0001_users_tracing_enabled", _migration_0001_users_tracing_enabled),
    ("0002_users_telemetry_enabled", _migration_0002_users_telemetry_enabled),
    (
        "0003_llm_call_traces_accounting",
        _migration_0003_llm_call_traces_accounting,
    ),
    ("0004_model_groups_pricing", _migration_0004_model_groups_pricing),
    ("0005_wallet_budget_schema", _migration_0005_wallet_budget_schema),
    ("0006_provider_capacity", _migration_0006_provider_capacity),
    ("0007_token_credit_billing", _migration_0007_token_credit_billing),
    ("0008_drop_legacy_reservations", _migration_0008_drop_legacy_reservations),
    ("0009_remove_credit_pools", _migration_0009_remove_credit_pools),
    ("0010_retry_estimate_policy", _migration_0010_retry_estimate_policy),
    ("0011_soft_capacity_accounting", _migration_0011_soft_capacity_accounting),
    (
        "0012_remove_wallet_credit_schema",
        _migration_0012_remove_wallet_credit_schema,
    ),
    ("0013_usage_credits", _migration_0013_usage_credits),
    ("0014_credit_micros_rename", _migration_0014_credit_micros_rename),
    ("0015_remove_max_output_tokens", _migration_0015_remove_max_output_tokens),
    ("0016_optional_model_token_ceiling", _migration_0016_optional_model_token_ceiling),
    ("0017_gateway_log_retention", _migration_0017_gateway_log_retention),
    ("0018_user_admin_audit", _migration_0018_user_admin_audit),
    ("0019_credit_coupons", _migration_0019_credit_coupons),
    ("0020_support_tickets", _migration_0020_support_tickets),
    ("0021_signup_settings", _migration_0021_signup_settings),
    ("0022_api_key_expiry", _migration_0022_api_key_expiry),
    ("0023_notifications", _migration_0023_notifications),
    ("0024_announcements", _migration_0024_announcements),
    ("0025_notification_preferences", _migration_0025_notification_preferences),
    ("0026_block_disposable_emails", _migration_0026_block_disposable_emails),
    ("0027_trace_error_details", _migration_0027_trace_error_details),
    ("0028_runtime_fallback", _migration_0028_runtime_fallback),
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

    if not event.contains(engine, "checkout", _foreign_keys_state_on_checkout):
        event.listen(engine, "checkout", _foreign_keys_state_on_checkout)

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

            if version in _FOREIGN_KEYS_OFF_MIGRATIONS:
                # FKs are toggled at checkout time (a PRAGMA inside a
                # transaction would be a no-op), so guarded migrations run on
                # their own connection while the guard is armed.
                _foreign_keys_guard["off"] = True
                guarded = engine.connect()
                try:
                    with guarded.begin():
                        migrate(guarded)
                        guarded.execute(
                            text(
                                f"INSERT INTO {_TRACKING_TABLE} (version) VALUES (:version)"
                            ),
                            {"version": version},
                        )
                finally:
                    _foreign_keys_guard["off"] = False
                    guarded.close()
            else:
                with connection.begin():
                    migrate(connection)
                    connection.execute(
                        text(f"INSERT INTO {_TRACKING_TABLE} (version) VALUES (:version)"),
                        {"version": version},
                    )

            applied_now.append(version)

    return applied_now
