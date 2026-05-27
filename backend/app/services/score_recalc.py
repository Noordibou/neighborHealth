"""Load latest-year indicators and persist risk_scores rows."""

from __future__ import annotations

import time
from datetime import datetime, timezone
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Indicator, RiskScore, Tract
from app.services.risk_score import METRIC_KEYS, TractValues, clamp_weights, compute_batch_scores

# ---------------------------------------------------------------------------
# In-process metric map cache
# ---------------------------------------------------------------------------
# load_metric_map_for_year pulls ~147K rows on every call.  Cache the result
# per year with a 1-hour TTL so repeated API requests (score, compare, PDF)
# are served from memory after the first cold load.
# Single-threaded asyncio — no lock needed.
# ---------------------------------------------------------------------------
_metric_map_cache: dict[int, tuple[float, Any]] = {}
_scores_cache: dict[int, tuple[float, Any]] = {}
_METRIC_MAP_TTL: float = 3600.0  # seconds


async def get_cached_metric_map(
    session: AsyncSession, year: int
) -> dict[str, dict[str, float | None]]:
    now = time.monotonic()
    if year in _metric_map_cache:
        cached_at, data = _metric_map_cache[year]
        if now - cached_at < _METRIC_MAP_TTL:
            return data  # type: ignore[return-value]
    data = await load_metric_map_for_year(session, year)
    _metric_map_cache[year] = (now, data)
    return data


async def get_cached_default_scores(
    session: AsyncSession, year: int
) -> dict[str, tuple[float, dict[str, float]]]:
    """Return compute_batch_scores() for default (equal) weights, cached per year.
    Avoids re-running the O(N×M) batch computation on every request.
    """
    now = time.monotonic()
    if year in _scores_cache:
        cached_at, data = _scores_cache[year]
        if now - cached_at < _METRIC_MAP_TTL:
            return data  # type: ignore[return-value]
    metric_map = await get_cached_metric_map(session, year)
    cohort = [
        TractValues(geoid=g, values={m: vals.get(m) for m in METRIC_KEYS})
        for g, vals in metric_map.items()
        if all(vals.get(m) is not None for m in METRIC_KEYS)
    ]
    data = compute_batch_scores(cohort)
    _scores_cache[year] = (now, data)
    return data  # type: ignore[return-value]


def invalidate_metric_map_cache() -> None:
    _metric_map_cache.clear()
    _scores_cache.clear()


async def resolve_year(
    session: AsyncSession,
    explicit_year: int | None = None,
) -> int:
    if explicit_year is not None:
        return explicit_year
    return await session.scalar(
        select(func.max(RiskScore.year))
    ) or 2023


async def recalculate_risk_scores(
    session: AsyncSession,
    year: int,
    weights: dict[str, float] | None = None,
) -> int:
    """Recompute risk_scores for all tracts that have the seven core metrics for ``year``."""
    w = clamp_weights(weights)

    # Exclude zero-population and institutional tracts from the scored cohort.
    excl_q = await session.execute(
        select(Tract.geoid).where(
            (Tract.is_institutional.is_(True)) | (Tract.population == 0)
        )
    )
    excluded: frozenset[str] = frozenset(excl_q.scalars().all())

    # Pull indicators for year for core metrics
    q = await session.execute(
        select(Indicator.geoid, Indicator.metric_name, Indicator.value).where(
            Indicator.year == year,
            Indicator.metric_name.in_(METRIC_KEYS),
        )
    )
    by_tract: dict[str, dict[str, float | None]] = {}
    for geoid, metric, value in q.all():
        if geoid not in excluded:
            by_tract.setdefault(geoid, {})[metric] = float(value) if value is not None else None

    tracts: list[TractValues] = []
    for geoid, vals in by_tract.items():
        if all(vals.get(m) is not None for m in METRIC_KEYS):
            tracts.append(TractValues(geoid=geoid, values={m: vals.get(m) for m in METRIC_KEYS}))

    if not tracts:
        return 0

    scores = compute_batch_scores(tracts, w)
    now = datetime.now(timezone.utc)

    await session.execute(delete(RiskScore).where(RiskScore.year == year))

    for geoid, (composite, components) in scores.items():
        session.add(
            RiskScore(
                geoid=geoid,
                year=year,
                composite_score=composite,
                component_scores=components,
                weights_used=w,
                computed_at=now,
            )
        )
    await session.commit()
    invalidate_metric_map_cache()
    return len(scores)


async def load_metric_map_for_year(
    session: AsyncSession,
    year: int,
) -> dict[str, dict[str, float | None]]:
    q = await session.execute(
        select(Indicator.geoid, Indicator.metric_name, Indicator.value).where(Indicator.year == year)
    )
    m: dict[str, dict[str, float | None]] = {}
    for geoid, metric, value in q.all():
        m.setdefault(geoid, {})[metric] = float(value) if value is not None else None
    return m


