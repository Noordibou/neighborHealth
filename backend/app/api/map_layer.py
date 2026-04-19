from __future__ import annotations

import json
from collections import defaultdict
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models import Indicator, RiskScore, Tract
from app.schemas.tract import GeoidsGeoJSONRequest
from app.services.risk_score import METRIC_KEYS


def _as_geojson_geometry(raw: Any) -> dict[str, Any] | None:
    """Drivers may return JSON as dict, str, or (rarely) bytes — MapLibre needs a GeoJSON geometry object."""
    if raw is None:
        return None
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, memoryview):
        raw = raw.tobytes()
    if isinstance(raw, bytes):
        try:
            raw = raw.decode("utf-8")
        except UnicodeDecodeError:
            return None
    if isinstance(raw, str):
        try:
            out = json.loads(raw)
            return out if isinstance(out, dict) else None
        except json.JSONDecodeError:
            return None
    return None

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
               r.composite_score, t.name,
               t.county_name, t.place_name, t.state_fips
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
    for geoid, geom, score, name, county_name, place_name, state_fips in rows:
        gj = _as_geojson_geometry(geom)
        if gj is None:
            continue
        props: dict[str, Any] = {
            "geoid": geoid,
            "composite_score": float(score) if score is not None else None,
            "name": name,
            "county_name": county_name,
            "place_name": place_name,
            "state_fips": state_fips,
        }
        props.update(metrics_by_geoid.get(geoid, {}))
        features.append({"type": "Feature", "geometry": gj, "properties": props})
    return {"type": "FeatureCollection", "features": features}


def _normalize_geoids(raw: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for g in raw:
        s = (g or "").strip()
        if not s or len(s) > 12 or not s.isdigit():
            continue
        if s not in seen:
            seen.add(s)
            out.append(s)
    return out[:100]


@router.post("/tracts-by-geoids")
async def tracts_geojson_by_geoids(
    session: Annotated[AsyncSession, Depends(get_db)],
    body: GeoidsGeoJSONRequest,
) -> dict:
    """GeoJSON for an explicit list of tract GEOIDs (e.g. search results on the map)."""
    geoids = _normalize_geoids(body.geoids)
    if not geoids:
        raise HTTPException(status_code=400, detail="No valid GEOIDs provided.")

    yq = await session.execute(select(func.max(RiskScore.year)))
    year_eff: int = yq.scalar() or 2023

    # Use ORM + IN (...): expanding bindparam inside raw text() is unreliable with asyncpg.
    stmt = (
        select(
            Tract.geoid,
            func.ST_AsGeoJSON(Tract.geometry).label("gj"),
            RiskScore.composite_score,
            Tract.name,
            Tract.county_name,
            Tract.place_name,
            Tract.state_fips,
        )
        .select_from(Tract)
        .outerjoin(
            RiskScore,
            and_(RiskScore.geoid == Tract.geoid, RiskScore.year == year_eff),
        )
        .where(Tract.geometry.isnot(None), Tract.geoid.in_(geoids))
    )
    res = await session.execute(stmt)
    rows = res.all()
    metrics_by_geoid: dict[str, dict[str, float]] = defaultdict(dict)
    if rows:
        gids = [r[0] for r in rows]
        iq = await session.execute(
            select(Indicator.geoid, Indicator.metric_name, Indicator.value).where(
                Indicator.geoid.in_(gids),
                Indicator.year == year_eff,
                Indicator.metric_name.in_(METRIC_KEYS),
            )
        )
        for gid, mn, val in iq.all():
            if val is not None:
                metrics_by_geoid[gid][mn] = float(val)

    features: list[dict[str, Any]] = []
    for geoid, gj_raw, score, name, county_name, place_name, state_fips in rows:
        gj = _as_geojson_geometry(gj_raw)
        if gj is None:
            continue
        props: dict[str, Any] = {
            "geoid": geoid,
            "composite_score": float(score) if score is not None else None,
            "name": name,
            "county_name": county_name,
            "place_name": place_name,
            "state_fips": state_fips,
        }
        props.update(metrics_by_geoid.get(geoid, {}))
        features.append({"type": "Feature", "geometry": gj, "properties": props})
    return {"type": "FeatureCollection", "features": features}
