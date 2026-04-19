"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { NeighborMap } from "@/components/NeighborMap";
import { SiteFooter } from "@/components/SiteFooter";
import {
  getMapGeoJSON,
  getTract,
  getTractList,
  postMapTractsByGeoids,
  searchFromAddress,
  searchSuggest,
  searchTracts,
  type SearchResultRow,
  type SearchSuggestItem,
} from "@/lib/api";
import {
  EXPLORE_MAP_SESSION_KEY,
  type ExploreMapSessionV1,
  parseExploreMapSession,
  serializeExploreMapSession,
} from "@/lib/exploreMapSession";

const STATES = [
  { fips: "06", label: "California" },
  { fips: "48", label: "Texas" },
  { fips: "36", label: "New York" },
  { fips: "12", label: "Florida" },
  { fips: "17", label: "Illinois" },
];

const STATE_ABBR: Record<string, string> = {
  "06": "CA",
  "48": "TX",
  "36": "NY",
  "12": "FL",
  "17": "IL",
};

/** Prefer Census address geocoder when the query looks like a street address (not a bare GEOID). */
function looksLikeUsStreetAddress(s: string): boolean {
  const t = s.trim();
  if (t.length < 8 || t.length > 400) return false;
  if (/^\d{11}$/.test(t)) return false;
  return /^\d+\s/.test(t);
}

type Preview = { rent: number | null; uninsured: number | null };

type MapMode = "browse" | "search";

function ExploreInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const initialQ = sp.get("q")?.trim() ?? "";

  const [stateFips, setStateFips] = useState<string | null>(null);
  const [geojson, setGeojson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState(initialQ);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchInfo, setSearchInfo] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResultRow[] | null>(null);
  const [searchNarrowFips, setSearchNarrowFips] = useState<string | null>(null);
  const [mapMode, setMapMode] = useState<MapMode>("browse");
  const [searchGeojson, setSearchGeojson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [searchMapLoading, setSearchMapLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<SearchSuggestItem[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [searchZoomKey, setSearchZoomKey] = useState(0);
  /** When false, skip persisting so hydrate does not overwrite sessionStorage with default state. */
  const [sessionReady, setSessionReady] = useState(false);
  const [ranked, setRanked] = useState<
    { geoid: string; composite_score: number | null; name: string | null; county_name: string | null }[]
  >([]);
  const [previews, setPreviews] = useState<Record<string, Preview>>({});

  const [draft, setDraft] = useState({
    minScore: 0,
    minRent: 0,
    minUninsured: 0,
    asthma: 0,
    urbanRural: "" as "" | "urban" | "rural",
  });
  const [applied, setApplied] = useState({
    minScore: 0,
    minRent: 0,
    minUninsured: 0,
    asthmaHigh: false,
    urbanRural: "" as "" | "urban" | "rural",
  });

  const skipSessionHydrate = initialQ.length > 0;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (skipSessionHydrate) {
      setSessionReady(true);
      return;
    }
    let cancelled = false;
    const raw = sessionStorage.getItem(EXPLORE_MAP_SESSION_KEY);
    const data = parseExploreMapSession(raw);
    if (!data) {
      setSessionReady(true);
      return;
    }
    setQ(data.q);
    setSearchNarrowFips(data.searchNarrowFips);
    setStateFips(data.stateFips);
    setSearchInfo(data.searchInfo);

    if (data.mapMode === "search" && data.searchGeoids.length > 0) {
      setMapMode("search");
      setSearchResults(data.searchResults as SearchResultRow[]);
      setSearchMapLoading(true);
      void postMapTractsByGeoids(data.searchGeoids)
        .then((fc) => {
          if (cancelled) return;
          if (fc.features?.length) {
            setSearchGeojson(fc);
            setSearchZoomKey((k) => k + 1);
          } else {
            setMapMode("browse");
            setSearchGeojson(null);
            setSearchResults(null);
          }
        })
        .catch(() => {
          if (cancelled) return;
          setMapMode("browse");
          setSearchGeojson(null);
          setSearchResults(null);
        })
        .finally(() => {
          if (!cancelled) setSearchMapLoading(false);
          if (!cancelled) setSessionReady(true);
        });
    } else {
      setMapMode("browse");
      setSearchGeojson(null);
      setSearchResults(null);
      setSessionReady(true);
    }
    return () => {
      cancelled = true;
    };
  }, [skipSessionHydrate, initialQ]);

  useEffect(() => {
    if (!sessionReady || typeof window === "undefined") return;
    const searchGeoids =
      searchGeojson?.features
        ?.map((f) => (typeof f.properties?.geoid === "string" ? f.properties.geoid : ""))
        .filter(Boolean) ?? [];
    const payload: ExploreMapSessionV1 = {
      v: 1,
      mapMode,
      q,
      searchNarrowFips,
      stateFips,
      searchResults: searchResults?.map((r) => ({ ...r })) ?? null,
      searchGeoids,
      searchInfo,
      searchZoomKey,
    };
    try {
      sessionStorage.setItem(EXPLORE_MAP_SESSION_KEY, serializeExploreMapSession(payload));
    } catch {
      /* quota or private mode */
    }
  }, [
    sessionReady,
    mapMode,
    q,
    searchNarrowFips,
    stateFips,
    searchResults,
    searchGeojson,
    searchInfo,
    searchZoomKey,
  ]);

  useEffect(() => {
    if (!stateFips) {
      setGeojson(null);
      setErr(null);
      return;
    }
    setErr(null);
    getMapGeoJSON(stateFips)
      .then(setGeojson)
      .catch((e: Error) => setErr(e.message));
  }, [stateFips]);

  /** Home page sends ?q= — run one search and go to the tract (no map fetch on explore). */
  useEffect(() => {
    if (!initialQ) return;
    const key = `nh-explore-q-${initialQ}`;
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(key)) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await searchTracts(initialQ);
        if (cancelled || !r.results[0]) return;
        if (typeof sessionStorage !== "undefined") sessionStorage.setItem(key, "1");
        router.replace(`/tract/${r.results[0].geoid}`);
      } catch {
        /* stay on explore; user can search again */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialQ, router]);

  const clearSearchMap = useCallback(() => {
    setMapMode("browse");
    setSearchGeojson(null);
    setSearchResults(null);
    setSearchError(null);
    setSearchInfo(null);
  }, []);

  const runSearchOnMap = useCallback(async (query: string, narrow?: string | null) => {
    const t = query.trim();
    if (!t) return;
    setSearchError(null);
    setSearchInfo(null);
    setSearchMapLoading(true);
    try {
      const tryAddress = looksLikeUsStreetAddress(t);
      if (tryAddress) {
        try {
          const ar = await searchFromAddress(t, narrow ?? undefined);
          if (ar.results.length > 0) {
            setSearchResults(ar.results);
            const bits: string[] = [];
            if (ar.matched_address) bits.push(ar.matched_address);
            if (ar.resolver === "postgis_point") {
              bits.push("Located using stored tract boundaries (point-in-polygon).");
            }
            if (ar.message) bits.push(ar.message);
            setSearchInfo(bits.length ? bits.join(" · ") : null);
            const fc = await postMapTractsByGeoids(ar.results.map((x) => x.geoid));
            if (!fc.features?.length) {
              setSearchInfo(null);
              setSearchError("Address resolved, but map geometry is missing for that tract.");
              setSearchGeojson(null);
              setMapMode("browse");
              return;
            }
            setSearchGeojson(fc);
            setMapMode("search");
            setSearchZoomKey((k) => k + 1);
            setSuggestOpen(false);
            return;
          }
          if (ar.census_tract_geoid != null || ar.message != null) {
            setSearchResults(null);
            setSearchGeojson(null);
            setMapMode("browse");
            setSearchError(
              ar.message ??
                (ar.census_tract_geoid
                  ? `Census reports tract ${ar.census_tract_geoid}, but this app has no data for it yet.`
                  : "Address lookup did not return a tract in this app.")
            );
            return;
          }
        } catch {
          /* Census geocoder or API error — fall through to text search */
        }
      }

      const r = await searchTracts(t, { stateFips: narrow ?? undefined, limit: 75 });
      if (!r.results.length) {
        setSearchError(
          "No matches. Try a street address (e.g. 123 Main St, Houston TX), place, county, state, or GEOID — or pick a suggestion."
        );
        setSearchResults(null);
        setSearchGeojson(null);
        setMapMode("browse");
        return;
      }
      setSearchResults(r.results);
      const fc = await postMapTractsByGeoids(r.results.map((x) => x.geoid));
      if (!fc.features?.length) {
        setSearchError("Matches found, but none have map geometry yet. Try ingesting boundaries for this area.");
        setSearchGeojson(null);
        setMapMode("browse");
        return;
      }
      setSearchGeojson(fc);
      setMapMode("search");
      setSearchZoomKey((k) => k + 1);
      setSuggestOpen(false);
    } catch (err: unknown) {
      setSearchError(err instanceof Error ? err.message : "Search failed.");
      setSearchGeojson(null);
      setMapMode("browse");
    } finally {
      setSearchMapLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) {
      setSuggestions([]);
      return;
    }
    const id = setTimeout(() => {
      searchSuggest(t)
        .then((res) => setSuggestions(res.items))
        .catch(() => setSuggestions([]));
    }, 260);
    return () => clearTimeout(id);
  }, [q]);

  const fetchList = useCallback(() => {
    if (!stateFips) {
      setRanked([]);
      return;
    }
    const params: Record<string, string | undefined> = {
      state: stateFips,
      limit: "50",
    };
    if (applied.minScore > 0) params.min_score = String(applied.minScore);
    if (applied.minRent > 0) params.min_rent_burden = String(applied.minRent);
    if (applied.minUninsured > 0) params.min_uninsured = String(applied.minUninsured);
    if (applied.asthmaHigh) params.high_asthma = "true";
    if (applied.urbanRural) params.urban_rural = applied.urbanRural;

    getTractList(params)
      .then((r) =>
        setRanked(
          r.items.map((i) => ({
            geoid: i.geoid,
            composite_score: i.composite_score,
            name: i.name,
            county_name: i.county_name,
          }))
        )
      )
      .catch(() => setRanked([]));
  }, [stateFips, applied]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    const top = ranked.slice(0, 6);
    if (!top.length) {
      setPreviews({});
      return;
    }
    let cancelled = false;
    Promise.all(
      top.map(async (r) => {
        try {
          const d = await getTract(r.geoid);
          const rent = d.indicators.find((i) => i.metric_name === "rent_burden_pct")?.value ?? null;
          const uninsured = d.indicators.find((i) => i.metric_name === "uninsured_pct")?.value ?? null;
          return { geoid: r.geoid, rent, uninsured };
        } catch {
          return { geoid: r.geoid, rent: null, uninsured: null };
        }
      })
    ).then((rows) => {
      if (cancelled) return;
      const next: Record<string, Preview> = {};
      rows.forEach((row) => {
        next[row.geoid] = { rent: row.rent, uninsured: row.uninsured };
      });
      setPreviews(next);
    });
    return () => {
      cancelled = true;
    };
  }, [ranked]);

  async function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    await runSearchOnMap(q.trim(), searchNarrowFips);
  }

  function onPickSuggestion(item: SearchSuggestItem) {
    setSuggestOpen(false);
    if (item.kind === "state" && item.state_fips) {
      setMapMode("browse");
      setSearchGeojson(null);
      setSearchResults(null);
      setSearchError(null);
      setStateFips(item.state_fips);
      setQ(item.query);
      setSearchNarrowFips(null);
      return;
    }
    setQ(item.query);
    setSearchNarrowFips(item.state_fips ?? null);
    void runSearchOnMap(item.query, item.state_fips ?? null);
  }

  function applyFilters() {
    setApplied({
      minScore: draft.minScore,
      minRent: draft.minRent,
      minUninsured: draft.minUninsured,
      asthmaHigh: draft.asthma >= 12,
      urbanRural: draft.urbanRural,
    });
  }

  const onSelectTract = useCallback(
    async (geoid: string) => {
      router.push(`/tract/${geoid}`);
    },
    [router]
  );

  const stateLabel = useMemo(() => {
    if (!stateFips) return "Choose a state";
    return STATES.find((s) => s.fips === stateFips)?.label ?? stateFips;
  }, [stateFips]);
  const stateAbbr = stateFips ? STATE_ABBR[stateFips] ?? stateFips : "";

  const featureCount = geojson?.features?.length ?? 0;
  const noData = !err && geojson != null && featureCount === 0;

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col bg-[#f0f4f8]">
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="w-full shrink-0 border-b border-slate-200 bg-white lg:w-[380px] lg:border-b-0 lg:border-r">
          <div className="max-h-[48vh] overflow-y-auto p-4 lg:max-h-[calc(100vh-4rem)]">
            <form onSubmit={onSearchSubmit} className="mb-6">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Search</label>
              <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
                Type for suggestions (state, county, place). Queries that start with a street number use the U.S.
                Census geocoder, then open the tract on the map. You can also search by place, county, state, or GEOID.
              </p>
              <div className="mt-1 flex gap-2">
                <div className="relative flex-1">
                  <svg
                    className="pointer-events-none absolute left-3 top-1/2 z-[1] h-4 w-4 -translate-y-1/2 text-slate-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    autoComplete="off"
                    className="relative z-[1] w-full rounded-xl border border-slate-200 py-2.5 pl-3 pr-3 text-sm text-[#0f2940] placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                    placeholder="e.g. 123 Main St, Houston TX — or city, county, GEOID"
                    value={q}
                    onChange={(e) => {
                      setQ(e.target.value);
                      setSearchNarrowFips(null);
                    }}
                    onFocus={() => setSuggestOpen(true)}
                    onBlur={() => {
                      window.setTimeout(() => setSuggestOpen(false), 180);
                    }}
                  />
                  {suggestOpen && suggestions.length > 0 && (
                    <ul
                      className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
                      role="listbox"
                    >
                      {suggestions.map((item, idx) => (
                        <li key={`${item.kind}-${item.label}-${item.state_fips ?? ""}-${idx}`}>
                          <button
                            type="button"
                            className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => onPickSuggestion(item)}
                          >
                            <span className="mt-0.5 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                              {item.kind}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="font-medium text-[#0f2940]">{item.label}</span>
                              {item.detail ? (
                                <span className="mt-0.5 block truncate text-xs text-slate-500">{item.detail}</span>
                              ) : null}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <button type="submit" className="rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800">
                  Go
                </button>
              </div>
              {searchNarrowFips && (
                <p className="mt-1 text-[11px] text-slate-500">
                  Narrowed to state FIPS <span className="font-mono">{searchNarrowFips}</span> from your last suggestion
                  — clear by editing the text.
                </p>
              )}
              {searchError && <p className="mt-2 text-xs text-red-600">{searchError}</p>}
              {searchResults && searchResults.length > 0 && (
                <div className="mt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Tracts ({searchResults.length}
                    {mapMode === "search" ? ", on map" : ""})
                  </p>
                  <ul className="mt-1 max-h-52 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs">
                    {searchResults.map((r) => (
                      <li key={r.geoid}>
                        <button
                          type="button"
                          className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-white"
                          onClick={() => router.push(`/tract/${r.geoid}`)}
                        >
                          <span className="font-medium text-[#0f2940]">{r.name ?? r.geoid}</span>
                          {r.county_name ? <span className="text-slate-500"> · {r.county_name}</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {searchInfo && !searchError ? (
                <p className="mt-2 text-xs leading-snug text-slate-600">{searchInfo}</p>
              ) : null}
            </form>

            <div className="mb-4">
              <button
                type="button"
                className="flex w-full items-center justify-between text-left text-sm font-semibold text-[#0f2940]"
                aria-expanded
              >
                State
                <span className="text-slate-400">▾</span>
              </button>
              {mapMode === "search" && (
                <p className="mb-2 text-xs text-amber-900/85">
                  Search map is active. State choices apply after you use <strong>Exit search map</strong> (they do not
                  change the current search layer).
                </p>
              )}
              <ul className="mt-2 space-y-2">
                <li>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="state"
                      checked={stateFips === null}
                      onChange={() => {
                        setStateFips(null);
                        clearSearchMap();
                      }}
                      className="rounded-full border-slate-300 text-teal-600 focus:ring-teal-500"
                    />
                    United States (overview — no tract data loaded)
                  </label>
                </li>
                {STATES.map((s) => (
                  <li key={s.fips}>
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                      <input
                        type="radio"
                        name="state"
                        checked={stateFips === s.fips}
                        onChange={() => {
                          setStateFips(s.fips);
                          clearSearchMap();
                        }}
                        className="rounded-full border-slate-300 text-teal-600 focus:ring-teal-500"
                      />
                      {s.label}
                    </label>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-4 border-t border-slate-100 pt-4">
              <div>
                <div className="flex justify-between text-xs font-medium text-slate-600">
                  <span>Rent burden %</span>
                  <span>{draft.minRent}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={draft.minRent}
                  onChange={(e) => setDraft((d) => ({ ...d, minRent: Number(e.target.value) }))}
                  className="mt-1 w-full accent-teal-600"
                />
              </div>
              <div>
                <div className="flex justify-between text-xs font-medium text-slate-600">
                  <span>Uninsured rate</span>
                  <span>{draft.minUninsured}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={50}
                  value={draft.minUninsured}
                  onChange={(e) => setDraft((d) => ({ ...d, minUninsured: Number(e.target.value) }))}
                  className="mt-1 w-full accent-teal-600"
                />
              </div>
              <div>
                <div className="flex justify-between text-xs font-medium text-slate-600">
                  <span>Asthma rate</span>
                  <span>{draft.asthma}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={30}
                  value={draft.asthma}
                  onChange={(e) => setDraft((d) => ({ ...d, asthma: Number(e.target.value) }))}
                  className="mt-1 w-full accent-teal-600"
                />
                <p className="mt-1 text-[10px] text-slate-400">≥12% counts as high asthma when you apply filters.</p>
              </div>
              <div>
                <div className="flex justify-between text-xs font-medium text-slate-600">
                  <span>Min risk score</span>
                  <span>{draft.minScore}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={draft.minScore}
                  onChange={(e) => setDraft((d) => ({ ...d, minScore: Number(e.target.value) }))}
                  className="mt-1 w-full accent-teal-600"
                />
              </div>
            </div>

            <div className="mt-4 border-t border-slate-100 pt-4">
              <p className="text-sm font-semibold text-[#0f2940]">Area type</p>
              <div className="mt-2 space-y-2">
                {(["", "urban", "rural"] as const).map((v) => (
                  <label key={v || "any"} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="urban_rural"
                      checked={draft.urbanRural === v}
                      onChange={() => setDraft((d) => ({ ...d, urbanRural: v }))}
                      className="border-slate-300 text-teal-600 focus:ring-teal-500"
                    />
                    {v === "" ? "Any" : v === "urban" ? "Urban" : "Rural"}
                  </label>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={applyFilters}
              className="mt-6 w-full rounded-xl bg-[#0f2940] py-3 text-sm font-semibold text-white shadow-sm hover:bg-[#0a1f30]"
            >
              Apply filters
            </button>

            <div className="mt-8">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Top high-risk tracts</h2>
              <p className="text-xs text-slate-400">{stateLabel}</p>
              {!stateFips && (
                <p className="mt-3 text-xs text-slate-500">Select a state above to load rankings and the choropleth map.</p>
              )}
              {noData && (
                <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                  No tract rows in the database yet. Run the ingest script (see repo README) to load boundaries and
                  scores.
                </p>
              )}
              <ul className="mt-3 space-y-3">
                {ranked.slice(0, 8).map((r) => {
                  const pv = previews[r.geoid];
                  const label = r.name ?? `Tract ${r.geoid}`;
                  const sub = r.county_name
                    ? `${r.county_name.split(",")[0]?.trim()}${stateAbbr ? `, ${stateAbbr}` : ""}`
                    : stateAbbr || "—";
                  return (
                    <li key={r.geoid}>
                      <button
                        type="button"
                        onClick={() => onSelectTract(r.geoid)}
                        className="flex w-full gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-left transition hover:border-teal-300 hover:bg-white"
                      >
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-50 text-lg font-bold text-red-500">
                          {r.composite_score != null ? Math.round(r.composite_score) : "—"}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold text-[#0f2940]">{label}</p>
                          <p className="truncate text-xs text-slate-500">{sub}</p>
                          <p className="mt-1 text-xs text-slate-600">
                            {pv?.rent != null ? `${Math.round(pv.rent)}% rent burden` : "—"} ·{" "}
                            {pv?.uninsured != null ? `${pv.uninsured.toFixed(1)}% uninsured` : "—"}
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </aside>

        <div className="relative flex min-h-[420px] flex-1 flex-col p-3 lg:min-h-[calc(100vh-4rem)] lg:p-4">
          {err && <p className="mb-2 text-sm text-red-600">{err}</p>}

          {mapMode === "search" && (
            <div className="relative w-full flex-1">
              {searchMapLoading && (
                <div className="absolute inset-0 z-20 flex min-h-[560px] items-center justify-center rounded-xl bg-white/70 text-sm font-medium text-slate-600 backdrop-blur-[1px] lg:min-h-[calc(100vh-5rem)]">
                  Loading search on map…
                </div>
              )}
              {!searchMapLoading && searchGeojson && (
                <div className="relative w-full">
                  <button
                    type="button"
                    onClick={clearSearchMap}
                    className="absolute right-5 top-5 z-20 rounded-lg border border-slate-200 bg-white/95 px-3 py-1.5 text-xs font-semibold text-[#0f2940] shadow hover:bg-white"
                  >
                    Exit search map
                  </button>
                  <NeighborMap
                    stateFips={null}
                    data={searchGeojson}
                    variant="explore"
                    fitBoundsToData
                    zoomToResultsKey={searchZoomKey}
                    onSelectTract={onSelectTract}
                  />
                </div>
              )}
            </div>
          )}

          {mapMode === "browse" && (
            <>
              {stateFips != null && !err && geojson == null && (
                <div className="flex min-h-[400px] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/80 text-sm text-slate-500">
                  Loading map data…
                </div>
              )}
              {!stateFips && !err && (
                <NeighborMap stateFips={null} data={null} variant="explore" onSelectTract={onSelectTract} />
              )}
              {stateFips != null && geojson != null && noData && (
                <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-sm">
                  <p className="font-semibold">No map data for this state</p>
                  <p className="mt-1 text-amber-900/90">
                    The API returned an empty GeoJSON layer. The database has the schema but no census tracts loaded for{" "}
                    <strong>{stateLabel}</strong>. From the project <code className="rounded bg-white/80 px-1">backend/</code>{" "}
                    folder, with Postgres running and <code className="rounded bg-white/80 px-1">DATABASE_URL</code> set, run:
                  </p>
                  <pre className="mt-3 overflow-x-auto rounded-lg bg-[#0f2940] px-3 py-2 text-xs text-teal-100">
                    python ingest.py --states 06,12,17,36,48
                  </pre>
                  <p className="mt-2 text-xs text-amber-800/90">
                    This downloads tract boundaries and indicators (several minutes, requires network). Then refresh this
                    page.
                  </p>
                </div>
              )}
              {stateFips != null && geojson != null && (
                <NeighborMap
                  stateFips={stateFips}
                  data={geojson}
                  variant="explore"
                  onSelectTract={onSelectTract}
                />
              )}
            </>
          )}
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}

export default function ExplorePage() {
  return (
    <Suspense fallback={<div className="flex min-h-[50vh] items-center justify-center text-slate-500">Loading map…</div>}>
      <ExploreInner />
    </Suspense>
  );
}
