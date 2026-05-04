/**
 * Adds `nh_map_value` on each feature for choropleth fill (0–100 scale where applicable).
 */
export type MapLayerMode = "composite" | "housing" | "health";

function numProp(p: Record<string, unknown>, k: string): number | null {
  const v = p[k];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function augmentGeoJSONForMap(
  fc: GeoJSON.FeatureCollection,
  mode: MapLayerMode
): GeoJSON.FeatureCollection {
  return {
    ...fc,
    features: fc.features.map((f) => {
      const p = { ...((f.properties ?? {}) as Record<string, unknown>) };
      let mapValue: number | null = null;

      if (mode === "composite") {
        mapValue = numProp(p, "composite_score");
      } else if (mode === "housing") {
        mapValue = numProp(p, "rent_burden_pct");
      } else {
        const a = numProp(p, "uninsured_pct");
        const b = numProp(p, "asthma_pct");
        const c = numProp(p, "disability_pct");
        const nums = [a, b, c].filter((x): x is number => x != null);
        mapValue = nums.length ? nums.reduce((s, x) => s + x, 0) / nums.length : null;
      }

      p.nh_map_value = mapValue;
      return { ...f, properties: p };
    }),
  };
}
