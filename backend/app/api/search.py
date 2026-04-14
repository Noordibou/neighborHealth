from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models import RiskScore, Tract
from app.schemas.tract import SearchResponse, SearchResult

router = APIRouter(prefix="/api/search", tags=["search"])

@router.get("", response_model=SearchResponse)
async def search_tracts(
    session: Annotated[AsyncSession, Depends(get_db)],
    q: str = Query(..., min_length=1, max_length=120),
    limit: int = Query(25, ge=1, le=100),
) -> SearchResponse:
    term = f"%{q.strip()}%"
    yq = await session.execute(select(func.max(RiskScore.year)))
    year_eff = yq.scalar() or 2023

    stmt = (
        select(Tract, RiskScore.composite_score)
        .join(RiskScore, RiskScore.geoid == Tract.geoid)
        .where(
            RiskScore.year == year_eff,
            or_(
                Tract.geoid.ilike(term),
                Tract.name.ilike(term),
                Tract.county_name.ilike(term),
                Tract.place_name.ilike(term),
            ),
        )
        .order_by(RiskScore.composite_score.desc())
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
