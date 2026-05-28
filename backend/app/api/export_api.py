from __future__ import annotations

import asyncio
import csv
import io
import logging
import os
import uuid
from collections import defaultdict
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import and_, func, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models import Indicator, RiskScore, Tract, TractClinic, TractDemographics
from app.services.pdf_export import build_compare_pdf_bytes, build_pdf_bytes, load_compare_data_for_pdf, write_temp_pdf
from app.services.risk_score import METRIC_KEYS
from app.services.score_recalc import resolve_year
from app.services.tract_list_filters import (
    TractListFilterParams,
    apply_tract_list_filters,
    build_list_tracts_select,
)

router = APIRouter(prefix="/api/export", tags=["export"])

log = logging.getLogger(__name__)


async def _delete_after_delay(path: str, delay: float = 5.0) -> None:
    await asyncio.sleep(delay)
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass


class PDFBody(BaseModel):
    geoid: str = Field(..., min_length=11, max_length=11)
    year: int | None = None


class CompareCSVBody(BaseModel):
    """2–4 tract GEOIDs for server-side compare CSV export."""

    geoids: list[str] = Field(..., min_length=2, max_length=4)

    @field_validator("geoids")
    @classmethod
    def validate_geoids(cls, v: list[str]) -> list[str]:
        out = [g.strip() for g in v if g and str(g).strip()]
        if len(out) < 2 or len(out) > 4:
            raise ValueError("Provide between 2 and 4 GEOIDs")
        for g in out:
            if len(g) != 11 or not g.isdigit():
                raise ValueError("Each GEOID must be an 11-digit string")
        return out


class TractCSVBody(BaseModel):
    """Single tract GEOID — same wide CSV columns as compare export."""

    geoid: str = Field(..., min_length=11, max_length=11)

    @field_validator("geoid")
    @classmethod
    def validate_geoid(cls, v: str) -> str:
        g = v.strip()
        if len(g) != 11 or not g.isdigit():
            raise ValueError("GEOID must be an 11-digit string")
        return g


class PDFJobResponse(BaseModel):
    job_id: str
    message: str
    download_url: str


def _expanded_csv_headers() -> list[str]:
    cols = ["geoid", "name", "state_fips", "county_name", "year", "composite_score"]
    for m in METRIC_KEYS:
        cols.extend([m, f"{m}_national_pctile", f"{m}_state_pctile"])
    cols.extend(["median_rent", "median_household_income", "population"])
    return cols


def _csv_missing(v: Any) -> bool:
    if v is None:
        return True
    if isinstance(v, float) and v != v:
        return True
    return False


def _fmt_metric_value(v: Any) -> str:
    """Metric raw values (incl. % metrics, heat index): 2 decimal places."""
    if _csv_missing(v):
        return ""
    return f"{float(v):.2f}"


def _fmt_percentile_rank(v: Any) -> str:
    """National / state percentile columns: 1 decimal place."""
    if _csv_missing(v):
        return ""
    return f"{float(v):.1f}"


def _fmt_composite(v: Any) -> str:
    if _csv_missing(v):
        return ""
    return f"{float(v):.1f}"


def _fmt_int_field(v: Any) -> str:
    """Median rent, median household income, population: nearest integer, no decimals."""
    if _csv_missing(v):
        return ""
    return str(int(round(float(v))))


def _tract_population(tract: Tract, population_fallback: float | None) -> float | None:
    if tract.population is not None and not _csv_missing(tract.population):
        return float(tract.population)
    return population_fallback


def _csv_state_fips(tract: Tract) -> str:
    """Two-digit state FIPS for CSV (e.g. Alaska → '02')."""
    return str(tract.state_fips).zfill(2)


def _expanded_csv_row(
    tract: Tract,
    composite_score: float | None,
    year_eff: int,
    ind_by_geoid: dict[str, dict[str, dict[str, Any]]],
    population_fallback: float | None,
) -> list[str]:
    im = ind_by_geoid.get(tract.geoid, {})
    pop = _tract_population(tract, population_fallback)
    row: list[str] = [
        tract.geoid,
        tract.name or "",
        _csv_state_fips(tract),
        tract.county_name or "",
        str(year_eff),
        _fmt_composite(composite_score),
    ]
    for m in METRIC_KEYS:
        cell = im.get(m, {})
        row.append(_fmt_metric_value(cell.get("value")))
        row.append(_fmt_percentile_rank(cell.get("pct_nat")))
        row.append(_fmt_percentile_rank(cell.get("pct_st")))
    row.append(_fmt_int_field(tract.median_rent))
    row.append(_fmt_int_field(tract.median_household_income))
    row.append(_fmt_int_field(pop))
    return row


async def _indicator_maps_by_geoid(
    session: AsyncSession, geoids: list[str], year_eff: int
) -> dict[str, dict[str, dict[str, Any]]]:
    if not geoids:
        return {}
    out: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    q = await session.execute(
        select(Indicator).where(
            Indicator.geoid.in_(geoids),
            Indicator.year == year_eff,
            Indicator.metric_name.in_(METRIC_KEYS),
        )
    )
    for row in q.scalars():
        out[row.geoid][row.metric_name] = {
            "value": row.value,
            "pct_nat": row.percentile_national,
            "pct_st": row.percentile_state,
        }
    return dict(out)


async def _latest_risk_year_score_by_geoid(
    session: AsyncSession, geoids: list[str]
) -> dict[str, tuple[int, float | None]]:
    """Latest (max year) risk score row per GEOID among requested geoids."""
    if not geoids:
        return {}
    subq = (
        select(RiskScore.geoid, func.max(RiskScore.year).label("yr"))
        .where(RiskScore.geoid.in_(geoids))
        .group_by(RiskScore.geoid)
    ).subquery()
    q = await session.execute(
        select(RiskScore.geoid, RiskScore.year, RiskScore.composite_score).join(
            subq,
            and_(RiskScore.geoid == subq.c.geoid, RiskScore.year == subq.c.yr),
        )
    )
    out: dict[str, tuple[int, float | None]] = {}
    for geoid, yr, score in q.all():
        out[str(geoid)] = (int(yr), float(score) if score is not None else None)
    return out


async def _indicator_maps_for_geoid_year_pairs(
    session: AsyncSession, geoid_year_pairs: list[tuple[str, int]]
) -> dict[str, dict[str, dict[str, Any]]]:
    if not geoid_year_pairs:
        return {}
    out: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    q = await session.execute(
        select(Indicator).where(
            tuple_(Indicator.geoid, Indicator.year).in_(geoid_year_pairs),
            Indicator.metric_name.in_(METRIC_KEYS),
        )
    )
    for row in q.scalars():
        out[row.geoid][row.metric_name] = {
            "value": row.value,
            "pct_nat": row.percentile_national,
            "pct_st": row.percentile_state,
        }
    return dict(out)


async def _population_by_geoid(session: AsyncSession, geoids: list[str]) -> dict[str, float | None]:
    if not geoids:
        return {}
    q = await session.execute(
        select(TractDemographics)
        .where(TractDemographics.geoid.in_(geoids))
        .order_by(TractDemographics.geoid, TractDemographics.year.desc())
    )
    out: dict[str, float | None] = {}
    for d in q.scalars():
        if d.geoid not in out:
            out[d.geoid] = d.total_population
    return out


async def _build_expanded_tract_csv_string(session: AsyncSession, ordered_geoids: list[str]) -> str:
    """Wide-format CSV (header + one row per GEOID in order). Raises HTTPException on missing data."""
    if not ordered_geoids:
        return ""
    risk_by_geoid = await _latest_risk_year_score_by_geoid(session, ordered_geoids)
    missing_risk = [g for g in ordered_geoids if g not in risk_by_geoid]
    if missing_risk:
        raise HTTPException(
            status_code=404,
            detail=f"No risk_scores row for GEOID(s): {', '.join(missing_risk)}",
        )

    tr_res = await session.execute(select(Tract).where(Tract.geoid.in_(ordered_geoids)))
    tract_by_geoid = {t.geoid: t for t in tr_res.scalars().all()}
    missing_tract = [g for g in ordered_geoids if g not in tract_by_geoid]
    if missing_tract:
        raise HTTPException(status_code=404, detail=f"Tract not found: {', '.join(missing_tract)}")

    pairs = [(g, risk_by_geoid[g][0]) for g in ordered_geoids]
    ind_by_geoid = await _indicator_maps_for_geoid_year_pairs(session, pairs)
    pop_fallback = await _population_by_geoid(session, ordered_geoids)

    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(_expanded_csv_headers())
    for gid in ordered_geoids:
        tract = tract_by_geoid[gid]
        year_g, score = risk_by_geoid[gid]
        w.writerow(
            _expanded_csv_row(
                tract,
                score,
                year_g,
                ind_by_geoid,
                pop_fallback.get(gid),
            )
        )
    buf.seek(0)
    return buf.getvalue().rstrip("\r\n")


@router.post("/compare-csv")
async def export_compare_csv(
    body: CompareCSVBody,
    session: Annotated[AsyncSession, Depends(get_db)],
) -> StreamingResponse:
    """Analyst-ready wide CSV: one row per tract, metrics + percentiles + tract context."""
    ordered_geoids = list(body.geoids)
    csv_str = await _build_expanded_tract_csv_string(session, ordered_geoids)
    return StreamingResponse(
        iter([csv_str]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="neighborhealth-compare.csv"'},
    )


@router.post("/compare-pdf")
async def export_compare_pdf(
    body: CompareCSVBody,
    session: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    if len(body.geoids) < 2 or len(body.geoids) > 4:
        raise HTTPException(422, "Provide 2–4 geoids")
    try:
        compare_data = await load_compare_data_for_pdf(
            session, body.geoids, None
        )
        pdf_bytes = await asyncio.wait_for(
            asyncio.to_thread(build_compare_pdf_bytes, compare_data),
            timeout=30.0,
        )
    except asyncio.TimeoutError:
        log.error("Compare PDF generation timed out")
        raise HTTPException(504, "PDF generation timed out")
    except Exception as e:
        log.error("Compare PDF generation failed: %s", e, exc_info=True)
        raise HTTPException(500, "PDF generation failed")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": 'attachment; filename="neighborhealth-compare.pdf"'
        },
    )


@router.post("/tract-csv")
async def export_tract_csv(
    body: TractCSVBody,
    session: Annotated[AsyncSession, Depends(get_db)],
) -> StreamingResponse:
    """Same wide CSV as compare export, single tract row."""
    gid = body.geoid
    csv_str = await _build_expanded_tract_csv_string(session, [gid])
    return StreamingResponse(
        iter([csv_str]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="neighborhealth-tract-{gid}.csv"'},
    )


@router.post("/pdf", response_model=PDFJobResponse)
async def export_pdf(
    body: PDFBody,
    session: Annotated[AsyncSession, Depends(get_db)],
) -> PDFJobResponse:
    tract = await session.get(Tract, body.geoid)
    if not tract:
        raise HTTPException(status_code=404, detail="Tract not found")
    try:
        data = await asyncio.wait_for(
            build_pdf_bytes(session, body.geoid, body.year),
            timeout=30.0,
        )
    except asyncio.TimeoutError:
        log.error("PDF generation timed out for geoid=%s", body.geoid)
        raise HTTPException(504, "PDF generation timed out")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    path = write_temp_pdf(data)
    job_id = uuid.uuid4().hex
    return PDFJobResponse(
        job_id=job_id,
        message="PDF ready",
        download_url=f"/api/export/pdf/file/{path.name}",
    )


_FILTERED_EXPORT_METRICS = (
    "rent_burden_pct",
    "uninsured_pct",
    "asthma_pct",
    "mental_health_pct",
)


def _filtered_tract_csv_headers() -> list[str]:
    return [
        "geoid",
        "name",
        "county_name",
        "state_fips",
        "composite_score",
        "rent_burden_pct",
        "uninsured_pct",
        "asthma_pct",
        "mental_health_pct",
        "nearest_clinic_miles",
        "median_household_income",
        "population",
    ]


async def _indicator_values_by_geoid(
    session: AsyncSession, geoids: list[str], year_eff: int, metric_names: tuple[str, ...]
) -> dict[str, dict[str, float | None]]:
    if not geoids:
        return {}
    out: dict[str, dict[str, float | None]] = defaultdict(dict)
    q = await session.execute(
        select(Indicator).where(
            Indicator.geoid.in_(geoids),
            Indicator.year == year_eff,
            Indicator.metric_name.in_(metric_names),
        )
    )
    for row in q.scalars():
        out[row.geoid][row.metric_name] = float(row.value) if row.value is not None else None
    return dict(out)


async def _nearest_clinic_miles_by_geoid(session: AsyncSession, geoids: list[str]) -> dict[str, float | None]:
    if not geoids:
        return {}
    q = await session.execute(
        select(TractClinic.geoid, TractClinic.distance_miles).where(
            TractClinic.geoid.in_(geoids),
            TractClinic.rank == 1,
        )
    )
    return {g: float(d) if d is not None else None for g, d in q.all()}


@router.get("/filtered-tracts")
async def export_filtered_tracts_csv(
    session: Annotated[AsyncSession, Depends(get_db)],
    state_fips: str | None = Query(None, description="2-digit state FIPS"),
    min_score: float = Query(0, ge=0, le=100),
    min_population: int = Query(0, ge=0),
    exclude_institutional: bool = Query(False),
    min_rent_burden: float | None = Query(None),
    min_uninsured: float | None = Query(None),
    high_asthma: bool | None = Query(None),
    max_clinic_dist: float | None = Query(
        None, ge=0, le=500, description="Max miles to nearest FQHC (rank 1)"
    ),
    min_clinic_dist: float | None = Query(
        None, ge=0, le=500, description="Care desert: no clinic within this many miles"
    ),
    year: int | None = None,
) -> StreamingResponse:
    """CSV of all tracts matching explore/list filters (no pagination cap)."""
    year_eff = await resolve_year(session, year)
    max_clinic_distance_miles = max_clinic_dist
    min_clinic_distance_miles = min_clinic_dist

    filter_params = TractListFilterParams(
        year_eff=year_eff,
        state=state_fips,
        min_score=min_score,
        min_population=min_population,
        exclude_institutional=exclude_institutional,
        max_clinic_distance_miles=max_clinic_distance_miles,
        min_clinic_distance_miles=min_clinic_distance_miles,
        min_rent_burden=min_rent_burden,
        min_uninsured=min_uninsured,
        high_asthma=high_asthma,
        urban_rural=None,
        sort_by="composite",
    )
    stmt = build_list_tracts_select(filter_params)
    stmt = await apply_tract_list_filters(session, stmt, filter_params)
    res = await session.execute(stmt)
    rows = list(res.all())

    geoids = [tract.geoid for tract, _ in rows]
    ind_by_geoid = await _indicator_values_by_geoid(session, geoids, year_eff, _FILTERED_EXPORT_METRICS)
    clinic_by_geoid = await _nearest_clinic_miles_by_geoid(session, geoids)

    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(_filtered_tract_csv_headers())
    for tract, score in rows:
        im = ind_by_geoid.get(tract.geoid, {})
        clinic_mi = clinic_by_geoid.get(tract.geoid)
        w.writerow(
            [
                tract.geoid,
                tract.name or "",
                tract.county_name or "",
                str(tract.state_fips).zfill(2),
                _fmt_composite(score),
                _fmt_metric_value(im.get("rent_burden_pct")),
                _fmt_metric_value(im.get("uninsured_pct")),
                _fmt_metric_value(im.get("asthma_pct")),
                _fmt_metric_value(im.get("mental_health_pct")),
                _fmt_metric_value(clinic_mi),
                _fmt_int_field(tract.median_household_income),
                _fmt_int_field(tract.population),
            ]
        )
    buf.seek(0)
    csv_body = buf.getvalue().rstrip("\r\n")
    return StreamingResponse(
        iter([csv_body]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="neighborhealth-filtered-tracts.csv"'},
    )


@router.get("/tracts.csv")
async def export_tracts_csv(
    session: Annotated[AsyncSession, Depends(get_db)],
    state: str | None = Query(None),
    min_score: float | None = Query(None),
    year: int | None = None,
) -> StreamingResponse:
    """CSV export of filtered tracts (same filters as GET /api/tracts)."""
    year_eff = await resolve_year(session, year)

    stmt = (
        select(Tract, RiskScore.composite_score)
        .join(RiskScore, and_(RiskScore.geoid == Tract.geoid, RiskScore.year == year_eff))
        .order_by(RiskScore.composite_score.desc())
    )
    if state:
        stmt = stmt.where(Tract.state_fips == state.zfill(2))
    if min_score is not None:
        stmt = stmt.where(RiskScore.composite_score >= min_score)

    res = await session.execute(stmt)
    rows = list(res.all())
    geoids = [t.geoid for t, _ in rows]
    ind_by_geoid = await _indicator_maps_by_geoid(session, geoids, year_eff)
    pop_by_geoid = await _population_by_geoid(session, geoids)

    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(_expanded_csv_headers())
    for tract, score in rows:
        w.writerow(
            _expanded_csv_row(tract, score, year_eff, ind_by_geoid, pop_by_geoid.get(tract.geoid))
        )
    buf.seek(0)
    csv_body = buf.getvalue().rstrip("\r\n")
    return StreamingResponse(
        iter([csv_body]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="tracts.csv"'},
    )


@router.get("/pdf/file/{filename}")
async def download_pdf_file(filename: str) -> FileResponse:
    from pathlib import Path

    base = Path(__file__).resolve().parents[2] / "tmp_exports"
    path = base / filename
    if not path.is_file() or path.parent != base.resolve():
        raise HTTPException(status_code=404, detail="File not found")
    response = FileResponse(path, media_type="application/pdf", filename="neighborhealth-report.pdf")
    asyncio.create_task(_delete_after_delay(str(path)))
    return response
