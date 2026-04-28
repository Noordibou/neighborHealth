"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { BrandWordmark } from "@/components/BrandMark";
import { NeighborMap } from "@/components/NeighborMap";
import {
  API_BASE,
  getMapGeoJSON,
  getTract,
  getTractList,
  postMapTractsByGeoids,
  searchFromAddress,
  searchSuggest,
  searchTracts,
  type SearchResultRow,
  type SearchSuggestItem,
  type TractDetail,
} from "@/lib/api";
import { addToCompareTray, readCompareTray, removeFromCompareTray, writeCompareTray } from "@/lib/compareTray";
import {
  EXPLORE_MAP_SESSION_KEY,
  type ExploreMapSessionV1,
  parseExploreMapSession,
  serializeExploreMapSession,
} from "@/lib/exploreMapSession";
import {
  augmentGeoJSONForMap,
  DEFAULT_MAP_WEIGHTS,
  type MapLayerMode,
  type MapWeightPercents,
} from "@/lib/mapGeojson";

const STATES = [
  { fips: "42", label: "Pennsylvania" },
  { fips: "06", label: "California" },
  { fips: "48", label: "Texas" },
  { fips: "36", label: "New York" },
  { fips: "12", label: "Florida" },
  { fips: "17", label: "Illinois" },
];

const STATE_ABBR: Record<string, string> = {
  "42": "PA",
  "06": "CA",
  "48": "TX",
  "36": "NY",
  "12": "FL",
  "17": "IL",
};

function mapFillLabel(mode: MapLayerMode): string {
  if (mode === "composite") return "Priority index — composite";
  if (mode === "housing") return "Housing — rent burden";
  if (mode === "health") return "Health — blended uninsured, asthma, disability";
  return "Custom weighted index";
}

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
  const [rankedTotal, setRankedTotal] = useState(0);
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const [layerMode, setLayerMode] = useState<MapLayerMode>("composite");
  const [weights, setWeights] = useState<MapWeightPercents>(DEFAULT_MAP_WEIGHTS);
  const [compareTray, setCompareTray] = useState<string[]>([]);
  const [selectedGeoid, setSelectedGeoid] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<TractDetail | null>(null);
  const [selectedDetailErr, setSelectedDetailErr] = useState<string | null>(null);
  const [shareHint, setShareHint] = useState<string | null>(null);

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
      const urlSt = new URLSearchParams(window.location.search).get("state");
      if (urlSt && /^\d{2}$/.test(urlSt)) setStateFips(urlSt);
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
    setCompareTray(readCompareTray());
  }, []);

  useEffect(() => {
    writeCompareTray(compareTray);
  }, [compareTray]);

  useEffect(() => {
    if (!sessionReady) return;
    const s = sp.get("state");
    if (s && /^\d{2}$/.test(s)) {
      setStateFips((prev) => prev ?? s);
    }
  }, [sessionReady, sp]);

  useEffect(() => {
    if (!sessionReady) return;
    const cur = sp.get("state") ?? "";
    const want = stateFips ?? "";
    if (cur === want) return;
    const next = new URLSearchParams(sp.toString());
    if (stateFips) next.set("state", stateFips);
    else next.delete("state");
    const qs = next.toString();
    router.replace(qs ? `/explore?${qs}` : "/explore", { scroll: false });
  }, [stateFips, sessionReady, router, sp]);

  useEffect(() => {
    if (!selectedGeoid) {
      setSelectedDetail(null);
      setSelectedDetailErr(null);
      return;
    }
    let cancelled = false;
    setSelectedDetailErr(null);
    getTract(selectedGeoid)
      .then((d) => {
        if (!cancelled) setSelectedDetail(d);
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setSelectedDetail(null);
          setSelectedDetailErr(e.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedGeoid]);

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
      setRankedTotal(0);
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
      .then((r) => {
        setRankedTotal(r.total);
        setRanked(
          r.items.map((i) => ({
            geoid: i.geoid,
            composite_score: i.composite_score,
            name: i.name,
            county_name: i.county_name,
          }))
        );
      })
      .catch(() => {
        setRanked([]);
        setRankedTotal(0);
      });
  }, [stateFips, applied]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    const top = ranked.slice(0, 16);
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

  const onSelectTract = useCallback((geoid: string) => {
    setSelectedGeoid(geoid);
  }, []);

  const augmentedBrowse = useMemo(() => {
    if (!geojson?.features?.length) return null;
    const mode: MapLayerMode = layerMode === "weighted" ? "weighted" : layerMode;
    return augmentGeoJSONForMap(geojson, mode, weights);
  }, [geojson, layerMode, weights]);

  const augmentedSearch = useMemo(() => {
    if (!searchGeojson?.features?.length) return null;
    const mode: MapLayerMode = layerMode === "weighted" ? "weighted" : layerMode;
    return augmentGeoJSONForMap(searchGeojson, mode, weights);
  }, [searchGeojson, layerMode, weights]);

  const priorityFlagged = useMemo(() => {
    const fc = mapMode === "search" ? augmentedSearch : augmentedBrowse;
    if (!fc?.features?.length) return 0;
    let n = 0;
    for (const f of fc.features) {
      const v = f.properties?.nh_map_value;
      if (typeof v === "number" && v >= 50) n += 1;
    }
    return n;
  }, [mapMode, augmentedBrowse, augmentedSearch]);

  const tractCountOnMap = mapMode === "search" ? augmentedSearch?.features?.length ?? 0 : augmentedBrowse?.features?.length ?? 0;

  const stateLabel = useMemo(() => {
    if (!stateFips) return "Choose a state";
    return STATES.find((s) => s.fips === stateFips)?.label ?? stateFips;
  }, [stateFips]);
  const stateAbbr = stateFips ? STATE_ABBR[stateFips] ?? stateFips : "";

  const featureCount = geojson?.features?.length ?? 0;
  const noData = !err && geojson != null && featureCount === 0;


  function shareView() {
    if (typeof window === "undefined" || !navigator.clipboard?.writeText) {
      setShareHint("Clipboard unavailable");
      return;
    }
    void navigator.clipboard.writeText(window.location.href).then(
      () => {
        setShareHint("Link copied");
        window.setTimeout(() => setShareHint(null), 2200);
      },
      () => setShareHint("Could not copy")
    );
  }

  const layerTabs: { id: MapLayerMode; label: string }[] = [
    { id: "composite", label: "Composite" },
    { id: "housing", label: "Housing" },
    { id: "health", label: "Health" },
    { id: "weighted", label: "Custom" },
  ];

  const weightFields: { key: keyof MapWeightPercents; label: string }[] = [
    { key: "rent_burden_pct", label: "Rent burden" },
    { key: "uninsured_pct", label: "Uninsured rate" },
    { key: "disability_pct", label: "Chronic / disability" },
    { key: "overcrowding_pct", label: "Overcrowding" },
    { key: "asthma_pct", label: "Asthma prevalence" },
  ];

  const mapDataBrowse = augmentedBrowse ?? geojson;
  const mapDataSearch = augmentedSearch ?? searchGeojson;
  return (
    <div className="flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden text-nh-brown">
      <header className="shrink-0 border-b border-nh-brown/10 bg-nh-cream/95 px-4 py-3">
        <div className="mx-auto flex max-w-[1920px] flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <BrandWordmark />
            <p className="hidden text-xs text-nh-brown-muted sm:block">
              <Link href="/explore" className="font-semibold text-nh-brown hover:underline">
                Map
              </Link>
              {stateFips ? (
                <>
                  <span className="text-nh-brown-muted/50"> / </span>
                  <span>{stateLabel}</span>
                </>
              ) : (
                <>
                  <span className="text-nh-brown-muted/50"> / </span>
                  <span>United States</span>
                </>
              )}
            </p>
          </div>
          <form
            onSubmit={onSearchSubmit}
            className="relative flex min-w-0 flex-1 flex-wrap items-center gap-2 lg:max-w-2xl"
          >
            <div className="relative min-w-0 flex-1">
              <svg
                className="pointer-events-none absolute left-3 top-1/2 z-[1] h-4 w-4 -translate-y-1/2 text-nh-brown-muted"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                autoComplete="off"
                className="relative z-[1] w-full rounded-full border border-nh-brown/15 bg-white py-2.5 pl-10 pr-4 text-sm text-nh-brown placeholder:text-nh-brown-muted/60 focus:border-nh-terracotta focus:outline-none focus:ring-1 focus:ring-nh-terracotta"
                placeholder="Search tract, neighborhood, ZIP…"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setSearchNarrowFips(null);
                }}
                onFocus={() => setSuggestOpen(true)}
                onBlur={() => window.setTimeout(() => setSuggestOpen(false), 180)}
              />
              {suggestOpen && suggestions.length > 0 && (
                <ul className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-xl border border-nh-brown/10 bg-white py-1 shadow-lg">
                  {suggestions.map((item, idx) => (
                    <li key={`${item.kind}-${item.label}-${item.state_fips ?? ""}-${idx}`}>
                      <button
                        type="button"
                        className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-nh-cream"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => onPickSuggestion(item)}
                      >
                        <span className="mt-0.5 shrink-0 rounded bg-nh-sand px-1.5 py-0.5 text-[10px] font-semibold uppercase text-nh-brown-muted">
                          {item.kind}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="font-medium text-nh-brown">{item.label}</span>
                          {item.detail ? (
                            <span className="mt-0.5 block truncate text-xs text-nh-brown-muted">{item.detail}</span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button
              type="submit"
              className="shrink-0 rounded-full bg-nh-terracotta px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-nh-terracotta-dark"
            >
              Go
            </button>
            <Link
              href="/#methodology"
              className="hidden shrink-0 text-sm font-medium text-nh-brown-muted hover:text-nh-brown md:inline"
            >
              Methodology
            </Link>
            <a
              href={`${API_BASE}/api/export/tracts.csv${stateFips ? `?state=${stateFips}` : ""}`}
              className="hidden shrink-0 text-sm font-medium text-nh-brown-muted hover:text-nh-brown lg:inline"
            >
              Export
            </a>
            <button
              type="button"
              onClick={shareView}
              className="shrink-0 rounded-full bg-nh-brown px-4 py-2 text-sm font-semibold text-nh-cream shadow-sm hover:bg-nh-brown/90"
            >
              Share view
            </button>
            {shareHint ? <span className="text-xs text-nh-terracotta">{shareHint}</span> : null}
          </form>
        </div>
        {searchNarrowFips ? (
          <p className="mx-auto mt-2 max-w-[1920px] px-4 text-[11px] text-nh-brown-muted">
            Narrowed to state FIPS <span className="font-mono">{searchNarrowFips}</span>
          </p>
        ) : null}
        {searchError ? <p className="mx-auto mt-2 max-w-[1920px] px-4 text-xs text-red-600">{searchError}</p> : null}
        {searchInfo && !searchError ? (
          <p className="mx-auto mt-2 max-w-[1920px] px-4 text-xs text-nh-brown-muted">{searchInfo}</p>
        ) : null}
        {searchResults && searchResults.length > 0 ? (
          <div className="mx-auto max-w-[1920px] border-t border-nh-brown/10 px-4 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-nh-brown-muted">
              Matches ({searchResults.length})
            </p>
            <ul className="mt-1 flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
              {searchResults.map((r) => (
                <li
                  key={r.geoid}
                  className="flex items-center gap-1 rounded-full border border-nh-brown/10 bg-white pl-2 pr-1 text-xs shadow-sm"
                >
                  <button type="button" className="max-w-[160px] truncate py-1 text-left font-medium text-nh-brown" onClick={() => onSelectTract(r.geoid)}>
                    {r.name ?? r.geoid}
                  </button>
                  <Link href={`/tract/${r.geoid}`} className="shrink-0 rounded-full bg-nh-cream px-2 py-0.5 text-[10px] font-semibold text-nh-terracotta hover:bg-nh-sand">
                    Profile
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1 flex-col pb-[9.5rem] pt-0 sm:pb-36 xl:flex-row xl:pb-16 ">
        <aside className="flex max-h-[min(36vh,320px)] min-h-0 shrink-0 flex-col overflow-hidden border-b border-nh-brown/10 bg-white/90 xl:h-full xl:max-h-none xl:w-[300px] xl:border-b-0 xl:border-r">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-nh-brown-muted">Layer</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {layerTabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setLayerMode(t.id)}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                      layerMode === t.id
                        ? "bg-nh-brown text-nh-cream shadow"
                        : "bg-nh-cream text-nh-brown-muted ring-1 ring-nh-brown/10 hover:bg-white"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] leading-snug text-nh-brown-muted">
                {layerMode === "weighted"
                  ? "Map reflects your indicator weights (normalized to 100%)."
                  : "Composite uses stored model scores; Housing colors by rent burden; Health blends uninsured, asthma, and disability."}
              </p>
            </div>

            <div className="border-t border-nh-brown/10 pt-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-nh-brown-muted">Indicator weights</p>
                <button
                  type="button"
                  className="text-xs font-semibold text-nh-terracotta hover:underline"
                  onClick={() => setWeights({ ...DEFAULT_MAP_WEIGHTS })}
                >
                  Reset
                </button>
              </div>
              <div className="mt-3 space-y-3">
                {weightFields.map(({ key, label }) => (
                  <div key={key}>
                    <div className="flex justify-between text-[11px] font-medium text-nh-brown-muted">
                      <span>{label}</span>
                      <span>{weights[key]}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={60}
                      value={weights[key]}
                      onChange={(e) =>
                        setWeights((w) => ({ ...w, [key]: Number(e.target.value) } as MapWeightPercents))
                      }
                      className="mt-1 w-full accent-nh-terracotta"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-nh-brown/10 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-nh-brown-muted">List filters</p>
              <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-nh-brown">
                <input
                  type="checkbox"
                  checked={draft.minScore >= 50}
                  onChange={(e) => setDraft((d) => ({ ...d, minScore: e.target.checked ? 50 : 0 }))}
                  className="rounded border-nh-brown/30 text-nh-terracotta focus:ring-nh-terracotta"
                />
                Score ≥ 50 (apply to list)
              </label>
              <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-nh-brown-muted">
                <input type="checkbox" disabled className="rounded border-nh-brown/20" />
                Population ≥ 3,000 (needs ACS field)
              </label>
              <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-nh-brown-muted">
                <input type="checkbox" disabled className="rounded border-nh-brown/20" />
                FQHC coverage (coming soon)
              </label>
            </div>

            <div className="border-t border-nh-brown/10 pt-4">
              <label className="text-xs font-semibold uppercase tracking-wide text-nh-brown-muted">Benchmark</label>
              <select
                disabled
                className="mt-1 w-full rounded-lg border border-nh-brown/15 bg-nh-cream/50 px-2 py-2 text-sm text-nh-brown-muted"
                value=""
              >
                <option>{stateLabel} (default)</option>
              </select>
            </div>

            <div className="border-t border-nh-brown/10 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-nh-brown-muted">State</p>
              {mapMode === "search" && (
                <p className="mb-2 mt-1 text-[11px] text-amber-900/90">
                  Search map active — exit search to change state layer.
                </p>
              )}
              <ul className="mt-2 max-h-40 space-y-1.5 overflow-y-auto text-sm">
                <li>
                  <label className="flex cursor-pointer items-center gap-2 text-nh-brown-muted">
                    <input
                      type="radio"
                      name="state"
                      checked={stateFips === null}
                      onChange={() => {
                        setStateFips(null);
                        clearSearchMap();
                      }}
                      className="border-nh-brown/30 text-nh-terracotta focus:ring-nh-terracotta"
                    />
                    US overview
                  </label>
                </li>
                {STATES.map((s) => (
                  <li key={s.fips}>
                    <label className="flex cursor-pointer items-center gap-2 text-nh-brown">
                      <input
                        type="radio"
                        name="state"
                        checked={stateFips === s.fips}
                        onChange={() => {
                          setStateFips(s.fips);
                          clearSearchMap();
                        }}
                        className="border-nh-brown/30 text-nh-terracotta focus:ring-nh-terracotta"
                      />
                      {s.label}
                    </label>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-3 border-t border-nh-brown/10 pt-4">
              <p className="text-xs font-semibold uppercase text-nh-brown-muted">Refine ranking</p>
              <div>
                <div className="flex justify-between text-[11px] font-medium text-nh-brown-muted">
                  <span>Rent burden ≥</span>
                  <span>{draft.minRent}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={draft.minRent}
                  onChange={(e) => setDraft((d) => ({ ...d, minRent: Number(e.target.value) }))}
                  className="mt-1 w-full accent-nh-terracotta"
                />
              </div>
              <div>
                <div className="flex justify-between text-[11px] font-medium text-nh-brown-muted">
                  <span>Uninsured ≥</span>
                  <span>{draft.minUninsured}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={50}
                  value={draft.minUninsured}
                  onChange={(e) => setDraft((d) => ({ ...d, minUninsured: Number(e.target.value) }))}
                  className="mt-1 w-full accent-nh-terracotta"
                />
              </div>
              <div>
                <div className="flex justify-between text-[11px] font-medium text-nh-brown-muted">
                  <span>Asthma (for high filter)</span>
                  <span>{draft.asthma}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={30}
                  value={draft.asthma}
                  onChange={(e) => setDraft((d) => ({ ...d, asthma: Number(e.target.value) }))}
                  className="mt-1 w-full accent-nh-terracotta"
                />
              </div>
              <div>
                <p className="text-[11px] font-medium text-nh-brown-muted">Area type</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {(["", "urban", "rural"] as const).map((v) => (
                    <label key={v || "any"} className="flex cursor-pointer items-center gap-1.5 text-xs text-nh-brown">
                      <input
                        type="radio"
                        name="urban_rural"
                        checked={draft.urbanRural === v}
                        onChange={() => setDraft((d) => ({ ...d, urbanRural: v }))}
                        className="border-nh-brown/30 text-nh-terracotta"
                      />
                      {v === "" ? "Any" : v === "urban" ? "Urban" : "Rural"}
                    </label>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={applyFilters}
                className="w-full rounded-xl bg-nh-brown py-2.5 text-sm font-semibold text-nh-cream shadow-sm hover:bg-nh-brown/90"
              >
                Apply filters
              </button>
            </div>
          </div>
        </aside>

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col px-2 pt-2 lg:min-h-0 lg:px-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-nh-brown/10 bg-white/80 px-3 py-2 text-xs text-nh-brown-muted">
            <span className="font-semibold uppercase tracking-wide text-nh-brown">Composite view</span>
            <span>
              Showing <strong className="text-nh-brown">{tractCountOnMap || featureCount}</strong> tracts
              {tractCountOnMap ? (
                <>
                  {" "}
                  · <strong className="text-nh-terracotta">{priorityFlagged}</strong> flagged priority (index ≥ 50)
                </>
              ) : null}
            </span>
          </div>
          {err ? <p className="mb-2 text-sm text-red-600">{err}</p> : null}

          {mapMode === "search" && (
            <div className="relative flex min-h-0 w-full flex-1 flex-col">
              {searchMapLoading && (
                <div className="absolute inset-0 z-20 flex min-h-0 flex-1 items-center justify-center rounded-xl bg-white/80 text-sm font-medium text-nh-brown-muted backdrop-blur-sm">
                  Loading search on map…
                </div>
              )}
              {!searchMapLoading && searchGeojson && (
                <div className="relative flex min-h-0 flex-1 flex-col">
                  <button
                    type="button"
                    onClick={clearSearchMap}
                    className="absolute right-4 top-4 z-20 rounded-lg border border-nh-brown/15 bg-white/95 px-3 py-1.5 text-xs font-semibold text-nh-brown shadow hover:bg-white"
                  >
                    Exit search map
                  </button>
                  <NeighborMap
                    stateFips={null}
                    data={mapDataSearch}
                    variant="explore"
                    fitBoundsToData
                    zoomToResultsKey={searchZoomKey}
                    onSelectTract={onSelectTract}
                    fillProperty="nh_map_value"
                    fillLabel={mapFillLabel(layerMode)}
                    showMetricControl={false}
                    selectedGeoid={selectedGeoid}
                  />
                </div>
              )}
            </div>
          )}

          {mapMode === "browse" && (
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              {stateFips != null && !err && geojson == null && (
                <div className="flex min-h-[12rem] flex-1 items-center justify-center rounded-xl border border-dashed border-nh-brown/20 bg-white/80 text-sm text-nh-brown-muted">
                  Loading map data…
                </div>
              )}
              {!stateFips && !err && (
                <div className="flex min-h-0 flex-1 flex-col">
                  <NeighborMap
                    stateFips={null}
                    data={null}
                    variant="explore"
                    onSelectTract={onSelectTract}
                    showMetricControl
                  />
                </div>
              )}
              {stateFips != null && geojson != null && noData && (
                <div className="mb-1 shrink-0 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-sm">
                  <p className="font-semibold">No map data for this state</p>
                  <p className="mt-1 text-amber-900/90">
                    Ingest tracts for <strong>{stateLabel}</strong> from <code className="rounded bg-white/80 px-1">backend/</code>:
                  </p>
                  <pre className="mt-3 overflow-x-auto rounded-lg bg-nh-brown px-3 py-2 text-xs text-nh-cream">
                    python ingest.py --states 42,06,12,17,36,48
                  </pre>
                </div>
              )}
              {stateFips != null && geojson != null && !noData && (
                <div className="flex min-h-0 flex-1 flex-col">
                  <NeighborMap
                    stateFips={stateFips}
                    data={mapDataBrowse}
                    variant="explore"
                    onSelectTract={onSelectTract}
                    fillProperty="nh_map_value"
                    fillLabel={mapFillLabel(layerMode)}
                    showMetricControl={false}
                    selectedGeoid={selectedGeoid}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="flex max-h-[min(40vh,360px)] min-h-0 shrink-0 flex-col overflow-hidden border-t border-nh-brown/10 bg-white/95 xl:h-full xl:max-h-none xl:w-[320px] xl:border-l xl:border-t-0">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-nh-brown-muted">Selected tract</p>
              {!selectedGeoid && (
                <p className="mt-2 text-sm text-nh-brown-muted">Click a tract on the map to inspect scores and add to compare.</p>
              )}
              {selectedGeoid && selectedDetailErr && (
                <p className="mt-2 text-sm text-red-600">{selectedDetailErr}</p>
              )}
              {selectedDetail && (
                <div className="mt-3 rounded-xl border border-nh-brown/10 bg-nh-cream/50 p-3">
                  <p className="font-display text-lg font-semibold text-nh-brown">
                    {selectedDetail.name ?? `Tract ${selectedDetail.geoid}`}
                  </p>
                  <p className="text-xs text-nh-brown-muted">
                    {selectedDetail.county_name}
                    {stateAbbr ? `, ${stateAbbr}` : ""}
                  </p>
                  <div className="mt-3 flex items-end justify-between gap-2">
                    <div>
                      <p className="text-[10px] font-semibold uppercase text-nh-brown-muted">Index</p>
                      <p className="font-display text-3xl font-bold text-nh-terracotta">
                        {selectedDetail.risk_score?.composite_score != null
                          ? Math.round(selectedDetail.risk_score.composite_score)
                          : "—"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCompareTray(addToCompareTray(selectedDetail.geoid))}
                      disabled={compareTray.includes(selectedDetail.geoid) || compareTray.length >= 4}
                      className="rounded-lg border border-nh-brown/20 px-2 py-1 text-xs font-semibold text-nh-brown hover:bg-white disabled:opacity-40"
                    >
                      {compareTray.includes(selectedDetail.geoid) ? "In tray" : "+ Compare"}
                    </button>
                  </div>
                  <Link
                    href={`/tract/${selectedDetail.geoid}`}
                    className="mt-3 inline-flex text-sm font-semibold text-nh-terracotta hover:underline"
                  >
                    View profile →
                  </Link>
                </div>
              )}
            </div>

            <div className="border-t border-nh-brown/10 pt-4">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-xs font-bold uppercase tracking-wide text-nh-brown-muted">Top tracts</h2>
                <span className="text-[11px] text-nh-brown-muted">
                  {ranked.length} / {rankedTotal || "—"}
                </span>
              </div>
              <p className="text-[11px] text-nh-brown-muted">{stateLabel}</p>
              {!stateFips && (
                <p className="mt-2 text-xs text-nh-brown-muted">Pick a state to load rankings.</p>
              )}
              {noData && (
                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-2 text-xs text-amber-950">
                  No tract rows in the database for this state yet.
                </p>
              )}
              <ul className="mt-3 space-y-2">
                {ranked.slice(0, 16).map((r, idx) => {
                  const pv = previews[r.geoid];
                  const label = r.name ?? `Tract ${r.geoid}`;
                  const inTray = compareTray.includes(r.geoid);
                  const isSel = selectedGeoid === r.geoid;
                  return (
                    <li
                      key={r.geoid}
                      className={`flex gap-2 rounded-xl border p-2 transition ${
                        isSel ? "border-nh-brown bg-white shadow-sm" : "border-nh-brown/10 bg-nh-cream/30 hover:bg-white"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectTract(r.geoid)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className="text-[10px] font-mono text-nh-brown-muted">#{idx + 1}</span>
                        <p className="truncate text-sm font-semibold text-nh-brown">{label}</p>
                        <p className="truncate text-[11px] text-nh-brown-muted">{r.county_name ?? "—"}</p>
                        <p className="text-[11px] text-nh-brown-muted">
                          {pv?.rent != null ? `${Math.round(pv.rent)}% rent` : "—"} ·{" "}
                          {pv?.uninsured != null ? `${pv.uninsured.toFixed(1)}% uninsured` : "—"}
                        </p>
                      </button>
                      <div className="flex shrink-0 flex-col items-center gap-1">
                        <span className="text-sm font-bold text-nh-terracotta">
                          {r.composite_score != null ? Math.round(r.composite_score) : "—"}
                        </span>
                        <button
                          type="button"
                          aria-label={inTray ? "Remove from compare" : "Add to compare"}
                          onClick={() =>
                            setCompareTray(inTray ? removeFromCompareTray(r.geoid) : addToCompareTray(r.geoid))
                          }
                          className="flex h-8 w-8 items-center justify-center rounded-full border border-nh-brown/15 text-lg font-medium text-nh-brown hover:bg-nh-cream"
                        >
                          {inTray ? "✓" : "+"}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </aside>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-nh-brown/10 bg-nh-cream/95 px-4 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom,0px))] shadow-[0_-8px_24px_rgba(44,24,16,0.08)] backdrop-blur-md sm:py-3">
        <div className="mx-auto flex max-w-[1920px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-nh-brown-muted">Compare tray</p>
            <p className="text-xs text-nh-brown-muted">
              {compareTray.length} / 4 tracts · select on map or from the list
            </p>
          </div>
          <div className="flex flex-1 flex-wrap items-center gap-2">
            {compareTray.map((g) => {
              const row = ranked.find((x) => x.geoid === g);
              return (
                <div
                  key={g}
                  className="flex items-center gap-2 rounded-lg border border-nh-brown/15 bg-white px-2 py-1.5 text-xs shadow-sm"
                >
                  <span className="max-w-[140px] truncate font-medium text-nh-brown">{row?.name ?? g}</span>
                  <button
                    type="button"
                    className="text-nh-brown-muted hover:text-red-600"
                    aria-label="Remove"
                    onClick={() => setCompareTray(removeFromCompareTray(g))}
                  >
                    ×
                  </button>
                </div>
              );
            })}
            {compareTray.length < 4 && (
              <span className="rounded-lg border border-dashed border-nh-brown/20 px-3 py-2 text-xs text-nh-brown-muted">
                + Add tract
              </span>
            )}
            <button
              type="button"
              disabled={compareTray.length < 2}
              onClick={() => router.push(`/compare?geoids=${encodeURIComponent(compareTray.join(","))}`)}
              className="ml-auto rounded-full bg-nh-brown px-4 py-2 text-sm font-semibold text-nh-cream shadow-sm hover:bg-nh-brown/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Open compare →
            </button>
          </div>
        </div>
      </div>
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
