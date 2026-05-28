"""Shared tract-list filter query building for GET /api/tracts and CSV export."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from sqlalchemy import Select, and_, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models import Indicator, RiskScore, Tract, TractClinic


@dataclass(frozen=True)
class TractListFilterParams:
    year_eff: int
    state: str | None
    min_score: float
    min_population: int
    exclude_institutional: bool
    max_clinic_distance_miles: float | None
    min_clinic_distance_miles: float | None
    min_rent_burden: float | None
    min_uninsured: float | None
    high_asthma: bool | None
    urban_rural: str | None
    sort_by: Literal["composite", "housing", "health"] = "composite"


async def _indicator_allowed_geoids(
    session: AsyncSession,
    year_eff: int,
    *,
    min_rent_burden: float | None,
    min_uninsured: float | None,
    high_asthma: bool | None,
) -> set[str] | None:
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
    return allowed


def build_list_tracts_select(params: TractListFilterParams) -> Select:
    """Build a tract + composite_score select with filters applied (no offset/limit)."""
    year_eff = params.year_eff
    sort_by = params.sort_by

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
            .where(RiskScore.composite_score >= params.min_score)
            .order_by(rent_ind.value.desc().nulls_last(), RiskScore.composite_score.desc())
        )
    elif sort_by == "health":
        iu = aliased(Indicator)
        ia = aliased(Indicator)
        imh = aliased(Indicator)
        blend_num = (
            case((iu.value.is_not(None), iu.value), else_=0)
            + case((ia.value.is_not(None), ia.value), else_=0)
            + case((imh.value.is_not(None), imh.value), else_=0)
        )
        blend_den = (
            case((iu.value.is_not(None), 1), else_=0)
            + case((ia.value.is_not(None), 1), else_=0)
            + case((imh.value.is_not(None), 1), else_=0)
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
                imh,
                and_(imh.geoid == Tract.geoid, imh.year == year_eff, imh.metric_name == "mental_health_pct"),
            )
            .where(RiskScore.composite_score >= params.min_score)
            .order_by(health_blend.desc().nulls_last(), RiskScore.composite_score.desc())
        )
    else:
        stmt = (
            select(Tract, RiskScore.composite_score)
            .join(RiskScore, and_(RiskScore.geoid == Tract.geoid, RiskScore.year == year_eff))
            .where(RiskScore.composite_score >= params.min_score)
            .order_by(RiskScore.composite_score.desc())
        )

    if params.state:
        stmt = stmt.where(Tract.state_fips == params.state.zfill(2))
    if params.min_population > 0:
        stmt = stmt.where(Tract.population >= params.min_population)
    if params.exclude_institutional:
        stmt = stmt.where(Tract.is_institutional.is_(False))
    if params.urban_rural:
        stmt = stmt.where(Tract.urban_rural == params.urban_rural)

    return stmt


async def apply_tract_list_filters(
    session: AsyncSession,
    stmt: Select,
    params: TractListFilterParams,
) -> Select:
    """Apply indicator and clinic filters shared by list + export endpoints."""
    allowed = await _indicator_allowed_geoids(
        session,
        params.year_eff,
        min_rent_burden=params.min_rent_burden,
        min_uninsured=params.min_uninsured,
        high_asthma=params.high_asthma,
    )
    if allowed is not None:
        stmt = stmt.where(Tract.geoid.in_(allowed))

    if params.max_clinic_distance_miles is not None:
        tc1 = aliased(TractClinic)
        stmt = stmt.join(
            tc1,
            and_(
                tc1.geoid == Tract.geoid,
                tc1.rank == 1,
                tc1.distance_miles <= params.max_clinic_distance_miles,
            ),
        )
    elif params.min_clinic_distance_miles is not None:
        has_clinic_within = (
            select(TractClinic.geoid)
            .where(
                TractClinic.rank == 1,
                TractClinic.distance_miles <= params.min_clinic_distance_miles,
            )
            .distinct()
        )
        stmt = stmt.where(~Tract.geoid.in_(has_clinic_within))

    return stmt
