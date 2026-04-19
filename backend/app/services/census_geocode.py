"""U.S. Census Bureau batch / one-line address geocoder (no API key)."""

from __future__ import annotations

from typing import Any

import httpx

CENSUS_GEOCODER_BASE = "https://geocoding.geo.census.gov/geocoder"
DEFAULT_BENCHMARK = "Public_AR_Current"
DEFAULT_VINTAGE = "Census2020_Current"
DEFAULT_LAYERS = "2020 Census Tracts"
REQUEST_TIMEOUT_S = 28.0


class CensusGeocoderError(Exception):
    """HTTP or parse failure talking to the Census geocoder."""


def _tract_geoid_from_geographies(geographies: dict[str, Any]) -> str | None:
    """First 2020 census tract GEOID (11 chars) from a geographies object."""
    tracts = geographies.get("Census Tracts")
    if not isinstance(tracts, list) or not tracts:
        return None
    first = tracts[0]
    if not isinstance(first, dict):
        return None
    gid = first.get("GEOID")
    if isinstance(gid, str) and gid.isdigit() and len(gid) >= 11:
        return gid[:11]
    return None


def _first_match(payload: dict[str, Any]) -> dict[str, Any] | None:
    try:
        matches = payload["result"]["addressMatches"]
    except (KeyError, TypeError):
        return None
    if not isinstance(matches, list) or not matches:
        return None
    m0 = matches[0]
    return m0 if isinstance(m0, dict) else None


def parse_geographies_response(data: dict[str, Any]) -> tuple[str | None, float | None, float | None, str | None]:
    """
    Returns (matched_address, lon, lat, census_tract_geoid).
    lon/lat from coordinates.x / coordinates.y when present.
    """
    m = _first_match(data)
    if m is None:
        return None, None, None, None
    matched = m.get("matchedAddress")
    matched_s = matched.strip() if isinstance(matched, str) else None
    lon: float | None = None
    lat: float | None = None
    coords = m.get("coordinates")
    if isinstance(coords, dict):
        try:
            lon = float(coords["x"])
            lat = float(coords["y"])
        except (KeyError, TypeError, ValueError):
            lon, lat = None, None
    geog = m.get("geographies")
    tract_geoid: str | None = None
    if isinstance(geog, dict):
        tract_geoid = _tract_geoid_from_geographies(geog)
    return matched_s, lon, lat, tract_geoid


async def geocode_oneline_with_geographies(address: str) -> dict[str, Any]:
    """
    Call Census /geographies/onelineaddress (includes coordinates + Census Tracts).
    See https://www.census.gov/programs-surveys/geography/services/geocoding-api.html
    """
    addr = address.strip()
    if not addr:
        raise CensusGeocoderError("Empty address")
    url = f"{CENSUS_GEOCODER_BASE}/geographies/onelineaddress"
    params = {
        "address": addr,
        "benchmark": DEFAULT_BENCHMARK,
        "vintage": DEFAULT_VINTAGE,
        "layers": DEFAULT_LAYERS,
        "format": "json",
    }
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_S) as client:
        r = await client.get(url, params=params)
    if r.status_code != 200:
        raise CensusGeocoderError(f"Census geocoder HTTP {r.status_code}")
    try:
        return r.json()
    except ValueError as e:
        raise CensusGeocoderError("Invalid JSON from Census geocoder") from e
