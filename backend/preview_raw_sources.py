#!/usr/bin/env python3
"""
Print Census ACS and CDC PLACES responses as returned by the APIs — before
ingest.py aggregates them into rent_burden_pct, overcrowding_pct, etc.

Usage:
  cd backend && python preview_raw_sources.py --state 06 --geoid 06075010100
  cd backend && python preview_raw_sources.py --state 06   # first tract in state as sample

Environment (optional):
  CENSUS_API_KEY — avoids Census rate limits
  CDC_API_KEY / X-App-Token for PLACES (optional)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from typing import Any

import httpx

from app.config import settings

ACS_YEAR = 2022
ACS_BASE = f"https://api.census.gov/data/{ACS_YEAR}/acs/acs5"
PLACES_DATASET = "hky2-3tpn"
PLACES_BASE = f"https://chronicdata.cdc.gov/resource/{PLACES_DATASET}.json"

INGEST_FIELD_NOTES: dict[str, str] = {
    "rent_burden_pct": "Computed in ingest: 100 * (B25070_007E+008E+009E+010E) / B25070_001E (rent 50%+ of income).",
    "overcrowding_pct": "Computed in ingest: 100 * sum(B25014 overcrowding cells) / B25014_001E.",
    "vacancy_rate": "Computed in ingest: 100 * B25002_003E / B25002_001E.",
    "asthma_pct": "Stored from PLACES field casthma_crudeprev (crude prevalence).",
    "uninsured_pct": "Stored from PLACES field access2_crudeprev (labeled access2 in source).",
    "disability_pct": "Stored from PLACES field disability_crudeprev.",
    "heat_index": "Not from these APIs; computed from tract centroid latitude in ingest.",
}


def _geoid_from_acs_row(header: list[str], row: list[str]) -> str:
    return (
        row[header.index("state")].zfill(2)
        + row[header.index("county")].zfill(3)
        + row[header.index("tract")].zfill(6)
    )


def _acs_row_as_dict(table: list[list[Any]], geoid: str) -> dict[str, Any] | None:
    if not table or len(table) < 2:
        return None
    header = table[0]
    for row in table[1:]:
        if _geoid_from_acs_row(header, row) == geoid:
            return dict(zip(header, row))
    return None


def _first_geoid_in_state(table: list[list[Any]], state_fips: str) -> str | None:
    if not table or len(table) < 2:
        return None
    header = table[0]
    st = state_fips.zfill(2)
    for row in table[1:]:
        if row[header.index("state")].zfill(2) == st:
            return _geoid_from_acs_row(header, row)
    return None


async def _fetch_acs_group(
    client: httpx.AsyncClient, state_fips: str, group: str, census_key: str | None
) -> list[list[Any]]:
    params: dict[str, Any] = {"for": "tract:*", "in": f"state:{state_fips}", "get": f"group({group})"}
    if census_key:
        params["key"] = census_key
    r = await client.get(ACS_BASE, params=params)
    r.raise_for_status()
    return r.json()


async def _fetch_places_for_tract(
    client: httpx.AsyncClient, geoid: str, cdc_token: str | None
) -> dict[str, Any] | None:
    headers = {}
    if cdc_token:
        headers["X-App-Token"] = cdc_token
    r = await client.get(PLACES_BASE, params={"tractfips": geoid, "$limit": "5"}, headers=headers)
    r.raise_for_status()
    rows = r.json()
    if not rows:
        return None
    return rows[0] if isinstance(rows[0], dict) else None


async def run_preview(state_fips: str, geoid: str | None, pretty: bool) -> dict[str, Any]:
    state_fips = state_fips.zfill(2)
    census_key = os.environ.get("CENSUS_API_KEY") or settings.census_api_key
    cdc_token = os.environ.get("CDC_API_KEY") or settings.cdc_api_key

    async with httpx.AsyncClient(timeout=120.0) as client:
        b70, b14, b02 = await asyncio.gather(
            _fetch_acs_group(client, state_fips, "B25070", census_key),
            _fetch_acs_group(client, state_fips, "B25014", census_key),
            _fetch_acs_group(client, state_fips, "B25002", census_key),
        )

        resolved_geoid = geoid
        if not resolved_geoid:
            resolved_geoid = _first_geoid_in_state(b70, state_fips) or _first_geoid_in_state(b14, state_fips)
        if not resolved_geoid:
            raise SystemExit(f"No ACS tract rows returned for state {state_fips} (check state FIPS or API key).")

        places_raw = await _fetch_places_for_tract(client, resolved_geoid, cdc_token)

        r70 = _acs_row_as_dict(b70, resolved_geoid)
        r14 = _acs_row_as_dict(b14, resolved_geoid)
        r02 = _acs_row_as_dict(b02, resolved_geoid)

        payload: dict[str, Any] = {
            "geoid": resolved_geoid,
            "acs": {
                "endpoint": ACS_BASE,
                "vintage": f"{ACS_YEAR} ACS 5-year",
                "row_present": {"B25070": r70 is not None, "B25014": r14 is not None, "B25002": r02 is not None},
                "B25070_rent_and_rent_as_pct_of_income": r70,
                "B25014_tenure_by_occupants_per_room": r14,
                "B25002_occupancy_status": r02,
            },
            "cdc_places": {
                "endpoint": PLACES_BASE,
                "dataset": PLACES_DATASET,
                "row_present": places_raw is not None,
                "raw_record_for_tract": places_raw,
            },
            "how_ingest_uses_this": INGEST_FIELD_NOTES,
        }
        if geoid is None:
            payload["_note"] = "No --geoid passed; showing the first tract returned in ACS B25070 for this state."
        if not (r70 and r14 and r02):
            payload["_acs_note"] = (
                "A null ACS block means this GEOID had no published row in that table for "
                f"{ACS_YEAR} ACS 5-year in this pull (suppression, zero estimates, or not in extract). "
                "PLACES can still return a tract record."
            )

        return payload


def main() -> None:
    p = argparse.ArgumentParser(description="Print raw ACS + PLACES fields before ingest calculations.")
    p.add_argument("--state", required=True, help="State FIPS, e.g. 06 for California")
    p.add_argument("--geoid", default=None, help="11-digit tract GEOID (optional; default = sample tract)")
    p.add_argument("--pretty", action="store_true", help="Indented JSON")
    args = p.parse_args()

    out = asyncio.run(run_preview(args.state, args.geoid, args.pretty))
    indent = 2 if args.pretty else None
    print(json.dumps(out, indent=indent, default=str))


if __name__ == "__main__":
    main()
