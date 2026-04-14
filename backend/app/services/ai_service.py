"""Anthropic Claude summaries for census tracts."""

from __future__ import annotations

from datetime import datetime, timezone

from anthropic import AsyncAnthropic
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import AISummary, Indicator, Tract
from app.services.risk_score import METRIC_KEYS


async def get_or_create_summary(
    session: AsyncSession,
    geoid: str,
    force_refresh: bool = False,
) -> AISummary:
    if not force_refresh:
        row = await session.get(AISummary, geoid)
        if row:
            return row

    if not settings.anthropic_api_key:
        text = (
            "AI summaries require ANTHROPIC_API_KEY. This tract’s indicators are still available "
            "in the scorecard; configure the API key to generate a plain-language narrative for "
            "nonprofit planning and community outreach."
        )
        row = AISummary(
            geoid=geoid,
            summary_text=text,
            generated_at=datetime.now(timezone.utc),
            model_version="placeholder",
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return row

    tract = await session.get(Tract, geoid)
    if not tract:
        raise ValueError("tract not found")

    ind_res = await session.execute(select(Indicator).where(Indicator.geoid == geoid))
    indicators = ind_res.scalars().all()
    lines = [f"- {i.metric_name} ({i.source}, {i.year}): {i.value}" for i in indicators if i.metric_name in METRIC_KEYS]

    client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    prompt = f"""You are writing for nonprofit program staff and local planners.

Census tract GEOID: {geoid}
Location context: {tract.name or ''}, county {tract.county_name or ''}, state FIPS {tract.state_fips}.

Core housing and health indicators:
{chr(10).join(lines)}

Write exactly three short paragraphs (plain language, no bullet points) that explain what these numbers suggest about day-to-day challenges residents may face regarding housing stability and access to health care, why the overlap matters for equity-focused outreach, and what kinds of interventions or partnerships might be most relevant. Avoid medical advice; focus on community-level interpretation."""

    msg = await client.messages.create(
        model=settings.ai_model,
        max_tokens=900,
        messages=[{"role": "user", "content": prompt}],
    )
    text = msg.content[0].text if msg.content else ""
    row = await session.get(AISummary, geoid)
    now = datetime.now(timezone.utc)
    if row:
        row.summary_text = text
        row.generated_at = now
        row.model_version = settings.ai_model
    else:
        row = AISummary(
            geoid=geoid,
            summary_text=text,
            generated_at=now,
            model_version=settings.ai_model,
        )
        session.add(row)
    await session.commit()
    await session.refresh(row)
    return row
