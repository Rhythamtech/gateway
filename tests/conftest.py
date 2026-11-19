"""conftest.py — shared fixtures for the test suite.

Sets up a fresh SQLite database for each test and patches ``SessionLocal``
(the write engine session factory used by the trace recording service) so
unit tests never hit the real database file.
"""

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from backend.core.database import Base
from backend.users import audit as user_audit_models  # noqa: F401
from backend.coupons import models as coupon_models  # noqa: F401

from backend.notifications import models as notification_models  # noqa: F401
from backend.announcements import models as announcement_models  # noqa: F401

@pytest.fixture(scope="function")
def db_session(monkeypatch, tmp_path):
    """Yield a fresh SQLite session, roll back after the test."""

    engine = create_engine(
        f"sqlite:///{tmp_path / 'test.db'}",
        connect_args={"check_same_thread": False, "timeout": 10},
    )

    # The write engine uses BEGIN IMMEDIATE; replicate that for tests.
    @event.listens_for(engine, "connect")
    def _pragmas(conn, _):
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA journal_mode=WAL")

    # Import all models so metadata is populated.
    import backend.auth.models  # noqa: F401
    import backend.api_keys.models  # noqa: F401
    import backend.gateway.model_groups.models  # noqa: F401
    import backend.gateway.provider_models.models  # noqa: F401
    import backend.gateway.providers.models  # noqa: F401
    import backend.traces.models  # noqa: F401

    Base.metadata.create_all(bind=engine)

    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    monkeypatch.setattr("backend.traces.service.SessionLocal", Session)
    monkeypatch.setattr("backend.core.database.SessionLocal", Session)

    session = Session()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()
