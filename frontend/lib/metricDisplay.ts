import { METRIC_KEYS } from "@/lib/riskScore";
import type { MetricKey } from "@/types";

// Includes all scored MetricKeys, disability_pct (stored, display-only, not scored),
// and the 6 additional PLACES display-only indicators.
export const METRIC_LABELS: Record<string, string> = {
  rent_burden_pct: "Rent burden",
  overcrowding_pct: "Overcrowding",
  structural_vacancy_rate: "Structural vacancy",
  uninsured_pct: "Uninsured rate",
  asthma_pct: "Asthma prevalence",
  mental_health_pct: "Mental health",
  heat_index: "Heat stress index",
  disability_pct: "Disability rate",
  obesity_pct: "Obesity",
  depression_pct: "Depression",
  cognitive_difficulty_pct: "Cognitive difficulty",
  mobility_difficulty_pct: "Mobility difficulty",
  smoking_pct: "Current smoking",
  dental_visits_pct: "Dental visit rate",
};

export function formatMetricValue(metric: MetricKey, value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (metric === "rent_burden_pct") return `${Math.round(value)}% burdened`;
  if (metric === "heat_index") return value.toFixed(1);
  if (metric.endsWith("_pct") || metric === "structural_vacancy_rate") return `${value.toFixed(1)}%`;
  return value.toFixed(2);
}

export { METRIC_KEYS };
