from __future__ import annotations

import time

from fastapi import APIRouter

from app.services.score_recalc import _metric_map_cache, _scores_cache

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/cache-stats")
async def cache_stats() -> dict:
    now = time.monotonic()

    mm_years = sorted(_metric_map_cache)
    mm_age: dict[str, float] = {}
    mm_count: dict[str, int] = {}
    for yr in mm_years:
        cached_at, data = _metric_map_cache[yr]
        mm_age[str(yr)] = round(now - cached_at, 1)
        mm_count[str(yr)] = len(data)

    sc_years = sorted(_scores_cache)
    sc_age: dict[str, float] = {}
    sc_count: dict[str, int] = {}
    for yr in sc_years:
        cached_at, data = _scores_cache[yr]
        sc_age[str(yr)] = round(now - cached_at, 1)
        sc_count[str(yr)] = len(data)

    return {
        "metric_map_cache": {
            "years_cached": mm_years,
            "age_seconds": mm_age,
            "entry_count": mm_count,
        },
        "scores_cache": {
            "years_cached": sc_years,
            "age_seconds": sc_age,
            "tract_count": sc_count,
        },
    }
