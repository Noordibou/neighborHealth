from __future__ import annotations

from typing import Any, Optional

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class SavedView(Base):
    __tablename__ = "saved_views"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    geoids: Mapped[list[str]] = mapped_column(ARRAY(String(11)))
    filters: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, nullable=True)

    user = relationship("User", back_populates="saved_views")
