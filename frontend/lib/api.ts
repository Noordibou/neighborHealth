import type {
  TractSummary,
  TractDetail,
  TractScoreTrendPayload,
  StateSummary,
  SearchResultRow,
  AddressSearchResponse,
  SearchSuggestItem,
  TractDemographicsRow,
  IndicatorRow,
} from "@/types";

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

export function getTractTrend(geoid: string) {
  return api<TractScoreTrendPayload>(`/api/tracts/${geoid}/trend`);
}

export function getTractSummary(geoid: string, refresh = false) {
  const q = refresh ? "?refresh=true" : "";
  return api<{ summary_text: string; generated_at: string }>(`/api/tracts/${geoid}/summary${q}`);
}

export function getMapGeoJSON(stateFips: string) {
  return api<GeoJSON.FeatureCollection>(`/api/map/tracts?state_fips=${stateFips}`);
}

export function getStates() {
  return api<StateSummary[]>(`/api/states`);
}

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

export function searchTracts(q: string, opts?: { stateFips?: string; limit?: number }) {
  const p = new URLSearchParams({ q: q.trim() });
  if (opts?.stateFips) p.set("state_fips", opts.stateFips);
  if (opts?.limit != null) p.set("limit", String(opts.limit));
  return api<{ query: string; results: SearchResultRow[] }>(`/api/search?${p.toString()}`);
}

/** U.S. Census Bureau geocoder + local tract lookup (no Mapbox key). */
export function searchFromAddress(address: string, stateFips?: string) {
  const body: { address: string; state_fips?: string } = { address: address.trim() };
  if (stateFips) body.state_fips = stateFips;
  return api<AddressSearchResponse>("/api/search/from-address", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function searchSuggest(q: string) {
  const t = q.trim();
  if (t.length < 2) return Promise.resolve({ query: t, items: [] as SearchSuggestItem[] });
  return api<{ query: string; items: SearchSuggestItem[] }>(
    `/api/search/suggest?q=${encodeURIComponent(t)}`
  );
}

export async function getDemographics(geoid: string): Promise<TractDemographicsRow | null> {
  const res = await fetch(`${API_BASE}/api/tracts/${geoid}/demographics`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<TractDemographicsRow>;
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
