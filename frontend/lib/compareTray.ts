/** Up to 4 GEOIDs for side-by-side compare; persisted for the map + profile flows. */

export const COMPARE_TRAY_KEY = "nh-compare-tray";

/** Fired on `window` after `writeCompareTray` so nav can refresh Compare href (same-tab sessionStorage is otherwise invisible). */
export const NH_COMPARE_TRAY_EVENT = "nh-compare-tray-update";

function notifyCompareTrayListeners(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(NH_COMPARE_TRAY_EVENT));
}

/** Href for global Compare nav: current compare URL when on `/compare`, else session tray when ≥2 GEOIDs. */
export function getCompareNavHref(pathname: string | null | undefined): string {
  if (typeof window === "undefined") return "/compare";
  if (pathname === "/compare") {
    const raw = new URLSearchParams(window.location.search).get("geoids") ?? "";
    const gs = raw.split(",").map((g) => g.trim()).filter(Boolean);
    if (gs.length >= 2) return `/compare?geoids=${encodeURIComponent(raw)}`;
  }
  const tray = readCompareTray();
  if (tray.length >= 2) return `/compare?geoids=${encodeURIComponent(tray.join(","))}`;
  return "/compare";
}

export function readCompareTray(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(COMPARE_TRAY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const x of parsed) {
      if (typeof x !== "string") continue;
      const g = x.trim();
      if (!g || g.length > 12 || !/^\d+$/.test(g) || seen.has(g)) continue;
      seen.add(g);
      out.push(g);
      if (out.length >= 4) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function writeCompareTray(geoids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    const next = geoids.slice(0, 4);
    sessionStorage.setItem(COMPARE_TRAY_KEY, JSON.stringify(next));
    notifyCompareTrayListeners();
  } catch {
    /* ignore */
  }
}

export function addToCompareTray(geoid: string, max = 4): string[] {
  const g = geoid.trim();
  if (!g) return readCompareTray();
  const cur = readCompareTray().filter((x) => x !== g);
  const next = [g, ...cur].slice(0, max);
  writeCompareTray(next);
  return next;
}

export function removeFromCompareTray(geoid: string): string[] {
  const next = readCompareTray().filter((x) => x !== geoid);
  writeCompareTray(next);
  return next;
}

export function toggleCompareTray(geoid: string): string[] {
  const cur = readCompareTray();
  if (cur.includes(geoid)) return removeFromCompareTray(geoid);
  if (cur.length >= 4) return cur;
  return addToCompareTray(geoid);
}
