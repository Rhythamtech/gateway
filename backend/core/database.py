from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from backend.core.config import settings
PROJECT_ROOT = Path(__file__).resolve().parents[2]


def resolve_database_url(url: str) -> str:
    if not url.startswith("sqlite"):
        return url

    parsed = make_url(url)

    if not parsed.database or parsed.database == ":memory:":
        return url

    db_path = Path(parsed.database)

    if not db_path.is_absolute():
        db_path = (PROJECT_ROOT / db_path).resolve()

    return parsed.set(database=str(db_path)).render_as_string(hide_password=False)


_database_url = resolve_database_url(settings.DATABASE_URL)
_parsed_database_url = make_url(_database_url)
_is_memory = (
    not _parsed_database_url.database or _parsed_database_url.database == ":memory:"
)

def _sqlite_engine() -> Engine:
    return create_engine(
        _database_url,
        connect_args={"check_same_thread": False} if _database_url.startswith("sqlite") else {},
    )


# Two connection pools over the same database file implement the WAL
# concurrency model: readers run plain deferred transactions (readers never
# block the writer), while every write transaction starts BEGIN IMMEDIATE
# (the write lock is taken up front, so writes serialize cleanly instead of
# deadlocking on deferred lock upgrade).
engine = _sqlite_engine()
write_engine = _sqlite_engine()


if _database_url.startswith("sqlite"):

    def _enable_sqlite_integrity(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        # Trace/aggregate writes happen on every inference call; a busy
        # timeout lets concurrent requests serialize instead of failing fast.
        cursor.execute("PRAGMA busy_timeout=5000")
        # WAL lets readers proceed while a writer holds the database lock.
        if not _is_memory:
            cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()
        # Hand transaction control to SQLAlchemy (no implicit driver BEGIN).
        dbapi_connection.isolation_level = None

    @event.listens_for(engine, "connect")
    def _connect_reader(dbapi_connection, _connection_record) -> None:
        _enable_sqlite_integrity(dbapi_connection, _connection_record)

    @event.listens_for(write_engine, "connect")
    def _connect_writer(dbapi_connection, _connection_record) -> None:
        _enable_sqlite_integrity(dbapi_connection, _connection_record)

    @event.listens_for(write_engine, "begin")
    def _begin_immediate(conn) -> None:
        # SQLAlchemy engine-level "begin" event: fires for every explicit and
        # Session-managed transaction start (``conn`` is a Connection).
        conn.exec_driver_sql("BEGIN IMMEDIATE")



SessionLocal = sessionmaker(
    bind=write_engine,
    autocommit=False,
    autoflush=False,
)

# Request-scoped sessions (auth, CRUD, analytics reads) never run BEGIN
# IMMEDIATE: deferred transactions let concurrent requests read freely while
# write transactions hold the single write lock.
ReadSessionLocal = sessionmaker(
    bind=engine,
    autocommit=False,
    autoflush=False,
)


class Base(DeclarativeBase):
    pass


def get_db():
    db = ReadSessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_write_db():
    with SessionLocal() as db:
        yield db
