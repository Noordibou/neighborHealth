from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.db.session import get_db
from app.models import Indicator, RiskScore, Tract
from app.models.demographics import TractDemographics as TractDemographicsRow
from app.schemas.tract import (
    AISummaryOut,
    IndicatorOut,
    RiskScoreOut,
    TractDemographics,
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
    min_score: float = Query(0, ge=0, le=100, description="Minimum composite risk score"),
    min_population: int = Query(0, ge=0, description="Minimum tract population (ACS total on tracts.population)"),
    exclude_institutional: bool = Query(False, description="Exclude tracts flagged as predominantly group quarters"),
    min_rent_burden: float | None = None,
    min_uninsured: float | None = None,
    high_asthma: bool | None = None,
    urban_rural: str | None = Query(None, description="urban | rural"),
    year: int | None = Query(None, description="Risk score / indicator year"),
    sort_by: Literal["composite", "housing", "health"] = Query(
        "composite",
        description="Ranking order: composite index, rent burden (housing layer), or uninsured/asthma/disability blend (health layer)",
    ),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> TractListResponse:
    """Filtered tract list with composite scores; ordered by sort_by (default composite descending)."""
    year_eff = year
    if year_eff is None:
        yq = await session.execute(select(func.max(RiskScore.year)))
        year_eff = yq.scalar() or 2023

    if sort_by == "housing":
        rent_ind = aliased(Indicator)
        stmt = (
            select(Tract, RiskScore.composite_score, rent_ind.value)
            .join(RiskScore, and_(RiskScore.geoid == Tract.geoid, RiskScore.year == year_eff))
            .outerjoin(
                rent_ind,
                and_(
                    rent_ind.geoid == Tract.geoid,
                    rent_ind.year == year_eff,
                    rent_ind.metric_name == "rent_burden_pct",
                ),
            )
            .where(RiskScore.composite_score >= min_score)
            .order_by(rent_ind.value.desc().nulls_last(), RiskScore.composite_score.desc())
        )
    elif sort_by == "health":
        iu = aliased(Indicator)
        ia = aliased(Indicator)
        idis = aliased(Indicator)
        blend_num = (
            case((iu.value.is_not(None), iu.value), else_=0)
            + case((ia.value.is_not(None), ia.value), else_=0)
            + case((idis.value.is_not(None), idis.value), else_=0)
        )
        blend_den = (
            case((iu.value.is_not(None), 1), else_=0)
            + case((ia.value.is_not(None), 1), else_=0)
            + case((idis.value.is_not(None), 1), else_=0)
        )
        health_blend = blend_num / func.nullif(blend_den, 0)
        stmt = (
            select(Tract, RiskScore.composite_score, health_blend.label("health_blend"))
            .join(RiskScore, and_(RiskScore.geoid == Tract.geoid, RiskScore.year == year_eff))
            .outerjoin(
                iu,
                and_(iu.geoid == Tract.geoid, iu.year == year_eff, iu.metric_name == "uninsured_pct"),
            )
            .outerjoin(
                ia,
                and_(ia.geoid == Tract.geoid, ia.year == year_eff, ia.metric_name == "asthma_pct"),
            )
            .outerjoin(
                idis,
                and_(idis.geoid == Tract.geoid, idis.year == year_eff, idis.metric_name == "disability_pct"),
            )
            .where(RiskScore.composite_score >= min_score)
            .order_by(health_blend.desc().nulls_last(), RiskScore.composite_score.desc())
        )
    else:
        stmt = (
            select(Tract, RiskScore.composite_score)
            .join(RiskScore, and_(RiskScore.geoid == Tract.geoid, RiskScore.year == year_eff))
            .where(RiskScore.composite_score >= min_score)
            .order_by(RiskScore.composite_score.desc())
        )
    if state:
        stmt = stmt.where(Tract.state_fips == state.zfill(2))
    if min_population > 0:
        stmt = stmt.where(Tract.population >= min_population)
    if exclude_institutional:
        stmt = stmt.where(Tract.is_institutional.is_(False))
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
    for row in res.all():
        if sort_by == "composite":
            tract, score = row
            layer_value = float(score)
        elif sort_by == "housing":
            tract, score, rent_v = row
            layer_value = float(rent_v) if rent_v is not None else None
        else:
            tract, score, hb = row
            layer_value = float(hb) if hb is not None else None

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
                layer_value=layer_value,
            )
        )
    return TractListResponse(items=items, total=int(total))


@router.get("/{geoid}", response_model=TractDetail)
async def get_tract(
    geoid: str,
    session: Annotated[AsyncSession, Depends(get_db)],
    year: int | None = None,
) -> TractDetail:
    tract_result = await session.execute(select(Tract).where(Tract.geoid == geoid))
    tract = tract_result.scalar_one_or_none()
    if not tract:
        raise HTTPException(status_code=404, detail="Tract not found")

    year_eff = year
    if year_eff is None:
        yq = await session.execute(select(func.max(Indicator.year)).where(Indicator.geoid == geoid))
        year_eff = yq.scalar() or 2023

    ind_res = await session.execute(
        select(Indicator).where(Indicator.geoid == geoid, Indicator.year == year_eff)
    )
    indicators = [
        IndicatorOut(
            source=i.source,
            metric_name=i.metric_name,
            value=i.value,
            value_moe=i.value_moe,
            year=i.year,
            percentile_national=i.percentile_national,
            percentile_state=i.percentile_state,
            percentile_county=i.percentile_county,
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
        rk: int | None = None
        rt: int | None = None
        if rs.composite_score is not None:
            rank_sq = (
                select(
                    RiskScore.geoid,
                    RiskScore.year,
                    func.row_number()
                    .over(partition_by=RiskScore.year, order_by=RiskScore.composite_score.desc())
                    .label("rn"),
                    func.count().over(partition_by=RiskScore.year).label("rt"),
                ).subquery()
            )
            rr = await session.execute(
                select(rank_sq.c.rn, rank_sq.c.rt).where(
                    rank_sq.c.geoid == geoid,
                    rank_sq.c.year == rs.year,
                )
            )
            rank_row = rr.first()
            if rank_row:
                rk = int(rank_row[0]) if rank_row[0] is not None else None
                rt = int(rank_row[1]) if rank_row[1] is not None else None
        risk_out = RiskScoreOut(
            geoid=rs.geoid,
            year=rs.year,
            composite_score=rs.composite_score,
            component_scores=rs.component_scores,
            weights_used=rs.weights_used,
            computed_at=rs.computed_at.isoformat() if rs.computed_at else None,
            rank=rk,
            rank_total=rt,
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
        median_rent=tract.median_rent,
        median_household_income=tract.median_household_income,
        indicators=indicators,
        risk_score=risk_out,
    )


@router.get("/{geoid}/demographics", response_model=TractDemographics)
async def get_tract_demographics(
    geoid: str,
    session: Annotated[AsyncSession, Depends(get_db)],
) -> TractDemographics:
    stmt = (
        select(TractDemographicsRow)
        .where(TractDemographicsRow.geoid == geoid)
        .order_by(TractDemographicsRow.year.desc())
        .limit(1)
    )
    r = (await session.execute(stmt)).scalar_one_or_none()
    if r is None:
        raise HTTPException(status_code=404, detail="Demographics not available for this tract.")
    return TractDemographics(
        geoid=r.geoid,
        year=r.year,
        total_population=r.total_population,
        median_age=r.median_age,
        pct_white=r.pct_white,
        pct_black=r.pct_black,
        pct_hispanic=r.pct_hispanic,
        pct_asian=r.pct_asian,
        pct_other_race=r.pct_other_race,
        pct_non_english_home=r.pct_non_english_home,
        pct_foreign_born=r.pct_foreign_born,
        pct_no_hs_diploma=r.pct_no_hs_diploma,
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


