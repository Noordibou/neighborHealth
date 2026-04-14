import { METRIC_KEYS, type MetricKey } from "@/lib/riskScore";

export const METRIC_LABELS: Record<MetricKey, string> = {
  rent_burden_pct: "Rent burden",
  overcrowding_pct: "Overcrowding",
  vacancy_rate: "Vacancy rate",
  uninsured_pct: "Uninsured rate",
  asthma_pct: "Asthma prevalence",
  disability_pct: "Disability rate",
  heat_index: "Heat stress index",
};

export function formatMetricValue(metric: MetricKey, value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (metric === "rent_burden_pct") return `${Math.round(value)}% burdened`;
  if (metric === "heat_index") return value.toFixed(1);
  if (metric.endsWith("_pct") || metric === "vacancy_rate") return `${value.toFixed(1)}%`;
  return value.toFixed(2);
}

export { METRIC_KEYS };
