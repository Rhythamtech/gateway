from alembic import context

# Import the composition root to register every mapped model, without running DDL.
import backend.main  # noqa: F401
from backend.core.database import Base, engine

target_metadata = Base.metadata


def include_object(obj, name, type_, reflected, compare_to):
    # The singleton settings table predates ORM models and is migration-owned.
    return not (type_ == "table" and name == "gateway_settings")


def run_migrations_online():
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True, include_object=include_object)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    context.configure(url=engine.url.render_as_string(hide_password=False), target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    run_migrations_online()
