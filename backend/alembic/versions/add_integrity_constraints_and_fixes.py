"""add integrity constraints and fixes

Revision ID: add_integrity_constraints
Revises: add_performance_indexes
Create Date: 2026-05-24

Changes applied in this migration:

1. UNIQUE CONSTRAINT FIX on indicators
   Old: (geoid, source, metric_name, year)
   New: (geoid, metric_name, year)  — source removed from key
   Reason: including source allows silent duplicate metrics if a source
   name is ever renamed or changed between ingest runs. All metrics map
   1:1 to a fixed source (e.g. rent_burden_pct is always census_acs),
   so source provides no uniqueness value and only creates a gap.
   Pre-flight confirmed 0 duplicate (geoid, metric_name, year) rows.

2. CHECK CONSTRAINTS added:
   - risk_scores.composite_score between 0 and 100
   - indicators.percentile_national, percentile_state, percentile_county:
     NULL or between 0 and 100
   - tract_clinics.rank between 1 and 3
   - tract_clinics.distance_miles > 0
   All pre-flight violation counts confirmed as 0.

3. tracts.population type changed DOUBLE PRECISION → INTEGER
   Population is an ACS count; storing it as float risks sub-integer
   values and type confusion. Existing values are all whole numbers.
   Cast: population::integer (safe, no fractional values in DB).

4. Covering index ix_indicators_metric_year_value
   ON indicators (metric_name, year, value DESC)
   Eliminates the 21K-row value scan in list_tracts with
   min_rent_burden / min_uninsured / high_asthma filters.
   Applied without CONCURRENTLY (safe inside a transaction for dev).

   For production under load, apply out-of-band before running this
   migration:
     CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_indicators_metric_year_value
       ON indicators (metric_name, year, value DESC);
   Then the IF NOT EXISTS in the migration will be a no-op.

5. Zero-population scored tracts flagged as institutional
   UPDATE tracts SET is_institutional = TRUE
   WHERE population = 0 AND geoid IN (SELECT geoid FROM risk_scores)
   Affects 1 tract: 06037277400 (Census Tract 2774, LA County).
   Downgrade reverses this specific row only.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "add_integrity_constraints"
down_revision: Union[str, None] = "add_performance_indexes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Replace indicators unique constraint (drop source from key)
    op.drop_constraint(
        "uq_indicator_tract_source_metric_year",
        "indicators",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_indicator_tract_metric_year",
        "indicators",
        ["geoid", "metric_name", "year"],
    )

    # 2. Check constraints
    op.create_check_constraint(
        "ck_composite_score_range",
        "risk_scores",
        "composite_score >= 0 AND composite_score <= 100",
    )
    op.create_check_constraint(
        "ck_percentile_national",
        "indicators",
        "percentile_national IS NULL OR "
        "(percentile_national >= 0 AND percentile_national <= 100)",
    )
    op.create_check_constraint(
        "ck_percentile_state",
        "indicators",
        "percentile_state IS NULL OR "
        "(percentile_state >= 0 AND percentile_state <= 100)",
    )
    op.create_check_constraint(
        "ck_percentile_county",
        "indicators",
        "percentile_county IS NULL OR "
        "(percentile_county >= 0 AND percentile_county <= 100)",
    )
    op.create_check_constraint(
        "ck_rank_range",
        "tract_clinics",
        "rank >= 1 AND rank <= 3",
    )
    op.create_check_constraint(
        "ck_distance_positive",
        "tract_clinics",
        "distance_miles > 0",
    )

    # 3. Change tracts.population from DOUBLE PRECISION to INTEGER
    op.alter_column(
        "tracts",
        "population",
        existing_type=sa.Float(),
        type_=sa.Integer(),
        postgresql_using="population::integer",
    )

    # 4. Covering index for value-range filters (no CONCURRENTLY — see docstring)
    op.create_index(
        "ix_indicators_metric_year_value",
        "indicators",
        ["metric_name", "year", sa.text("value DESC")],
        if_not_exists=True,
    )

    # 5. Flag zero-population scored tracts as institutional
    op.execute(
        sa.text(
            "UPDATE tracts SET is_institutional = TRUE "
            "WHERE population = 0 "
            "AND geoid IN (SELECT DISTINCT geoid FROM risk_scores)"
        )
    )


def downgrade() -> None:
    # Reverse in opposite order of upgrade.

    # 5. Reverse is_institutional flag for the one affected tract
    op.execute(
        sa.text(
            "UPDATE tracts SET is_institutional = FALSE "
            "WHERE geoid = '06037277400'"
        )
    )

    # 4. Drop covering index
    op.drop_index(
        "ix_indicators_metric_year_value",
        table_name="indicators",
        if_exists=True,
    )

    # 3. Revert population to DOUBLE PRECISION
    op.alter_column(
        "tracts",
        "population",
        existing_type=sa.Integer(),
        type_=sa.Float(),
        postgresql_using="population::double precision",
    )

    # 2. Drop check constraints (reverse order of creation)
    op.drop_constraint("ck_distance_positive", "tract_clinics", type_="check")
    op.drop_constraint("ck_rank_range", "tract_clinics", type_="check")
    op.drop_constraint("ck_percentile_county", "indicators", type_="check")
    op.drop_constraint("ck_percentile_state", "indicators", type_="check")
    op.drop_constraint("ck_percentile_national", "indicators", type_="check")
    op.drop_constraint("ck_composite_score_range", "risk_scores", type_="check")

    # 1. Restore original unique constraint with source in key
    op.drop_constraint(
        "uq_indicator_tract_metric_year",
        "indicators",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_indicator_tract_source_metric_year",
        "indicators",
        ["geoid", "source", "metric_name", "year"],
    )
