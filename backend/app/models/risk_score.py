from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class RiskScore(Base):
    __tablename__ = "risk_scores"

    geoid: Mapped[str] = mapped_column(String(11), ForeignKey("tracts.geoid", ondelete="CASCADE"), primary_key=True)
    year: Mapped[int] = mapped_column(Integer, primary_key=True)
    composite_score: Mapped[float] = mapped_column(Float, index=True)
    component_scores: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    weights_used: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.utcnow())

    tract = relationship("Tract", back_populates="risk_scores")
