import { notFound } from "next/navigation";
import { AISummaryPanel } from "@/components/AISummaryPanel";
import { ScorecardActions } from "@/components/ScorecardActions";
import { SiteFooter } from "@/components/SiteFooter";
import { TractMapBackControl } from "@/components/TractMapBackControl";
import { TractMetricGrid } from "@/components/TractMetricGrid";
import { TractScorecardTable } from "@/components/TractScorecardTable";
import { API_BASE, getTract, getTractSummary } from "@/lib/api";

type Props = { params: Promise<{ geoid: string }> };

const STATE_ABBR: Record<string, string> = {
  "42": "PA",
  "06": "CA",
  "48": "TX",
  "36": "NY",
  "12": "FL",
  "17": "IL",
};

export default async function TractPage({ params }: Props) {
  const { geoid } = await params;
  let tract;
  try {
    tract = await getTract(geoid);
  } catch {
    notFound();
  }

  let summary: { summary_text: string; generated_at: string } | null = null;
  try {
    summary = await getTractSummary(geoid);
  } catch {
    summary = null;
  }

  const score = tract.risk_score?.composite_score;
  const scoreRounded = score != null ? Math.round(score) : null;
  const st = tract.state_fips ? STATE_ABBR[tract.state_fips] ?? tract.state_fips : "";
  const place =
    tract.county_name && st ? `${tract.county_name}, ${st}` : [tract.county_name, st].filter(Boolean).join(", ");
  const tier = scoreRounded != null && scoreRounded >= 70 ? "Tier 1" : scoreRounded != null && scoreRounded >= 50 ? "Tier 2" : "Tier 3";

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
            GEOID {tract.geoid}
          </span>
        </div>

        <div className="mt-6 flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-6 sm:flex-row sm:items-start">
            {scoreRounded != null && (
              <div
                className="relative flex h-36 w-36 shrink-0 items-center justify-center rounded-full border-[8px] border-nh-terracotta/25 bg-white shadow-inner"
                aria-label={`Composite score ${scoreRounded}`}
              >
                <div className="text-center">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-nh-brown-muted">Composite</p>
                  <p className="font-display text-4xl font-bold text-nh-terracotta">{scoreRounded}</p>
                </div>
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-nh-brown-muted">Neighborhood profile</p>
              <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-nh-brown md:text-4xl">
                {tract.name ?? `Tract ${tract.geoid}`}
              </h1>
              <p className="mt-2 text-lg text-nh-brown-muted">{place || `GEOID ${tract.geoid}`}</p>
              <p className="mt-4 max-w-2xl text-sm leading-relaxed text-nh-brown-muted">
                This tract ranks in the upper tier on the composite housing–health index when benchmarked against peers
                with full indicator coverage. Open compare from the map explorer to contrast nearby areas, or export a
                PDF for stakeholders.
              </p>
            </div>
          </div>
          <div className="shrink-0 lg:pt-2">
            <ScorecardActions geoid={tract.geoid} apiBase={API_BASE} />
          </div>
        </div>

        <section className="mt-12">
          <h2 className="font-display text-xl font-semibold text-nh-brown">Indicator scorecard</h2>
          <p className="mt-1 text-sm text-nh-brown-muted">Tract values with state and national percentile context.</p>
          <div className="mt-4">
            <TractScorecardTable tract={tract} />
          </div>
        </section>

        <section className="mt-12">
          <h2 className="font-display text-xl font-semibold text-nh-brown">Metric cards</h2>
          <div className="mt-4">
            <TractMetricGrid tract={tract} />
          </div>
        </section>

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
