"""PDF report generation with WeasyPrint."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, Template, select_autoescape
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from weasyprint import HTML

from app.models import AISummary, Indicator, RiskScore, Tract, TractDemographics
from app.schemas.tract import CompareResponse, IndicatorOut
from app.services.risk_score import METRIC_KEYS
from app.services.score_recalc import get_cached_default_scores, resolve_year

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

_TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"
_COMPARE_ENV = Environment(
    loader=FileSystemLoader(str(_TEMPLATES_DIR)),
    autoescape=select_autoescape(["html", "xml"]),
)

METRIC_LABELS: dict[str, str] = {
    "rent_burden_pct": "Rent burden",
    "overcrowding_pct": "Overcrowding",
    "structural_vacancy_rate": "Structural vacancy",
    "uninsured_pct": "Uninsured rate",
    "asthma_pct": "Asthma prevalence",
    "mental_health_pct": "Mental health",
    "heat_index": "Heat stress index",
    "disability_pct": "Disability rate",  # stored, not scored — display-only
}

DIVERGENCE_THRESHOLD = 25


def format_metric_value(metric: str, value: float | None) -> str:
    """Match frontend/lib/metricDisplay.ts formatMetricValue."""
    if value is None:
        return "—"
    fv = float(value)
    if fv != fv:  # NaN
        return "—"
    if metric == "rent_burden_pct":
        return f"{round(fv)}% burdened"
    if metric == "heat_index":
        return f"{fv:.1f}"
    if metric.endswith("_pct") or metric == "structural_vacancy_rate":
        return f"{fv:.1f}%"
    return f"{fv:.2f}"


def composite_badge(series_row: dict[str, Any]) -> int | None:
    """Match frontend/app/compare/page.tsx compositeBadge (mean of component scores)."""
    nums: list[float] = []
    for k in METRIC_KEYS:
        v = series_row.get(k)
        if isinstance(v, (int, float)) and v == v:
            nums.append(float(v))
    if not nums:
        return None
    return round(sum(nums) / len(nums))


def compare_tier_label(badge: int | None) -> str:
    """Match compare page Priority / Stable (badge >= 55)."""
    if badge is None:
        return "—"
    return "Priority" if badge >= 55 else "Stable"


def _ordinal_suffix(n: int | None) -> str:
    if n is None:
        return ""
    n = int(n)
    if 11 <= (n % 100) <= 13:
        return "th"
    return {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")


def _national_rank_label(percentile_national: float | None) -> str:
    if percentile_national is None:
        return ""
    p = float(percentile_national)
    if p != p:
        return ""
    rn = int(round(p))
    return f"National {rn}{_ordinal_suffix(rn)} percentile"


def build_compare_insights(series: list[dict[str, Any]]) -> dict[str, str]:
    """Port of frontend/lib/compareInsights.ts buildCompareInsights → dict for Jinja."""
    if len(series) < 2:
        return {}

    biggest: dict[str, Any] | None = None

    for m in METRIC_KEYS:
        pairs: list[tuple[float, str]] = []
        for s in series:
            v = s.get(m)
            if not isinstance(v, (int, float)) or v != v:
                continue
            fv = float(v)
            label = str(s.get("label") or s.get("geoid") or "")
            pairs.append((fv, label))
        if len(pairs) < 2:
            continue
        vals = [p[0] for p in pairs]
        lo = min(vals)
        hi = max(vals)
        gap = hi - lo
        if biggest is None or gap > biggest["gap"]:
            lo_label = next((lab for fv, lab in pairs if fv == lo), "")
            hi_label = next((lab for fv, lab in pairs if fv == hi), "")
            biggest = {"metric": m, "gap": gap, "loLabel": lo_label, "hiLabel": hi_label}

    def _finite_num(x: Any) -> bool:
        return isinstance(x, (int, float)) and x == x and abs(x) != float("inf")

    common = [
        m
        for m in METRIC_KEYS
        if all(_finite_num(s.get(m)) and float(s[m]) >= 55 for s in series)
    ]

    cards: list[dict[str, str]] = []
    if biggest:
        m = biggest["metric"]
        gap_r = round(biggest["gap"])
        cards.append(
            {
                "title": "Biggest gap",
                "body": (
                    f"{METRIC_LABELS[m]}: roughly {gap_r} points separate "
                    f"{biggest['loLabel']} and {biggest['hiLabel']} on the normalized 0–100 scale."
                ),
            }
        )
    if common:
        labels = " and ".join(METRIC_LABELS[x] for x in common[:2])
        cards.append(
            {
                "title": "Common stressor",
                "body": f"Every tract here scores above the midrange on {labels}.",
            }
        )
    else:
        cards.append(
            {
                "title": "Common stressor",
                "body": (
                    "No single indicator is uniformly elevated across every tract—use the profile "
                    "chart to see where paths diverge."
                ),
            }
        )

    if biggest and biggest["gap"] >= DIVERGENCE_THRESHOLD:
        m = biggest["metric"]
        gap_r = round(biggest["gap"])
        cards.append(
            {
                "title": "Divergence",
                "body": (
                    f"{METRIC_LABELS[m]}: {biggest['loLabel']} and {biggest['hiLabel']} show the largest "
                    f"divergence — a {gap_r}-point gap on the normalized scale."
                ),
            }
        )
    else:
        cards.append(
            {
                "title": "Divergence",
                "body": (
                    "No single indicator drives the gap — burdens are distributed across metrics. "
                    "See individual tract profiles for full breakdowns."
                ),
            }
        )

    out: dict[str, str] = {}
    keys = ("biggest_gap", "common_stressor", "divergence")
    for i, key in enumerate(keys):
        if i < len(cards):
            out[key] = cards[i]["body"]
    return out


def _raw_for(geoid: str, metric: str, raw_indicators: dict[str, Any]) -> dict[str, Any] | None:
    rows = raw_indicators.get(geoid)
    if not rows:
        return None
    for row in rows:
        if isinstance(row, dict):
            if row.get("metric_name") == metric:
                return row
        elif getattr(row, "metric_name", None) == metric:
            return {
                "metric_name": row.metric_name,
                "value": row.value,
                "percentile_national": row.percentile_national,
            }
    return None


def build_compare_pdf_bytes(compare_data: dict[str, Any]) -> bytes:
    """Render compare_report.html via WeasyPrint. compare_data matches CompareResponse + optional pdf_tract_meta."""
    series: list[dict[str, Any]] = compare_data.get("series") or []
    geoids: list[str] = list(compare_data.get("geoids") or [])
    raw_indicators: dict[str, Any] = compare_data.get("raw_indicators") or {}
    tract_meta: dict[str, Any] = compare_data.get("pdf_tract_meta") or {}

    tracts_out: list[dict[str, Any]] = []
    for row in series:
        gid = str(row.get("geoid", ""))
        meta = tract_meta.get(gid, {})
        badge = composite_badge(row)
        pop = meta.get("population")
        tracts_out.append(
            {
                "name": str(row.get("label") or gid),
                "geoid": gid,
                "composite_score": str(badge) if badge is not None else "—",
                "tier": compare_tier_label(badge),
                "population": pop if pop is not None else "—",
                "county_name": meta.get("county_name") or "",
            }
        )

    metrics_out: list[dict[str, Any]] = []
    for m in METRIC_KEYS:
        tract_cells: list[dict[str, Any]] = []
        for gid in geoids:
            ind = _raw_for(gid, m, raw_indicators)
            val = None
            pn = None
            if ind:
                if isinstance(ind, dict):
                    val = ind.get("value")
                    pn = ind.get("percentile_national")
                else:
                    val = getattr(ind, "value", None)
                    pn = getattr(ind, "percentile_national", None)
            raw_display = format_metric_value(m, float(val) if isinstance(val, (int, float)) and val == val else None)
            rank_lbl = _national_rank_label(float(pn) if isinstance(pn, (int, float)) and pn == pn else None)
            cell: dict[str, Any] = {"raw": raw_display, "national_rank": rank_lbl}
            if isinstance(val, (int, float)) and val == val:
                cell["sort_value"] = float(val)
            tract_cells.append(cell)

        metrics_out.append(
            {
                "name": m,
                "display_name": METRIC_LABELS.get(m, m),
                "tract_values": tract_cells,
            }
        )

    insights = build_compare_insights(series)
    generated = datetime.now(timezone.utc).strftime("%B %d, %Y")

    tpl = _COMPARE_ENV.get_template("compare_report.html")
    html = tpl.render(
        generated_date=generated,
        tracts=tracts_out,
        metrics=metrics_out,
        insights=insights,
    )
    return HTML(string=html).write_pdf()


async def load_compare_data_for_pdf(
    session: AsyncSession,
    geoids: list[str],
    year: int | None,
) -> dict[str, Any]:
    """Same DB-backed payload as GET /api/compare (plus pdf_tract_meta for PDF cards)."""
    parts = [g.strip() for g in geoids if g.strip()]
    if len(parts) < 2 or len(parts) > 4:
        raise ValueError("Provide between 2 and 4 GEOIDs")

    year_eff = await resolve_year(session, year)

    scores = await get_cached_default_scores(session, year_eff)

    series: list[dict[str, float | str]] = []
    raw: dict[str, list[IndicatorOut]] = {}
    pdf_tract_meta: dict[str, dict[str, Any]] = {}

    for gid in parts:
        t = await session.get(Tract, gid)
        if not t:
            raise ValueError(f"Tract {gid} not found")
        if gid not in scores:
            raise ValueError(f"Tract {gid} missing core indicators for year {year_eff}")
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
                value_moe=i.value_moe,
                year=i.year,
                percentile_national=i.percentile_national,
                percentile_state=i.percentile_state,
                percentile_county=i.percentile_county,
            )
            for i in ind_res.scalars().all()
        ]

        pop_row = await session.execute(
            select(TractDemographics.total_population)
            .where(TractDemographics.geoid == gid)
            .order_by(TractDemographics.year.desc())
            .limit(1)
        )
        pop = pop_row.scalar_one_or_none()
        pop_str: str | None
        if pop is not None and pop == pop:
            try:
                pop_str = f"{int(round(float(pop))):,}"
            except (TypeError, ValueError):
                pop_str = None
        else:
            pop_str = None

        pdf_tract_meta[gid] = {
            "county_name": t.county_name or "",
            "population": pop_str,
        }

    payload = CompareResponse(
        geoids=parts,
        year=year_eff,
        indicators=list(METRIC_KEYS),
        series=series,
        raw_indicators=raw,
    ).model_dump(mode="json")
    payload["pdf_tract_meta"] = pdf_tract_meta
    return payload


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
