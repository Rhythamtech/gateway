"""Store diagnostics for failed trace attempts.

Revision ID: 9ea40c2869d3
Revises: b7d49f5151af
"""
from alembic import op
import sqlalchemy as sa


revision = "9ea40c2869d3"
down_revision = "b7d49f5151af"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("llm_call_traces", sa.Column("error_details", sa.JSON(), nullable=True))


def downgrade():
    op.drop_column("llm_call_traces", "error_details")
