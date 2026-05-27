from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Clinic(Base):
    __tablename__ = "clinics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    hrsa_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(512), nullable=False)
    address: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    state_fips: Mapped[Optional[str]] = mapped_column(String(2), nullable=True)
    zip_code: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    is_operational: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    site_type: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    tract_clinics = relationship("TractClinic", back_populates="clinic", cascade="all, delete-orphan")


class TractClinic(Base):
    __tablename__ = "tract_clinics"

    geoid: Mapped[str] = mapped_column(
        String(11), ForeignKey("tracts.geoid", ondelete="CASCADE"), primary_key=True
    )
    clinic_id: Mapped[int] = mapped_column(Integer, ForeignKey("clinics.id", ondelete="CASCADE"), nullable=False)
    distance_miles: Mapped[float] = mapped_column(Float, nullable=False)
    rank: Mapped[int] = mapped_column(Integer, primary_key=True)

    clinic = relationship("Clinic", back_populates="tract_clinics")
