"""Add the disposable email signup setting.

Revision ID: 0e59340f274b
Revises: ae0b963ad639
"""
from alembic import op
import sqlalchemy as sa


revision = "0e59340f274b"
down_revision = "ae0b963ad639"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "gateway_settings",
        sa.Column(
            "block_disposable_emails",
            sa.Integer(),
            sa.CheckConstraint(
                "block_disposable_emails IN (0, 1)",
                name="ck_gateway_settings_block_disposable_emails",
            ),
            nullable=False,
            server_default="1",
        ),
    )


def downgrade():
    op.drop_column("gateway_settings", "block_disposable_emails")
