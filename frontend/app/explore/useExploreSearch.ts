"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  postMapTractsByGeoids,
  searchFromAddress,
  searchSuggest,
  searchTracts,
  type SearchResultRow,
  type SearchSuggestItem,
} from "@/lib/api";

function looksLikeUsStreetAddress(s: string): boolean {
  const t = s.trim();
  if (t.length < 8 || t.length > 400) return false;
  if (/^\d{11}$/.test(t)) return false;
  return /^\d+\s/.test(t);
}

export function useExploreSearch({
  initialQ,
  clearViewport,
  onSelectState,
  setMapMode,
  setSearchGeojson,
  setSearchResults,
  setSearchError,
  setSearchInfo,
  setSearchMapLoading,
  setSearchZoomKey,
}: {
  initialQ: string;
  clearViewport: () => void;
  onSelectState: (fips: string) => void;
  setMapMode: (mode: "browse" | "search") => void;
  setSearchGeojson: (fc: GeoJSON.FeatureCollection | null) => void;
  setSearchResults: (results: SearchResultRow[] | null) => void;
  setSearchError: (err: string | null) => void;
  setSearchInfo: (info: string | null) => void;
  setSearchMapLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setSearchZoomKey: React.Dispatch<React.SetStateAction<number>>;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initialQ);
  const [searchNarrowFips, setSearchNarrowFips] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<SearchSuggestItem[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [searchResultsExpanded, setSearchResultsExpanded] = useState(true);

  // Auto-suggest with 260ms debounce.
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

  // If ?q= was supplied on load, run one search and redirect to the top tract.
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
        /* stay on explore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialQ, router]);

  const runSearchOnMap = useCallback(
    async (query: string, narrow?: string | null) => {
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
              clearViewport();
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
            "No matches. Try a street address (e.g. 123 Main St, Houston TX), place, county, state, or Census tract ID — or pick a suggestion."
          );
          setSearchResults(null);
          setSearchGeojson(null);
          setMapMode("browse");
          return;
        }
        setSearchResults(r.results);
        const fc = await postMapTractsByGeoids(r.results.map((x) => x.geoid));
        if (!fc.features?.length) {
          setSearchError(
            "Matches found, but none have map geometry yet. Try ingesting boundaries for this area."
          );
          setSearchGeojson(null);
          setMapMode("browse");
          return;
        }
        setSearchGeojson(fc);
        setMapMode("search");
        clearViewport();
        setSearchZoomKey((k) => k + 1);
        setSuggestOpen(false);
      } catch (err: unknown) {
        setSearchError(err instanceof Error ? err.message : "Search failed.");
        setSearchGeojson(null);
        setMapMode("browse");
      } finally {
        setSearchMapLoading(false);
      }
    },
    [
      clearViewport,
      setMapMode,
      setSearchGeojson,
      setSearchResults,
      setSearchError,
      setSearchInfo,
      setSearchMapLoading,
      setSearchZoomKey,
    ]
  );

  const clearSearch = useCallback(() => {
    setQ("");
    setSearchNarrowFips(null);
    setSuggestions([]);
    setSuggestOpen(false);
  }, []);

  const onSearchSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!q.trim()) return;
      await runSearchOnMap(q.trim(), searchNarrowFips);
    },
    [q, searchNarrowFips, runSearchOnMap]
  );

  const onPickSuggestion = useCallback(
    (item: SearchSuggestItem) => {
      setSuggestOpen(false);
      if (item.kind === "state" && item.state_fips) {
        onSelectState(item.state_fips);
        setQ(item.query);
        setSearchNarrowFips(null);
        return;
      }
      setQ(item.query);
      setSearchNarrowFips(item.state_fips ?? null);
      void runSearchOnMap(item.query, item.state_fips ?? null);
    },
    [onSelectState, runSearchOnMap]
  );

  return {
    q,
    setQ,
    searchNarrowFips,
    setSearchNarrowFips,
    suggestions,
    suggestOpen,
    setSuggestOpen,
    searchResultsExpanded,
    setSearchResultsExpanded,
    clearSearch,
    onSearchSubmit,
    onPickSuggestion,
  };
}
