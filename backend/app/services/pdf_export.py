"""PDF report generation with WeasyPrint."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path

from jinja2 import Template
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from weasyprint import HTML

from app.models import AISummary, Indicator, RiskScore, Tract
from app.services.risk_score import METRIC_KEYS


TEMPLATE = Template(
    """
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <style>
    body { font-family: system-ui, sans-serif; margin: 24px; color: #111; }
    h1 { font-size: 22px; }
    h2 { font-size: 16px; margin-top: 24px; }
    table { border-collapse: collapse; width: 100%; font-size: 12px; }
    th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
    .muted { color: #555; font-size: 11px; }
    .summary { white-space: pre-wrap; line-height: 1.45; }
  </style>
</head>
<body>
  <h1>NeighborHealth — Tract report</h1>
  <p class="muted">Generated {{ generated }} · GEOID {{ geoid }}</p>
  <p><strong>{{ name }}</strong>{% if county %} · {{ county }}{% endif %}</p>
  <h2>Composite risk score</h2>
  <p>{{ composite }} (year {{ year }})</p>
  <h2>Indicators</h2>
  <table>
    <tr><th>Metric</th><th>Value</th><th>Year</th><th>Source</th></tr>
    {% for row in indicators %}
    <tr><td>{{ row.metric_name }}</td><td>{{ row.value }}</td><td>{{ row.year }}</td><td>{{ row.source }}</td></tr>
    {% endfor %}
  </table>
  <h2>AI summary</h2>
  <div class="summary">{{ ai_text }}</div>
  <h2>Data sources</h2>
  <p class="muted">CDC PLACES (tract estimates), U.S. Census Bureau ACS 5-year (housing), NeighborHealth composite index. See project README for dataset versions and methodology.</p>
</body>
</html>
"""
)


async def build_pdf_bytes(session: AsyncSession, geoid: str, year: int | None) -> bytes:
    tract = await session.get(Tract, geoid)
    if not tract:
        raise ValueError("tract not found")

    ind_res = await session.execute(
        select(Indicator).where(Indicator.geoid == geoid, Indicator.metric_name.in_(METRIC_KEYS))
    )
    indicators = ind_res.scalars().all()

    rs = None
    if year is not None:
        rs = await session.get(RiskScore, (geoid, year))
    if rs is None:
        r2 = await session.execute(
            select(RiskScore).where(RiskScore.geoid == geoid).order_by(RiskScore.year.desc()).limit(1)
        )
        rs = r2.scalars().first()

    ai = await session.get(AISummary, geoid)
    ai_text = ai.summary_text if ai else "No AI summary available."

    html = TEMPLATE.render(
        generated=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        geoid=geoid,
        name=tract.name or "",
        county=tract.county_name or "",
        composite=f"{rs.composite_score:.1f}" if rs else "N/A",
        year=rs.year if rs else "",
        indicators=indicators,
        ai_text=ai_text,
    )
    return HTML(string=html).write_pdf()


def write_temp_pdf(data: bytes) -> Path:
    base = Path(__file__).resolve().parents[2] / "tmp_exports"
    base.mkdir(parents=True, exist_ok=True)
    path = base / f"{uuid.uuid4().hex}.pdf"
    path.write_bytes(data)
    return path
