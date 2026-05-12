"""add value_moe to indicators

Revision ID: 003_value_moe
Revises: 002_percentile_county
Create Date: 2026-05-06

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "003_value_moe"
down_revision: Union[str, None] = "002_percentile_county"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Idempotent: DB may already have value_moe if applied manually or a prior partial run.
    op.execute(sa.text("ALTER TABLE indicators ADD COLUMN IF NOT EXISTS value_moe DOUBLE PRECISION"))


def downgrade() -> None:
    op.execute(sa.text("ALTER TABLE indicators DROP COLUMN IF EXISTS value_moe"))
