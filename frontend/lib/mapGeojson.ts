/**
 * Adds `nh_map_value` on each feature for choropleth fill (0–100 scale where applicable).
 * Adds bivariate classification props (`nh_housing_*`, `nh_health_*`, `nh_bivariate_class`, raw blends)
 * for a 3×3 housing stress × health burden matrix (tertiles across the current feature set).
 */
export type MapLayerMode = "composite" | "housing" | "health";

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

function numProp(p: Record<string, unknown>, k: string): number | null {
  const v = p[k];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Mean of two metrics; if one is missing, returns the other; both missing → null. */
function housingStressRawFromProps(p: Record<string, unknown>): number | null {
  const rent = numProp(p, "rent_burden_pct");
  const crowd = numProp(p, "overcrowding_pct");
  if (rent != null && crowd != null) return (rent + crowd) / 2;
  if (rent != null) return rent;
  if (crowd != null) return crowd;
  return null;
}

/** Mean of available health burden metrics; none present → null. */
function healthBurdenRawFromProps(p: Record<string, unknown>): number | null {
  const a = numProp(p, "uninsured_pct");
  const b = numProp(p, "asthma_pct");
  const c = numProp(p, "mental_health_pct");
  const nums = [a, b, c].filter((x): x is number => x != null);
  return nums.length ? nums.reduce((s, x) => s + x, 0) / nums.length : null;
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
 * Mutates feature properties in place (no new feature objects) and returns a new
 * FeatureCollection wrapper so React detects a reference change and MapLibre's
 * Source component calls source.setData() to refresh tile rendering.
 */
export function applyLayerMode(
  fc: GeoJSON.FeatureCollection | null,
  mode: MapLayerMode
): GeoJSON.FeatureCollection | null {
  if (!fc) return null;
  for (const f of fc.features) {
    if (!f.properties) continue;
    const p = f.properties as Record<string, unknown>;
    let mapValue: number | null = null;
    if (mode === "composite") {
      mapValue = numProp(p, "composite_score");
    } else if (mode === "housing") {
      mapValue = numProp(p, "rent_burden_pct");
    } else {
      const a = numProp(p, "uninsured_pct");
      const b = numProp(p, "asthma_pct");
      const c = numProp(p, "mental_health_pct");
      const nums = [a, b, c].filter((x): x is number => x != null);
      mapValue = nums.length ? nums.reduce((s, x) => s + x, 0) / nums.length : null;
    }
    p.nh_map_value = mapValue;
  }
  return { ...fc }; // new wrapper reference — React sees a prop change
}

/** @deprecated Use augmentGeoJSONForYear + applyLayerMode separately for better memoization. */
export function augmentGeoJSONForMap(
  fc: GeoJSON.FeatureCollection,
  mode: MapLayerMode
): GeoJSON.FeatureCollection {
  return applyLayerMode(augmentGeoJSONForYear(fc), mode)!;
}
