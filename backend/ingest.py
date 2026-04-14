#!/usr/bin/env python3
"""
Idempotent ingestion pipeline for NeighborHealth.

Sources:
- U.S. Census TIGER/Line tract boundaries (2022)
- ACS 5-year (2022) detail tables B25070, B25014, B25002 via Census API
- CDC PLACES tract estimates (2023 GIS-friendly release, stored under analysis year)

Usage:
  cd backend && python ingest.py --states 06,12,17,36,48

Environment:
  CENSUS_API_KEY (optional, raises rate limits)
  DATABASE_URL (async URL postgresql+asyncpg://...)
"""

from __future__ import annotations

import argparse
import asyncio
import io
import logging
import math
import os
import tempfile
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Any

import geopandas as gpd
import httpx
from geoalchemy2.shape import from_shape
from shapely.geometry import MultiPolygon, Polygon
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.models import Indicator, Tract
from app.services.risk_score import METRIC_KEYS
from app.services.score_recalc import recalculate_risk_scores

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("ingest")

DATA_YEAR = 2022
PLACES_DATASET = "hky2-3tpn"
TIGER_YEAR = "2022"

STATE_FP_TO_ABBR = {
    "06": "CA",
    "12": "FL",
    "17": "IL",
    "36": "NY",
    "48": "TX",
}


def heat_from_lat(lat: float | None) -> float:
    """Heat-risk index 0–100 from latitude (warmer south → higher)."""
    if lat is None or (isinstance(lat, float) and math.isnan(lat)):
        return 50.0
    return max(0.0, min(100.0, 150.0 - 3.0 * float(lat)))


def _percentile_rank(vals: list[float], x: float) -> float:
    if not vals:
        return 50.0
    s = sorted(vals)
    n = len(s)
    below = sum(1 for v in s if v < x)
    equal = sum(1 for v in s if v == x)
    return 100.0 * (below + 0.5 * equal) / n


async def fetch_acs_state(client: httpx.AsyncClient, state_fips: str, census_key: str | None) -> dict[str, dict[str, float]]:
    base = "https://api.census.gov/data/2022/acs/acs5"
    params_base: dict[str, Any] = {"for": "tract:*", "in": f"state:{state_fips}"}
    if census_key:
        params_base["key"] = census_key

    async def _get(group: str) -> list[list[Any]]:
        params = {**params_base, "get": f"group({group})"}
        r = await client.get(base, params=params)
        r.raise_for_status()
        return r.json()

    j70, j14, j02 = await asyncio.gather(_get("B25070"), _get("B25014"), _get("B25002"))

    def idx(header: list[str], name: str) -> int:
        return header.index(name)

    def geoid_from_row(h: list[str], row: list[str]) -> str:
        st = row[idx(h, "state")].zfill(2)
        co = row[idx(h, "county")].zfill(3)
        tr = row[idx(h, "tract")].zfill(6)
        return st + co + tr

    h70, rows70 = j70[0], j70[1:]
    h14, rows14 = j14[0], j14[1:]
    h02, rows02 = j02[0], j02[1:]

    out: dict[str, dict[str, float]] = {}

    for row in rows70:
        gid = geoid_from_row(h70, row)
        try:
            total = float(row[idx(h70, "B25070_001E")])
            if total <= 0:
                continue
            high = 0.0
            for k in ("B25070_007E", "B25070_008E", "B25070_009E", "B25070_010E"):
                cell = row[idx(h70, k)]
                if cell in (None, "-666666666"):
                    continue
                high += float(cell)
            out.setdefault(gid, {})["rent_burden_pct"] = 100.0 * high / total
        except (ValueError, KeyError, ZeroDivisionError):
            continue

    for row in rows14:
        gid = geoid_from_row(h14, row)
        try:
            tot = float(row[idx(h14, "B25014_001E")])
            if tot <= 0:
                continue
            crowded = 0.0
            for k in ("B25014_005E", "B25014_006E", "B25014_007E", "B25014_011E", "B25014_012E", "B25014_013E"):
                cell = row[idx(h14, k)]
                if cell in (None, "-666666666"):
                    continue
                crowded += float(cell)
            out.setdefault(gid, {})["overcrowding_pct"] = 100.0 * crowded / tot
        except (ValueError, KeyError, ZeroDivisionError):
            continue

    for row in rows02:
        gid = geoid_from_row(h02, row)
        try:
            hu = float(row[idx(h02, "B25002_001E")])
            vac = float(row[idx(h02, "B25002_003E")])
            if hu <= 0:
                continue
            out.setdefault(gid, {})["vacancy_rate"] = 100.0 * vac / hu
        except (ValueError, KeyError, ZeroDivisionError):
            continue

    return out


async def fetch_places_states(
    client: httpx.AsyncClient,
    state_abbrs: list[str],
    app_token: str | None,
) -> dict[str, dict[str, float]]:
    base = f"https://chronicdata.cdc.gov/resource/{PLACES_DATASET}.json"
    headers = {}
    if app_token:
        headers["X-App-Token"] = app_token

    out: dict[str, dict[str, float]] = {}
    where_clause = "(" + " OR ".join([f"stateabbr='{s}'" for s in state_abbrs]) + ")"
    offset = 0
    page = 50000

    while True:
        params = {"$where": where_clause, "$limit": str(page), "$offset": str(offset)}
        r = await client.get(base, params=params, headers=headers)
        r.raise_for_status()
        rows = r.json()
        if not rows:
            break
        for row in rows:
            tf = row.get("tractfips")
            if not tf or len(str(tf)) != 11:
                continue
            tf = str(tf)
            try:
                asthma = float(row.get("casthma_crudeprev") or 0)
                unins = float(row.get("access2_crudeprev") or 0)
                disab = float(row.get("disability_crudeprev") or 0)
            except (TypeError, ValueError):
                continue
            out[tf] = {
                "asthma_pct": asthma,
                "uninsured_pct": unins,
                "disability_pct": disab,
            }
        if len(rows) < page:
            break
        offset += page

    return out


def _read_tiger_gdf_from_zip(content: bytes) -> gpd.GeoDataFrame:
    zf = zipfile.ZipFile(io.BytesIO(content))
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        zf.extractall(tmp_path)
        shp = next(tmp_path.rglob("*.shp"))
        gdf = gpd.read_file(shp)
    if gdf.crs is not None and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(4326)
    else:
        gdf = gdf.set_crs(4326, allow_override=True)
    return gdf


async def load_tiger_tracts(client: httpx.AsyncClient, state_fips: str) -> gpd.GeoDataFrame:
    url = f"https://www2.census.gov/geo/tiger/TIGER{TIGER_YEAR}/TRACT/tl_{TIGER_YEAR}_{state_fips}_tract.zip"
    log.info("Downloading TIGER %s", url)
    r = await client.get(url, timeout=120.0)
    r.raise_for_status()
    return await asyncio.to_thread(_read_tiger_gdf_from_zip, r.content)


def urban_rural_class(aland: float | None) -> str:
    if aland is None:
        return "unknown"
    if float(aland) > 20_000_000:
        return "rural"
    return "urban"


async def upsert_tract_row(session: AsyncSession, row: Any, geoid_col: str) -> None:
    gid = str(row[geoid_col])
    geom: Polygon | MultiPolygon | None = row.geometry
    if geom is None or geom.is_empty:
        return
    if isinstance(geom, Polygon):
        geom = MultiPolygon([geom])
    centroid = geom.centroid
    aland = float(row["ALAND"]) if "ALAND" in row and row["ALAND"] is not None else None
    name = row.get("NAMELSAD") or row.get("NAME")
    county_fp = str(row["COUNTYFP"]).zfill(3)
    t = await session.get(Tract, gid)
    if t is None:
        t = Tract(
            geoid=gid,
            name=str(name) if name is not None else None,
            state_fips=str(row["STATEFP"]).zfill(2),
            county_fips=county_fp,
            county_name=None,
            place_name=None,
            urban_rural=urban_rural_class(aland),
            centroid_lat=float(centroid.y),
            centroid_lon=float(centroid.x),
            geometry=from_shape(geom, srid=4326),
        )
        session.add(t)
    else:
        t.name = str(name) if name is not None else t.name
        t.centroid_lat = float(centroid.y)
        t.centroid_lon = float(centroid.x)
        t.geometry = from_shape(geom, srid=4326)
        t.urban_rural = urban_rural_class(aland)


async def replace_indicators(
    session: AsyncSession,
    geoid: str,
    rows: list[tuple[str, str, float, int]],
) -> None:
    await session.execute(delete(Indicator).where(Indicator.geoid == geoid, Indicator.year == DATA_YEAR))
    for source, metric, value, year in rows:
        session.add(
            Indicator(
                geoid=geoid,
                source=source,
                metric_name=metric,
                value=value,
                year=year,
                percentile_national=None,
                percentile_state=None,
            )
        )


async def update_percentiles(session: AsyncSession, year: int) -> None:
    q = await session.execute(
        select(Indicator, Tract.state_fips)
        .join(Tract, Tract.geoid == Indicator.geoid)
        .where(Indicator.year == year, Indicator.metric_name.in_(METRIC_KEYS))
    )
    by_metric: dict[str, list[tuple[str, str, float]]] = defaultdict(list)
    for ind, sf in q.all():
        if ind.value is None:
            continue
        by_metric[ind.metric_name].append((ind.geoid, sf, float(ind.value)))

    updates: dict[tuple[str, str, int], tuple[float, float]] = {}

    for metric, rows in by_metric.items():
        nat_vals = [v for _, _, v in rows]
        by_state: dict[str, list[float]] = defaultdict(list)
        for _, sf, v in rows:
            by_state[sf].append(v)
        for geoid, sf, v in rows:
            pn = _percentile_rank(nat_vals, v)
            st_vals = by_state.get(sf, [])
            ps = _percentile_rank(st_vals, v) if st_vals else pn
            updates[(geoid, metric, year)] = (pn, ps)

    q2 = await session.execute(
        select(Indicator).where(Indicator.year == year, Indicator.metric_name.in_(METRIC_KEYS))
    )
    for ind in q2.scalars().all():
        key = (ind.geoid, ind.metric_name, ind.year)
        if key in updates:
            pn, ps = updates[key]
            ind.percentile_national = pn
            ind.percentile_state = ps


async def run_ingest(states: list[str]) -> None:
    engine = create_async_engine(settings.database_url, echo=False)
    async_session = async_sessionmaker(engine, expire_on_commit=False)

    census_key = os.environ.get("CENSUS_API_KEY") or settings.census_api_key
    cdc_token = os.environ.get("CDC_API_KEY") or settings.cdc_api_key

    async with async_session() as session:
        abbrs = [STATE_FP_TO_ABBR[s.zfill(2)] for s in states]

        async with httpx.AsyncClient(timeout=120.0) as http:
            log.info("Fetching PLACES…")
            places = await fetch_places_states(http, abbrs, cdc_token)
            log.info("PLACES rows: %s", len(places))

            for sf in states:
                sf = sf.zfill(2)
                log.info("State %s: ACS + TIGER", sf)
                acs = await fetch_acs_state(http, sf, census_key)
                gdf = await load_tiger_tracts(http, sf)
                geoid_col = "GEOID20" if "GEOID20" in gdf.columns else "GEOID"

                for _, row in gdf.iterrows():
                    await upsert_tract_row(session, row, geoid_col)
                await session.commit()

                for _, row in gdf.iterrows():
                    gid = str(row[geoid_col])
                    a = acs.get(gid, {})
                    p = places.get(gid, {})
                    geom = row.geometry
                    lat = float(geom.centroid.y) if geom is not None else None
                    heat = heat_from_lat(lat)

                    rows: list[tuple[str, str, float, int]] = []
                    if "rent_burden_pct" in a:
                        rows.append(("census_acs", "rent_burden_pct", a["rent_burden_pct"], DATA_YEAR))
                    if "overcrowding_pct" in a:
                        rows.append(("census_acs", "overcrowding_pct", a["overcrowding_pct"], DATA_YEAR))
                    if "vacancy_rate" in a:
                        rows.append(("census_acs", "vacancy_rate", a["vacancy_rate"], DATA_YEAR))
                    for k in ("asthma_pct", "uninsured_pct", "disability_pct"):
                        if k in p:
                            rows.append(("cdc_places", k, p[k], DATA_YEAR))
                    rows.append(("computed", "heat_index", heat, DATA_YEAR))

                    present = {r[1] for r in rows}
                    if all(m in present for m in METRIC_KEYS):
                        await replace_indicators(session, gid, rows)

                await session.commit()

        log.info("Percentiles…")
        await update_percentiles(session, DATA_YEAR)
        await session.commit()

        log.info("Risk scores…")
        n = await recalculate_risk_scores(session, DATA_YEAR)
        log.info("Computed risk scores for %s tracts", n)

    await engine.dispose()


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--states",
        default="06,12,17,36,48",
        help="Comma-separated state FIPS (default: CA, FL, IL, NY, TX)",
    )
    args = p.parse_args()
    states = [s.strip().zfill(2) for s in args.states.split(",") if s.strip()]
    asyncio.run(run_ingest(states))


if __name__ == "__main__":
    main()
