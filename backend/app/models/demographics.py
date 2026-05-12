from __future__ import annotations

from typing import Optional

from sqlalchemy import Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class TractDemographics(Base):
    """ACS-derived tract-level demographics for a given vintage year."""

    __tablename__ = "tract_demographics"

    geoid: Mapped[str] = mapped_column(
        String(11), ForeignKey("tracts.geoid", ondelete="CASCADE"), primary_key=True
    )
    year: Mapped[int] = mapped_column(Integer, primary_key=True)

    total_population: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    median_age: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    pct_white: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    pct_black: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    pct_hispanic: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    pct_asian: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    pct_other_race: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    pct_non_english_home: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    pct_foreign_born: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    pct_no_hs_diploma: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    tract = relationship("Tract", back_populates="demographics")
