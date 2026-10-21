from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
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


engine = create_engine(resolve_database_url(settings.DATABASE_URL))

SessionLocal = sessionmaker(
    bind=engine,
    autocommit=False,
    autoflush=False,
)

class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()

    try:
        yield db
    finally:
        db.close()
