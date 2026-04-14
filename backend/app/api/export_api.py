from __future__ import annotations

import csv
import io
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models import RiskScore, Tract
from app.services.pdf_export import build_pdf_bytes, write_temp_pdf

router = APIRouter(prefix="/api/export", tags=["export"])


class PDFBody(BaseModel):
    geoid: str = Field(..., min_length=11, max_length=11)
    year: int | None = None


class PDFJobResponse(BaseModel):
    job_id: str
    message: str
    download_url: str


@router.post("/pdf", response_model=PDFJobResponse)
async def export_pdf(
    body: PDFBody,
    session: Annotated[AsyncSession, Depends(get_db)],
) -> PDFJobResponse:
    tract = await session.get(Tract, body.geoid)
    if not tract:
        raise HTTPException(status_code=404, detail="Tract not found")
    try:
        data = await build_pdf_bytes(session, body.geoid, body.year)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    path = write_temp_pdf(data)
    job_id = uuid.uuid4().hex
    return PDFJobResponse(
        job_id=job_id,
        message="PDF ready",
        download_url=f"/api/export/pdf/file/{path.name}",
    )


@router.get("/tracts.csv")
async def export_tracts_csv(
    session: Annotated[AsyncSession, Depends(get_db)],
    state: str | None = Query(None),
    min_score: float | None = Query(None),
    year: int | None = None,
) -> StreamingResponse:
    """CSV export of filtered tracts (same filters as GET /api/tracts)."""
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

    res = await session.execute(stmt)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["geoid", "name", "state_fips", "county_name", "composite_score", "year"])
    for tract, score in res.all():
        w.writerow(
            [
                tract.geoid,
                tract.name or "",
                tract.state_fips,
                tract.county_name or "",
                f"{float(score):.4f}" if score is not None else "",
                year_eff,
            ]
        )
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
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
    return FileResponse(path, media_type="application/pdf", filename="neighborhealth-report.pdf")
