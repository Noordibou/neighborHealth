"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { MapRef } from "react-map-gl/maplibre";
import { isExploreBrowsePlaceholderViewport } from "@/lib/exploreMapPlaceholder";
import type {
  ExploreLayerMode,
  AppliedFilters,
  DraftFilters,
  Viewport,
} from "@/types";

export type { ExploreLayerMode, AppliedFilters, DraftFilters };

function paramsEqual(a: URLSearchParams, b: URLSearchParams): boolean {
  const keys = new Set<string>();
  a.forEach((_, k) => keys.add(k));
  b.forEach((_, k) => keys.add(k));
  for (const k of Array.from(keys)) {
    if (a.get(k) !== b.get(k)) return false;
  }
  return true;
}

export function parseExploreUrl(search: string): {
  tract: string | null;
  stateFromUrl: string | null;
  layer: ExploreLayerMode | null;
  minRent: number | null;
  minUninsured: number | null;
  scoreMin: number | undefined;
  popMin: number | undefined;
  exclInst: boolean | undefined;
  clinicDist: "" | "1" | "2" | "5" | "over5";
  viewport: Viewport | null;
} {
  const p = new URLSearchParams(search);
  const tractRaw = p.get("tract")?.trim();
  const tract = tractRaw && /^\d{11}$/.test(tractRaw) ? tractRaw : null;
  const stateRaw = p.get("state")?.trim();
  const stateFromUrl =
    stateRaw && /^\d{2}$/.test(stateRaw.padStart(2).slice(0, 2))
      ? stateRaw.padStart(2).slice(0, 2)
      : null;
  const lr = p.get("layer")?.toLowerCase();
  const layer: ExploreLayerMode | null =
    lr === "housing" || lr === "health" || lr === "composite" || lr === "overlap"
      ? (lr as ExploreLayerMode)
      : null;
  const rentN = Number(p.get("f_rent"));
  const minRent =
    Number.isFinite(rentN) && rentN >= 0 && rentN <= 100 ? Math.round(rentN) : null;
  const uniN = Number(p.get("f_uninsured"));
  const minUninsured =
    Number.isFinite(uniN) && uniN >= 0 && uniN <= 50 ? Math.round(uniN) : null;
  let scoreMin: number | undefined;
  if (p.has("score_min")) {
    const sc = Number(p.get("score_min"));
    if (Number.isFinite(sc) && sc >= 0 && sc <= 100) scoreMin = Math.round(sc);
  }
  const POP_MIN_OPTS = new Set([0, 500, 1000, 2500, 5000]);
  let popMin: number | undefined;
  if (p.has("pop_min")) {
    const pn = Number(p.get("pop_min"));
    if (Number.isFinite(pn) && POP_MIN_OPTS.has(Math.round(pn))) popMin = Math.round(pn);
  }
  let exclInst: boolean | undefined;
  if (p.has("excl_inst")) {
    const raw = p.get("excl_inst")?.toLowerCase() ?? "";
    exclInst = raw === "1" || raw === "true";
  }
  let clinicDist: "" | "1" | "2" | "5" | "over5" = "";
  if (p.has("clinic_dist")) {
    const cr = p.get("clinic_dist")?.trim().toLowerCase() ?? "";
    if (cr === "1" || cr === "2" || cr === "5") clinicDist = cr as "1" | "2" | "5";
    else if (cr === "over5") clinicDist = "over5";
  }
  const lat = Number(p.get("lat"));
  const lng = Number(p.get("lng"));
  const zoom = Number(p.get("zoom"));
  const viewport =
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    Number.isFinite(lng) &&
    lng >= -180 &&
    lng <= 180 &&
    Number.isFinite(zoom) &&
    zoom >= 0 &&
    zoom <= 22
      ? { lat, lng, zoom }
      : null;
  return {
    tract,
    stateFromUrl,
    layer,
    minRent,
    minUninsured,
    scoreMin,
    popMin,
    exclInst,
    clinicDist,
    viewport,
  };
}

function buildExploreUrlParams(opts: {
  qParam: string | null | undefined;
  stateFips: string | null;
  selectedGeoid: string | null;
  layerMode: ExploreLayerMode;
  appliedMinScore: number;
  appliedMinPopulation: number;
  appliedExcludeInstitutional: boolean;
  appliedMinRent: number;
  appliedMinUninsured: number;
  appliedClinicDist: "" | "1" | "2" | "5" | "over5";
  viewport: Viewport | null;
}): URLSearchParams {
  const p = new URLSearchParams();
  if (opts.qParam) p.set("q", opts.qParam);
  if (opts.stateFips) p.set("state", opts.stateFips.padStart(2, "0").slice(0, 2));
  if (opts.selectedGeoid) p.set("tract", opts.selectedGeoid);
  if (opts.layerMode !== "composite") p.set("layer", opts.layerMode);
  if (opts.appliedMinScore > 0) p.set("score_min", String(opts.appliedMinScore));
  if (opts.appliedMinPopulation > 0) p.set("pop_min", String(opts.appliedMinPopulation));
  if (opts.appliedExcludeInstitutional) p.set("excl_inst", "1");
  if (opts.appliedClinicDist !== "") p.set("clinic_dist", opts.appliedClinicDist);
  if (opts.appliedMinRent > 0) p.set("f_rent", String(opts.appliedMinRent));
  if (opts.appliedMinUninsured > 0) p.set("f_uninsured", String(opts.appliedMinUninsured));
  if (opts.viewport) {
    p.set("lat", opts.viewport.lat.toFixed(4));
    p.set("lng", opts.viewport.lng.toFixed(4));
    p.set("zoom", opts.viewport.zoom.toFixed(1));
  }
  return p;
}

export function useExploreUrlSync({
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
}: {
  sessionReady: boolean;
  stateFips: string | null;
  selectedGeoid: string | null;
  layerMode: ExploreLayerMode;
  applied: AppliedFilters;
  mapMode: "browse" | "search";
  exploreMapRef: React.RefObject<MapRef | null>;
  setStateFips: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedGeoid: React.Dispatch<React.SetStateAction<string | null>>;
  setLayerMode: React.Dispatch<React.SetStateAction<ExploreLayerMode>>;
  setDraft: React.Dispatch<React.SetStateAction<DraftFilters>>;
  setApplied: React.Dispatch<React.SetStateAction<AppliedFilters>>;
  clearSearchState: () => void;
}) {
  const router = useRouter();
  const sp = useSearchParams();

  const suppressViewportUrlUntilRef = useRef(0);
  const viewportDebounceRef = useRef<number | null>(null);
  const pendingViewportRef = useRef<Viewport | null>(null);
  const hasHydratedRef = useRef(false);

  const [viewportForUrl, setViewportForUrl] = useState<Viewport | null>(null);
  const [pendingUrlFly, setPendingUrlFly] = useState<Viewport | null>(null);

  // Write current state to the URL on any relevant change.
  useEffect(() => {
    if (!sessionReady || typeof window === "undefined") return;
    const qParam = sp.get("q");
    const merged = buildExploreUrlParams({
      qParam,
      stateFips,
      selectedGeoid,
      layerMode,
      appliedMinScore: applied.minScore,
      appliedMinPopulation: applied.minPopulation,
      appliedExcludeInstitutional: applied.excludeInstitutional,
      appliedMinRent: applied.minRent,
      appliedMinUninsured: applied.minUninsured,
      appliedClinicDist: applied.clinicDist,
      viewport: stateFips ? viewportForUrl : null,
    });
    const current = new URLSearchParams(window.location.search);
    if (paramsEqual(merged, current)) return;
    const qs = merged.toString();
    const nextPath = qs ? `/explore?${qs}` : "/explore";
    window.history.replaceState(window.history.state ?? null, "", nextPath);
    router.replace(nextPath, { scroll: false });
  }, [
    sessionReady,
    router,
    sp,
    stateFips,
    selectedGeoid,
    layerMode,
    applied.minScore,
    applied.minPopulation,
    applied.excludeInstitutional,
    applied.minRent,
    applied.minUninsured,
    applied.clinicDist,
    viewportForUrl,
  ]);

  // Hydrate state from URL params exactly once when session is ready.
  useEffect(() => {
    if (!sessionReady || typeof window === "undefined") return;
    if (hasHydratedRef.current) return;
    hasHydratedRef.current = true;

    const parsed = parseExploreUrl(window.location.search);
    if (parsed.tract) {
      clearSearchState();
      setViewportForUrl(null);
      setPendingUrlFly(null);
      const sf = parsed.tract.slice(0, 2).padStart(2, "0").slice(0, 2);
      setStateFips(sf);
      setSelectedGeoid(parsed.tract);
    }
    if (parsed.layer !== null) setLayerMode(parsed.layer);
    if (parsed.minRent !== null) {
      const v = parsed.minRent;
      setDraft((d) => ({ ...d, minRent: v }));
      setApplied((a) => ({ ...a, minRent: v }));
    }
    if (parsed.minUninsured !== null) {
      const v = parsed.minUninsured;
      setDraft((d) => ({ ...d, minUninsured: v }));
      setApplied((a) => ({ ...a, minUninsured: v }));
    }
    if (parsed.scoreMin !== undefined) {
      const v = parsed.scoreMin!;
      setDraft((d) => ({ ...d, minScore: v }));
      setApplied((a) => ({ ...a, minScore: v }));
    }
    if (parsed.popMin !== undefined) {
      setApplied((a) => ({ ...a, minPopulation: parsed.popMin! }));
    }
    if (parsed.exclInst !== undefined) {
      setApplied((a) => ({ ...a, excludeInstitutional: parsed.exclInst! }));
    }
    if (parsed.clinicDist) {
      setApplied((a) => ({ ...a, clinicDist: parsed.clinicDist }));
    }
    if (parsed.viewport) {
      const fromTract = parsed.tract
        ? parsed.tract.slice(0, 2).padStart(2, "0").slice(0, 2)
        : null;
      const sfForViewport = fromTract ?? parsed.stateFromUrl ?? stateFips;
      if (sfForViewport && !isExploreBrowsePlaceholderViewport(sfForViewport, parsed.viewport)) {
        setViewportForUrl({
          lng: parsed.viewport.lng,
          lat: parsed.viewport.lat,
          zoom: parsed.viewport.zoom,
        });
        setPendingUrlFly(parsed.viewport);
      }
    }
  }, [
    sessionReady,
    stateFips,
    clearSearchState,
    setStateFips,
    setSelectedGeoid,
    setLayerMode,
    setDraft,
    setApplied,
  ]);

  // When pendingUrlFly is set, wait for the map to be ready then jump to it.
  useEffect(() => {
    if (!pendingUrlFly || !sessionReady) return;
    const target = pendingUrlFly;
    let cancelled = false;
    let attempts = 0;
    const id = window.setInterval(() => {
      if (cancelled) return;
      attempts += 1;
      const map = exploreMapRef.current?.getMap?.();
      if (!map) {
        if (attempts > 200) {
          window.clearInterval(id);
          setPendingUrlFly(null);
        }
        return;
      }
      const loaded = typeof map.isStyleLoaded === "function" ? map.isStyleLoaded() : true;
      if (!loaded && attempts < 200) return;
      window.clearInterval(id);
      setPendingUrlFly(null);
      suppressViewportUrlUntilRef.current = Date.now() + 1600;
      try {
        map.jumpTo({ center: [target.lng, target.lat], zoom: target.zoom });
      } catch {
        /* ignore */
      }
    }, 50);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [pendingUrlFly, sessionReady, exploreMapRef]);

  // Clean up viewport debounce timer on unmount.
  useEffect(
    () => () => {
      if (viewportDebounceRef.current != null) window.clearTimeout(viewportDebounceRef.current);
    },
    []
  );

  const onExploreMapMoveEnd = useCallback(
    (v: Viewport) => {
      if (typeof window !== "undefined" && Date.now() < suppressViewportUrlUntilRef.current) return;
      if (mapMode === "browse" && !stateFips) return;
      pendingViewportRef.current = v;
      if (viewportDebounceRef.current != null) window.clearTimeout(viewportDebounceRef.current);
      viewportDebounceRef.current = window.setTimeout(() => {
        viewportDebounceRef.current = null;
        const p = pendingViewportRef.current;
        if (!p) return;
        setViewportForUrl({
          lng: Math.round(p.lng * 10000) / 10000,
          lat: Math.round(p.lat * 10000) / 10000,
          zoom: Math.round(p.zoom * 10) / 10,
        });
      }, 500);
    },
    [mapMode, stateFips]
  );

  const clearViewport = useCallback(() => {
    setViewportForUrl(null);
    setPendingUrlFly(null);
  }, []);

  const suppressViewportUrl = useCallback((ms: number) => {
    suppressViewportUrlUntilRef.current = Date.now() + ms;
  }, []);

  return { onExploreMapMoveEnd, clearViewport, suppressViewportUrl };
}
