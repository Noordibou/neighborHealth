"""create clinics and tract_clinics tables

Revision ID: add_clinics_tract_clinics
Revises: add_is_institutional_to_tracts
Create Date: 2026-05-21

Note: revision id must stay ≤32 chars (Postgres ``alembic_version.version_num``).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "add_clinics_tract_clinics"
down_revision: Union[str, None] = "add_is_institutional_to_tracts"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "clinics",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("hrsa_id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=512), nullable=False),
        sa.Column("address", sa.String(length=512), nullable=True),
        sa.Column("city", sa.String(length=128), nullable=True),
        sa.Column("state_fips", sa.String(length=2), nullable=True),
        sa.Column("zip_code", sa.String(length=10), nullable=True),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("is_operational", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("site_type", sa.String(length=128), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("hrsa_id"),
    )
    op.create_table(
        "tract_clinics",
        sa.Column("geoid", sa.String(length=11), nullable=False),
        sa.Column("clinic_id", sa.Integer(), nullable=False),
        sa.Column("distance_miles", sa.Float(), nullable=False),
        sa.Column("rank", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["clinic_id"], ["clinics.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["geoid"], ["tracts.geoid"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("geoid", "rank"),
    )


def downgrade() -> None:
    op.drop_table("tract_clinics")
    op.drop_table("clinics")
