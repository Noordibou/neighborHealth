#!/usr/bin/env python3
"""
Idempotent ingestion pipeline for NeighborHealth.

Sources:
- U.S. Census TIGER/Line tract boundaries (vintage matches ``--year``)
- ACS 5-year detail tables B25070, B25014, B25002, B25058, B19013 via Census API (vintage ``--year``)
- ACS 5-year tract demographics (B01001, B01002, B03002, C16001, B05001, B15003) → tract_demographics
- CDC PLACES tract estimates (dataset ID depends on ``--year``; stored on indicator / risk_score rows)

Usage:
  cd backend && python ingest.py --states 06,12,17,36,48
  cd backend && python ingest.py --states 48 --year 2021

Environment:
  CENSUS_API_KEY (optional, raises rate limits)
  DATABASE_URL (async URL postgresql+asyncpg://...)
"""

from __future__ import annotations

import argparse
import asyncio
import codecs
import csv
import io
import logging
import math
import os
import random
import subprocess
import tempfile
import zipfile
from collections import defaultdict
from datetime import datetime, timezone

import certifi

# Use the system CA bundle when present (Linux/WSL/Docker) — it includes intermediate CAs
# that certifi may lack (e.g. CDC Socrata). Fall back to certifi on other platforms.
_SSL_CA_BUNDLE: str = (
    "/etc/ssl/certs/ca-certificates.crt"
    if os.path.isfile("/etc/ssl/certs/ca-certificates.crt")
    else certifi.where()
)
from pathlib import Path
from typing import Any, AsyncIterator

import geopandas as gpd
import pandas as pd
import httpx
from geoalchemy2.shape import from_shape
from shapely.geometry import MultiPolygon, Polygon
from sqlalchemy import delete, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.models import Clinic, Indicator, Tract, TractClinic, TractDemographics
from app.services.risk_score import METRIC_KEYS
from app.services.score_recalc import invalidate_metric_map_cache, recalculate_risk_scores

# Stored in the indicators table for display on the tract profile, but excluded from
# composite scoring and percentile computation (update_percentiles only ranks METRIC_KEYS).
DISPLAY_ONLY_METRICS: frozenset[str] = frozenset({
    "obesity_pct",
    "depression_pct",
    "cognitive_difficulty_pct",
    "mobility_difficulty_pct",
    "smoking_pct",
    "dental_visits_pct",
    "diabetes_pct",
    "physical_inactivity_pct",
    "hypertension_pct",
    "insufficient_sleep_pct",
    "all_teeth_lost_pct",
})


class IngestPartialFailureError(Exception):
    """Raised when one or more states fail during ingest but others succeed."""

    def __init__(self, failed_states: list[str]) -> None:
        self.failed_states = failed_states
        super().__init__(
            f"Ingest completed with {len(failed_states)} failed state(s): {failed_states}"
        )


logging.basicConfig(level=logging.INFO)
log = logging.getLogger("ingest")

# api.census.gov streams large tract JSON; a plain 600s float can still hit ReadTimeout on slow
# networks. Use an explicit read budget + retries in `_acs_get_json_with_retry`.
_ACS_HTTP_TIMEOUT = httpx.Timeout(connect=60.0, read=1800.0, write=120.0, pool=120.0)


async def _acs_get_json_with_retry(
    client: httpx.AsyncClient,
    url: str,
    *,
    params: dict[str, Any],
    max_retries: int = 5,
) -> Any:
    """GET JSON from the Census ACS API with exponential backoff (timeouts / 5xx are common)."""
    last_exc: BaseException | None = None
    for attempt in range(max_retries):
        try:
            r = await client.get(url, params=params, timeout=_ACS_HTTP_TIMEOUT)
            r.raise_for_status()
            return r.json()
        except httpx.HTTPStatusError as e:
            last_exc = e
            if e.response.status_code not in (502, 503, 504) or attempt == max_retries - 1:
                raise
        except (
            httpx.ReadTimeout,
            httpx.ConnectError,
            httpx.ConnectTimeout,
            httpx.RemoteProtocolError,
            httpx.WriteError,
        ) as e:
            last_exc = e
            if attempt == max_retries - 1:
                raise
        wait = min(2**attempt + random.uniform(0, 2), 60.0)
        log.warning(
            "Census ACS GET attempt %s/%s failed (%s): %s — retrying in %.1fs",
            attempt + 1,
            max_retries,
            url,
            last_exc,
            wait,
        )
        await asyncio.sleep(wait)
    raise RuntimeError("_acs_get_json_with_retry: exhausted retries without raising")


_PLACES_RETRY_BACKOFF_SECS: tuple[float, ...] = (2.0, 4.0, 8.0, 16.0)


async def _places_get_json_with_retry(
    client: httpx.AsyncClient,
    url: str,
    *,
    params: dict[str, Any],
    headers: dict[str, str] | None = None,
    max_retries: int = 5,
) -> Any:
    """GET JSON from CDC PLACES (Socrata) with exponential backoff (timeouts / 429 / 5xx)."""
    last_exc: BaseException | None = None
    for attempt in range(max_retries):
        try:
            r = await client.get(url, params=params, headers=headers or {})
            r.raise_for_status()
            return r.json()
        except httpx.TimeoutException as e:
            last_exc = e
            if attempt == max_retries - 1:
                raise
        except httpx.HTTPStatusError as e:
            last_exc = e
            sc = e.response.status_code
            if sc != 429 and not (500 <= sc < 600):
                raise
            if attempt == max_retries - 1:
                raise
        wait = _PLACES_RETRY_BACKOFF_SECS[attempt]
        log.warning(
            "PLACES GET attempt %s/%s failed (%s): %s — retrying in %.1fs",
            attempt + 1,
            max_retries,
            url,
            last_exc,
            wait,
        )
        await asyncio.sleep(wait)
    raise RuntimeError("_places_get_json_with_retry: exhausted retries without raising")


# Socrata dataset IDs for PLACES census-tract data (verify with ``curl`` or browser):
#   ``https://chronicdata.cdc.gov/resource/{id}.json?$limit=1``
PLACES_DATASET_BY_YEAR: dict[int, str] = {
    # ``4ai3-zynv`` is long-form (one row per measure) and has ``locationid``, not ``tractfips``;
    # it also omits a disability crude measure our ingest expects. Use the wide tract file for 2020 too.
    2020: "hky2-3tpn",
    # Verified HTTP 200: https://chronicdata.cdc.gov/resource/hky2-3tpn.json?$limit=1
    2021: "hky2-3tpn",
    # Verified HTTP 200: https://chronicdata.cdc.gov/resource/hky2-3tpn.json?$limit=1
    2022: "hky2-3tpn",
    # Same resource as 2022 until CDC publishes a newer tract file; re-check vintage on chronicdata.cdc.gov.
    2023: "hky2-3tpn",
    2024: "hky2-3tpn",
}

DOCKER_INGEST_DATABASE_URL = "postgresql+asyncpg://neighborhealth:neighborhealth@localhost:5432/neighborhealth"


def _cli_analysis_year(raw: str) -> int:
    """Validate ``--year`` before any HTTP or DB work (Census ACS 5-year must exist on api.census.gov)."""
    y = int(raw, 10)
    if y < 2020 or y > 2024:
        raise argparse.ArgumentTypeError(
            f"{y} is not supported: ACS 5-year tract data is only wired for 2020–2024 "
            f"(got {y}; Census returns 404 for /data/{y}/acs/acs5 until that vintage is published)."
        )
    return y


# HRSA Health Center Program + Look-Alike site list (CSV). Legacy
# ``/api/download?filename=HCSODSite_DATA_MAIN.csv`` returns an HTML error page after the site redesign.
_DEFAULT_HRSA_SITES_CSV_URL = (
    "https://data.hrsa.gov/DataDownload/DD_Files/Health_Center_Service_Delivery_and_LookAlike_Sites.csv"
)

# Human-readable column titles in the current HRSA CSV (confirmed 2026-05).
_HRSA_COL_BPHC = "BPHC Assigned Number"
_HRSA_COL_LOC_ID = "Health Center Location Identification Number"
_HRSA_COL_SITE_NAME = "Site Name"
_HRSA_COL_ADDRESS = "Site Address"
_HRSA_COL_CITY = "Site City"
_HRSA_COL_ZIP = "Site Postal Code"
_HRSA_COL_STATUS = "Site Status Description"
_HRSA_COL_TYPE = "Health Center Type Description"
_HRSA_COL_STATE_FIPS = "State FIPS Code"
_HRSA_COL_LAT = "Geocoding Artifact Address Primary Y Coordinate"
_HRSA_COL_LON = "Geocoding Artifact Address Primary X Coordinate"


def _places_dataset_for_year(year: int) -> str:
    """Return the chronicdata.cdc.gov Socrata dataset ID for the requested PLACES vintage."""
    try:
        return PLACES_DATASET_BY_YEAR[year]
    except KeyError as e:
        raise ValueError(f"No PLACES dataset configured for year {year}.") from e


def heat_from_lat(lat: float | None) -> float:
    """Heat-risk index 0–100 from latitude (warmer south → higher)."""
    if lat is None or (isinstance(lat, float) and math.isnan(lat)):
        return 50.0
    return max(0.0, min(100.0, 150.0 - 3.0 * float(lat)))



def _acs_pct_moe_from_denominator_moe(
    row: list[str],
    header: list[str],
    moe_col: str,
    denom_col: str,
    computed_pct: float,
) -> float | None:
    """Approximate MOE for an ACS-derived % using MOE(denominator) / estimate(denominator) * computed_pct."""
    try:
        i_d = header.index(denom_col)
        den = float(row[i_d])
        if den <= 0:
            return None
        raw = row[header.index(moe_col)]
        if raw in (None, "", "-666666666", "-555555555"):
            return None
        moe_d = float(raw)
        if moe_d < 0:
            return None
        return (moe_d / den) * computed_pct
    except (ValueError, KeyError, IndexError, ZeroDivisionError, TypeError):
        return None


def _acs_estimate_float(row: list[str], header: list[str], col: str) -> float | None:
    """ACS estimate column; returns None for suppressed or invalid cells."""
    try:
        raw = row[header.index(col)]
    except (ValueError, IndexError):
        return None
    if raw in (None, "", "-666666666", "-555555555"):
        return None
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return None
    return v


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _docker_db_is_running() -> bool:
    """Return True when docker compose service 'db' is currently running."""
    compose_file = _repo_root() / "docker-compose.yml"
    if not compose_file.exists():
        return False
    try:
        p = subprocess.run(
            ["docker", "compose", "-f", str(compose_file), "ps", "--services", "--filter", "status=running"],
            cwd=str(_repo_root()),
            check=False,
            capture_output=True,
            text=True,
            timeout=4,
        )
    except (FileNotFoundError, subprocess.SubprocessError):
        return False
    if p.returncode != 0:
        return False
    running = {line.strip() for line in p.stdout.splitlines() if line.strip()}
    return "db" in running


def _ingest_database_url() -> str:
    """Prefer the Docker DB when it's running to avoid writing to the wrong Postgres."""
    if os.path.exists("/.dockerenv"):
        return os.environ.get("DATABASE_URL") or settings.database_url
    if _docker_db_is_running():
        return os.environ.get("DOCKER_INGEST_DATABASE_URL") or DOCKER_INGEST_DATABASE_URL
    return os.environ.get("DATABASE_URL") or settings.database_url


async def fetch_acs_state(
    client: httpx.AsyncClient, state_fips: str, census_key: str | None, year: int
) -> dict[str, dict[str, Any]]:
    base = f"https://api.census.gov/data/{year}/acs/acs5"
    params_base: dict[str, Any] = {"for": "tract:*", "in": f"state:{state_fips}"}
    if census_key:
        params_base["key"] = census_key

    async def _get(group: str) -> list[list[Any]]:
        params = {**params_base, "get": f"group({group})"}
        return await _acs_get_json_with_retry(client, base, params=params)

    j70, j14, j02, j04, j58, j13 = await asyncio.gather(
        _get("B25070"),
        _get("B25014"),
        _get("B25002"),
        _get("B25004"),
        _get("B25058"),
        _get("B19013"),
    )

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
    h04, rows04 = j04[0], j04[1:]
    h58, rows58 = j58[0], j58[1:]
    h13, rows13 = j13[0], j13[1:]

    # B25004_006E: seasonal / recreational / occasional-use vacancies — excluded from structural vacancy
    seasonal_by_gid: dict[str, float] = {}
    for row in rows04:
        gid = geoid_from_row(h04, row)
        cell = row[idx(h04, "B25004_006E")]
        if cell not in (None, "", "-666666666", "-555555555"):
            try:
                seasonal_by_gid[gid] = float(cell)
            except (ValueError, TypeError):
                pass

    out: dict[str, dict[str, Any]] = {}

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
            computed = 100.0 * high / total
            moe_pct = _acs_pct_moe_from_denominator_moe(
                row, h70, "B25070_001M", "B25070_001E", computed
            )
            out.setdefault(gid, {})["rent_burden_pct"] = (computed, moe_pct)
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
            computed = 100.0 * crowded / tot
            moe_pct = _acs_pct_moe_from_denominator_moe(
                row, h14, "B25014_001M", "B25014_001E", computed
            )
            out.setdefault(gid, {})["overcrowding_pct"] = (computed, moe_pct)
        except (ValueError, KeyError, ZeroDivisionError):
            continue

    for row in rows02:
        gid = geoid_from_row(h02, row)
        try:
            hu = float(row[idx(h02, "B25002_001E")])
            vac = float(row[idx(h02, "B25002_003E")])
            if hu <= 0:
                continue
            structural_vacant = max(0.0, vac - seasonal_by_gid.get(gid, 0.0))
            computed = 100.0 * structural_vacant / hu
            moe_pct = _acs_pct_moe_from_denominator_moe(
                row, h02, "B25002_001M", "B25002_001E", computed
            )
            out.setdefault(gid, {})["structural_vacancy_rate"] = (computed, moe_pct)
        except (ValueError, KeyError, ZeroDivisionError):
            continue

    for row in rows58:
        gid = geoid_from_row(h58, row)
        out.setdefault(gid, {})["median_rent"] = _acs_estimate_float(row, h58, "B25058_001E")

    for row in rows13:
        gid = geoid_from_row(h13, row)
        out.setdefault(gid, {})["median_household_income"] = _acs_estimate_float(row, h13, "B19013_001E")

    return out


# ACS tract demographics (same vintage as analysis ``year``); single GET per state.
ACS_NO_HS_COLS = [f"B15003_{i:03d}E" for i in range(2, 17)]
ACS_DEMOGRAPHICS_VARS = [
    "B01001_001E",
    "B26001_001E",
    "B01002_001E",
    "B03002_001E",
    "B03002_003E",
    "B03002_004E",
    "B03002_006E",
    "B03002_012E",
    "B05001_001E",
    "B05001_006E",
    "B15003_001E",
    *ACS_NO_HS_COLS,
]

# C16001 (collapsed language table) is used instead of B16001 because B16001 has 100+
# variables and the Census API silently returns null for all tract-level rows when B16001
# is requested, even in a dedicated GET.  C16001_001E = total pop 5+, C16001_002E = English-only.
ACS_LANG_VARS = ["C16001_001E", "C16001_002E"]


def _tract_demographics_from_acs_row(header: list[str], row: list[str]) -> dict[str, float | None]:
    """Map ACS cells to tract_demographics columns (percents 0–100). None if invalid/suppressed."""

    total_population = _acs_estimate_float(row, header, "B01001_001E")
    group_quarters_pop = _acs_estimate_float(row, header, "B26001_001E")
    median_age = _acs_estimate_float(row, header, "B01002_001E")

    pct_white: float | None = None
    pct_black: float | None = None
    pct_hispanic: float | None = None
    pct_asian: float | None = None
    pct_other_race: float | None = None

    d_race = _acs_estimate_float(row, header, "B03002_001E")
    if d_race is not None and d_race > 0:
        num_w = _acs_estimate_float(row, header, "B03002_003E")
        num_b = _acs_estimate_float(row, header, "B03002_004E")
        num_h = _acs_estimate_float(row, header, "B03002_012E")
        num_a = _acs_estimate_float(row, header, "B03002_006E")
        if num_w is not None:
            pct_white = 100.0 * num_w / d_race
        if num_b is not None:
            pct_black = 100.0 * num_b / d_race
        if num_h is not None:
            pct_hispanic = 100.0 * num_h / d_race
        if num_a is not None:
            pct_asian = 100.0 * num_a / d_race
        if all(v is not None for v in (pct_white, pct_black, pct_hispanic, pct_asian)):
            pct_other_race = max(
                0.0,
                100.0 - float(pct_white) - float(pct_black) - float(pct_hispanic) - float(pct_asian),
            )

    pct_non_english_home: float | None = None  # merged from dedicated C16001 request in caller

    pct_foreign_born: float | None = None
    d_cit = _acs_estimate_float(row, header, "B05001_001E")
    non_cit = _acs_estimate_float(row, header, "B05001_006E")
    if d_cit is not None and d_cit > 0 and non_cit is not None:
        pct_foreign_born = 100.0 * non_cit / d_cit

    pct_no_hs_diploma: float | None = None
    d_ed = _acs_estimate_float(row, header, "B15003_001E")
    if d_ed is not None and d_ed > 0:
        parts: list[float] = []
        bad = False
        for col in ACS_NO_HS_COLS:
            v = _acs_estimate_float(row, header, col)
            if v is None:
                bad = True
                break
            parts.append(v)
        if not bad:
            pct_no_hs_diploma = 100.0 * sum(parts) / d_ed

    return {
        "total_population": total_population,
        "group_quarters_pop": group_quarters_pop,
        "median_age": median_age,
        "pct_white": pct_white,
        "pct_black": pct_black,
        "pct_hispanic": pct_hispanic,
        "pct_asian": pct_asian,
        "pct_other_race": pct_other_race,
        "pct_non_english_home": pct_non_english_home,
        "pct_foreign_born": pct_foreign_born,
        "pct_no_hs_diploma": pct_no_hs_diploma,
    }


async def fetch_acs_demographics(
    session: AsyncSession, states: list[str], year: int, census_key: str | None
) -> None:
    """Fetch ACS demographic tables per state and upsert tract_demographics for ``year``.

    Requests are scoped **per county** (`in=state:XX+county:YYY`). A single statewide
    `tract:*` call can omit rows for large states or hit undocumented response limits;
    county batches match Census guidance and reliably cover every tract we store.

    C16001 (collapsed language spoken at home) is fetched in a separate statewide GET.
    B16001 (the full 100+ variable table) returns null for all tract-level rows despite
    a 200 response. C16001 has the same total/English-only variables and works correctly.
    The two responses are merged by GEOID before writing to tract_demographics.
    """
    base = f"https://api.census.gov/data/{year}/acs/acs5"
    get_param = ",".join(ACS_DEMOGRAPHICS_VARS)
    lang_get_param = ",".join(ACS_LANG_VARS)

    def geoid_from_acs_row(h: list[str], row: list[str]) -> str:
        i_state = h.index("state")
        i_co = h.index("county")
        i_tr = h.index("tract")
        st = row[i_state].zfill(2)
        co = row[i_co].zfill(3)
        tr = row[i_tr].zfill(6)
        return st + co + tr

    async with httpx.AsyncClient(timeout=_ACS_HTTP_TIMEOUT, verify=_SSL_CA_BUNDLE) as client:
        for sf_raw in states:
            sf = sf_raw.zfill(2)
            log.info("State %s: ACS demographics (by county)", sf)
            tract_geoids = set(
                (await session.scalars(select(Tract.geoid).where(Tract.state_fips == sf))).all()
            )
            if not tract_geoids:
                continue

            # Call B: statewide C16001 request, isolated from the county-batched Call A.
            # On failure, all tracts in this state get pct_non_english_home = None.
            lang_by_geoid: dict[str, float | None] = {}
            try:
                lang_params: dict[str, Any] = {
                    "get": lang_get_param,
                    "for": "tract:*",
                    "in": f"state:{sf}",
                }
                if census_key:
                    lang_params["key"] = census_key
                lang_data = await _acs_get_json_with_retry(client, base, params=lang_params)
                if lang_data and len(lang_data) >= 2:
                    lh: list[str] = lang_data[0]
                    for lang_row in lang_data[1:]:
                        gid = geoid_from_acs_row(lh, lang_row)
                        d_lang = _acs_estimate_float(lang_row, lh, "C16001_001E")
                        eng_only = _acs_estimate_float(lang_row, lh, "C16001_002E")
                        pct: float | None = None
                        if d_lang is not None and d_lang > 0 and eng_only is not None:
                            pct = (1.0 - eng_only / d_lang) * 100.0
                        lang_by_geoid[gid] = pct
                    log.info("State %s: C16001 loaded for %s tracts", sf, len(lang_by_geoid))
                else:
                    log.warning(
                        "State %s: C16001 statewide request returned no data; "
                        "pct_non_english_home will be NULL for this state",
                        sf,
                    )
            except Exception as e:
                log.warning(
                    "State %s: C16001 statewide request failed (%s); "
                    "pct_non_english_home will be NULL for this state",
                    sf,
                    e,
                )

            county_rows = (
                await session.execute(
                    select(Tract.county_fips).where(Tract.state_fips == sf).distinct().order_by(Tract.county_fips)
                )
            ).all()

            # Null counters for per-state post-processing validation.
            _demog_cols = (
                "total_population", "median_age", "pct_white", "pct_black",
                "pct_hispanic", "pct_asian", "pct_other_race", "pct_non_english_home",
                "pct_foreign_born", "pct_no_hs_diploma",
            )
            null_counts: dict[str, int] = {c: 0 for c in _demog_cols}
            row_count = 0

            for (county_fips,) in county_rows:
                co = str(county_fips).zfill(3)
                params: dict[str, Any] = {
                    "get": get_param,
                    "for": "tract:*",
                    "in": f"state:{sf}+county:{co}",
                }
                if census_key:
                    params["key"] = census_key
                data = await _acs_get_json_with_retry(client, base, params=params)
                if not data or len(data) < 2:
                    continue
                header: list[str] = data[0]
                for row in data[1:]:
                    gid = geoid_from_acs_row(header, row)
                    if gid not in tract_geoids:
                        continue
                    cols = _tract_demographics_from_acs_row(header, row)

                    # Merge B16001 result from the dedicated statewide request.
                    cols["pct_non_english_home"] = lang_by_geoid.get(gid)

                    row_count += 1
                    for col in _demog_cols:
                        if cols.get(col) is None:
                            null_counts[col] += 1

                    existing = await session.get(TractDemographics, (gid, year))
                    if existing is None:
                        session.add(
                            TractDemographics(
                                geoid=gid,
                                year=year,
                                total_population=cols["total_population"],
                                median_age=cols["median_age"],
                                pct_white=cols["pct_white"],
                                pct_black=cols["pct_black"],
                                pct_hispanic=cols["pct_hispanic"],
                                pct_asian=cols["pct_asian"],
                                pct_other_race=cols["pct_other_race"],
                                pct_non_english_home=cols["pct_non_english_home"],
                                pct_foreign_born=cols["pct_foreign_born"],
                                pct_no_hs_diploma=cols["pct_no_hs_diploma"],
                            )
                        )
                    else:
                        existing.total_population = cols["total_population"]
                        existing.median_age = cols["median_age"]
                        existing.pct_white = cols["pct_white"]
                        existing.pct_black = cols["pct_black"]
                        existing.pct_hispanic = cols["pct_hispanic"]
                        existing.pct_asian = cols["pct_asian"]
                        existing.pct_other_race = cols["pct_other_race"]
                        existing.pct_non_english_home = cols["pct_non_english_home"]
                        existing.pct_foreign_born = cols["pct_foreign_born"]
                        existing.pct_no_hs_diploma = cols["pct_no_hs_diploma"]
                    tract_row = await session.get(Tract, gid)
                    if tract_row is not None:
                        tract_row.population = cols["total_population"]
                        tract_row.is_institutional = compute_is_institutional(
                            tract_row.name,
                            cols.get("group_quarters_pop"),
                            cols["total_population"],
                        )
            await session.commit()

            # Validation: warn if any demographic column is >50% null for this state/year.
            if row_count > 0:
                for col, n_null in null_counts.items():
                    pct_null = 100.0 * n_null / row_count
                    if pct_null > 50.0:
                        log.warning(
                            "State %s year %s: %s is %.1f%% null (%s/%s tracts) — "
                            "check Census API response for this variable",
                            sf, year, col, pct_null, n_null, row_count,
                        )


def _places_float(row: dict[str, Any], field: str) -> float | None:
    """Parse a PLACES Socrata field to float, returning None for blank/missing/negative values."""
    v = row.get(field)
    if v is None or str(v).strip() == "":
        return None
    try:
        f = float(v)
        return None if f < 0 else f
    except (TypeError, ValueError):
        return None


async def fetch_places_states(
    client: httpx.AsyncClient,
    state_fips: list[str],
    app_token: str | None,
    places_dataset_id: str,
) -> dict[str, dict[str, float]]:
    base = f"https://chronicdata.cdc.gov/resource/{places_dataset_id}.json"
    headers = {}
    if app_token:
        headers["X-App-Token"] = app_token

    out: dict[str, dict[str, float]] = {}
    where_clause = "(" + " OR ".join([f"tractfips like '{s.zfill(2)}%'" for s in state_fips]) + ")"
    offset = 0
    page = 50000

    while True:
        params = {"$where": where_clause, "$limit": str(page), "$offset": str(offset)}
        rows = await _places_get_json_with_retry(client, base, params=params, headers=headers)
        if not rows:
            break
        for row in rows:
            tf = row.get("tractfips")
            if not tf or len(str(tf)) != 11:
                continue
            tf = str(tf)
            entry: dict[str, float] = {}
            asthma = _places_float(row, "casthma_crudeprev")
            unins = _places_float(row, "access2_crudeprev")
            disab = _places_float(row, "disability_crudeprev")
            mental = _places_float(row, "mhlth_crudeprev")
            if asthma is not None:
                entry["asthma_pct"] = asthma
            if unins is not None:
                entry["uninsured_pct"] = unins
            if disab is not None:
                entry["disability_pct"] = disab
            if mental is not None:
                entry["mental_health_pct"] = mental
            # Display-only PLACES metrics (best-effort; absent when column missing or blank).
            # mobility_crudeprev_ has a trailing underscore in the Socrata wide-format export.
            _display_cols: dict[str, str] = {
                "obesity_pct": "obesity_crudeprev",
                "depression_pct": "depression_crudeprev",
                "cognitive_difficulty_pct": "cognition_crudeprev",
                "mobility_difficulty_pct": "mobility_crudeprev_",
                "smoking_pct": "csmoking_crudeprev",
                "dental_visits_pct": "dental_crudeprev",
                "diabetes_pct": "diabetes_crudeprev",
                "physical_inactivity_pct": "lpa_crudeprev",
                "hypertension_pct": "bphigh_crudeprev",
                "insufficient_sleep_pct": "sleep_crudeprev",
                "all_teeth_lost_pct": "teethlost_crudeprev",
            }
            for metric_key, src_col in _display_cols.items():
                v = _places_float(row, src_col)
                if v is not None:
                    entry[metric_key] = v
            out[tf] = entry
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


async def load_tiger_tracts(client: httpx.AsyncClient, state_fips: str, tiger_year: str) -> gpd.GeoDataFrame:
    url = f"https://www2.census.gov/geo/tiger/TIGER{tiger_year}/TRACT/tl_{tiger_year}_{state_fips}_tract.zip"
    log.info("Downloading TIGER %s", url)
    content = await _download_binary(client, url, timeout=600.0)
    return await asyncio.to_thread(_read_tiger_gdf_from_zip, content)


async def load_tiger_us_counties(client: httpx.AsyncClient, tiger_year: str) -> gpd.GeoDataFrame:
    """Nationwide county file (state-specific county URLs often return HTML instead of ZIP)."""
    url = f"https://www2.census.gov/geo/tiger/TIGER{tiger_year}/COUNTY/tl_{tiger_year}_us_county.zip"
    log.info("Downloading TIGER US counties %s", url)
    content = await _download_binary(client, url, timeout=600.0)
    return await asyncio.to_thread(_read_tiger_gdf_from_zip, content)


async def load_tiger_places(client: httpx.AsyncClient, state_fips: str, tiger_year: str) -> gpd.GeoDataFrame:
    url = f"https://www2.census.gov/geo/tiger/TIGER{tiger_year}/PLACE/tl_{tiger_year}_{state_fips}_place.zip"
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
    if tg.crs is not None and tg.crs.is_geographic:
        # Compute centroids in a projected CRS to avoid geographic-CRS centroid distortion/warnings.
        tg_projected = tg.to_crs("EPSG:5070")
        pts = tg_projected.copy()
        pts["geometry"] = tg_projected.geometry.centroid
        pts = pts.to_crs(tg.crs)
    else:
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


def compute_is_institutional(name: object | None, gq: float | None, total: float | None) -> bool:
    """True if Census name marks institutional tracts or group quarters exceed half of population."""
    if name is not None and "institutional" in str(name).lower():
        return True
    # Zero-population tracts are redevelopment zones or temporary displacement areas;
    # treat as institutional so they are excluded from scoring.
    if total is not None and float(total) == 0:
        return True
    if gq is not None and total is not None and float(total) > 0:
        return float(gq) / float(total) > 0.5
    return False


async def upsert_tract_row(
    session: AsyncSession,
    row: Any,
    geoid_col: str,
    *,
    county_name: str | None = None,
    median_rent: float | None = None,
    median_household_income: float | None = None,
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
            median_rent=median_rent,
            median_household_income=median_household_income,
            is_institutional=compute_is_institutional(name, None, None),
            population=None,
            geometry=from_shape(geom, srid=4326),
        )
        session.add(t)
    else:
        t.name = str(name) if name is not None else t.name
        t.centroid_lat = float(centroid.y)
        t.centroid_lon = float(centroid.x)
        t.geometry = from_shape(geom, srid=4326)
        t.urban_rural = urban_rural_class(aland)
        t.median_rent = median_rent
        t.median_household_income = median_household_income
        if county_name is not None:
            t.county_name = county_name


async def replace_indicators(
    session: AsyncSession,
    geoid: str,
    rows: list[tuple[str, str, float, int, float | None]],
    year: int,
) -> None:
    await session.execute(delete(Indicator).where(Indicator.geoid == geoid, Indicator.year == year))
    for source, metric, value, year, value_moe in rows:
        session.add(
            Indicator(
                geoid=geoid,
                source=source,
                metric_name=metric,
                value=value,
                value_moe=value_moe,
                year=year,
                percentile_national=None,
                percentile_state=None,
                percentile_county=None,
            )
        )


async def update_percentiles(session: AsyncSession, year: int) -> None:
    """Compute national / state / county percentile ranks using SQL window functions.

    Replaces the former O(N²) Python loop (147K calls to a linear-scan helper).
    A single UPDATE ... FROM CTE delegates all ranking to PostgreSQL's
    PERCENT_RANK(), which runs in O(N log N) — typically under 1 second for
    the full national dataset.

    Tracts are joined for state_fips / county_fips only; geometry is excluded.
    """
    metrics_in = ", ".join(f"'{m}'" for m in sorted(METRIC_KEYS))
    sql = text(
        f"""
        WITH percentiles AS (
            SELECT
                i.id,
                PERCENT_RANK() OVER (
                    PARTITION BY i.metric_name
                    ORDER BY i.value ASC
                ) * 100 AS pn,
                PERCENT_RANK() OVER (
                    PARTITION BY i.metric_name, t.state_fips
                    ORDER BY i.value ASC
                ) * 100 AS ps,
                PERCENT_RANK() OVER (
                    PARTITION BY i.metric_name, t.state_fips, t.county_fips
                    ORDER BY i.value ASC
                ) * 100 AS pc
            FROM indicators i
            JOIN tracts t ON t.geoid = i.geoid
            WHERE i.year = :year
              AND i.metric_name IN ({metrics_in})
              AND i.value IS NOT NULL
        )
        UPDATE indicators
        SET percentile_national = percentiles.pn,
            percentile_state    = percentiles.ps,
            percentile_county   = percentiles.pc
        FROM percentiles
        WHERE indicators.id = percentiles.id
        """
    )
    await session.execute(sql, {"year": year})


_HRSA_OPERATIONAL_STATUSES = frozenset({"operational", "active"})


def _haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in miles (WGS84 sphere approximation)."""
    r_earth = 3958.8
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(
        dlon / 2
    ) ** 2
    return r_earth * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _hrsa_clip(s: str | None, max_len: int) -> str | None:
    if s is None:
        return None
    t = str(s).strip()
    if not t:
        return None
    return t[:max_len]


async def _iter_hrsa_csv_dict_rows(client: httpx.AsyncClient, url: str) -> AsyncIterator[dict[str, str]]:
    """Stream HRSA site CSV rows as dicts (UTF-8 safe across chunk boundaries)."""
    decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
    pending = ""
    header: list[str] | None = None
    first_chunk = True
    async with client.stream("GET", url, follow_redirects=True) as r:
        r.raise_for_status()
        ctype = (r.headers.get("content-type") or "").lower()
        if "html" in ctype:
            raise ValueError(
                f"HRSA sites URL returned Content-Type {ctype!r} (expected CSV). "
                "Set HRSA_SITES_CSV_URL to the current data.hrsa.gov CSV download."
            )
        async for chunk in r.aiter_bytes():
            if first_chunk and chunk:
                first_chunk = False
                stripped = chunk.lstrip()
                if stripped.startswith(b"<") or stripped.startswith(b"<!"):
                    raise ValueError(
                        "HRSA sites URL returned HTML, not CSV (legacy /api/download links may be retired). "
                        "Set HRSA_SITES_CSV_URL to the current data.hrsa.gov CSV download."
                    )
            pending += decoder.decode(chunk, False)
            while True:
                nl = pending.find("\n")
                if nl == -1:
                    break
                line = pending[:nl].rstrip("\r")
                pending = pending[nl + 1 :]
                if not line.strip():
                    continue
                if header is None:
                    header = next(csv.reader([line]))
                    while header and header[-1] == "":
                        header.pop()
                    log.info("HRSA CSV header columns (%s): %s", len(header), header[:12])
                    continue
                cells = next(csv.reader([line]))
                if len(cells) < len(header):
                    cells = cells + [""] * (len(header) - len(cells))
                elif len(cells) > len(header):
                    continue
                yield dict(zip(header, cells))
        pending += decoder.decode(b"", True)
        while True:
            nl = pending.find("\n")
            if nl == -1:
                break
            line = pending[:nl].rstrip("\r")
            pending = pending[nl + 1 :]
            if not line.strip():
                continue
            if header is None:
                header = next(csv.reader([line]))
                while header and header[-1] == "":
                    header.pop()
                log.info("HRSA CSV header columns (%s): %s", len(header), header[:12])
                continue
            cells = next(csv.reader([line]))
            if len(cells) < len(header):
                cells = cells + [""] * (len(header) - len(cells))
            elif len(cells) > len(header):
                continue
            yield dict(zip(header, cells))
        if pending.strip():
            line = pending.rstrip("\r\n")
            if header is None:
                header = next(csv.reader([line]))
                while header and header[-1] == "":
                    header.pop()
                log.info("HRSA CSV header columns (%s): %s", len(header), header[:12])
            else:
                cells = next(csv.reader([line]))
                if len(cells) < len(header):
                    cells = cells + [""] * (len(header) - len(cells))
                elif len(cells) > len(header):
                    pass  # skip malformed trailing-only row fragment
                else:
                    yield dict(zip(header, cells))


def _parse_hrsa_site_row(row: dict[str, str]) -> dict[str, Any] | None:
    """Return kwargs fragment for ``Clinic`` or None to skip the row."""
    status = (row.get(_HRSA_COL_STATUS) or "").strip().lower()
    if status not in _HRSA_OPERATIONAL_STATUSES:
        return None

    bphc = (row.get(_HRSA_COL_BPHC) or "").strip()
    loc_id = (row.get(_HRSA_COL_LOC_ID) or "").strip()
    if not bphc or not loc_id:
        return None

    hrsa_id = f"{bphc}:{loc_id}"
    hrsa_id = hrsa_id[:64]

    try:
        lat = float((row.get(_HRSA_COL_LAT) or "").strip())
        lon = float((row.get(_HRSA_COL_LON) or "").strip())
    except ValueError:
        return None

    if lat == 0.0 and lon == 0.0:
        return None
    if abs(lat) > 90.0 or abs(lon) > 180.0:
        return None
    if not math.isfinite(lat) or not math.isfinite(lon):
        return None

    name = (row.get(_HRSA_COL_SITE_NAME) or "").strip()
    if not name:
        return None

    sf = row.get(_HRSA_COL_STATE_FIPS)
    state_fips = str(sf).strip().zfill(2) if sf not in (None, "") else None
    if state_fips == "":
        state_fips = None

    return {
        "hrsa_id": hrsa_id,
        "name": _hrsa_clip(name, 512) or "",
        "address": _hrsa_clip(row.get(_HRSA_COL_ADDRESS), 512),
        "city": _hrsa_clip(row.get(_HRSA_COL_CITY), 128),
        "state_fips": _hrsa_clip(state_fips, 2) if state_fips else None,
        "zip_code": _hrsa_clip(row.get(_HRSA_COL_ZIP), 10),
        "latitude": lat,
        "longitude": lon,
        "site_type": _hrsa_clip(row.get(_HRSA_COL_TYPE), 128),
    }


async def fetch_hrsa_clinics(session: AsyncSession) -> None:
    """Download HRSA Health Center / Look-Alike site CSV and upsert ``clinics`` rows."""
    url = os.environ.get("HRSA_SITES_CSV_URL", _DEFAULT_HRSA_SITES_CSV_URL)
    log.info("Fetching HRSA site CSV from %s", url)

    existing = {c.hrsa_id: c for c in (await session.scalars(select(Clinic))).all()}
    seen: set[str] = set()
    n_rows = 0
    n_skipped = 0
    n_inserted = 0
    n_updated = 0
    now = datetime.now(timezone.utc)

    async with httpx.AsyncClient(timeout=600.0, verify=_SSL_CA_BUNDLE) as client:
        async for raw in _iter_hrsa_csv_dict_rows(client, url):
            n_rows += 1
            parsed = _parse_hrsa_site_row(raw)
            if parsed is None:
                n_skipped += 1
                continue

            hid = parsed["hrsa_id"]
            seen.add(hid)

            if hid in existing:
                c = existing[hid]
                n_updated += 1
                c.name = parsed["name"]
                c.address = parsed["address"]
                c.city = parsed["city"]
                c.state_fips = parsed["state_fips"]
                c.zip_code = parsed["zip_code"]
                c.latitude = parsed["latitude"]
                c.longitude = parsed["longitude"]
                c.is_operational = True
                c.site_type = parsed["site_type"]
                c.updated_at = now
            else:
                c = Clinic(
                    hrsa_id=hid,
                    name=parsed["name"],
                    address=parsed["address"],
                    city=parsed["city"],
                    state_fips=parsed["state_fips"],
                    zip_code=parsed["zip_code"],
                    latitude=parsed["latitude"],
                    longitude=parsed["longitude"],
                    is_operational=True,
                    site_type=parsed["site_type"],
                    updated_at=now,
                )
                session.add(c)
                existing[hid] = c
                n_inserted += 1

    await session.flush()

    n_deactivated = 0
    if seen:
        q = select(Clinic.hrsa_id).where(~Clinic.hrsa_id.in_(seen), Clinic.is_operational.is_(True))
        to_close = list((await session.scalars(q)).all())
        n_deactivated = len(to_close)
        if to_close:
            await session.execute(update(Clinic).where(~Clinic.hrsa_id.in_(seen)).values(is_operational=False))

    log.info(
        "HRSA clinics: total_rows_from_download=%s, skipped_non_operational_or_invalid=%s, "
        "inserted=%s, updated=%s, deactivated=%s",
        n_rows,
        n_skipped,
        n_inserted,
        n_updated,
        n_deactivated,
    )


async def compute_tract_clinic_distances(
    session: AsyncSession,
    state_fips_filter: list[str] | None = None,
) -> None:
    """Recompute the three nearest operational clinics per tract (Haversine miles).

    When ``state_fips_filter`` is provided, only the tracts belonging to those
    states are rebuilt and only their existing ``tract_clinics`` rows are deleted.
    Clinic candidates are always drawn from the full national set so cross-state
    proximity (e.g. a VA clinic nearest to a DC tract) is captured correctly.
    """
    clinics_rows = (
        await session.execute(select(Clinic.id, Clinic.latitude, Clinic.longitude).where(Clinic.is_operational.is_(True)))
    ).all()
    all_clinics: list[tuple[int, float, float]] = [(int(r[0]), float(r[1]), float(r[2])) for r in clinics_rows]
    if not all_clinics:
        log.warning("No operational clinics; skipping tract_clinics.")
        return

    buckets: defaultdict[tuple[int, int], list[tuple[int, float, float]]] = defaultdict(list)
    for cid, lat, lon in all_clinics:
        buckets[(math.floor(lat), math.floor(lon))].append((cid, lat, lon))

    tract_stmt = select(Tract.geoid, Tract.centroid_lat, Tract.centroid_lon).where(
        Tract.centroid_lat.isnot(None),
        Tract.centroid_lon.isnot(None),
    )
    if state_fips_filter:
        tract_stmt = tract_stmt.where(Tract.state_fips.in_(state_fips_filter))
    tract_rows = (await session.execute(tract_stmt)).all()

    if state_fips_filter:
        await session.execute(
            delete(TractClinic).where(
                TractClinic.geoid.in_(
                    select(Tract.geoid).where(Tract.state_fips.in_(state_fips_filter))
                )
            )
        )
    else:
        await session.execute(delete(TractClinic))
    await session.flush()

    rank1_sum = 0.0
    rank1_n = 0
    written = 0
    batch: list[TractClinic] = []
    lat_pad = 1.5
    lon_pad = 2.0

    for geoid, raw_lat, raw_lon in tract_rows:
        try:
            tlat = float(raw_lat)
            tlon = float(raw_lon)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(tlat) or not math.isfinite(tlon):
            continue

        lat_lo, lat_hi = tlat - lat_pad, tlat + lat_pad
        lon_lo, lon_hi = tlon - lon_pad, tlon + lon_pad
        la0 = math.floor(lat_lo) - 1
        la1 = math.floor(lat_hi) + 1
        lo0 = math.floor(lon_lo) - 1
        lo1 = math.floor(lon_hi) + 1

        cands: list[tuple[int, float, float]] = []
        for la in range(la0, la1 + 1):
            for lo in range(lo0, lo1 + 1):
                for item in buckets.get((la, lo), []):
                    _cid, clat, clon = item
                    if lat_lo <= clat <= lat_hi and lon_lo <= clon <= lon_hi:
                        cands.append(item)

        if not cands:
            cands = all_clinics

        scored: list[tuple[float, int]] = [
            (_haversine_miles(tlat, tlon, clat, clon), cid) for cid, clat, clon in cands
        ]
        scored.sort(key=lambda x: x[0])
        top = scored[:3]

        for rank, (dist_mi, cid) in enumerate(top, start=1):
            batch.append(
                TractClinic(geoid=geoid, clinic_id=cid, distance_miles=float(dist_mi), rank=rank),
            )
            written += 1
        if top:
            rank1_sum += top[0][0]
            rank1_n += 1

        if len(batch) >= 8000:
            session.add_all(batch)
            await session.flush()
            batch.clear()

    if batch:
        session.add_all(batch)
        await session.flush()

    avg_rank1 = rank1_sum / rank1_n if rank1_n else 0.0
    log.info(
        "tract_clinics: wrote %s rows; tracts_with_rank1=%s; mean distance_miles (rank 1)=%.2f",
        written,
        rank1_n,
        avg_rank1,
    )


async def _public_table_exists(session: AsyncSession, table_name: str) -> bool:
    q = text(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = 'public' AND table_name = :name)"
    )
    r = await session.execute(q, {"name": table_name})
    return bool(r.scalar())


async def run_ingest(states: list[str], year: int) -> None:
    if year < 2020 or year > 2024:
        raise ValueError(f"Year {year} is not supported. Use 2020–2024 (ACS 5-year must exist on api.census.gov).")
    if year == 2020:
        log.warning(
            "Warning: ACS 2020 5-year data has elevated margins of error due to "
            "COVID-19 data collection disruptions. Interpret 2020 scores with caution."
        )
        log.info(
            "PLACES for 2020 uses the wide-format tract dataset (hky2-3tpn), same as 2021–2024, "
            "so asthma / uninsured / disability columns match ingest expectations; ACS and TIGER still use vintage 2020."
        )

    database_url = _ingest_database_url()
    log.info("Using database URL: %s", database_url)
    engine = create_async_engine(database_url, echo=False)
    async_session = async_sessionmaker(engine, expire_on_commit=False)

    census_key = os.environ.get("CENSUS_API_KEY") or settings.census_api_key
    cdc_token = os.environ.get("CDC_API_KEY") or settings.cdc_api_key
    places_dataset_id = _places_dataset_for_year(year)
    tiger_year = str(year)
    failed_states: list[str] = []

    async with async_session() as session:
        async with httpx.AsyncClient(timeout=_ACS_HTTP_TIMEOUT, verify=_SSL_CA_BUNDLE) as http:
            log.info("Fetching PLACES (dataset %s, analysis year %s)…", places_dataset_id, year)
            places = await fetch_places_states(http, states, cdc_token, places_dataset_id)
            log.info("PLACES rows: %s", len(places))

            log.info("Loading TIGER US county boundaries (once)…")
            us_county_gdf = await load_tiger_us_counties(http, tiger_year)

            for sf in states:
                sf = sf.zfill(2)
                try:
                    log.info("State %s: ACS + TIGER (year %s)", sf, year)
                    acs = await fetch_acs_state(http, sf, census_key, year)
                    gdf = await load_tiger_tracts(http, sf, tiger_year)
                    geoid_col = "GEOID20" if "GEOID20" in gdf.columns else "GEOID"

                    county_gdf = us_county_gdf[us_county_gdf["STATEFP"].astype(str).str.zfill(2) == sf].copy()
                    county_lookup = _county_lookup_from_gdf(county_gdf)
                    try:
                        place_gdf = await load_tiger_places(http, sf, tiger_year)
                        place_by_geoid = _place_by_tract_geoid(gdf, place_gdf, geoid_col)
                    except Exception as e:
                        log.warning("TIGER places for state %s failed (%s); place_name will stay empty for this state", sf, e)
                        place_by_geoid = {}

                    for _, row in gdf.iterrows():
                        st = str(row["STATEFP"]).zfill(2)
                        co = str(row["COUNTYFP"]).zfill(3)
                        cn = county_lookup.get((st, co))
                        gid_key = str(row[geoid_col])
                        dem = acs.get(gid_key, {})
                        await upsert_tract_row(
                            session,
                            row,
                            geoid_col,
                            county_name=cn,
                            median_rent=dem.get("median_rent"),
                            median_household_income=dem.get("median_household_income"),
                        )
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

                        rows: list[tuple[str, str, float, int, float | None]] = []
                        if "rent_burden_pct" in a:
                            rv, rm = a["rent_burden_pct"]
                            rows.append(("census_acs", "rent_burden_pct", rv, year, rm))
                        if "overcrowding_pct" in a:
                            ov, om = a["overcrowding_pct"]
                            rows.append(("census_acs", "overcrowding_pct", ov, year, om))
                        if "structural_vacancy_rate" in a:
                            vv, vm = a["structural_vacancy_rate"]
                            rows.append(("census_acs", "structural_vacancy_rate", vv, year, vm))
                        for k in ("asthma_pct", "uninsured_pct", "disability_pct", "mental_health_pct"):
                            if k in p:
                                rows.append(("cdc_places", k, p[k], year, None))
                        for k in DISPLAY_ONLY_METRICS:
                            if k in p:
                                rows.append(("cdc_places", k, p[k], year, None))
                        rows.append(("computed", "heat_index", heat, year, None))

                        present = {r[1] for r in rows}
                        if all(m in present for m in METRIC_KEYS):
                            t_row = await session.get(Tract, gid)
                            if t_row is not None and t_row.population is not None and t_row.population == 0:
                                log.debug("Skipping scoring for zero-population tract %s", gid)
                            else:
                                await replace_indicators(session, gid, rows, year)

                    await session.commit()
                    log.info("State %s: ingest complete", sf)
                except Exception as e:
                    log.error(
                        "INGEST FAILED for state %s: %s — skipping, other states will continue",
                        sf,
                        e,
                        exc_info=True,
                    )
                    failed_states.append(sf)
                    await session.rollback()

            await fetch_acs_demographics(session, states, year, census_key)

        log.info("Percentiles…")
        await update_percentiles(session, year)
        await session.commit()

        log.info("Risk scores…")
        n = await recalculate_risk_scores(session, year)
        log.info("Computed risk scores for %s tracts", n)

        if await _public_table_exists(session, "clinics"):
            log.info("HRSA FQHC sites and tract–clinic distances…")
            await fetch_hrsa_clinics(session)
            await session.flush()
            await compute_tract_clinic_distances(session, state_fips_filter=states)
            await session.commit()
        else:
            log.warning(
                'Skipping HRSA clinic steps: table "clinics" is missing. '
                "Apply migrations with: cd backend && alembic upgrade head — then re-run ingest to load FQHC data."
            )

    invalidate_metric_map_cache()
    await engine.dispose()

    if failed_states:
        log.warning(
            "Ingest completed with %d failed state(s): %s",
            len(failed_states),
            failed_states,
        )
        raise IngestPartialFailureError(failed_states)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--states",
        default="06,12,17,36,48",
        help="Comma-separated state FIPS (default: CA, FL, IL, NY, TX)",
    )
    p.add_argument(
        "--year",
        type=_cli_analysis_year,
        default=2022,
        help="ACS / TIGER / PLACES analysis year (default: 2022; must be 2020–2024)",
    )
    args = p.parse_args()
    states = [s.strip().zfill(2) for s in args.states.split(",") if s.strip()]
    asyncio.run(run_ingest(states, args.year))


if __name__ == "__main__":
    main()
