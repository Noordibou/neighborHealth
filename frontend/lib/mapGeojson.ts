/**
 * Adds `nh_map_value` on each feature for choropleth fill (0–100 scale where applicable).
 * Adds bivariate classification props (`nh_housing_*`, `nh_health_*`, `nh_bivariate_class`, raw blends)
 * for a 3×3 housing stress × health burden matrix (tertiles across the current feature set).
 */
import type { MapLayerMode } from "@/types";
export type { MapLayerMode };

/** Fill colors for bivariate class keys `"<housing>-<health>"` e.g. `"1-1"` … `"3-3"`. */
export const BIVARIATE_COLORS: Record<string, string> = {
  "1-1": "#e8e8e8",
  "1-2": "#dfb0b0",
  "1-3": "#b56c6c",
  "2-1": "#b0c1df",
  "2-2": "#a9a9c0",
  "2-3": "#956b8a",
  "3-1": "#6c83b5",
  "3-2": "#7a6e9e",
  "3-3": "#574249",
};

/**
 * Minimum number of component-score metrics that must be non-null to produce a
 * blend value.  Tracts with fewer available metrics return null (no-data fill).
 * Requiring 2-of-3 prevents a single metric from masquerading as a full blend.
 */
const MIN_METRICS_FOR_BLEND = 2;

function numProp(p: Record<string, unknown>, k: string): number | null {
  const v = p[k];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Housing stress blend from normalized component scores (cs_ prefix, 0–100).
 * Uses rent burden, overcrowding, and structural vacancy.
 * Requires at least MIN_METRICS_FOR_BLEND of the three to be non-null.
 * Raw percentage properties are still present on features for backward compat
 * but are NOT used here — raw values are on different scales and would
 * suppress overcrowding (narrow range) against rent burden (wide range).
 */
function housingStressRawFromProps(p: Record<string, unknown>): number | null {
  const a = numProp(p, "cs_rent_burden_pct");
  const b = numProp(p, "cs_overcrowding_pct");
  const c = numProp(p, "cs_structural_vacancy_rate");
  const nums = [a, b, c].filter((x): x is number => x != null);
  return nums.length >= MIN_METRICS_FOR_BLEND
    ? nums.reduce((s, x) => s + x, 0) / nums.length
    : null;
}

/**
 * Health burden blend from normalized component scores (cs_ prefix, 0–100).
 * Uses uninsured rate, asthma prevalence, and mental health prevalence.
 * Requires at least MIN_METRICS_FOR_BLEND of the three to be non-null.
 */
function healthBurdenRawFromProps(p: Record<string, unknown>): number | null {
  const a = numProp(p, "cs_uninsured_pct");
  const b = numProp(p, "cs_asthma_pct");
  const c = numProp(p, "cs_mental_health_pct");
  const nums = [a, b, c].filter((x): x is number => x != null);
  return nums.length >= MIN_METRICS_FOR_BLEND
    ? nums.reduce((s, x) => s + x, 0) / nums.length
    : null;
}

/**
 * Tertile cut points from sorted values: lower at index floor(n/3), upper at floor(2n/3).
 * Returns null when there are no values.
 */
export function computeTertileBreaks(values: number[]): [number, number] | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const i1 = Math.floor(n / 3);
  const i2 = Math.floor((2 * n) / 3);
  return [sorted[i1], sorted[i2]];
}

function classifyTertile(value: number | null, breaks: [number, number] | null): 1 | 2 | 3 | null {
  if (value == null || breaks == null) return null;
  const [b0, b1] = breaks;
  if (value <= b0) return 1;
  if (value <= b1) return 2;
  return 3;
}

/**
 * Layer 1 (expensive): compute bivariate class + housing/health properties for every feature.
 * Results depend only on the raw GeoJSON values — not on which layer tab is active.
 * Call this once when GeoJSON loads; memoize on [geojson] reference only.
 * `nh_map_value` is set to null here; `applyLayerMode` assigns the active tab value
 * on cloned feature properties so MapLibre `<Source>` deep-compare detects updates.
 *
 * Housing and health blends use normalized component scores (cs_ prefix) so that
 * all three contributing metrics are on the same 0–100 scale before blending.
 * This keeps the bivariate classification consistent with the Health and Housing
 * choropleth layers.
 */
export function augmentGeoJSONForYear(
  fc: GeoJSON.FeatureCollection
): GeoJSON.FeatureCollection {
  const housingRaws: number[] = [];
  const healthRaws: number[] = [];

  const staged = fc.features.map((f) => {
    const base = (f.properties ?? {}) as Record<string, unknown>;
    const housingRaw = housingStressRawFromProps(base);
    const healthRaw = healthBurdenRawFromProps(base);
    if (housingRaw != null) housingRaws.push(housingRaw);
    if (healthRaw != null) healthRaws.push(healthRaw);
    return { f, base, housingRaw, healthRaw };
  });

  const housingBreaks = computeTertileBreaks(housingRaws);
  const healthBreaks = computeTertileBreaks(healthRaws);

  return {
    ...fc,
    features: staged.map(({ f, base, housingRaw, healthRaw }) => {
      const p = { ...base };
      const housingClass = classifyTertile(housingRaw, housingBreaks);
      const healthClass = classifyTertile(healthRaw, healthBreaks);
      p.nh_housing_stress_raw = housingRaw;
      p.nh_health_burden_raw = healthRaw;
      p.nh_housing_class = housingClass;
      p.nh_health_class = healthClass;
      p.nh_bivariate_class =
        housingClass != null && healthClass != null ? `${housingClass}-${healthClass}` : null;
      p.nh_map_value = null; // populated by applyLayerMode
      return { ...f, properties: p };
    }),
  };
}

/**
 * Layer 2 (cheap): set nh_map_value on each feature for the active layer mode.
 *
 * Returns new feature + properties objects (not in-place mutation). MapLibre's
 * React `<Source>` uses deep equality on `data`; reusing the same `features`
 * array reference makes `deepEqual(prev, next)` true immediately (`a === b`)
 * even when nested `nh_map_value` changed — so `setData` never runs and the
 * choropleth colors stick on the previous layer.
 *
 * All three modes produce values on the same 0–100 normalized scale so the
 * fixed-domain choropleth in NeighborMap renders consistently across states.
 *
 * - composite: uses the stored composite_score (0–100, pre-normalized nationally)
 * - housing:   blends cs_rent_burden_pct + cs_overcrowding_pct + cs_structural_vacancy_rate
 * - health:    blends cs_uninsured_pct + cs_asthma_pct + cs_mental_health_pct
 */
export function applyLayerMode(
  fc: GeoJSON.FeatureCollection | null,
  mode: MapLayerMode
): GeoJSON.FeatureCollection | null {
  if (!fc) return null;
  const features = fc.features.map((f) => {
    if (!f.properties) return f;
    const p = f.properties as Record<string, unknown>;
    let mapValue: number | null = null;
    if (mode === "composite") {
      mapValue = numProp(p, "composite_score");
    } else if (mode === "housing") {
      mapValue = housingStressRawFromProps(p);
    } else {
      mapValue = healthBurdenRawFromProps(p);
    }
    return {
      ...f,
      properties: {
        ...p,
        nh_map_value: mapValue,
      },
    };
  });
  return { ...fc, features };
}

/** @deprecated Use augmentGeoJSONForYear + applyLayerMode separately for better memoization. */
export function augmentGeoJSONForMap(
  fc: GeoJSON.FeatureCollection,
  mode: MapLayerMode
): GeoJSON.FeatureCollection {
  return applyLayerMode(augmentGeoJSONForYear(fc), mode)!;
}
