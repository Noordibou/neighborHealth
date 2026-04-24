import { computeBatchScores, METRIC_KEYS, type MetricKey, type TractValues } from "@/lib/riskScore";

export type MapLayerMode = "composite" | "housing" | "health" | "weighted";

/** Five sliders aligned with product mock (percentages; need not sum to 100 — normalized client-side). */
export type MapWeightPercents = {
  rent_burden_pct: number;
  uninsured_pct: number;
  disability_pct: number;
  overcrowding_pct: number;
  asthma_pct: number;
};

export const DEFAULT_MAP_WEIGHTS: MapWeightPercents = {
  rent_burden_pct: 25,
  uninsured_pct: 20,
  disability_pct: 20,
  overcrowding_pct: 15,
  asthma_pct: 20,
};

const WEIGHT_KEYS = [
  "rent_burden_pct",
  "uninsured_pct",
  "disability_pct",
  "overcrowding_pct",
  "asthma_pct",
] as const;

function numProp(p: Record<string, unknown>, k: string): number | null {
  const v = p[k];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function propsToTractValues(props: Record<string, unknown>): TractValues["values"] {
  const values = {} as TractValues["values"];
  for (const k of METRIC_KEYS) {
    values[k] = numProp(props, k);
  }
  return values;
}

function weightPercentsToPartial(w: MapWeightPercents): Partial<Record<MetricKey, number>> {
  const out: Partial<Record<MetricKey, number>> = {
    vacancy_rate: 0,
    heat_index: 0,
  };
  for (const k of WEIGHT_KEYS) {
    const n = w[k];
    if (typeof n === "number" && Number.isFinite(n) && n >= 0) out[k] = n;
  }
  return out;
}

/**
 * Adds `nh_map_value` on each feature for choropleth fill (0–100 scale where applicable).
 */
export function augmentGeoJSONForMap(
  fc: GeoJSON.FeatureCollection,
  mode: MapLayerMode,
  weightPercents: MapWeightPercents
): GeoJSON.FeatureCollection {
  const tractRows: TractValues[] = [];
  for (const f of fc.features) {
    const p = f.properties as Record<string, unknown> | null | undefined;
    if (!p || typeof p.geoid !== "string") continue;
    tractRows.push({ geoid: p.geoid, values: propsToTractValues(p) });
  }

  const weighted =
    tractRows.length > 0 ? computeBatchScores(tractRows, weightPercentsToPartial(weightPercents)) : {};

  return {
    ...fc,
    features: fc.features.map((f) => {
      const p = { ...((f.properties ?? {}) as Record<string, unknown>) };
      const geoid = typeof p.geoid === "string" ? p.geoid : "";
      let mapValue: number | null = null;

      if (mode === "composite") {
        mapValue = numProp(p, "composite_score");
      } else if (mode === "housing") {
        mapValue = numProp(p, "rent_burden_pct");
      } else if (mode === "health") {
        const a = numProp(p, "uninsured_pct");
        const b = numProp(p, "asthma_pct");
        const c = numProp(p, "disability_pct");
        const nums = [a, b, c].filter((x): x is number => x != null);
        mapValue = nums.length ? nums.reduce((s, x) => s + x, 0) / nums.length : null;
      } else {
        mapValue = geoid && weighted[geoid] ? weighted[geoid].composite : null;
      }

      p.nh_map_value = mapValue;
      return { ...f, properties: p };
    }),
  };
}
