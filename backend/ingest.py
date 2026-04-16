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
import random
import tempfile
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Any

import geopandas as gpd
import pandas as pd
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
    # Census/Cloudflare sometimes returns HTTP 200 with an HTML "Request Rejected" page instead of a ZIP.
    if not content.startswith(b"PK"):
        preview = content[:400].decode("utf-8", errors="replace")
        raise ValueError(
            "Expected a ZIP shapefile from Census (bytes starting with PK), but got non-ZIP content. "
            f"Preview: {preview!r}"
        )
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


async def _download_binary(
    client: httpx.AsyncClient,
    url: str,
    *,
    timeout: float = 600.0,
    max_retries: int = 6,
) -> bytes:
    """
    Census TIGER downloads are large; connections often drop mid-body (RemoteProtocolError).
    Retry with exponential backoff (Census / Cloudflare often reset long transfers).
    """
    last_exc: BaseException | None = None
    for attempt in range(max_retries):
        try:
            r = await client.get(url, timeout=timeout)
            r.raise_for_status()
            return r.content
        except httpx.HTTPStatusError as e:
            last_exc = e
            if e.response.status_code not in (502, 503, 504) or attempt == max_retries - 1:
                raise
        except (
            httpx.RemoteProtocolError,
            httpx.ReadTimeout,
            httpx.ConnectError,
            httpx.ConnectTimeout,
            httpx.WriteError,
        ) as e:
            last_exc = e
            if attempt == max_retries - 1:
                raise
        wait = min(2**attempt + random.uniform(0, 2), 60.0)
        log.warning(
            "Download attempt %s/%s failed for %s: %s — retrying in %.1fs",
            attempt + 1,
            max_retries,
            url,
            last_exc,
            wait,
        )
        await asyncio.sleep(wait)
    raise RuntimeError("_download_binary: exhausted retries without raising")


async def load_tiger_tracts(client: httpx.AsyncClient, state_fips: str) -> gpd.GeoDataFrame:
    url = f"https://www2.census.gov/geo/tiger/TIGER{TIGER_YEAR}/TRACT/tl_{TIGER_YEAR}_{state_fips}_tract.zip"
    log.info("Downloading TIGER %s", url)
    content = await _download_binary(client, url, timeout=600.0)
    return await asyncio.to_thread(_read_tiger_gdf_from_zip, content)


async def load_tiger_us_counties(client: httpx.AsyncClient) -> gpd.GeoDataFrame:
    """Nationwide county file (state-specific county URLs often return HTML instead of ZIP)."""
    url = f"https://www2.census.gov/geo/tiger/TIGER{TIGER_YEAR}/COUNTY/tl_{TIGER_YEAR}_us_county.zip"
    log.info("Downloading TIGER US counties %s", url)
    content = await _download_binary(client, url, timeout=600.0)
    return await asyncio.to_thread(_read_tiger_gdf_from_zip, content)


async def load_tiger_places(client: httpx.AsyncClient, state_fips: str) -> gpd.GeoDataFrame:
    url = f"https://www2.census.gov/geo/tiger/TIGER{TIGER_YEAR}/PLACE/tl_{TIGER_YEAR}_{state_fips}_place.zip"
    log.info("Downloading TIGER places %s", url)
    content = await _download_binary(client, url, timeout=600.0)
    return await asyncio.to_thread(_read_tiger_gdf_from_zip, content)


def _county_lookup_from_gdf(county_gdf: gpd.GeoDataFrame) -> dict[tuple[str, str], str]:
    out: dict[tuple[str, str], str] = {}
    for _, crow in county_gdf.iterrows():
        st = str(crow["STATEFP"]).zfill(2)
        co = str(crow["COUNTYFP"]).zfill(3)
        nm = crow.get("NAME") or crow.get("NAMELSAD")
        if nm is not None and str(nm).strip():
            out[(st, co)] = str(nm).strip()
    return out


def _place_by_tract_geoid(
    tract_gdf: gpd.GeoDataFrame,
    place_gdf: gpd.GeoDataFrame,
    geoid_col: str,
) -> dict[str, str]:
    """Map tract GEOID → place name (incorporated place / CDP) via centroid-in-polygon."""
    if tract_gdf.empty or place_gdf.empty:
        return {}
    if tract_gdf.crs != place_gdf.crs:
        place_gdf = place_gdf.to_crs(tract_gdf.crs)
    tg = tract_gdf[[geoid_col, "geometry"]].copy()
    pts = tg.copy()
    pts["geometry"] = tg.geometry.centroid
    name_col = "NAME" if "NAME" in place_gdf.columns else "NAMELSAD"
    pj = place_gdf[[name_col, "geometry"]].copy()
    joined = gpd.sjoin(pts, pj, how="left", predicate="within")
    out: dict[str, str] = {}
    for gid, grp in joined.groupby(geoid_col):
        row = grp.iloc[0]
        nm = row.get(name_col)
        if pd.isna(nm):
            continue
        s = str(nm).strip()
        if s:
            out[str(gid)] = s
    return out


def urban_rural_class(aland: float | None) -> str:
    if aland is None:
        return "unknown"
    if float(aland) > 20_000_000:
        return "rural"
    return "urban"


async def upsert_tract_row(
    session: AsyncSession,
    row: Any,
    geoid_col: str,
    *,
    county_name: str | None = None,
) -> None:
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
            county_name=county_name,
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
        if county_name is not None:
            t.county_name = county_name


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

        async with httpx.AsyncClient(timeout=600.0) as http:
            log.info("Fetching PLACES…")
            places = await fetch_places_states(http, abbrs, cdc_token)
            log.info("PLACES rows: %s", len(places))

            log.info("Loading TIGER US county boundaries (once)…")
            us_county_gdf = await load_tiger_us_counties(http)

            for sf in states:
                sf = sf.zfill(2)
                log.info("State %s: ACS + TIGER", sf)
                acs = await fetch_acs_state(http, sf, census_key)
                gdf = await load_tiger_tracts(http, sf)
                geoid_col = "GEOID20" if "GEOID20" in gdf.columns else "GEOID"

                county_gdf = us_county_gdf[us_county_gdf["STATEFP"].astype(str).str.zfill(2) == sf].copy()
                county_lookup = _county_lookup_from_gdf(county_gdf)
                try:
                    place_gdf = await load_tiger_places(http, sf)
                    place_by_geoid = _place_by_tract_geoid(gdf, place_gdf, geoid_col)
                except Exception as e:
                    log.warning("TIGER places for state %s failed (%s); place_name will stay empty for this state", sf, e)
                    place_by_geoid = {}

                for _, row in gdf.iterrows():
                    st = str(row["STATEFP"]).zfill(2)
                    co = str(row["COUNTYFP"]).zfill(3)
                    cn = county_lookup.get((st, co))
                    await upsert_tract_row(session, row, geoid_col, county_name=cn)
                await session.commit()

                for gid, pname in place_by_geoid.items():
                    t = await session.get(Tract, gid)
                    if t is not None:
                        t.place_name = pname
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
