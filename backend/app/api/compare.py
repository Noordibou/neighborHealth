from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models import Indicator, RiskScore, Tract
from app.schemas.tract import CompareResponse, IndicatorOut
from app.services.risk_score import METRIC_KEYS, TractValues, compute_batch_scores
from app.services.score_recalc import load_metric_map_for_year

router = APIRouter(prefix="/api/compare", tags=["compare"])


@router.get("", response_model=CompareResponse)
async def compare_tracts(
    session: Annotated[AsyncSession, Depends(get_db)],
    geoids: str = Query(..., description="Comma-separated GEOIDs (2–4 tracts)"),
    year: int | None = None,
) -> CompareResponse:
    parts = [g.strip() for g in geoids.split(",") if g.strip()]
    if len(parts) < 2 or len(parts) > 4:
        raise HTTPException(status_code=400, detail="Provide between 2 and 4 GEOIDs")

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
    scores = compute_batch_scores(cohort)

    series: list[dict[str, float | str]] = []
    raw: dict[str, list[IndicatorOut]] = {}

    for gid in parts:
        t = await session.get(Tract, gid)
        if not t:
            raise HTTPException(status_code=404, detail=f"Tract {gid} not found")
        if gid not in scores:
            raise HTTPException(status_code=400, detail=f"Tract {gid} missing core indicators for year {year_eff}")
        _, comp = scores[gid]
        row: dict[str, float | str] = {"geoid": gid, "label": t.name or gid}
        row.update({k: float(comp[k]) for k in METRIC_KEYS})
        series.append(row)

        ind_res = await session.execute(
            select(Indicator).where(Indicator.geoid == gid, Indicator.metric_name.in_(METRIC_KEYS))
        )
        raw[gid] = [
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

    return CompareResponse(
        geoids=parts,
        year=year_eff,
        indicators=list(METRIC_KEYS),
        series=series,
        raw_indicators=raw,
    )
