"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { BrandWordmark } from "@/components/BrandMark";
import { NeighborMap } from "@/components/NeighborMap";
import {
  API_BASE,
  getMapGeoJSON,
  getStates,
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
import { augmentGeoJSONForMap, type MapLayerMode } from "@/lib/mapGeojson";

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
  return "Health — blended uninsured, asthma, disability";
}

const TOP_TRACT_LAYER_HEADING: Record<MapLayerMode, string> = {
  composite: "COMPOSITE",
  housing: "HOUSING",
  health: "HEALTH",
};

/** Sidebar indicator bars — matches tract detail `metric_name` keys */
const SIDEBAR_METRICS: { metric_name: string; label: string }[] = [
  { metric_name: "rent_burden_pct", label: "Rent burden" },
  { metric_name: "overcrowding_pct", label: "Overcrowding" },
  { metric_name: "asthma_pct", label: "Asthma prevalence" },
  { metric_name: "uninsured_pct", label: "Uninsured" },
  { metric_name: "disability_pct", label: "Disability" },
];

function indicatorValue(indicators: TractDetail["indicators"], metric_name: string): number | null {
  const row = indicators.find((i) => i.metric_name === metric_name);
  return row?.value != null && Number.isFinite(row.value) ? row.value : null;
}

/** Warm ramp for bar fill from low (sand) to high (terracotta) */
function barFillStyle(pct: number): { background: string } {
  const t = Math.max(0, Math.min(1, pct / 100));
  const lo = [232, 212, 196];
  const hi = [179, 92, 58];
  const r = Math.round(lo[0] + (hi[0] - lo[0]) * t);
  const g = Math.round(lo[1] + (hi[1] - lo[1]) * t);
  const b = Math.round(lo[2] + (hi[2] - lo[2]) * t);
  return { background: `rgb(${r},${g},${b})` };
}

/** Prefer Census address geocoder when the query looks like a street address (not a bare GEOID). */
function looksLikeUsStreetAddress(s: string): boolean {
  const t = s.trim();
  if (t.length < 8 || t.length > 400) return false;
  if (/^\d{11}$/.test(t)) return false;
  return /^\d+\s/.test(t);
}

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
  const [layerMode, setLayerMode] = useState<MapLayerMode>("composite");
  const [compareTray, setCompareTray] = useState<string[]>([]);
  const [selectedGeoid, setSelectedGeoid] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<TractDetail | null>(null);
  const [selectedDetailErr, setSelectedDetailErr] = useState<string | null>(null);
  const [shareHint, setShareHint] = useState<string | null>(null);
  const [searchResultsExpanded, setSearchResultsExpanded] = useState(true);
  const [rankingFiltersOpen, setRankingFiltersOpen] = useState(false);
  const [availableStates, setAvailableStates] = useState<{ state_fips: string; state_name: string }[]>([]);
  const [usStatesGeojson, setUsStatesGeojson] = useState<GeoJSON.FeatureCollection | null>(null);

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
    let cancelled = false;
    getStates()
      .then((rows) => {
        if (!cancelled) {
          setAvailableStates(
            rows.map((r) => ({ state_fips: r.state_fips.padStart(2, "0"), state_name: r.state_name }))
          );
        }
      })
      .catch(() => {
        if (!cancelled) setAvailableStates([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/geo/us-states.json")
      .then((r) => r.json())
      .then((fc: GeoJSON.FeatureCollection) => {
        if (!cancelled) setUsStatesGeojson(fc);
      })
      .catch(() => {
        if (!cancelled) setUsStatesGeojson(null);
      });
    return () => {
      cancelled = true;
    };
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

  const clearSearch = useCallback(() => {
    setQ("");
    setSearchNarrowFips(null);
    setSuggestions([]);
    setSuggestOpen(false);
    clearSearchMap();
  }, [clearSearchMap]);

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
    if (!stateFips) setRankingFiltersOpen(false);
  }, [stateFips]);

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

  const onSelectStateFromMap = useCallback(
    (fips: string) => {
      const sf = fips.padStart(2, "0").slice(0, 2);
      clearSearchMap();
      setStateFips(sf);
      setSelectedGeoid(null);
    },
    [clearSearchMap]
  );

  const goToUsOverview = useCallback(() => {
    setStateFips(null);
    setGeojson(null);
    setErr(null);
    setSelectedGeoid(null);
  }, []);

  const statePickerGeoJSON = useMemo(() => {
    if (!usStatesGeojson?.features?.length) return null;
    const avail = new Set(availableStates.map((s) => s.state_fips.padStart(2, "0").slice(0, 2)));
    return {
      type: "FeatureCollection" as const,
      features: usStatesGeojson.features.map((f) => {
        const rawId = f.id != null ? String(f.id) : "";
        const state_fips = rawId.padStart(2, "0").slice(0, 2);
        const name = (f.properties as { name?: string } | null)?.name ?? state_fips;
        return {
          type: "Feature" as const,
          id: state_fips,
          properties: {
            name,
            state_fips,
            nh_has_data: avail.has(state_fips),
          },
          geometry: f.geometry,
        };
      }),
    };
  }, [usStatesGeojson, availableStates]);

  const augmentedBrowse = useMemo(() => {
    if (!geojson?.features?.length) return null;
    return augmentGeoJSONForMap(geojson, layerMode);
  }, [geojson, layerMode]);

  const augmentedSearch = useMemo(() => {
    if (!searchGeojson?.features?.length) return null;
    return augmentGeoJSONForMap(searchGeojson, layerMode);
  }, [searchGeojson, layerMode]);

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
    if (!stateFips) return "United States";
    const sf = stateFips.padStart(2, "0").slice(0, 2);
    return (
      availableStates.find((s) => s.state_fips.padStart(2, "0").slice(0, 2) === sf)?.state_name ?? `FIPS ${sf}`
    );
  }, [stateFips, availableStates]);
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
  ];

  const exploreLayerTabsEl = (
    <div className="rounded-2xl border border-[#e8e3dc] bg-[#f9f7f2] px-3 py-3 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8e8e8e]">Layer</p>
      <div className="mt-2 flex rounded-full bg-[#ebe6df] p-1">
        {layerTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setLayerMode(t.id)}
            className={`min-w-0 flex-1 rounded-full px-2 py-2 text-center text-xs font-semibold transition ${
              layerMode === t.id ? "bg-[#2d2d2d] text-white shadow-sm" : "bg-transparent text-[#5c534c] hover:text-[#2d2d2d]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );

  const mapDataBrowse = augmentedBrowse ?? geojson;
  const mapDataSearch = augmentedSearch ?? searchGeojson;
  return (
    <div className="flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden text-nh-brown">
      <header className="shrink-0 border-b border-nh-brown/10 bg-nh-cream/95 px-4 py-3">
        <div className="mx-auto flex max-w-[1920px] flex-wrap items-center justify-between gap-3">
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
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Link
              href="/#methodology"
              className="text-sm font-medium text-nh-brown-muted hover:text-nh-brown"
            >
              Methodology
            </Link>
            <a
              href={`${API_BASE}/api/export/tracts.csv${stateFips ? `?state=${stateFips}` : ""}`}
              className="text-sm font-medium text-nh-brown-muted hover:text-nh-brown"
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
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col pb-[9.5rem] pt-0 sm:pb-36 xl:flex-row xl:pb-16 ">
        <aside className="flex max-h-[min(52vh,420px)] min-h-0 shrink-0 flex-col overflow-hidden border-b border-nh-brown/10 bg-white/90 xl:h-full xl:max-h-none xl:w-[360px] xl:border-b-0 xl:border-r">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            <section className="rounded-xl border border-nh-brown/10 bg-nh-cream/40 p-3 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wide text-nh-brown-muted">Search</p>
              <form onSubmit={onSearchSubmit} className="mt-2 space-y-2">
                <div className="relative">
                  <svg
                    className="pointer-events-none absolute left-3 top-1/2 z-[1] h-4 w-4 -translate-y-1/2 text-nh-brown-muted"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                  <input
                    autoComplete="off"
                    className={`relative z-[1] w-full rounded-xl border border-nh-brown/15 bg-white py-2.5 pl-10 text-sm text-nh-brown placeholder:text-nh-brown-muted/60 focus:border-nh-terracotta focus:outline-none focus:ring-1 focus:ring-nh-terracotta ${q.trim() ? "pr-10" : "pr-3"}`}
                    placeholder="Tract, neighborhood, ZIP, address…"
                    value={q}
                    onChange={(e) => {
                      setQ(e.target.value);
                      setSearchNarrowFips(null);
                    }}
                    onFocus={() => setSuggestOpen(true)}
                    onBlur={() => window.setTimeout(() => setSuggestOpen(false), 180)}
                  />
                  {q.trim() ? (
                    <button
                      type="button"
                      aria-label="Clear search"
                      className="absolute right-2 top-1/2 z-[2] flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-nh-brown-muted hover:bg-nh-cream hover:text-nh-brown"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        clearSearch();
                      }}
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  ) : null}
                  {suggestOpen && suggestions.length > 0 ? (
                    <ul className="absolute left-0 right-0 top-full z-40 mt-1 max-h-56 overflow-y-auto rounded-xl border border-nh-brown/10 bg-white py-1 shadow-lg">
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
                  ) : null}
                </div>
                <button
                  type="submit"
                  className="w-full rounded-xl bg-nh-terracotta py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-nh-terracotta-dark"
                >
                  Search map
                </button>
              </form>
              {searchNarrowFips ? (
                <p className="mt-2 text-[11px] text-nh-brown-muted">
                  Narrowed to state FIPS <span className="font-mono">{searchNarrowFips}</span>
                </p>
              ) : null}
              {searchError ? <p className="mt-2 text-xs text-red-600">{searchError}</p> : null}
              {searchInfo && !searchError ? (
                <p className="mt-2 text-xs text-nh-brown-muted">{searchInfo}</p>
              ) : null}
            </section>

            <section className="rounded-xl border border-nh-brown/10 bg-nh-cream/40 p-3 shadow-sm">
              <button
                type="button"
                onClick={() => setSearchResultsExpanded((v) => !v)}
                className="flex w-full items-start justify-between gap-2 rounded-lg text-left outline-none ring-nh-terracotta hover:bg-nh-cream/60 focus-visible:ring-2"
                aria-expanded={searchResultsExpanded}
              >
                <div className="min-w-0">
                  <span className="text-xs font-bold uppercase tracking-wide text-nh-brown-muted">Search results</span>
                  <span className="ml-2 text-[11px] font-normal text-nh-brown-muted tabular-nums">
                    ({searchResults?.length ?? 0})
                  </span>
                </div>
                <span className="shrink-0 text-[11px] font-semibold text-nh-brown-muted tabular-nums">
                  {searchResultsExpanded ? "Hide" : "Show"}
                </span>
              </button>
              {searchResultsExpanded ? (
                <>
                  <p className="mt-2 text-[11px] text-nh-brown-muted">
                    {searchResults?.length
                      ? "Select a result to focus tract details on the right panel."
                      : "Use Search above, then open results here."}
                  </p>
                  {searchResults?.length ? (
                    <ul className="mt-3 space-y-2">
                      {searchResults.map((r, idx) => {
                        const isSel = selectedGeoid === r.geoid;
                        return (
                          <li
                            key={r.geoid}
                            className={`rounded-xl border p-2 ${
                              isSel ? "border-nh-brown bg-white shadow-sm" : "border-nh-brown/10 bg-nh-cream/30"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => onSelectTract(r.geoid)}
                              className="w-full text-left"
                            >
                              <span className="text-[10px] font-mono text-nh-brown-muted">#{idx + 1}</span>
                              <p className="truncate text-sm font-semibold text-nh-brown">{r.name ?? `Tract ${r.geoid}`}</p>
                              <p className="truncate text-[11px] text-nh-brown-muted">{r.county_name ?? "—"}</p>
                            </button>
                            <div className="mt-2 flex items-center justify-between">
                              <span className="text-xs font-semibold text-nh-terracotta">
                                Score {r.composite_score != null ? Math.round(r.composite_score) : "—"}
                              </span>
                              <Link href={`/tract/${r.geoid}`} className="text-xs font-semibold text-nh-terracotta hover:underline">
                                Profile →
                              </Link>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <div className="mt-3 rounded-lg border border-dashed border-nh-brown/20 bg-nh-cream/40 px-3 py-3 text-xs text-nh-brown-muted">
                      Try a tract GEOID, place, ZIP, county, or street address in Search above.
                    </div>
                  )}
                </>
              ) : null}
            </section>
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
                    exploreLayerTabs={exploreLayerTabsEl}
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
                <div className="relative flex min-h-0 flex-1 flex-col">
                  <NeighborMap
                    stateFips={null}
                    data={null}
                    variant="explore"
                    onSelectTract={onSelectTract}
                    showMetricControl={false}
                    exploreLayerTabs={exploreLayerTabsEl}
                    statePickerGeoJSON={statePickerGeoJSON}
                    onSelectStateFips={onSelectStateFromMap}
                  />
                </div>
              )}
              {stateFips != null && err ? (
                <div className="flex min-h-[10rem] flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-red-200 bg-red-50/90 px-4 py-6 text-center">
                  <p className="text-sm text-red-700">{err}</p>
                  <button
                    type="button"
                    onClick={goToUsOverview}
                    className="rounded-full border border-nh-brown/15 bg-white px-4 py-2 text-xs font-semibold text-nh-brown shadow hover:bg-white"
                  >
                    ← All states
                  </button>
                </div>
              ) : null}
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
              {stateFips != null && !err && geojson != null && !noData && (
                <div className="relative flex min-h-0 flex-1 flex-col">
                  <button
                    type="button"
                    onClick={goToUsOverview}
                    className="absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-full border border-nh-brown/15 bg-white/95 px-4 py-1.5 text-xs font-semibold text-nh-brown shadow hover:bg-white"
                  >
                    ← All states
                  </button>
                  <NeighborMap
                    stateFips={stateFips}
                    data={mapDataBrowse}
                    variant="explore"
                    onSelectTract={onSelectTract}
                    fillProperty="nh_map_value"
                    fillLabel={mapFillLabel(layerMode)}
                    showMetricControl={false}
                    selectedGeoid={selectedGeoid}
                    exploreLayerTabs={exploreLayerTabsEl}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="flex max-h-[min(40vh,360px)] min-h-0 shrink-0 flex-col overflow-hidden border-t border-[#e8e3dc] bg-[#faf8f5] xl:h-full xl:max-h-none xl:w-[380px] xl:border-l xl:border-t-0">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
            <div>
              {!selectedGeoid && (
                <p className="text-sm leading-relaxed text-[#6b6560]">
                  Click a tract on the map to inspect scores and add to compare.
                </p>
              )}
              {selectedGeoid && selectedDetailErr && (
                <p className="mt-2 text-sm text-red-600">{selectedDetailErr}</p>
              )}
              {selectedDetail && (
                <div className="rounded-2xl border border-[#e8e3dc] bg-[#f9f7f2] p-4 shadow-sm">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8e8e8e]">Selected tract</p>
                  <div className="mt-3 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-display text-xl font-bold leading-tight text-[#2d2d2d]">
                        {selectedDetail.name ?? `Tract ${selectedDetail.geoid}`}
                      </h3>
                      <p className="mt-1 text-sm text-[#6b6560]">
                        <span className="font-mono text-[13px]">{selectedDetail.geoid}</span>
                        <span className="text-[#c4bcb4]"> · </span>
                        {selectedDetail.place_name ?? selectedDetail.county_name ?? "—"}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8e8e8e]">Index</p>
                      <p className="font-display text-[2.75rem] font-bold leading-none text-[#c4a574]">
                        {selectedDetail.risk_score?.composite_score != null
                          ? Math.round(selectedDetail.risk_score.composite_score)
                          : "—"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-2">
                    <Link
                      href={`/tract/${selectedDetail.geoid}`}
                      className="flex min-w-0 flex-1 basis-[calc(50%-0.25rem)] items-center justify-center rounded-full bg-[#b34d3a] px-4 py-2.5 text-center text-sm font-semibold text-white shadow-sm hover:bg-[#9a4131]"
                    >
                      View profile →
                    </Link>
                    <button
                      type="button"
                      onClick={() => setCompareTray(addToCompareTray(selectedDetail.geoid))}
                      disabled={compareTray.includes(selectedDetail.geoid) || compareTray.length >= 4}
                      className={`flex min-w-0 flex-1 basis-[calc(50%-0.25rem)] items-center justify-center rounded-full border-2 px-4 py-2.5 text-sm font-semibold shadow-sm transition disabled:opacity-40 ${
                        compareTray.includes(selectedDetail.geoid)
                          ? "border-[#b34d3a] bg-white text-[#b34d3a]"
                          : "border-[#d6cfc7] bg-white text-[#2d2d2d] hover:border-[#b34d3a]/40"
                      }`}
                    >
                      {compareTray.includes(selectedDetail.geoid) ? "✓ In compare" : "+ Compare"}
                    </button>
                  </div>

                  <div className="mt-6 space-y-4">
                    {SIDEBAR_METRICS.map(({ metric_name, label }) => {
                      const v = indicatorValue(selectedDetail.indicators, metric_name);
                      const pct = v != null ? Math.min(100, Math.max(0, v)) : null;
                      return (
                        <div key={metric_name}>
                          <div className="flex justify-between text-xs text-[#2d2d2d]">
                            <span>{label}</span>
                            <span className="tabular-nums font-semibold">
                              {v != null
                                ? `${metric_name === "uninsured_pct" ? v.toFixed(1) : Math.round(v)}%`
                                : "—"}
                            </span>
                          </div>
                          <div className="relative mt-1.5 h-2 overflow-hidden rounded-full bg-[#ebe6df]">
                            {pct != null ? (
                              <div
                                className="absolute left-0 top-0 h-full rounded-full"
                                style={{ width: `${pct}%`, ...barFillStyle(pct) }}
                              />
                            ) : null}
                            <div
                              className="pointer-events-none absolute left-1/2 top-0 z-[1] h-full w-px -translate-x-1/2 border-l border-dashed border-[#9ca3af]"
                              aria-hidden
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-5 border-t border-[#e8e3dc] pt-3 text-[10px] leading-snug text-[#8e8e8e]">
                    <span className="inline-block translate-y-px border-l border-dashed border-[#9ca3af] pl-1">
                      Dashed line = county benchmark (50th percentile scale)
                    </span>
                  </p>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-[#e8e3dc] bg-[#f9f7f2] shadow-sm">
              <div className="flex items-center justify-between gap-2 border-b border-[#ebe6df] px-4 py-3">
                <h2 className="min-w-0 flex-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[#5c4a42]">
                  Top tracts — {TOP_TRACT_LAYER_HEADING[layerMode]}
                </h2>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="text-[11px] tabular-nums text-[#8e8e8e]">
                    {ranked.length} / {rankedTotal || "—"}
                  </span>
                  {stateFips ? (
                    <button
                      type="button"
                      onClick={() => setRankingFiltersOpen((v) => !v)}
                      aria-expanded={rankingFiltersOpen}
                      aria-controls="ranking-filters-panel"
                      aria-label={rankingFiltersOpen ? "Hide ranking filters" : "Show ranking filters"}
                      className={`rounded-lg p-1.5 text-[#8e8e8e] transition hover:bg-[#ebe6df] hover:text-[#5c534c] ${rankingFiltersOpen ? "bg-[#ebe6df] text-[#5c534c]" : ""}`}
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                        />
                      </svg>
                    </button>
                  ) : null}
                </div>
              </div>

              {stateFips && rankingFiltersOpen ? (
                <div
                  id="ranking-filters-panel"
                  className="space-y-3 border-b border-[#ebe6df] bg-[#faf8f5] px-4 py-3"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8e8e8e]">
                    Refine ranking list
                  </p>
                  <div>
                    <div className="flex justify-between text-[11px] font-medium text-[#5c534c]">
                      <span>Rent burden ≥</span>
                      <span>{draft.minRent}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={draft.minRent}
                      onChange={(e) => setDraft((d) => ({ ...d, minRent: Number(e.target.value) }))}
                      className="mt-1 w-full accent-[#b34d3a]"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px] font-medium text-[#5c534c]">
                      <span>Uninsured ≥</span>
                      <span>{draft.minUninsured}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={50}
                      value={draft.minUninsured}
                      onChange={(e) => setDraft((d) => ({ ...d, minUninsured: Number(e.target.value) }))}
                      className="mt-1 w-full accent-[#b34d3a]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      applyFilters();
                      setRankingFiltersOpen(false);
                    }}
                    className="w-full rounded-xl bg-[#2d2d2d] py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#1f1f1f]"
                  >
                    Apply filters
                  </button>
                </div>
              ) : null}

              <div className="space-y-0 px-3 pb-3 pt-2">
                <p className="px-1 text-[11px] text-[#8e8e8e]">{stateLabel}</p>
                {!stateFips && (
                  <p className="mt-2 px-1 text-xs leading-relaxed text-[#6b6560]">
                    Click a state on the map (highlighted) to load tract rankings.
                  </p>
                )}
                {noData && (
                  <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-2 text-xs text-amber-950">
                    No tract rows in the database for this state yet.
                  </p>
                )}
              </div>

              <ul className="max-h-[min(52vh,28rem)] divide-y divide-[#ebe6df] overflow-y-auto overscroll-contain">
                {ranked.slice(0, 16).map((r, idx) => {
                  const label = r.name ?? `Tract ${r.geoid}`;
                  const inTray = compareTray.includes(r.geoid);
                  const isSel = selectedGeoid === r.geoid;
                  const score = r.composite_score != null ? Math.round(r.composite_score) : null;
                  const scoreTone =
                    score != null
                      ? score >= 66
                        ? "bg-[#e8c9a5] text-[#2d2d2d]"
                        : score >= 33
                          ? "bg-[#efe0d0] text-[#2d2d2d]"
                          : "bg-[#f4ebe4] text-[#5c534c]"
                      : "bg-[#ebe6df] text-[#8e8e8e]";
                  const secondary = [r.county_name].filter(Boolean).join(" · ") || "—";
                  return (
                    <li
                      key={r.geoid}
                      className={`flex items-center gap-2 px-3 py-2.5 transition ${isSel ? "bg-[#f6e9e4]" : "hover:bg-[#faf6f0]"}`}
                    >
                      <span className="w-7 shrink-0 text-[11px] tabular-nums text-[#8e8e8e]">
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <span
                        className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-bold tabular-nums ${scoreTone}`}
                      >
                        {score ?? "—"}
                      </span>
                      <button
                        type="button"
                        onClick={() => onSelectTract(r.geoid)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p className="truncate text-sm font-semibold text-[#2d2d2d]">{label}</p>
                        <p className="truncate text-[11px] text-[#8e8e8e]">{secondary}</p>
                      </button>
                      <button
                        type="button"
                        aria-label={inTray ? "Remove from compare" : "Add to compare"}
                        onClick={() =>
                          setCompareTray(inTray ? removeFromCompareTray(r.geoid) : addToCompareTray(r.geoid))
                        }
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-base font-semibold transition ${
                          inTray
                            ? "bg-[#b34d3a] text-white shadow-sm"
                            : "border border-[#d6cfc7] bg-white text-[#2d2d2d] hover:border-[#b34d3a]/50"
                        }`}
                      >
                        {inTray ? "✓" : "+"}
                      </button>
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
