/**
 * Fixed camera for the US state-picker (no `state=` selected). Conterminous US only — never a global/world zoom.
 * Keep in sync with `NeighborMap` when `stateFips == null`.
 */
export function getExploreUsOverviewView(): { lng: number; lat: number; zoom: number } {
  return { lng: -98.2, lat: 39.35, zoom: 3.5 };
}

/**
 * Default explore-map camera when a state is selected but fitBounds has not run yet.
 * Must stay aligned with `NeighborMap` explore browse `center` / `zoom` logic.
 */
export function getExploreBrowsePlaceholderView(stateFips: string): {
  lng: number;
  lat: number;
  zoom: number;
} {
  const sf = stateFips.padStart(2).slice(0, 2);
  const centers: Record<string, [number, number]> = {
    "06": [-119, 37],
    "12": [-81.5, 27.5],
    "17": [-89, 40],
    "36": [-75, 43],
    "42": [-77.6, 41.0],
    "48": [-99, 31],
  };
  const [lng, lat] = centers[sf] ?? [-98, 39];
  const zoom = sf === "06" ? 5.5 : sf === "42" ? 7 : 6;
  return { lng, lat, zoom };
}

/** True when URL viewport is effectively the pre–fitBounds placeholder (not a user-chosen camera). */
export function isExploreBrowsePlaceholderViewport(
  stateFips: string | null | undefined,
  vp: { lng: number; lat: number; zoom: number }
): boolean {
  if (!stateFips || !/^\d{2}$/.test(stateFips.padStart(2).slice(0, 2))) return false;
  const ph = getExploreBrowsePlaceholderView(stateFips);
  return (
    Math.abs(vp.lat - ph.lat) < 0.02 &&
    Math.abs(vp.lng - ph.lng) < 0.02 &&
    Math.abs(vp.zoom - ph.zoom) < 0.25
  );
}
