from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models import Indicator, RiskScore, Tract
from app.schemas.tract import (
    AISummaryOut,
    IndicatorOut,
    RiskScoreOut,
    TractDetail,
    TractListResponse,
    TractScoreDetail,
    TractSummary,
)
from app.services.ai_service import get_or_create_summary
from app.services.risk_score import METRIC_KEYS, TractValues, clamp_weights, compute_batch_scores
from app.services.score_recalc import load_metric_map_for_year

router = APIRouter(prefix="/api/tracts", tags=["tracts"])


def _weights_from_query(**kwargs: float | None) -> dict[str, float] | None:
    d = {k: v for k, v in kwargs.items() if v is not None and k in METRIC_KEYS}
    return d or None


@router.get("", response_model=TractListResponse)
async def list_tracts(
    session: Annotated[AsyncSession, Depends(get_db)],
    state: str | None = Query(None, description="2-digit state FIPS"),
    min_score: float | None = Query(None, ge=0, le=100),
    min_rent_burden: float | None = None,
    min_uninsured: float | None = None,
    high_asthma: bool | None = None,
    urban_rural: str | None = Query(None, description="urban | rural"),
    year: int | None = Query(None, description="Risk score / indicator year"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> TractListResponse:
    """Filtered tract list with composite scores, sorted by composite score descending."""
    year_eff = year
    if year_eff is None:
        yq = await session.execute(select(func.max(RiskScore.year)))
        year_eff = yq.scalar() or 2023

    stmt = (
        select(Tract, RiskScore.composite_score)
        .join(RiskScore, and_(RiskScore.geoid == Tract.geoid, RiskScore.year == year_eff))
        .order_by(RiskScore.composite_score.desc())
    )
    if state:
        stmt = stmt.where(Tract.state_fips == state.zfill(2))
    if min_score is not None:
        stmt = stmt.where(RiskScore.composite_score >= min_score)
    if urban_rural:
        stmt = stmt.where(Tract.urban_rural == urban_rural)

    allowed: set[str] | None = None
    if min_rent_burden is not None:
        q = select(Indicator.geoid).where(
            Indicator.year == year_eff,
            Indicator.metric_name == "rent_burden_pct",
            Indicator.value >= min_rent_burden,
        )
        s = set((await session.execute(q)).scalars().all())
        allowed = s if allowed is None else allowed & s
    if min_uninsured is not None:
        q = select(Indicator.geoid).where(
            Indicator.year == year_eff,
            Indicator.metric_name == "uninsured_pct",
            Indicator.value >= min_uninsured,
        )
        s = set((await session.execute(q)).scalars().all())
        allowed = s if allowed is None else allowed & s
    if high_asthma:
        q = select(Indicator.geoid).where(
            Indicator.year == year_eff,
            Indicator.metric_name == "asthma_pct",
            Indicator.value >= 12.0,
        )
        s = set((await session.execute(q)).scalars().all())
        allowed = s if allowed is None else allowed & s
    if allowed is not None:
        stmt = stmt.where(Tract.geoid.in_(allowed))

    id_subq = stmt.with_only_columns(Tract.geoid).order_by(None).subquery()
    total = (await session.execute(select(func.count()).select_from(id_subq))).scalar() or 0

    stmt = stmt.offset(offset).limit(limit)
    res = await session.execute(stmt)
    items: list[TractSummary] = []
    for tract, score in res.all():
        items.append(
            TractSummary(
                geoid=tract.geoid,
                name=tract.name,
                state_fips=tract.state_fips,
                county_fips=tract.county_fips,
                county_name=tract.county_name,
                place_name=tract.place_name,
                urban_rural=tract.urban_rural,
                composite_score=float(score),
                year=year_eff,
            )
        )
    return TractListResponse(items=items, total=int(total))


@router.get("/{geoid}", response_model=TractDetail)
async def get_tract(
    geoid: str,
    session: Annotated[AsyncSession, Depends(get_db)],
    year: int | None = None,
) -> TractDetail:
    tract = await session.get(Tract, geoid)
    if not tract:
        raise HTTPException(status_code=404, detail="Tract not found")

    year_eff = year
    if year_eff is None:
        yq = await session.execute(select(func.max(Indicator.year)).where(Indicator.geoid == geoid))
        year_eff = yq.scalar() or 2023

    ind_res = await session.execute(select(Indicator).where(Indicator.geoid == geoid))
    indicators = [
        IndicatorOut(
            source=i.source,
            metric_name=i.metric_name,
            value=i.value,
            year=i.year,
            percentile_national=i.percentile_national,
            percentile_state=i.percentile_state,
        )
        for i in ind_res.scalars().all()
    ]

    rs = await session.get(RiskScore, (geoid, year_eff))
    if rs is None:
        r2 = await session.execute(
            select(RiskScore).where(RiskScore.geoid == geoid).order_by(RiskScore.year.desc()).limit(1)
        )
        rs = r2.scalars().first()
        year_eff = rs.year if rs else year_eff

    risk_out = None
    if rs:
        risk_out = RiskScoreOut(
            geoid=rs.geoid,
            year=rs.year,
            composite_score=rs.composite_score,
            component_scores=rs.component_scores,
            weights_used=rs.weights_used,
            computed_at=rs.computed_at.isoformat() if rs.computed_at else None,
        )

    return TractDetail(
        geoid=tract.geoid,
        name=tract.name,
        state_fips=tract.state_fips,
        county_fips=tract.county_fips,
        county_name=tract.county_name,
        place_name=tract.place_name,
        urban_rural=tract.urban_rural,
        composite_score=rs.composite_score if rs else None,
        year=rs.year if rs else None,
        centroid_lat=tract.centroid_lat,
        centroid_lon=tract.centroid_lon,
        indicators=indicators,
        risk_score=risk_out,
    )


@router.get("/{geoid}/score", response_model=TractScoreDetail)
async def get_tract_score(
    geoid: str,
    session: Annotated[AsyncSession, Depends(get_db)],
    year: int | None = None,
    rent_burden_pct: float | None = None,
    overcrowding_pct: float | None = None,
    vacancy_rate: float | None = None,
    uninsured_pct: float | None = None,
    asthma_pct: float | None = None,
    disability_pct: float | None = None,
    heat_index: float | None = None,
) -> TractScoreDetail:
    weights = _weights_from_query(
        rent_burden_pct=rent_burden_pct,
        overcrowding_pct=overcrowding_pct,
        vacancy_rate=vacancy_rate,
        uninsured_pct=uninsured_pct,
        asthma_pct=asthma_pct,
        disability_pct=disability_pct,
        heat_index=heat_index,
    )
    w = clamp_weights(weights)

    year_eff = year
    if year_eff is None:
        yq = await session.execute(select(func.max(RiskScore.year)))
        year_eff = yq.scalar() or 2023

    metric_map = await load_metric_map_for_year(session, year_eff)
    cohort = [
        TractValues(geoid=g, values={m: vals.get(m) for m in METRIC_KEYS})
        for g, vals in metric_map.items()
        if all(vals.get(m) is not None for m in METRIC_KEYS)
    ]
    scores = compute_batch_scores(cohort, w)
    if geoid not in scores:
        raise HTTPException(status_code=404, detail="Tract not found or incomplete indicators")

    composite, components = scores[geoid]
    return TractScoreDetail(
        geoid=geoid,
        year=year_eff,
        composite_score=composite,
        component_scores=components,
        weights_used=w,
    )


@router.get("/{geoid}/summary", response_model=AISummaryOut)
async def get_tract_summary(
    geoid: str,
    session: Annotated[AsyncSession, Depends(get_db)],
    refresh: bool = False,
) -> AISummaryOut:
    tract = await session.get(Tract, geoid)
    if not tract:
        raise HTTPException(status_code=404, detail="Tract not found")
    row = await get_or_create_summary(session, geoid, force_refresh=refresh)
    return AISummaryOut(
        geoid=row.geoid,
        summary_text=row.summary_text,
        generated_at=row.generated_at.isoformat() if row.generated_at else "",
        model_version=row.model_version,
    )


