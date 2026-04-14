"""initial schema with PostGIS

Revision ID: 001
Revises:
Create Date: 2026-04-13

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geometry
from sqlalchemy.dialects import postgresql

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(sa.text("CREATE EXTENSION IF NOT EXISTS postgis"))

    op.create_table(
        "tracts",
        sa.Column("geoid", sa.String(length=11), nullable=False),
        sa.Column("name", sa.Text(), nullable=True),
        sa.Column("state_fips", sa.String(length=2), nullable=False),
        sa.Column("county_fips", sa.String(length=3), nullable=False),
        sa.Column("county_name", sa.Text(), nullable=True),
        sa.Column("place_name", sa.Text(), nullable=True),
        sa.Column("urban_rural", sa.String(length=16), nullable=True),
        sa.Column("centroid_lat", sa.Float(), nullable=True),
        sa.Column("centroid_lon", sa.Float(), nullable=True),
        sa.Column(
            "geometry",
            Geometry(geometry_type="MULTIPOLYGON", srid=4326, spatial_index=False),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("geoid"),
    )
    op.create_index("ix_tracts_state_fips", "tracts", ["state_fips"])
    op.create_index("ix_tracts_county_fips", "tracts", ["county_fips"])
    op.create_index("ix_tracts_state_county", "tracts", ["state_fips", "county_fips"])
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_tracts_geometry ON tracts USING GIST (geometry)"))

    op.create_table(
        "indicators",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("geoid", sa.String(length=11), nullable=False),
        sa.Column("source", sa.String(length=64), nullable=False),
        sa.Column("metric_name", sa.String(length=128), nullable=False),
        sa.Column("value", sa.Float(), nullable=True),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("percentile_national", sa.Float(), nullable=True),
        sa.Column("percentile_state", sa.Float(), nullable=True),
        sa.ForeignKeyConstraint(["geoid"], ["tracts.geoid"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "geoid", "source", "metric_name", "year", name="uq_indicator_tract_source_metric_year"
        ),
    )
    op.create_index("ix_indicators_geoid", "indicators", ["geoid"])
    op.create_index("ix_indicators_source", "indicators", ["source"])
    op.create_index("ix_indicators_metric_name", "indicators", ["metric_name"])
    op.create_index("ix_indicators_year", "indicators", ["year"])

    op.create_table(
        "risk_scores",
        sa.Column("geoid", sa.String(length=11), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("composite_score", sa.Float(), nullable=False),
        sa.Column("component_scores", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("weights_used", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["geoid"], ["tracts.geoid"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("geoid", "year"),
    )
    op.create_index("ix_risk_scores_composite_score", "risk_scores", ["composite_score"])

    op.create_table(
        "ai_summaries",
        sa.Column("geoid", sa.String(length=11), nullable=False),
        sa.Column("summary_text", sa.Text(), nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("model_version", sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(["geoid"], ["tracts.geoid"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("geoid"),
    )

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "saved_views",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("geoids", postgresql.ARRAY(sa.String(length=11)), nullable=False),
        sa.Column("filters", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_saved_views_user_id", "saved_views", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_saved_views_user_id", table_name="saved_views")
    op.drop_table("saved_views")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
    op.drop_table("ai_summaries")
    op.drop_index("ix_risk_scores_composite_score", table_name="risk_scores")
    op.drop_table("risk_scores")
    op.drop_index("ix_indicators_year", table_name="indicators")
    op.drop_index("ix_indicators_metric_name", table_name="indicators")
    op.drop_index("ix_indicators_source", table_name="indicators")
    op.drop_index("ix_indicators_geoid", table_name="indicators")
    op.drop_table("indicators")
    op.execute(sa.text("DROP INDEX IF EXISTS ix_tracts_geometry"))
    op.drop_index("ix_tracts_state_county", table_name="tracts")
    op.drop_index("ix_tracts_county_fips", table_name="tracts")
    op.drop_index("ix_tracts_state_fips", table_name="tracts")
    op.drop_table("tracts")
