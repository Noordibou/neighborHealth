"""add is_institutional and population to tracts

Revision ID: add_is_institutional_to_tracts
Revises: create_tract_demographics_table
Create Date: 2026-05-11

``population`` mirrors ACS total used for ranking filters; ``is_institutional``
flags group-quarters–dominant or Census \"institutional\" tracts (see ingest).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "add_is_institutional_to_tracts"
down_revision: Union[str, None] = "create_tract_demographics_table"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tracts", sa.Column("population", sa.Float(), nullable=True))
    op.add_column(
        "tracts",
        sa.Column("is_institutional", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("tracts", "is_institutional")
    op.drop_column("tracts", "population")
