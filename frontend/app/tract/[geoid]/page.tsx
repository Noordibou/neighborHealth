import { notFound } from "next/navigation";
import { AISummaryPanel } from "@/components/AISummaryPanel";
import { ScorecardActions } from "@/components/ScorecardActions";
import { SiteFooter } from "@/components/SiteFooter";
import { TractMapBackControl } from "@/components/TractMapBackControl";
import { TractMetricGrid } from "@/components/TractMetricGrid";
import { API_BASE, getTract, getTractSummary } from "@/lib/api";

type Props = { params: Promise<{ geoid: string }> };

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

  const STATE_ABBR: Record<string, string> = {
    "06": "CA",
    "48": "TX",
    "36": "NY",
    "12": "FL",
    "17": "IL",
  };

  const score = tract.risk_score?.composite_score;
  const scoreRounded = score != null ? Math.round(score) : null;
  const st = tract.state_fips ? STATE_ABBR[tract.state_fips] ?? tract.state_fips : "";
  const place =
    tract.county_name && st ? `${tract.county_name}, ${st}` : [tract.county_name, st].filter(Boolean).join(", ");

  return (
    <div className="min-h-screen bg-[#f0f4f8]">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <TractMapBackControl />

        <div className="mt-6 flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
            {scoreRounded != null && (
              <div
                className="flex h-32 w-32 shrink-0 items-center justify-center rounded-full border-[6px] border-red-100 bg-white text-5xl font-bold text-red-500 shadow-inner"
                aria-label={`Composite risk score ${scoreRounded}`}
              >
                {scoreRounded}
              </div>
            )}
            <div>
              <p className="text-sm font-medium uppercase tracking-wide text-slate-500">Census tract</p>
              <h1 className="mt-1 text-3xl font-bold tracking-tight text-[#0f2940]">
                {tract.name ?? `Tract ${tract.geoid}`}
              </h1>
              <p className="mt-1 text-lg text-slate-600">{place || `GEOID ${tract.geoid}`}</p>
              <p className="mt-2 text-sm text-slate-500">
                Year {tract.risk_score?.year ?? "—"} · GEOID {tract.geoid}
              </p>
            </div>
          </div>
          <div className="shrink-0 lg:pt-2">
            <ScorecardActions geoid={tract.geoid} apiBase={API_BASE} />
          </div>
        </div>

        <section className="mt-10">
          <h2 className="sr-only">Indicators</h2>
          <TractMetricGrid tract={tract} />
        </section>

        <AISummaryPanel
          summaryText={summary?.summary_text ?? null}
          generatedAt={summary?.generated_at ?? null}
          unavailable={!summary?.summary_text}
        />

        <SiteFooter />
      </div>
    </div>
  );
}
