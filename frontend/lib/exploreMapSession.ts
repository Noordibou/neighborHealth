/** Persist Explore map + search state so browser Back can restore after opening a tract. */

export const EXPLORE_MAP_SESSION_KEY = "nh-explore-map-session";

export type PersistedSearchResult = {
  geoid: string;
  name: string | null;
  state_fips: string;
  county_name: string | null;
  composite_score: number | null;
};

export type ExploreMapSessionV1 = {
  v: 1;
  mapMode: "browse" | "search";
  q: string;
  searchNarrowFips: string | null;
  stateFips: string | null;
  searchResults: PersistedSearchResult[] | null;
  /** GEOIDs used to rebuild search GeoJSON via POST /map/tracts-by-geoids */
  searchGeoids: string[];
  searchInfo: string | null;
  searchZoomKey: number;
};

function isPlainRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function asString(x: unknown, fallback = ""): string {
  return typeof x === "string" ? x : fallback;
}

function asStringOrNull(x: unknown): string | null {
  if (x === null || x === undefined) return null;
  if (typeof x === "string") return x;
  return null;
}

function asFiniteNumber(x: unknown, fallback: number): number {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string" && x.trim() !== "") {
    const n = Number(x);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function parseStateFips(x: unknown): string | null {
  if (x === null || x === undefined) return null;
  if (typeof x === "string") {
    const s = x.trim();
    return s.length ? s : null;
  }
  if (typeof x === "number" && Number.isFinite(x)) {
    return String(Math.trunc(x)).padStart(2, "0").slice(-2);
  }
  return null;
}

/** Safe GEOID list: non-array or wrong element types become []. */
export function parseSearchGeoids(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  const out: string[] = [];
  for (const g of x) {
    if (typeof g === "string" && g.trim()) out.push(g.trim());
  }
  return out;
}

/** Safe results: non-array → null; rows missing required fields are skipped. */
export function parseSearchResults(x: unknown): PersistedSearchResult[] | null {
  if (x === null || x === undefined) return null;
  if (!Array.isArray(x)) return null;
  const out: PersistedSearchResult[] = [];
  for (const row of x) {
    if (!isPlainRecord(row)) continue;
    const geoid = row.geoid;
    if (typeof geoid !== "string" || !geoid.trim()) continue;
    let state_fips = "";
    if (typeof row.state_fips === "string" && row.state_fips.trim()) state_fips = row.state_fips.trim();
    else if (typeof row.state_fips === "number" && Number.isFinite(row.state_fips)) {
      state_fips = String(Math.trunc(row.state_fips)).padStart(2, "0").slice(-2);
    }
    if (!state_fips) continue;
    let composite_score: number | null = null;
    const cs = row.composite_score;
    if (typeof cs === "number" && Number.isFinite(cs)) composite_score = cs;
    else if (typeof cs === "string" && cs.trim() !== "") {
      const n = Number(cs);
      if (Number.isFinite(n)) composite_score = n;
    }
    out.push({
      geoid: geoid.trim(),
      name: asStringOrNull(row.name),
      state_fips,
      county_name: asStringOrNull(row.county_name),
      composite_score,
    });
  }
  return out;
}

export function parseExploreMapSession(raw: string | null): ExploreMapSessionV1 | null {
  if (raw == null || raw === "") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainRecord(parsed)) return null;
    if (parsed.v !== 1) return null;
    if (parsed.mapMode !== "browse" && parsed.mapMode !== "search") return null;
    const mapMode = parsed.mapMode;
    return {
      v: 1,
      mapMode,
      q: asString(parsed.q),
      searchNarrowFips: asStringOrNull(parsed.searchNarrowFips),
      stateFips: parseStateFips(parsed.stateFips),
      searchResults: parseSearchResults(parsed.searchResults),
      searchGeoids: parseSearchGeoids(parsed.searchGeoids),
      searchInfo: asStringOrNull(parsed.searchInfo),
      searchZoomKey: asFiniteNumber(parsed.searchZoomKey, 0),
    };
  } catch {
    return null;
  }
}

export function serializeExploreMapSession(data: ExploreMapSessionV1): string {
  return JSON.stringify(data);
}
