from __future__ import annotations

from typing import Optional

from sqlalchemy import Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Indicator(Base):
    __tablename__ = "indicators"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    geoid: Mapped[str] = mapped_column(String(11), ForeignKey("tracts.geoid", ondelete="CASCADE"), index=True)
    source: Mapped[str] = mapped_column(String(64), index=True)
    metric_name: Mapped[str] = mapped_column(String(128), index=True)
    value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    year: Mapped[int] = mapped_column(Integer, index=True)
    percentile_national: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    percentile_state: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    tract = relationship("Tract", back_populates="indicators")

    __table_args__ = (
        UniqueConstraint("geoid", "source", "metric_name", "year", name="uq_indicator_tract_source_metric_year"),
    )
