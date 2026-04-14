/**
 * Mirrors backend `app/services/risk_score.py` for UI previews and tests.
 */

export const METRIC_KEYS = [
  "rent_burden_pct",
  "overcrowding_pct",
  "vacancy_rate",
  "uninsured_pct",
  "asthma_pct",
  "disability_pct",
  "heat_index",
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

export type TractValues = { geoid: string; values: Record<MetricKey, number | null | undefined> };

const DEFAULT_WEIGHTS: Record<MetricKey, number> = Object.fromEntries(
  METRIC_KEYS.map((k) => [k, 1 / METRIC_KEYS.length])
) as Record<MetricKey, number>;

export function clampWeights(weights?: Partial<Record<MetricKey, number>>): Record<MetricKey, number> {
  const w = { ...DEFAULT_WEIGHTS };
  if (!weights) return w;
  for (const k of METRIC_KEYS) {
    if (weights[k] != null && !Number.isNaN(weights[k]!)) {
      w[k] = Math.max(0, weights[k]!);
    }
  }
  const total = METRIC_KEYS.reduce((s, k) => s + w[k], 0);
  if (total <= 0) return { ...DEFAULT_WEIGHTS };
  return Object.fromEntries(METRIC_KEYS.map((k) => [k, w[k] / total])) as Record<MetricKey, number>;
}

function minMaxNormalize(values: (number | null | undefined)[]): number[] {
  const nums = values.filter((v): v is number => v != null && !Number.isNaN(v));
  if (!nums.length) return values.map(() => 50);
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  if (hi - lo < 1e-9) return values.map(() => 50);
  return values.map((v) => {
    if (v == null || Number.isNaN(v)) return 50;
    return ((v - lo) / (hi - lo)) * 100;
  });
}

export function computeBatchScores(
  tracts: TractValues[],
  weights?: Partial<Record<MetricKey, number>>
): Record<string, { composite: number; components: Record<MetricKey, number> }> {
  const w = clampWeights(weights);
  const out: Record<string, { composite: number; components: Record<MetricKey, number> }> = {};
  if (!tracts.length) return out;

  const byMetric = METRIC_KEYS.map((m) => minMaxNormalize(tracts.map((t) => t.values[m])));

  tracts.forEach((t, i) => {
    const components = {} as Record<MetricKey, number>;
    let total = 0;
    METRIC_KEYS.forEach((m, mi) => {
      const nv = byMetric[mi][i];
      components[m] = Math.round(nv * 10000) / 10000;
      total += w[m] * nv;
    });
    const composite = Math.max(0, Math.min(100, Math.round(total * 10000) / 10000));
    out[t.geoid] = { composite, components };
  });
  return out;
}
