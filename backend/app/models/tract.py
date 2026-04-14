from __future__ import annotations

from typing import Optional

from sqlalchemy import Float, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from geoalchemy2 import Geometry

from app.db.base import Base


class Tract(Base):
    __tablename__ = "tracts"

    geoid: Mapped[str] = mapped_column(String(11), primary_key=True)
    name: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    state_fips: Mapped[str] = mapped_column(String(2), index=True)
    county_fips: Mapped[str] = mapped_column(String(3), index=True)
    county_name: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    place_name: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    urban_rural: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    centroid_lat: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    centroid_lon: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    geometry: Mapped[object] = mapped_column(
        Geometry(geometry_type="MULTIPOLYGON", srid=4326, spatial_index=False),
        nullable=True,
    )

    indicators = relationship("Indicator", back_populates="tract", cascade="all, delete-orphan")
    risk_scores = relationship("RiskScore", back_populates="tract", cascade="all, delete-orphan")
    ai_summary = relationship("AISummary", back_populates="tract", uselist=False, cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_tracts_state_county", "state_fips", "county_fips"),
    )
