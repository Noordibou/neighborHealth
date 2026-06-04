import { METRIC_KEYS, type MetricKey } from "@/lib/riskScore";
import { METRIC_LABELS } from "@/lib/metricDisplay";
import {
  COMMON_STRESSOR_THRESHOLD,
  DIVERGENCE_THRESHOLD,
  INCOME_HIGH_THRESHOLD,
  INCOME_SURVIVAL_THRESHOLD,
} from "@/lib/constants";
import type { CompareDemographicsIncomeMap } from "@/types";

export type { CompareDemographicsIncomeMap };

type SeriesRow = Record<string, number | string>;

function appendCommonStressorIncomeContext(
  series: SeriesRow[],
  demographicsMap: CompareDemographicsIncomeMap
): string {
  if (!series.length) return "";
  const incomes: number[] = [];
  for (const s of series) {
    const gid = String(s.geoid ?? "");
    if (!gid) return "";
    const row = demographicsMap[gid];
    if (!row || row.median_household_income == null || !Number.isFinite(row.median_household_income)) {
      return "";
    }
    incomes.push(row.median_household_income);
  }
  const maxIncome = Math.max(...incomes);
  const minIncome = Math.min(...incomes);
  if (maxIncome >= INCOME_HIGH_THRESHOLD) return "";
  if (maxIncome < INCOME_SURVIVAL_THRESHOLD) {
    return " Median household incomes are all below $50k — rent burden likely represents a survival-level cost pressure.";
  }
  const fmt = (n: number) =>
    `$${Math.round(n).toLocaleString("en-US", { maximumFractionDigits: 0, useGrouping: true })}`;
  return ` Median household incomes range from ${fmt(minIncome)} to ${fmt(maxIncome)} — cost burden varies in severity across these tracts.`;
}

/** Heuristic narrative cards from compare `series` (component scores 0–100 per metric). */
export function buildCompareInsights(
  series: SeriesRow[],
  demographicsMap: CompareDemographicsIncomeMap = {}
): { title: string; body: string }[] {
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
      return typeof v === "number" && v >= COMMON_STRESSOR_THRESHOLD;
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
    let body = `Every tract here scores above the midrange on ${common
      .slice(0, 2)
      .map((m) => METRIC_LABELS[m])
      .join(" and ")}.`;
    body += appendCommonStressorIncomeContext(series, demographicsMap);
    cards.push({
      title: "Common stressor",
      body,
    });
  } else {
    cards.push({
      title: "Common stressor",
      body: "No single indicator is uniformly elevated across every tract—use the profile chart to see where paths diverge.",
    });
  }

  if (biggest && biggest.gap >= DIVERGENCE_THRESHOLD) {
    cards.push({
      title: "Divergence",
      body: `${METRIC_LABELS[biggest.metric]}: ${biggest.loLabel} and ${biggest.hiLabel} show the largest divergence — a ${Math.round(biggest.gap)}-point gap on the normalized scale.`,
    });
  } else {
    cards.push({
      title: "Divergence",
      body: "No single indicator drives the gap — burdens are distributed across metrics. See individual tract profiles for full breakdowns.",
    });
  }

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
