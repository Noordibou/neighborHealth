"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { MapRef } from "react-map-gl/maplibre";
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BrandWordmark } from "@/components/BrandMark";
import { SiteFooter } from "@/components/SiteFooter";
import { BivariateLegend } from "@/components/BivariateLegend";
import { NeighborMap } from "@/components/NeighborMap";
import { TopTractsPanel } from "@/components/TopTractsPanel";
import { TractDetailPanel } from "@/components/TractDetailPanel";
import {
  API_BASE,
  getMapGeoJSON,
  getStates,
  getTract,
  postMapTractsByGeoids,
} from "@/lib/api";
import type {
  SearchResultRow,
  TractDetail,
  ExploreLayerMode,
  MapLayerMode,
  MapMode,
  RankedTractRow,
  ExploreMapSessionV1,
  StateSummary,
} from "@/types";
import { addToCompareTray, readCompareTray, removeFromCompareTray, writeCompareTray } from "@/lib/compareTray";
import {
  EXPLORE_MAP_SESSION_KEY,
  getInitialExploreBrowseStateFips,
  parseExploreMapSession,
  serializeExploreMapSession,
} from "@/lib/exploreMapSession";
import { applyLayerMode, augmentGeoJSONForYear } from "@/lib/mapGeojson";
import { SCORE_THRESHOLDS } from "@/lib/constants";
import { parseExploreUrl, useExploreUrlSync } from "./useExploreUrlSync";
import { useExploreSearch } from "./useExploreSearch";

function mapFillLabel(mode: ExploreLayerMode): string {
  if (mode === "composite") return "Priority index — composite";
  if (mode === "housing") return "Housing — rent burden";
  if (mode === "health") return "Health — blended uninsured, asthma, mental health";
  return "Overlap — housing stress × health burden";
}

const PRIORITY_THRESHOLDS: Record<ExploreLayerMode, number | null> = {
  composite: SCORE_THRESHOLDS.mapFlag,
  housing: SCORE_THRESHOLDS.mapFlagHousing,
  health: SCORE_THRESHOLDS.mapFlagHealth,
  overlap: null,
};

function priorityFlagCopy(mode: ExploreLayerMode): string {
  if (mode === "composite") return `flagged priority (score ≥ ${SCORE_THRESHOLDS.mapFlag})`;
  if (mode === "housing") return `flagged priority (rent burden ≥ ${SCORE_THRESHOLDS.mapFlagHousing}%)`;
  if (mode === "health") return `flagged priority (health blend ≥ ${SCORE_THRESHOLDS.mapFlagHealth})`;
  return "in high-overlap zone (class 3-3)";
}

function ExploreInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const initialQ = sp.get("q")?.trim() ?? "";

  const [stateFips, setStateFips] = useState<string | null>(null);
  const [geojson, setGeojson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchInfo, setSearchInfo] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResultRow[] | null>(null);
  const [mapMode, setMapMode] = useState<MapMode>("browse");
  const [searchGeojson, setSearchGeojson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [searchMapLoading, setSearchMapLoading] = useState(false);
  const [searchZoomKey, setSearchZoomKey] = useState(0);
  /** When false, skip persisting so hydrate does not overwrite sessionStorage with default state. */
  const [sessionReady, setSessionReady] = useState(false);
  const [rankedForTray, setRankedForTray] = useState<RankedTractRow[]>([]);
  const [layerMode, setLayerMode] = useState<ExploreLayerMode>("composite");
  const [compareTray, setCompareTray] = useState<string[]>([]);
  /** Avoid persisting initial `[]` before layout hydration reads sessionStorage (was clearing the tray). */
  const skipCompareTrayPersistRef = useRef(true);
  const [selectedGeoid, setSelectedGeoid] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<TractDetail | null>(null);
  const [selectedDetailErr, setSelectedDetailErr] = useState<string | null>(null);
  const [shareHint, setShareHint] = useState<string | null>(null);
  const [availableStates, setAvailableStates] = useState<StateSummary[]>([]);
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
    minPopulation: 0,
    excludeInstitutional: false,
    minRent: 0,
    minUninsured: 0,
    asthmaHigh: false,
    urbanRural: "" as "" | "urban" | "rural",
    clinicDist: "" as "" | "1" | "2" | "5" | "over5",
  });

  const exploreMapRef = useRef<MapRef | null>(null);

  const skipSessionHydrate = initialQ.length > 0;

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const next = getInitialExploreBrowseStateFips(window.location.search, skipSessionHydrate);
    if (next) setStateFips((prev) => (prev == null ? next : prev));
  }, [skipSessionHydrate]);

  // clearSearchState clears only search UI state (no viewport — that's owned by useExploreUrlSync).
  const clearSearchState = useCallback(() => {
    setMapMode("browse");
    setSearchGeojson(null);
    setSearchResults(null);
    setSearchError(null);
    setSearchInfo(null);
  }, []);

  const { onExploreMapMoveEnd, clearViewport, suppressViewportUrl } = useExploreUrlSync({
    sessionReady,
    stateFips,
    selectedGeoid,
    layerMode,
    applied,
    mapMode,
    exploreMapRef,
    setStateFips,
    setSelectedGeoid,
    setLayerMode,
    setDraft,
    setApplied,
    clearSearchState,
  });

  const clearSearchMap = useCallback(() => {
    clearSearchState();
    clearViewport();
  }, [clearSearchState, clearViewport]);

  const {
    q,
    setQ,
    searchNarrowFips,
    setSearchNarrowFips,
    suggestions,
    suggestOpen,
    setSuggestOpen,
    searchResultsExpanded,
    setSearchResultsExpanded,
    clearSearch: clearSearchFields,
    onSearchSubmit,
    onPickSuggestion,
  } = useExploreSearch({
    initialQ,
    clearViewport,
    onSelectState: (fips) => {
      clearSearchMap();
      setStateFips(fips.padStart(2, "0").slice(0, 2));
    },
    setMapMode,
    setSearchGeojson,
    setSearchResults,
    setSearchError,
    setSearchInfo,
    setSearchMapLoading,
    setSearchZoomKey,
  });

  const clearSearch = useCallback(() => {
    clearSearchFields();
    clearSearchMap();
  }, [clearSearchFields, clearSearchMap]);

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
      const { stateFromUrl } = parseExploreUrl(window.location.search);
      if (stateFromUrl) setStateFips(stateFromUrl);
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
            clearViewport();
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
  }, [skipSessionHydrate, initialQ, clearViewport, setQ, setSearchNarrowFips]);

  useLayoutEffect(() => {
    setCompareTray(readCompareTray());
  }, []);

  useEffect(() => {
    let cancelled = false;
    getStates()
      .then((rows) => {
        if (!cancelled) {
          setAvailableStates(
            rows.map((r) => ({
              state_fips: r.state_fips.padStart(2, "0"),
              state_name: r.state_name,
              tract_count: r.tract_count,
            }))
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
    if (skipCompareTrayPersistRef.current) {
      skipCompareTrayPersistRef.current = false;
      return;
    }
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

  const onSelectTract = useCallback((geoid: string) => {
    setSelectedGeoid(geoid);
  }, []);

  const onSelectStateFromMap = useCallback(
    (fips: string) => {
      const sf = fips.padStart(2, "0").slice(0, 2);
      clearSearchMap();
      suppressViewportUrl(2200);
      setStateFips(sf);
      setSelectedGeoid(null);
    },
    [clearSearchMap, suppressViewportUrl]
  );

  const goToUsOverview = useCallback(() => {
    setStateFips(null);
    setGeojson(null);
    setErr(null);
    setSelectedGeoid(null);
    clearViewport();
  }, [clearViewport]);

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

  const mapAugmentMode: MapLayerMode = layerMode === "overlap" ? "composite" : layerMode;

  // Layer 1: expensive bivariate sort+classification — runs once when GeoJSON reference changes.
  const augmentedBrowseBase = useMemo(() => {
    if (!geojson?.features?.length) return null;
    return augmentGeoJSONForYear(geojson);
  }, [geojson]);

  const augmentedSearchBase = useMemo(() => {
    if (!searchGeojson?.features?.length) return null;
    return augmentGeoJSONForYear(searchGeojson);
  }, [searchGeojson]);

  // Layer 2: cheap nh_map_value assignment — runs on layer mode switch (O(N) property write).
  const augmentedBrowse = useMemo(
    () => applyLayerMode(augmentedBrowseBase, mapAugmentMode),
    [augmentedBrowseBase, mapAugmentMode]
  );

  const augmentedSearch = useMemo(
    () => applyLayerMode(augmentedSearchBase, mapAugmentMode),
    [augmentedSearchBase, mapAugmentMode]
  );

  const priorityFlagged = useMemo(() => {
    const fc = mapMode === "search" ? augmentedSearch : augmentedBrowse;
    if (!fc?.features?.length) return 0;
    if (layerMode === "overlap") {
      let n = 0;
      for (const f of fc.features) {
        if (f.properties?.nh_bivariate_class === "3-3") n += 1;
      }
      return n;
    }
    const threshold = PRIORITY_THRESHOLDS[layerMode];
    if (threshold === null) return 0;
    let n = 0;
    for (const f of fc.features) {
      const v = f.properties?.nh_map_value;
      if (typeof v === "number" && v >= threshold) n += 1;
    }
    return n;
  }, [mapMode, augmentedBrowse, augmentedSearch, layerMode]);

  const tractCountOnMap = mapMode === "search" ? augmentedSearch?.features?.length ?? 0 : augmentedBrowse?.features?.length ?? 0;

  const stateLabel = useMemo(() => {
    if (!stateFips) return "United States";
    const sf = stateFips.padStart(2, "0").slice(0, 2);
    return (
      availableStates.find((s) => s.state_fips.padStart(2, "0").slice(0, 2) === sf)?.state_name ?? `FIPS ${sf}`
    );
  }, [stateFips, availableStates]);

  const exploreDataStatus = useMemo(() => {
    const total = availableStates.reduce((sum, st) => sum + st.tract_count, 0);
    return { total, stateCount: availableStates.length };
  }, [availableStates]);

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

  const layerTabs: { id: ExploreLayerMode; label: string; sublabel?: string }[] = [
    { id: "composite", label: "Composite" },
    { id: "housing", label: "Housing" },
    { id: "health", label: "Health" },
    {
      id: "overlap",
      label: "Overlap",
      sublabel: "Housing stress × Health burden",
    },
  ];

  const mapDataBrowse = augmentedBrowse ?? geojson;
  const mapDataSearch = augmentedSearch ?? searchGeojson;
  return (
    <>
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
            <div className="flex flex-col items-end gap-0.5">
              <button
                type="button"
                onClick={shareView}
                className="shrink-0 rounded-full bg-nh-brown px-4 py-2 text-sm font-semibold text-nh-cream shadow-sm hover:bg-nh-brown/90"
              >
                Share view
              </button>
              <p className="max-w-[14rem] text-right text-[10px] leading-snug text-nh-brown-muted">
                Link captures current view
              </p>
              {shareHint ? <span className="text-xs text-nh-terracotta">{shareHint}</span> : null}
            </div>
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
                    placeholder="Tract, neighborhood, address…"
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
                  Narrowed to{" "}
                  {availableStates.find((s) => s.state_fips === searchNarrowFips)?.state_name ?? searchNarrowFips}
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
                      Try a Census tract ID, place, county, or street address in Search above.
                    </div>
                  )}
                </>
              ) : null}
            </section>
          </div>
        </aside>

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col px-2 pt-2 lg:min-h-0 lg:px-4">
          {exploreDataStatus.stateCount > 0 ? (
            <p className="mb-1.5 text-[10px] leading-snug text-nh-brown-muted">
              Data: ACS 2022 · {exploreDataStatus.total.toLocaleString()} tracts across{" "}
              {exploreDataStatus.stateCount} states
            </p>
          ) : null}
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-nh-brown/10 bg-white/80 px-3 py-2 text-xs text-nh-brown-muted">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-nh-brown-muted">
                Layer
              </span>
              <div className="flex min-w-0 rounded-full bg-[#ebe6df] p-1">
                {layerTabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    title={t.sublabel ? `${t.label}: ${t.sublabel}` : t.label}
                    onClick={() => setLayerMode(t.id)}
                    className={`min-w-0 rounded-full px-2.5 py-1.5 text-center text-xs font-semibold transition sm:px-3 ${
                      layerMode === t.id
                        ? "bg-[#2d2d2d] text-white shadow-sm"
                        : "bg-transparent text-[#5c534c] hover:text-[#2d2d2d]"
                    }`}
                  >
                    <span className="flex flex-col items-center gap-0 leading-tight">
                      <span>{t.label}</span>
                      {t.sublabel ? (
                        <span
                          className={`hidden max-w-[7rem] truncate text-[9px] font-normal sm:block ${
                            layerMode === t.id ? "text-white/75" : "text-[#8e8e8e]"
                          }`}
                        >
                          {t.sublabel}
                        </span>
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <span className="min-w-0 text-right leading-snug">
              Showing <strong className="text-nh-brown">{tractCountOnMap || featureCount}</strong> tracts
              {tractCountOnMap ? (
                <>
                  {" "}
                  · <strong className="text-nh-terracotta">{priorityFlagged}</strong> {priorityFlagCopy(layerMode)}
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
                    choroplethStyle={layerMode === "overlap" ? "bivariate" : "ramp"}
                    suppressBuiltInBivariateLegend={layerMode === "overlap"}
                    showMetricControl={false}
                    selectedGeoid={selectedGeoid}
                    exploreMapRef={exploreMapRef}
                    onExploreMapMoveEnd={onExploreMapMoveEnd}
                  />
                  {layerMode === "overlap" ? (
                    <div className="pointer-events-none absolute bottom-10 left-3 z-[15]">
                      <BivariateLegend />
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          )}

          {mapMode === "browse" && (
            <div className="flex min-h-0 flex-1 flex-col gap-2">
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
              {!err && !(stateFips != null && geojson != null && noData) && (
                <div className="relative flex min-h-0 flex-1 flex-col">
                  {stateFips != null && geojson != null && !noData ? (
                    <button
                      type="button"
                      onClick={goToUsOverview}
                      className="absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-full border border-nh-brown/15 bg-white/95 px-4 py-1.5 text-xs font-semibold text-nh-brown shadow hover:bg-white"
                    >
                      ← All states
                    </button>
                  ) : null}
                  <NeighborMap
                    stateFips={stateFips}
                    data={stateFips != null && geojson != null && !noData ? mapDataBrowse : null}
                    variant="explore"
                    onSelectTract={onSelectTract}
                    fillProperty="nh_map_value"
                    fillLabel={mapFillLabel(layerMode)}
                    choroplethStyle={layerMode === "overlap" ? "bivariate" : "ramp"}
                    suppressBuiltInBivariateLegend={layerMode === "overlap"}
                    showMetricControl={false}
                    selectedGeoid={selectedGeoid}
                    statePickerGeoJSON={!stateFips ? statePickerGeoJSON : null}
                    onSelectStateFips={!stateFips ? onSelectStateFromMap : undefined}
                    exploreMapRef={exploreMapRef}
                    onExploreMapMoveEnd={onExploreMapMoveEnd}
                  />
                  {stateFips != null && geojson == null ? (
                    <div className="pointer-events-none absolute inset-0 z-20 flex min-h-0 flex-1 items-center justify-center rounded-xl bg-white/75 text-sm font-medium text-nh-brown-muted backdrop-blur-[2px]">
                      Loading map data…
                    </div>
                  ) : null}
                  {layerMode === "overlap" ? (
                    <div className="pointer-events-none absolute bottom-10 left-3 z-[15]">
                      <BivariateLegend />
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="flex max-h-[min(40vh,360px)] min-h-0 shrink-0 flex-col overflow-hidden border-t border-[#e8e3dc] bg-[#faf8f5] xl:h-full xl:max-h-none xl:w-[380px] xl:border-l xl:border-t-0">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
            <div>
              {!selectedGeoid && !stateFips && (
                <div className="rounded-xl border border-nh-brown/10 bg-nh-cream/50 p-4">
                  <h3 className="font-display text-base font-semibold text-nh-brown">
                    Find high-burden communities
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#6b6560]">
                    Select a state on the map to view tract rankings by housing stress and health burden.
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-[#6b6560]">
                    Or search for a neighborhood, address, or Census tract ID using the search bar.
                  </p>
                </div>
              )}
              {!selectedGeoid && stateFips && (
                <p className="text-sm leading-relaxed text-[#6b6560]">
                  Click a tract on the map to inspect scores and add to compare.
                </p>
              )}
              {selectedGeoid && selectedDetailErr && (
                <p className="mt-2 text-sm text-red-600">{selectedDetailErr}</p>
              )}
              <TractDetailPanel
                tract={selectedDetail}
                isInCompare={selectedDetail != null && compareTray.includes(selectedDetail.geoid)}
                compareDisabled={compareTray.length >= 4}
                onAddToCompare={() => {
                  if (selectedDetail) setCompareTray(addToCompareTray(selectedDetail.geoid));
                }}
              />
            </div>

            <TopTractsPanel
              stateFips={stateFips}
              layerMode={layerMode}
              selectedGeoid={selectedGeoid}
              stateLabel={stateLabel}
              noData={noData}
              draft={draft}
              setDraft={setDraft}
              applied={applied}
              setApplied={setApplied}
              compareTray={compareTray}
              setCompareTray={setCompareTray}
              onSelectTract={onSelectTract}
              onRankedChange={setRankedForTray}
            />
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
              const row = rankedForTray.find((x) => x.geoid === g);
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
    <div className="pb-[9.5rem] sm:pb-36 xl:pb-16">
      <SiteFooter />
    </div>
    </>
  );

}

export default function ExplorePage() {
  return (
    <Suspense fallback={<div className="flex min-h-[50vh] items-center justify-center text-slate-500">Loading map…</div>}>
      <ExploreInner />
    </Suspense>
  );
}
