import { METRIC_KEYS, type MetricKey } from "@/lib/riskScore";
import { METRIC_LABELS } from "@/lib/metricDisplay";

type SeriesRow = Record<string, number | string>;

/** Heuristic narrative cards from compare `series` (component scores 0–100 per metric). */
export function buildCompareInsights(series: SeriesRow[]): { title: string; body: string }[] {
  if (series.length < 2) return [];

  let biggest: { metric: MetricKey; gap: number; loLabel: string; hiLabel: string } | null = null;

  for (const m of METRIC_KEYS) {
    const pairs: { v: number; label: string }[] = [];
    for (const s of series) {
      const v = s[m];
      if (typeof v !== "number" || Number.isNaN(v)) continue;
      pairs.push({ v, label: String(s.label ?? s.geoid) });
    }
    if (pairs.length < 2) continue;
    const vals = pairs.map((p) => p.v);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const gap = hi - lo;
    if (!biggest || gap > biggest.gap) {
      biggest = {
        metric: m,
        gap,
        loLabel: pairs.find((p) => p.v === lo)?.label ?? "",
        hiLabel: pairs.find((p) => p.v === hi)?.label ?? "",
      };
    }
  }

  const common = METRIC_KEYS.filter((m) =>
    series.every((s) => {
      const v = s[m];
      return typeof v === "number" && v >= 55;
    })
  );

  const cards: { title: string; body: string }[] = [];
  if (biggest) {
    cards.push({
      title: "Biggest gap",
      body: `${METRIC_LABELS[biggest.metric]}: roughly ${Math.round(biggest.gap)} points separate ${biggest.loLabel} and ${biggest.hiLabel} on the normalized 0–100 scale.`,
    });
  }
  if (common.length) {
    cards.push({
      title: "Common stressor",
      body: `Every tract here scores above the midrange on ${common
        .slice(0, 2)
        .map((m) => METRIC_LABELS[m])
        .join(" and ")}.`,
    });
  } else {
    cards.push({
      title: "Common stressor",
      body: "No single indicator is uniformly elevated across every tract—use the profile chart to see where paths diverge.",
    });
  }

  const spread = METRIC_KEYS.find((m) => {
    const nums = series.map((s) => s[m]).filter((v): v is number => typeof v === "number");
    if (nums.length < 2) return false;
    return Math.max(...nums) - Math.min(...nums) >= 40;
  });

  cards.push({
    title: "Divergence",
    body: spread
      ? `${METRIC_LABELS[spread]} shows the widest spread in this comparison—worth a deeper tract-level read.`
      : "Scores are relatively clustered; open individual tract pages for raw percentages and citations.",
  });

  return cards.slice(0, 3);
}

export function compareSeriesToLineChartData(series: SeriesRow[]): Record<string, string | number>[] {
  return METRIC_KEYS.map((m) => {
    const row: Record<string, string | number> = { metric: METRIC_LABELS[m] };
    series.forEach((s) => {
      const id = String(s.geoid);
      const v = s[m];
      if (typeof v === "number") row[id] = v;
    });
    return row;
  });
}
