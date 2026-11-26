"""Replace the Priority routing strategy with Runtime Fallback.

Revision ID: c27f640f9e11
Revises: 9ea40c2869d3
"""

from alembic import op


revision = "c27f640f9e11"
down_revision = "9ea40c2869d3"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "UPDATE model_groups SET routing_strategy = 'runtime_fallback' "
        "WHERE routing_strategy = 'priority'"
    )


def downgrade():
    op.execute(
        "UPDATE model_groups SET routing_strategy = 'priority' "
        "WHERE routing_strategy = 'runtime_fallback'"
    )
