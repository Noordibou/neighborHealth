from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.states import STATE_NAMES, STATE_POSTAL_TO_FIPS
from app.db.session import get_db
from app.models import RiskScore, Tract
from app.schemas.tract import SearchResponse, SearchResult

router = APIRouter(prefix="/api/search", tags=["search"])


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


@router.get("", response_model=SearchResponse)
async def search_tracts(
    session: Annotated[AsyncSession, Depends(get_db)],
    q: str = Query(..., min_length=1, max_length=120),
    limit: int = Query(25, ge=1, le=100),
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

    stmt = (
        select(Tract, RiskScore.composite_score)
        .outerjoin(
            RiskScore,
            and_(RiskScore.geoid == Tract.geoid, RiskScore.year == year_eff),
        )
        .where(or_(*clauses))
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
