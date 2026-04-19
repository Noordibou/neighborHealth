from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.states import STATE_FIPS_TO_POSTAL, STATE_NAMES, STATE_POSTAL_TO_FIPS
from app.db.session import get_db
from app.models import RiskScore, Tract
from app.schemas.tract import (
    AddressSearchRequest,
    AddressSearchResponse,
    SearchResponse,
    SearchResult,
    SearchSuggestItem,
    SearchSuggestResponse,
)
from app.services.census_geocode import CensusGeocoderError, geocode_oneline_with_geographies, parse_geographies_response

router = APIRouter(prefix="/api/search", tags=["search"])


async def _search_results_for_geoids(
    session: AsyncSession, geoids: list[str], year_eff: int
) -> dict[str, SearchResult]:
    if not geoids:
        return {}
    stmt = (
        select(Tract, RiskScore.composite_score)
        .outerjoin(
            RiskScore,
            and_(RiskScore.geoid == Tract.geoid, RiskScore.year == year_eff),
        )
        .where(Tract.geoid.in_(geoids))
    )
    res = await session.execute(stmt)
    return {
        t.geoid: SearchResult(
            geoid=t.geoid,
            name=t.name,
            state_fips=t.state_fips,
            county_name=t.county_name,
            composite_score=float(s) if s is not None else None,
        )
        for t, s in res.all()
    }


async def _tract_geoid_at_point(
    session: AsyncSession, lon: float, lat: float, state_fips: str | None
) -> str | None:
    pt = func.ST_SetSRID(func.ST_MakePoint(lon, lat), 4326)
    stmt = select(Tract.geoid).where(Tract.geometry.isnot(None), func.ST_Contains(Tract.geometry, pt))
    if state_fips:
        stmt = stmt.where(Tract.state_fips == state_fips.zfill(2))
    stmt = stmt.limit(1)
    row = (await session.execute(stmt)).first()
    return str(row[0]) if row else None


def _state_fips_for_query(q: str) -> list[str]:
    """Match full/partial state names and two-letter postal abbreviations (e.g. CA, NY)."""
    raw = q.strip()
    if not raw:
        return []
    ql = raw.lower()
    out: set[str] = set()
    if len(raw) == 2 and raw.isalpha():
        fips = STATE_POSTAL_TO_FIPS.get(raw.upper())
        if fips:
            out.add(fips)
    if len(ql) >= 3:
        for fips, name in STATE_NAMES.items():
            if ql in name.lower():
                out.add(fips)
    return list(out)


@router.get("/suggest", response_model=SearchSuggestResponse)
async def search_suggest(
    session: Annotated[AsyncSession, Depends(get_db)],
    q: str = Query(..., min_length=2, max_length=80),
) -> SearchSuggestResponse:
    """Typeahead-style suggestions (states, counties, places) for map search."""
    qi = q.strip()
    term = f"%{qi}%"
    ql = qi.lower()
    items: list[SearchSuggestItem] = []
    seen: set[tuple[str, str, str | None]] = set()

    def add(item: SearchSuggestItem) -> None:
        key = (item.kind, item.label, item.state_fips)
        if key in seen:
            return
        seen.add(key)
        items.append(item)

    if len(qi) == 2 and qi.isalpha():
        sf_post = STATE_POSTAL_TO_FIPS.get(qi.upper())
        if sf_post and sf_post in STATE_NAMES:
            nm = STATE_NAMES[sf_post]
            add(
                SearchSuggestItem(
                    kind="state",
                    label=nm,
                    detail=qi.upper(),
                    query=nm,
                    state_fips=sf_post,
                )
            )
    if len(ql) >= 2:
        n_state = sum(1 for it in items if it.kind == "state")
        for sf, name in STATE_NAMES.items():
            if n_state >= 6:
                break
            if ql in name.lower():
                add(
                    SearchSuggestItem(
                        kind="state",
                        label=name,
                        detail=STATE_FIPS_TO_POSTAL.get(sf),
                        query=name,
                        state_fips=sf,
                    )
                )
                n_state = sum(1 for it in items if it.kind == "state")

    cq = (
        await session.execute(
            select(Tract.county_name, Tract.state_fips)
            .where(Tract.county_name.isnot(None), Tract.county_name.ilike(term))
            .distinct()
            .limit(8)
        )
    ).all()
    for cn, sf in cq:
        if cn is None or sf is None:
            continue
        st_name = STATE_NAMES.get(sf, sf)
        abbr = STATE_FIPS_TO_POSTAL.get(sf)
        add(
            SearchSuggestItem(
                kind="county",
                label=str(cn),
                detail=f"{st_name}" + (f" · {abbr}" if abbr else ""),
                query=str(cn),
                state_fips=str(sf).zfill(2),
            )
        )

    pq = (
        await session.execute(
            select(Tract.place_name, Tract.state_fips)
            .where(Tract.place_name.isnot(None), Tract.place_name.ilike(term))
            .distinct()
            .limit(8)
        )
    ).all()
    for pn, sf in pq:
        if pn is None or sf is None:
            continue
        st_name = STATE_NAMES.get(sf, sf)
        abbr = STATE_FIPS_TO_POSTAL.get(sf)
        add(
            SearchSuggestItem(
                kind="place",
                label=str(pn),
                detail=f"{st_name}" + (f" · {abbr}" if abbr else ""),
                query=str(pn),
                state_fips=str(sf).zfill(2),
            )
        )

    return SearchSuggestResponse(query=qi, items=items[:14])


@router.post("/from-address", response_model=AddressSearchResponse)
async def search_from_address(
    session: Annotated[AsyncSession, Depends(get_db)],
    body: AddressSearchRequest,
) -> AddressSearchResponse:
    """
    Resolve a U.S. street address to a census tract using the Census Bureau geocoder,
    then load that tract from this database (with PostGIS containment as a fallback).
    """
    q = body.address.strip()
    yq = await session.execute(select(func.max(RiskScore.year)))
    year_eff: int = yq.scalar() or 2023

    try:
        raw = await geocode_oneline_with_geographies(q)
    except CensusGeocoderError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e

    matched_address, lon, lat, census_tract_geoid = parse_geographies_response(raw)

    if matched_address is None and lon is None:
        return AddressSearchResponse(
            query=q,
            matched_address=None,
            longitude=None,
            latitude=None,
            results=[],
            census_tract_geoid=None,
            resolver="none",
            message="No match from the U.S. Census address geocoder.",
        )

    if census_tract_geoid:
        by_geoid = await _search_results_for_geoids(session, [census_tract_geoid], year_eff)
        if census_tract_geoid in by_geoid:
            return AddressSearchResponse(
                query=q,
                matched_address=matched_address,
                longitude=lon,
                latitude=lat,
                results=[by_geoid[census_tract_geoid]],
                census_tract_geoid=None,
                resolver="census_geographies",
                message=None,
            )

    if lon is not None and lat is not None:
        hit = await _tract_geoid_at_point(session, lon, lat, body.state_fips)
        if hit:
            by_hit = await _search_results_for_geoids(session, [hit], year_eff)
            if hit in by_hit:
                msg = None
                if census_tract_geoid and census_tract_geoid != hit:
                    msg = (
                        "Located via map geometry; Census tract code from the geocoder differed from the "
                        "containing polygon in this database."
                    )
                return AddressSearchResponse(
                    query=q,
                    matched_address=matched_address,
                    longitude=lon,
                    latitude=lat,
                    results=[by_hit[hit]],
                    census_tract_geoid=census_tract_geoid if census_tract_geoid != hit else None,
                    resolver="postgis_point",
                    message=msg,
                )

    if census_tract_geoid:
        return AddressSearchResponse(
            query=q,
            matched_address=matched_address,
            longitude=lon,
            latitude=lat,
            results=[],
            census_tract_geoid=census_tract_geoid,
            resolver="none",
            message=(
                f"Census reports tract {census_tract_geoid}, but this app has no matching tract row or geometry "
                "(ingest may not include that area)."
            ),
        )

    return AddressSearchResponse(
        query=q,
        matched_address=matched_address,
        longitude=lon,
        latitude=lat,
        results=[],
        census_tract_geoid=None,
        resolver="none",
        message="The geocoder did not return a census tract code, and no tract polygon in the database contains that point.",
    )


@router.get("", response_model=SearchResponse)
async def search_tracts(
    session: Annotated[AsyncSession, Depends(get_db)],
    q: str = Query(..., min_length=1, max_length=120),
    limit: int = Query(25, ge=1, le=100),
    state_fips: str | None = Query(None, min_length=2, max_length=2),
) -> SearchResponse:
    term = f"%{q.strip()}%"
    yq = await session.execute(select(func.max(RiskScore.year)))
    year_eff = yq.scalar() or 2023

    sf_match = _state_fips_for_query(q)
    clauses = [
        Tract.geoid.ilike(term),
        Tract.name.ilike(term),
        Tract.county_name.ilike(term),
        Tract.place_name.ilike(term),
    ]
    if sf_match:
        clauses.append(Tract.state_fips.in_(sf_match))

    where_expr = or_(*clauses)
    if state_fips:
        sf_one = state_fips.zfill(2)
        where_expr = and_(where_expr, Tract.state_fips == sf_one)

    stmt = (
        select(Tract, RiskScore.composite_score)
        .outerjoin(
            RiskScore,
            and_(RiskScore.geoid == Tract.geoid, RiskScore.year == year_eff),
        )
        .where(where_expr)
        .order_by(RiskScore.composite_score.desc().nulls_last())
        .limit(limit)
    )
    res = await session.execute(stmt)
    results = [
        SearchResult(
            geoid=t.geoid,
            name=t.name,
            state_fips=t.state_fips,
            county_name=t.county_name,
            composite_score=float(s) if s is not None else None,
        )
        for t, s in res.all()
    ]
    return SearchResponse(query=q, results=results)
