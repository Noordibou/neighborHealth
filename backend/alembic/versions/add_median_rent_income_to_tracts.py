"""add median rent and median household income to tracts

Revision ID: add_median_rent_income_to_tracts
Revises: 003_value_moe
Create Date: 2026-05-09

ACS: B25058_001E (median gross rent), B19013_001E (median household income).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "add_median_rent_income_to_tracts"
down_revision: Union[str, None] = "003_value_moe"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tracts", sa.Column("median_rent", sa.Float(), nullable=True))
    op.add_column("tracts", sa.Column("median_household_income", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("tracts", "median_household_income")
    op.drop_column("tracts", "median_rent")
