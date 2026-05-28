import { notFound } from "next/navigation";
import { AISummaryPanel } from "@/components/AISummaryPanel";
import { AdditionalIndicatorsPanel } from "@/components/AdditionalIndicatorsPanel";
import { DemographicsPanel } from "@/components/DemographicsPanel";
import { NearbyClinicPanel } from "@/components/NearbyClinicPanel";
import { ScorecardActions } from "@/components/ScorecardActions";
import { SiteFooter } from "@/components/SiteFooter";
import { TrendChartLazy } from "@/components/TrendChartLazy";
import { TractMapBackControl } from "@/components/TractMapBackControl";
import { TractScorecardTable } from "@/components/TractScorecardTable";
import { getTract, getTractSummary } from "@/lib/api";
import { SCORE_THRESHOLDS } from "@/lib/constants";
import { STATE_FIPS_TO_POSTAL } from "@/lib/geo";

type Props = { params: Promise<{ geoid: string }> };


export default async function TractPage({ params }: Props) {
  const { geoid } = await params;
  let tract: Awaited<ReturnType<typeof getTract>> | null = null;
  let unavailableMessage: string | null = null;

  const [tractResult, summaryResult] = await Promise.allSettled([
    getTract(geoid),
    getTractSummary(geoid),
  ]);

  if (tractResult.status === "fulfilled") {
    tract = tractResult.value;
  } else {
    const msg = tractResult.reason instanceof Error ? tractResult.reason.message : String(tractResult.reason);
    // Only show Next.js 404 when the backend confirms tract is missing.
    if (msg.startsWith("404")) {
      notFound();
    }
    unavailableMessage = msg || "Could not reach API";
  }

  if (!tract) {
    return (
      <div className="min-h-screen bg-nh-cream text-nh-brown">
        <div className="mx-auto max-w-3xl px-4 py-12">
          <TractMapBackControl />
          <div className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-5 shadow-sm">
            <h1 className="font-display text-2xl font-semibold text-nh-brown">Tract profile unavailable</h1>
            <p className="mt-2 text-sm text-nh-brown-muted">
              The app could not reach the API to load this tract right now. This is usually caused by the backend not
              running or an incorrect `NEXT_PUBLIC_API_URL`.
            </p>
            <p className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-xs text-nh-brown-muted">
              GEOID: <span className="font-mono">{geoid}</span>
              {unavailableMessage ? (
                <>
                  {" "}
                  · Error: <span className="font-mono">{unavailableMessage}</span>
                </>
              ) : null}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const summary = summaryResult.status === "fulfilled" ? summaryResult.value : null;

  const score = tract.risk_score?.composite_score;
  const scoreRounded = score != null ? Math.round(score) : null;
  const st = tract.state_fips ? STATE_FIPS_TO_POSTAL[tract.state_fips] ?? tract.state_fips : "";
  const place =
    tract.county_name && st ? `${tract.county_name}, ${st}` : [tract.county_name, st].filter(Boolean).join(", ");
  const tier = scoreRounded != null && scoreRounded >= SCORE_THRESHOLDS.tier1 ? "Tier 1" : scoreRounded != null && scoreRounded >= SCORE_THRESHOLDS.tier2 ? "Tier 2" : "Tier 3";
  const tierLabel = scoreRounded != null ? (scoreRounded >= SCORE_THRESHOLDS.tier1 ? "high" : scoreRounded >= SCORE_THRESHOLDS.tier2 ? "moderate" : "lower") : null;

  return (
    <div className="min-h-screen bg-nh-cream text-nh-brown">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <TractMapBackControl />

        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded-full bg-nh-terracotta/15 px-3 py-1 text-xs font-semibold text-nh-terracotta">
            Priority · {tier}
          </span>
          <span className="rounded-full border border-nh-brown/10 bg-white px-3 py-1 text-xs font-medium text-nh-brown-muted">
            Year {tract.risk_score?.year ?? "—"}
          </span>
          <span className="rounded-full border border-nh-brown/10 bg-white px-3 py-1 text-xs font-medium text-nh-brown-muted">
            Tract ID {tract.geoid}
          </span>
          {tract.median_rent != null ? (
            <span className="rounded-full border border-nh-brown/10 bg-white px-3 py-1 text-xs font-medium">
              <span className="text-nh-brown-muted">Median rent</span>{" "}
              <span className="text-nh-brown">
                ${Math.round(tract.median_rent).toLocaleString("en-US")} / mo
              </span>
            </span>
          ) : null}
          {tract.median_household_income != null ? (
            <span className="rounded-full border border-nh-brown/10 bg-white px-3 py-1 text-xs font-medium">
              <span className="text-nh-brown-muted">Median income</span>{" "}
              <span className="text-nh-brown">${Math.round(tract.median_household_income).toLocaleString("en-US")}</span>
            </span>
          ) : null}
        </div>

        <div className="mt-6 flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-6 sm:flex-row sm:items-start">
            <div className="flex shrink-0 flex-col items-center gap-2 sm:items-start">
              {scoreRounded != null && (
                <>
                  <div
                    className="relative flex h-36 w-36 shrink-0 items-center justify-center rounded-full border-[8px] border-nh-terracotta/25 bg-white shadow-inner"
                    aria-label={`Composite score ${scoreRounded} out of 100`}
                  >
                    <div className="text-center">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-nh-brown-muted">Composite</p>
                      <p className="font-display text-4xl font-bold text-nh-terracotta">{scoreRounded}</p>
                      <p className="text-[9px] text-nh-brown-muted">out of 100</p>
                    </div>
                  </div>
                  <p className="text-center text-[11px] text-nh-brown-muted sm:text-left">
                    Higher score = greater burden
                  </p>
                  {tract.risk_score?.rank != null && tract.risk_score.rank_total != null ? (
                    <p className="text-center text-[11px] font-medium text-nh-brown-muted sm:text-left">
                      Ranks #{tract.risk_score.rank} of {tract.risk_score.rank_total.toLocaleString()} nationally
                    </p>
                  ) : null}
                  {tract.state_composite_score != null ? (
                    <p className="max-w-[11rem] text-center text-xs font-medium leading-snug text-nh-brown-muted sm:text-left">
                      State score {Math.round(tract.state_composite_score)}
                    </p>
                  ) : null}
                </>
              )}
              {(tract.has_trend ?? false) ? (
                <div className="mt-1 w-full max-w-[min(100%,20rem)] sm:max-w-xs">
                  <TrendChartLazy geoid={tract.geoid} has_trend={true} />
                </div>
              ) : null}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-nh-brown-muted">Neighborhood profile</p>
              <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-nh-brown md:text-4xl">
                {tract.name ?? `Tract ${tract.geoid}`}
              </h1>
              <p className="mt-2 text-lg text-nh-brown-muted">{place || `Tract ID ${tract.geoid}`}</p>
              <p className="mt-4 max-w-2xl text-sm leading-relaxed text-nh-brown-muted">
                {scoreRounded != null && tierLabel
                  ? `This tract's composite score of ${scoreRounded} places it in the ${tierLabel} burden tier nationally.`
                  : "Open compare from the map explorer to contrast nearby areas, or export a PDF for stakeholders."}
              </p>
            </div>
          </div>
          <div className="shrink-0 lg:pt-2">
            <ScorecardActions geoid={tract.geoid} />
          </div>
        </div>

        <section className="mt-12">
          <h2 className="font-display text-xl font-semibold text-nh-brown">Indicator scorecard</h2>
          <p className="mt-1 text-sm text-nh-brown-muted">
            Tract values with county, state, and national percentile context.
          </p>
          <div className="mt-4">
            <TractScorecardTable tract={tract} />
          </div>
        </section>

        <DemographicsPanel geoid={tract.geoid} />

        <NearbyClinicPanel geoid={tract.geoid} />

        <AdditionalIndicatorsPanel indicators={tract.display_indicators ?? []} />

        <AISummaryPanel
          summaryText={summary?.summary_text ?? null}
          generatedAt={summary?.generated_at ?? null}
          unavailable={!summary?.summary_text}
        />

        <section className="mt-10 rounded-2xl border border-nh-brown/10 bg-white/80 p-5 text-xs leading-relaxed text-nh-brown-muted">
          <p className="font-semibold text-nh-brown">Data sources</p>
          <p className="mt-2">
            CDC PLACES (tract estimates), U.S. Census Bureau ACS 5-year (housing), HUD CHAS where available, and
            NeighborHealth composite methodology. See repository documentation for vintages and limitations.
          </p>
        </section>

        <SiteFooter />
      </div>
    </div>
  );
}
