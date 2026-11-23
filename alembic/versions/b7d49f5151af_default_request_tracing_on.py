"""Enable request tracing by default for new accounts.

Revision ID: b7d49f5151af
Revises: 0e59340f274b
"""
from alembic import op
import sqlalchemy as sa


revision = "b7d49f5151af"
down_revision = "0e59340f274b"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("users", "tracing_enabled", server_default=sa.true())


def downgrade():
    op.alter_column("users", "tracing_enabled", server_default=None)
