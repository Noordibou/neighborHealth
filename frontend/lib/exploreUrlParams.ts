import type { ExploreLayerMode, Viewport } from "@/types";

/** Parse `/explore` query string (with or without leading `?`). */
export function parseExploreUrl(search: string): {
  tract: string | null;
  stateFromUrl: string | null;
  layer: ExploreLayerMode | null;
  minRent: number | null;
  minUninsured: number | null;
  scoreMin: number | undefined;
  popMin: number | undefined;
  exclInst: boolean | undefined;
  clinicDist: "" | "1" | "2" | "5" | "over5";
  viewport: Viewport | null;
} {
  const q = search.startsWith("?") ? search.slice(1) : search;
  const p = new URLSearchParams(q);
  const tractRaw = p.get("tract")?.trim();
  const tract = tractRaw && /^\d{11}$/.test(tractRaw) ? tractRaw : null;
  const stateRaw = p.get("state")?.trim();
  const stateFromUrl =
    stateRaw && /^\d{2}$/.test(stateRaw.padStart(2).slice(0, 2))
      ? stateRaw.padStart(2).slice(0, 2)
      : null;
  const lr = p.get("layer")?.toLowerCase();
  const layer: ExploreLayerMode | null =
    lr === "housing" || lr === "health" || lr === "composite" || lr === "overlap"
      ? (lr as ExploreLayerMode)
      : null;
  const rentN = Number(p.get("f_rent"));
  const minRent =
    Number.isFinite(rentN) && rentN >= 0 && rentN <= 100 ? Math.round(rentN) : null;
  const uniN = Number(p.get("f_uninsured"));
  const minUninsured =
    Number.isFinite(uniN) && uniN >= 0 && uniN <= 50 ? Math.round(uniN) : null;
  let scoreMin: number | undefined;
  if (p.has("score_min")) {
    const sc = Number(p.get("score_min"));
    if (Number.isFinite(sc) && sc >= 0 && sc <= 100) scoreMin = Math.round(sc);
  }
  const POP_MIN_OPTS = new Set([0, 500, 1000, 2500, 5000]);
  let popMin: number | undefined;
  if (p.has("pop_min")) {
    const pn = Number(p.get("pop_min"));
    if (Number.isFinite(pn) && POP_MIN_OPTS.has(Math.round(pn))) popMin = Math.round(pn);
  }
  let exclInst: boolean | undefined;
  if (p.has("excl_inst")) {
    const raw = p.get("excl_inst")?.toLowerCase() ?? "";
    exclInst = raw === "1" || raw === "true";
  }
  let clinicDist: "" | "1" | "2" | "5" | "over5" = "";
  if (p.has("clinic_dist")) {
    const cr = p.get("clinic_dist")?.trim().toLowerCase() ?? "";
    if (cr === "1" || cr === "2" || cr === "5") clinicDist = cr as "1" | "2" | "5";
    else if (cr === "over5") clinicDist = "over5";
  }
  const lat = Number(p.get("lat"));
  const lng = Number(p.get("lng"));
  const zoom = Number(p.get("zoom"));
  const viewport =
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    Number.isFinite(lng) &&
    lng >= -180 &&
    lng <= 180 &&
    Number.isFinite(zoom) &&
    zoom >= 0 &&
    zoom <= 22
      ? { lat, lng, zoom }
      : null;
  return {
    tract,
    stateFromUrl,
    layer,
    minRent,
    minUninsured,
    scoreMin,
    popMin,
    exclInst,
    clinicDist,
    viewport,
  };
}
