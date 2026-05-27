from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import ProgrammingError
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.gzip import GZipMiddleware

from app.api.admin import router as admin_router
from app.api.auth_routes import router as auth_router
from app.api.compare import router as compare_router
from app.api.export_api import router as export_router
from app.api.map_layer import router as map_router
from app.api.search import router as search_router
from app.api.states import router as states_router
from app.api.tracts import router as tracts_router
from app.config import settings

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # FIX 1: warn on default secrets so misconfigured deploys are visible in logs
    if settings.jwt_secret == "change-me-in-production":
        log.critical(
            "SECURITY WARNING: JWT_SECRET is set to the default value. "
            "Tokens can be forged. Set JWT_SECRET env var before "
            "deploying to any non-local environment."
        )
    if "neighborhealth:neighborhealth@localhost" in settings.database_url:
        log.warning(
            "Using default local database URL. Set DATABASE_URL env var "
            "for staging/production."
        )
    # FIX 2: purge tmp PDF exports older than 2 hours on each startup
    tmp_dir = Path(__file__).resolve().parent.parent / "tmp_exports"
    if tmp_dir.exists():
        now = time.time()
        for f in tmp_dir.iterdir():
            try:
                if f.stat().st_mtime < now - 7200:
                    f.unlink()
            except OSError:
                pass
    yield


app = FastAPI(title="NeighborHealth API", version="0.1.0", lifespan=lifespan)


@app.exception_handler(ProgrammingError)
async def programming_error_handler(request: Request, exc: ProgrammingError) -> JSONResponse:
    """Friendly hint when Alembic migrations were never applied to this database."""
    msg = str(exc.orig) if getattr(exc, "orig", None) else str(exc)
    if "does not exist" in msg and "relation" in msg:
        return JSONResponse(
            status_code=503,
            content={
                "detail": "Database schema is missing. From the backend directory run: alembic upgrade head",
                "hint": "Ensure DATABASE_URL points at the database you migrated.",
            },
        )
    raise exc


class TimingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start = time.monotonic()
        response = await call_next(request)
        duration_ms = (time.monotonic() - start) * 1000
        log.info(
            "%s %s → %d (%.1fms)",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
        )
        return response


app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# TimingMiddleware added last so it is outermost (receives request first, response last)
app.add_middleware(TimingMiddleware)

app.include_router(tracts_router)
app.include_router(map_router)
app.include_router(compare_router)
app.include_router(search_router)
app.include_router(states_router)
app.include_router(export_router)
app.include_router(auth_router)
app.include_router(admin_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
