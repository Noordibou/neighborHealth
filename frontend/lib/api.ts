function normalizeApiBase(raw: string): string {
  const t = (raw || "").trim().replace(/\/+$/, "");
  if (!t) return "http://localhost:8000";
  // On server-side Next.js fetch, localhost can resolve to ::1 while API may be bound only on 127.0.0.1.
  if (typeof window === "undefined") {
    return t.replace("://localhost", "://127.0.0.1");
  }
  return t;
}

const CLIENT_API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000");
const SERVER_API_BASE = normalizeApiBase(process.env.INTERNAL_API_URL ?? CLIENT_API_BASE);
const API_BASE = typeof window === "undefined" ? SERVER_API_BASE : CLIENT_API_BASE;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

export type TractSummary = {
  geoid: string;
  name: string | null;
  state_fips: string;
  county_fips: string;
  county_name: string | null;
  place_name: string | null;
  composite_score: number | null;
  year: number | null;
};

export type TractDetail = TractSummary & {
  centroid_lat: number | null;
  centroid_lon: number | null;
  indicators: {
    source: string;
    metric_name: string;
    value: number | null;
    year: number;
    percentile_national: number | null;
    percentile_state: number | null;
  }[];
  risk_score: {
    composite_score: number;
    component_scores: Record<string, number> | null;
    year: number;
  } | null;
};

export function getTractList(params: Record<string, string | undefined>) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== "") q.set(k, v);
  });
  return api<{ items: TractSummary[]; total: number }>(`/api/tracts?${q.toString()}`);
}

export function getTract(geoid: string) {
  return api<TractDetail>(`/api/tracts/${geoid}`);
}

export function getTractSummary(geoid: string, refresh = false) {
  const q = refresh ? "?refresh=true" : "";
  return api<{ summary_text: string; generated_at: string }>(`/api/tracts/${geoid}/summary${q}`);
}

export function getMapGeoJSON(stateFips: string) {
  return api<GeoJSON.FeatureCollection>(`/api/map/tracts?state_fips=${stateFips}`);
}

export function getStates() {
  return api<{ state_fips: string; state_name: string; tract_count: number }[]>(`/api/states`);
}

export type IndicatorRow = {
  source: string;
  metric_name: string;
  value: number | null;
  year: number;
  percentile_national: number | null;
  percentile_state: number | null;
};

export function getCompare(geoids: string[]) {
  const q = geoids.join(",");
  return api<{
    geoids: string[];
    year: number | null;
    indicators: string[];
    series: Record<string, number | string>[];
    raw_indicators: Record<string, IndicatorRow[]>;
  }>(`/api/compare?geoids=${encodeURIComponent(q)}`);
}

export type SearchResultRow = {
  geoid: string;
  name: string | null;
  state_fips: string;
  county_name: string | null;
  composite_score: number | null;
};

export function searchTracts(q: string, opts?: { stateFips?: string; limit?: number }) {
  const p = new URLSearchParams({ q: q.trim() });
  if (opts?.stateFips) p.set("state_fips", opts.stateFips);
  if (opts?.limit != null) p.set("limit", String(opts.limit));
  return api<{ query: string; results: SearchResultRow[] }>(`/api/search?${p.toString()}`);
}

export type AddressSearchResponse = {
  query: string;
  matched_address: string | null;
  longitude: number | null;
  latitude: number | null;
  results: SearchResultRow[];
  census_tract_geoid: string | null;
  resolver: "none" | "census_geographies" | "postgis_point";
  message: string | null;
};

/** U.S. Census Bureau geocoder + local tract lookup (no Mapbox key). */
export function searchFromAddress(address: string, stateFips?: string) {
  const body: { address: string; state_fips?: string } = { address: address.trim() };
  if (stateFips) body.state_fips = stateFips;
  return api<AddressSearchResponse>("/api/search/from-address", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type SearchSuggestItem = {
  kind: "state" | "county" | "place";
  label: string;
  detail?: string | null;
  query: string;
  state_fips?: string | null;
};

export function searchSuggest(q: string) {
  const t = q.trim();
  if (t.length < 2) return Promise.resolve({ query: t, items: [] as SearchSuggestItem[] });
  return api<{ query: string; items: SearchSuggestItem[] }>(
    `/api/search/suggest?q=${encodeURIComponent(t)}`
  );
}

export function postMapTractsByGeoids(geoids: string[]) {
  return api<GeoJSON.FeatureCollection>("/api/map/tracts-by-geoids", {
    method: "POST",
    body: JSON.stringify({ geoids }),
  });
}

export async function postPdfExport(geoid: string) {
  const res = await fetch(`${API_BASE}/api/export/pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ geoid }),
  });
  if (!res.ok) throw new Error(await res.text());
  const j = (await res.json()) as { download_url: string };
  if (j.download_url && !j.download_url.startsWith("http")) {
    j.download_url = `${API_BASE}${j.download_url}`;
  }
  return j;
}

export { API_BASE };
