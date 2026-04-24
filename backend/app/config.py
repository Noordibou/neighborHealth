from __future__ import annotations

from pathlib import Path
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolve backend/.env from this file so DATABASE_URL is consistent whether you start
# uvicorn from `backend/`, the repo root, or Docker (file may be absent; use env vars).
_BACKEND_DIR = Path(__file__).resolve().parent.parent
_ENV_PATH = _BACKEND_DIR / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_PATH),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "postgresql+asyncpg://neighborhealth:neighborhealth@localhost:5432/neighborhealth"
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7

    anthropic_api_key: Optional[str] = None
    mapbox_token: Optional[str] = None
    census_api_key: Optional[str] = None
    cdc_api_key: Optional[str] = None

    ai_model: str = "claude-3-5-haiku-20241022"
    cors_origins: str = "http://localhost:3000"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
