"""add percentile_county to indicators

Revision ID: 002_percentile_county
Revises: 001
Create Date: 2026-05-06

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "002_percentile_county"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        sa.text("ALTER TABLE indicators ADD COLUMN IF NOT EXISTS percentile_county DOUBLE PRECISION")
    )


def downgrade() -> None:
    op.execute(sa.text("ALTER TABLE indicators DROP COLUMN IF EXISTS percentile_county"))
