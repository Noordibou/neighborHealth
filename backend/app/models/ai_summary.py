from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class AISummary(Base):
    __tablename__ = "ai_summaries"

    geoid: Mapped[str] = mapped_column(String(11), ForeignKey("tracts.geoid", ondelete="CASCADE"), primary_key=True)
    summary_text: Mapped[str] = mapped_column(Text)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.utcnow())
    model_version: Mapped[str] = mapped_column(String(64))

    tract = relationship("Tract", back_populates="ai_summary")
