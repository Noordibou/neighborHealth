const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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

export function searchTracts(q: string) {
  return api<{ results: { geoid: string; name: string | null; composite_score: number | null }[] }>(
    `/api/search?q=${encodeURIComponent(q)}`
  );
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
