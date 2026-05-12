"""create tract_demographics table

Revision ID: create_tract_demographics_table
Revises: add_median_rent_income_to_tracts
Create Date: 2026-05-09

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "create_tract_demographics_table"
down_revision: Union[str, None] = "add_median_rent_income_to_tracts"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tract_demographics",
        sa.Column("geoid", sa.String(length=11), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("total_population", sa.Float(), nullable=True),
        sa.Column("median_age", sa.Float(), nullable=True),
        sa.Column("pct_white", sa.Float(), nullable=True),
        sa.Column("pct_black", sa.Float(), nullable=True),
        sa.Column("pct_hispanic", sa.Float(), nullable=True),
        sa.Column("pct_asian", sa.Float(), nullable=True),
        sa.Column("pct_other_race", sa.Float(), nullable=True),
        sa.Column("pct_non_english_home", sa.Float(), nullable=True),
        sa.Column("pct_foreign_born", sa.Float(), nullable=True),
        sa.Column("pct_no_hs_diploma", sa.Float(), nullable=True),
        sa.ForeignKeyConstraint(["geoid"], ["tracts.geoid"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("geoid", "year"),
    )


def downgrade() -> None:
    op.drop_table("tract_demographics")
