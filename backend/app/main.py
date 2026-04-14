from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import ProgrammingError

from app.api.auth_routes import router as auth_router
from app.api.compare import router as compare_router
from app.api.export_api import router as export_router
from app.api.map_layer import router as map_router
from app.api.search import router as search_router
from app.api.states import router as states_router
from app.api.tracts import router as tracts_router
from app.config import settings

app = FastAPI(title="NeighborHealth API", version="0.1.0")


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


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tracts_router)
app.include_router(map_router)
app.include_router(compare_router)
app.include_router(search_router)
app.include_router(states_router)
app.include_router(export_router)
app.include_router(auth_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
