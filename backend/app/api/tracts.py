from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.models import Clinic, Indicator, RiskScore, Tract, TractClinic
from app.models.demographics import TractDemographics as TractDemographicsRow
from app.schemas.tract import (
    AISummaryOut,
    DisplayIndicator,
    IndicatorOut,
    NearbyClinic,
    RiskScoreOut,
    TractDemographics,
    TractDetail,
    TractListResponse,
    TractScoreDetail,
    TractScorePoint,
    TractScoreTrend,
    TractSummary,
)
from app.services.ai_service import get_or_create_summary
from app.services.risk_score import DEFAULT_WEIGHTS, METRIC_KEYS, TractValues, clamp_weights, compute_batch_scores
from app.services.score_recalc import get_cached_default_scores, get_cached_metric_map, resolve_year
from app.services.tract_list_filters import (
    TractListFilterParams,
    apply_tract_list_filters,
    build_list_tracts_select,
)

router = APIRouter(prefix="/api/tracts", tags=["tracts"])

ACS_2020_SCORE_TREND_NOTE = (
    "ACS 2020 data has elevated uncertainty due to COVID-19 collection disruptions."
)

_DISPLAY_INDICATOR_NAMES: dict[str, str] = {
    "obesity_pct": "Obesity",
    "depression_pct": "Depression",
    "cognitive_difficulty_pct": "Cognitive difficulty",
    "mobility_difficulty_pct": "Mobility difficulty",
    "smoking_pct": "Current smoking",
    "dental_visits_pct": "Dental visit rate",
    "diabetes_pct": "Diabetes",
    "physical_inactivity_pct": "Physical inactivity",
    "hypertension_pct": "High blood pressure",
    "insufficient_sleep_pct": "Insufficient sleep",
    "all_teeth_lost_pct": "All teeth lost",
}
_DISPLAY_ONLY_METRIC_NAMES: frozenset[str] = frozenset(_DISPLAY_INDICATOR_NAMES)


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
    max_clinic_distance_miles: float | None = Query(
        None,
        ge=0,
        le=500,
        description="When set, only tracts whose nearest operational FQHC (tract_clinics rank=1) is within this many miles",
    ),
    min_clinic_distance_miles: float | None = Query(
        None,
        ge=0,
        le=500,
        description="When set, only tracts with no nearest clinic within this many miles (care deserts: no rank-1 row or rank-1 distance exceeds threshold)",
    ),
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
    year_eff = await resolve_year(session, year)

    filter_params = TractListFilterParams(
        year_eff=year_eff,
        state=state,
        min_score=min_score,
        min_population=min_population,
        exclude_institutional=exclude_institutional,
        max_clinic_distance_miles=max_clinic_distance_miles,
        min_clinic_distance_miles=min_clinic_distance_miles,
        min_rent_burden=min_rent_burden,
        min_uninsured=min_uninsured,
        high_asthma=high_asthma,
        urban_rural=urban_rural,
        sort_by=sort_by,
    )
    stmt = build_list_tracts_select(filter_params)
    stmt = await apply_tract_list_filters(session, stmt, filter_params)

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

    n_years = await session.scalar(
        select(func.count(distinct(RiskScore.year))).where(RiskScore.geoid == geoid)
    )
    has_trend = int(n_years or 0) >= 2

    ind_res = await session.execute(
        select(Indicator).where(Indicator.geoid == geoid, Indicator.year == year_eff)
    )
    all_inds = ind_res.scalars().all()
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
        for i in all_inds
        if i.metric_name not in _DISPLAY_ONLY_METRIC_NAMES
    ]
    display_indicators = [
        DisplayIndicator(
            metric_name=i.metric_name,
            display_name=_DISPLAY_INDICATOR_NAMES.get(i.metric_name, i.metric_name),
            value=i.value,
            source=i.source,
        )
        for i in all_inds
        if i.metric_name in _DISPLAY_ONLY_METRIC_NAMES
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

    ind_by_metric = {i.metric_name: i for i in all_inds}
    _sc_parts = [
        DEFAULT_WEIGHTS[m] * (ind_by_metric[m].percentile_state or 50.0)
        for m in METRIC_KEYS
        if m in ind_by_metric
    ]
    state_composite_score: float | None = (
        round(max(0.0, min(100.0, sum(_sc_parts))), 4) if _sc_parts else None
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
        display_indicators=display_indicators,
        risk_score=risk_out,
        has_trend=has_trend,
        state_composite_score=state_composite_score,
    )


@router.get("/{geoid}/clinics", response_model=list[NearbyClinic])
async def get_tract_nearby_clinics(
    geoid: str,
    session: Annotated[AsyncSession, Depends(get_db)],
) -> list[NearbyClinic]:
    """Up to three nearest operational HRSA sites linked to this tract (precomputed distances)."""
    stmt = (
        select(
            Clinic.id,
            Clinic.name,
            Clinic.address,
            Clinic.city,
            Clinic.zip_code,
            Clinic.latitude,
            Clinic.longitude,
            Clinic.site_type,
            TractClinic.distance_miles,
            TractClinic.rank,
        )
        .select_from(TractClinic)
        .join(Clinic, TractClinic.clinic_id == Clinic.id)
        .where(
            TractClinic.geoid == geoid,
            Clinic.is_operational.is_(True),
        )
        .order_by(TractClinic.rank.asc())
        .limit(3)
    )
    rows = (await session.execute(stmt)).all()
    return [
        NearbyClinic(
            clinic_id=int(cid),
            name=str(name),
            address=address,
            city=city,
            zip_code=zip_code,
            latitude=float(lat),
            longitude=float(lon),
            distance_miles=round(float(dist_mi), 2),
            rank=int(rnk),
            site_type=site_type,
        )
        for cid, name, address, city, zip_code, lat, lon, site_type, dist_mi, rnk in rows
    ]


@router.get("/{geoid}/trend", response_model=TractScoreTrend)
async def get_tract_score_trend(
    geoid: str,
    session: Annotated[AsyncSession, Depends(get_db)],
) -> TractScoreTrend:
    tract = await session.get(Tract, geoid)
    if tract is None:
        raise HTTPException(status_code=404, detail="Tract not found")

    rows = (
        (
            await session.execute(
                select(RiskScore.year, RiskScore.composite_score)
                .where(RiskScore.geoid == geoid)
                .order_by(RiskScore.year.asc())
            )
        )
        .all()
    )
    if not rows:
        raise HTTPException(status_code=404, detail="No risk scores for this tract")

    trend: list[TractScorePoint] = []
    for yr, composite in rows:
        trend.append(
            TractScorePoint(
                year=int(yr),
                composite_score=float(composite),
                data_quality_note=ACS_2020_SCORE_TREND_NOTE if int(yr) == 2020 else None,
            )
        )
    return TractScoreTrend(geoid=geoid, trend=trend)


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
    structural_vacancy_rate: float | None = None,
    uninsured_pct: float | None = None,
    asthma_pct: float | None = None,
    mental_health_pct: float | None = None,
    heat_index: float | None = None,
) -> TractScoreDetail:
    weights = _weights_from_query(
        rent_burden_pct=rent_burden_pct,
        overcrowding_pct=overcrowding_pct,
        structural_vacancy_rate=structural_vacancy_rate,
        uninsured_pct=uninsured_pct,
        asthma_pct=asthma_pct,
        mental_health_pct=mental_health_pct,
        heat_index=heat_index,
    )
    w = clamp_weights(weights)

    year_eff = await resolve_year(session, year)

    # Component scores are min-max normalized against the full cohort and are
    # weight-independent, so the cached values are valid for any weight vector.
    cached_scores = await get_cached_default_scores(session, year_eff)
    cached_entry = cached_scores.get(geoid)

    if cached_entry is not None:
        _, component_scores = cached_entry
        composite = round(
            max(0.0, min(100.0, sum(w[m] * component_scores[m] for m in METRIC_KEYS))),
            4,
        )
        return TractScoreDetail(
            geoid=geoid,
            year=year_eff,
            composite_score=composite,
            component_scores=component_scores,
            weights_used=w,
        )

    # Fallback: tract not in scores cache (missing core indicators).
    metric_map = await get_cached_metric_map(session, year_eff)
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


