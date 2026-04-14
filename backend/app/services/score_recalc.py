"""Load latest-year indicators and persist risk_scores rows."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Indicator, RiskScore
from app.services.risk_score import METRIC_KEYS, TractValues, clamp_weights, compute_batch_scores


async def recalculate_risk_scores(
    session: AsyncSession,
    year: int,
    weights: dict[str, float] | None = None,
) -> int:
    """Recompute risk_scores for all tracts that have the seven core metrics for ``year``."""
    w = clamp_weights(weights)

    # Pull indicators for year for core metrics
    q = await session.execute(
        select(Indicator.geoid, Indicator.metric_name, Indicator.value).where(
            Indicator.year == year,
            Indicator.metric_name.in_(METRIC_KEYS),
        )
    )
    by_tract: dict[str, dict[str, float | None]] = {}
    for geoid, metric, value in q.all():
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


async def cohort_arrays(
    session: AsyncSession,
    year: int,
) -> dict[str, Any]:
    """All tract GEOIDs with core metrics for cohort normalization in API."""
    metric_map = await load_metric_map_for_year(session, year)
    geoids = [
        g
        for g, vals in metric_map.items()
        if all(vals.get(m) is not None for m in METRIC_KEYS)
    ]
    return {"geoids": geoids, "metrics": metric_map}
