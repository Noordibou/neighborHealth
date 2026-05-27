"""add performance indexes for year-filtered queries

Revision ID: add_performance_indexes
Revises: add_clinics_tract_clinics
Create Date: 2026-05-23

Fixes two sequential-scan bottlenecks identified in profiling:

  1. risk_scores has no index on (year): every year-filtered query
     (rank window, CSV export, health/composite sort) does a full
     84K-row scan discarding 63K rows before doing any useful work.

  2. indicators has only separate indexes on metric_name and year:
     the health-sort join runs 3 bitmap scans each returning 84K rows
     then filtering to ~21K by year — a composite index cuts that to
     21K rows directly.

Production note: CREATE INDEX CONCURRENTLY is incompatible with
Alembic's default transaction-per-migration mode (asyncpg driver
raises an error when CONCURRENTLY is issued inside a transaction
block). For a live database under load, apply the equivalent SQL
out-of-band before running this migration:

    CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_risk_scores_year
        ON risk_scores (year);
    CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_risk_scores_year_score
        ON risk_scores (year, composite_score DESC);
    CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_indicators_metric_year
        ON indicators (metric_name, year);
    CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_indicators_geoid_year
        ON indicators (geoid, year);
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "add_performance_indexes"
down_revision: Union[str, None] = "add_clinics_tract_clinics"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Problem 1 — risk_scores year scans
    op.create_index(
        "ix_risk_scores_year",
        "risk_scores",
        ["year"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_risk_scores_year_score",
        "risk_scores",
        ["year", sa.text("composite_score DESC")],
        if_not_exists=True,
    )

    # Problem 2 — indicators metric+year scans
    op.create_index(
        "ix_indicators_metric_year",
        "indicators",
        ["metric_name", "year"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_indicators_geoid_year",
        "indicators",
        ["geoid", "year"],
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_index("ix_indicators_geoid_year", table_name="indicators", if_exists=True)
    op.drop_index("ix_indicators_metric_year", table_name="indicators", if_exists=True)
    op.drop_index("ix_risk_scores_year_score", table_name="risk_scores", if_exists=True)
    op.drop_index("ix_risk_scores_year", table_name="risk_scores", if_exists=True)
