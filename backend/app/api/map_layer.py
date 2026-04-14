from __future__ import annotations

from collections import defaultdict
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models import Indicator, RiskScore
from app.services.risk_score import METRIC_KEYS

router = APIRouter(prefix="/api/map", tags=["map"])


@router.get("/tracts")
async def tracts_geojson(
    session: Annotated[AsyncSession, Depends(get_db)],
    state_fips: str = Query(..., min_length=2, max_length=2),
    year: int | None = None,
) -> dict:
    """GeoJSON FeatureCollection of tract polygons with composite score properties."""
    sf = state_fips.zfill(2)
    year_eff = year
    if year_eff is None:
        yq = await session.execute(select(func.max(RiskScore.year)))
        year_eff = yq.scalar() or 2023

    sql = text(
        """
        SELECT t.geoid, ST_AsGeoJSON(t.geometry)::json AS g,
               r.composite_score, t.name
        FROM tracts t
        LEFT JOIN risk_scores r ON r.geoid = t.geoid AND r.year = :year
        WHERE t.state_fips = :sf AND t.geometry IS NOT NULL
        """
    )
    res = await session.execute(sql, {"sf": sf, "year": year_eff})
    rows = res.all()
    geoids = [r[0] for r in rows]
    metrics_by_geoid: dict[str, dict[str, float]] = defaultdict(dict)
    if geoids:
        iq = await session.execute(
            select(Indicator.geoid, Indicator.metric_name, Indicator.value).where(
                Indicator.geoid.in_(geoids),
                Indicator.year == year_eff,
                Indicator.metric_name.in_(METRIC_KEYS),
            )
        )
        for gid, mn, val in iq.all():
            if val is not None:
                metrics_by_geoid[gid][mn] = float(val)

    features: list[dict[str, Any]] = []
    for geoid, geom, score, name in rows:
        if geom is None:
            continue
        props: dict[str, Any] = {
            "geoid": geoid,
            "composite_score": float(score) if score is not None else None,
            "name": name,
        }
        props.update(metrics_by_geoid.get(geoid, {}))
        features.append({"type": "Feature", "geometry": geom, "properties": props})
    return {"type": "FeatureCollection", "features": features}
