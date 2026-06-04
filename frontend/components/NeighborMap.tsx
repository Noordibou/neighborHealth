"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import maplibregl from "maplibre-gl";
import type { MutableRefObject, ReactNode } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map, { Layer, Source, type MapRef } from "react-map-gl/maplibre";
import type { Map as MapLibreMap, MapLayerMouseEvent } from "maplibre-gl";
import { BIVARIATE_COLORS } from "@/lib/mapGeojson";
import { getExploreBrowsePlaceholderView, getExploreUsOverviewView } from "@/lib/exploreMapPlaceholder";
import { STATE_FIPS_TO_POSTAL } from "@/lib/geo";

// MapLibre GL 4.x requires an explicit worker URL in bundled/Next.js environments.
// Without this, new Worker("") fails silently and glyphs (required for text labels)
// never load — geometry still renders but city/road/country names are absent.
if (typeof window !== "undefined") {
  // Resolve against the document URL so the worker always loads from this origin
  // (avoids edge cases with relative resolution in worker creation).
  maplibregl.setWorkerUrl(new URL("/maplibre-worker.js", window.location.href).href);
}

/**
 * Vector basemap (roads, labels, landcover) without an API key.
 * Carto CDN (`basemaps.cartocdn.com`) can hit ERR_SSL_PROTOCOL_ERROR on some networks; this host is a reliable default.
 * Override with NEXT_PUBLIC_MAP_STYLE_URL (e.g. Carto Voyager) if your environment loads it fine.
 */
export const DEFAULT_MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

/** Fallback when the style has not been inspected yet (Liberty uses this id today). */
const DEFAULT_BASEMAP_LABEL_BEFORE_ID = "waterway_line_label";

function firstSymbolLayerIdFromStyle(map: MapLibreMap): string | undefined {
  const layers = map.getStyle()?.layers;
  if (!layers) return undefined;
  for (const layer of layers) {
    if (layer.type === "symbol" && typeof layer.id === "string") return layer.id;
  }
  return undefined;
}

const METRICS = [
  { id: "composite_score", label: "Composite risk" },
  { id: "rent_burden_pct", label: "Rent burden (30%+)" },
  { id: "overcrowding_pct", label: "Overcrowding" },
  { id: "structural_vacancy_rate", label: "Structural vacancy" },
  { id: "uninsured_pct", label: "Uninsured (access)" },
  { id: "asthma_pct", label: "Asthma prevalence" },
  { id: "mental_health_pct", label: "Mental health" },
  { id: "heat_index", label: "Heat index (proxy)" },
] as const;

function statePostalFromFips(fips: string | null | undefined): string | null {
  if (fips == null || typeof fips !== "string") return null;
  const k = fips.padStart(2, "0").slice(0, 2);
  return STATE_FIPS_TO_POSTAL[k] ?? null;
}

function strProp(p: Record<string, unknown>, k: string): string | null {
  const v = p[k];
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function numProp(p: Record<string, unknown>, k: string): number | null {
  const v = p[k];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Fill color for tracts with no value for the active choropleth metric (distinct from the teal value ramp).
 * Referenced in the map legend and hover copy so users learn this convention.
 */
const NO_DATA_CHOROPLETH_FILL = "#f5e6d8";

function hasChoroplethValueForProperty(p: Record<string, unknown> | undefined, key: string): boolean {
  if (!p || !Object.prototype.hasOwnProperty.call(p, key)) return false;
  const v = p[key];
  if (v === null || v === undefined) return false;
  return true;
}

type HoverInfo = {
  geoid: string;
  name: string | null;
  place_name: string | null;
  county_name: string | null;
  state_postal: string | null;
  composite_score: number | null;
  rent_burden_pct: number | null;
  uninsured_pct: number | null;
  asthma_pct: number | null;
  /** True when the tract has no value for the metric currently driving map fill color. */
  missingActiveChoropleth: boolean;
};

function propsToHover(
  p: Record<string, unknown> | null | undefined,
  choroplethKey: string
): HoverInfo | null {
  if (!p || typeof p.geoid !== "string") return null;
  const stateFips =
    strProp(p, "state_fips") ?? (p.geoid.length >= 2 ? p.geoid.slice(0, 2) : null);
  return {
    geoid: p.geoid,
    name: strProp(p, "name"),
    place_name: strProp(p, "place_name"),
    county_name: strProp(p, "county_name"),
    state_postal: statePostalFromFips(stateFips),
    composite_score: numProp(p, "composite_score"),
    rent_burden_pct: numProp(p, "rent_burden_pct"),
    uninsured_pct: numProp(p, "uninsured_pct"),
    asthma_pct: numProp(p, "asthma_pct"),
    missingActiveChoropleth: !hasChoroplethValueForProperty(p, choroplethKey),
  };
}

function formatHoverLocation(h: HoverInfo): { headline: string; subline: string | null } {
  const st = h.state_postal;
  const countyWithSt =
    h.county_name && st ? `${h.county_name}, ${st}` : h.county_name ?? (st ? st : null);

  if (h.place_name) {
    const parts: string[] = [];
    if (h.name) parts.push(h.name);
    if (countyWithSt) parts.push(countyWithSt);
    const sub = parts.length ? parts.join(" · ") : null;
    return { headline: h.place_name, subline: sub };
  }

  if (countyWithSt) {
    const sub = h.name && h.name !== countyWithSt ? h.name : null;
    return { headline: countyWithSt, subline: sub };
  }

  if (h.name) {
    return { headline: h.name, subline: st ? st : null };
  }

  if (st) {
    return { headline: `Census tract · ${st}`, subline: null };
  }

  return { headline: "Census tract", subline: null };
}

function hoverHasShownMetrics(h: HoverInfo): boolean {
  return (
    h.composite_score != null ||
    h.rent_burden_pct != null ||
    h.uninsured_pct != null ||
    h.asthma_pct != null
  );
}

type Props = {
  /** When null, map shows the continental US overview with no tract layer. */
  stateFips: string | null;
  /** When null or empty, no tract choropleth is drawn (overview mode). */
  data: GeoJSON.FeatureCollection | null;
  mapStyle?: string;
  onSelectTract?: (geoid: string) => void;
  /** Full controls on left vs compact overlay (explore dashboard) */
  variant?: "default" | "explore";
  /** After load, fit camera to the combined bounds of all features (e.g. search hits). */
  fitBoundsToData?: boolean;
  /** Bump when a new search completes so zoom runs again even if the GeoJSON is unchanged. */
  zoomToResultsKey?: number;
  /** When set, choropleth uses this GeoJSON property (e.g. nh_map_value) instead of the built-in metric picker. */
  fillProperty?: string | null;
  /** Legend / hover label for `fillProperty` mode. */
  fillLabel?: string;
  /**
   * When "bivariate", tract fill uses `nh_bivariate_class` + `BIVARIATE_COLORS` (numeric ramp skipped).
   * Does not change `effectiveKey` / hover metrics — only map fill paint.
   */
  choroplethStyle?: "ramp" | "bivariate";
  /**
   * When true with `choroplethStyle="bivariate"`, the built-in top-right bivariate legend is omitted
   * (e.g. Explore renders `BivariateLegend` over the map instead).
   */
  suppressBuiltInBivariateLegend?: boolean;
  /** When false, hides the metric dropdown (parent drives `fillProperty`). */
  showMetricControl?: boolean;
  /** Strong outline for the active tract (GEOID string). */
  selectedGeoid?: string | null;
  /** Tailwind bottom position for the hover card (explore mode; use when a bottom bar covers the map). */
  hoverLegendBottomClassName?: string;
  /** Explore: Composite / Housing / Health tabs (top-left). */
  exploreLayerTabs?: ReactNode;
  /** US overview: state polygons; click a state with data to drill in. */
  statePickerGeoJSON?: GeoJSON.FeatureCollection | null;
  onSelectStateFips?: (stateFips: string) => void;
  /** Explore dashboard: expose MapRef for programmatic camera / URL sync. */
  exploreMapRef?: MutableRefObject<MapRef | null>;
  /** Explore: fired after pan/zoom settles (debounced in parent for URL). */
  onExploreMapMoveEnd?: (view: { lng: number; lat: number; zoom: number }) => void;
};

function bboxFromGeoJSON(fc: GeoJSON.FeatureCollection): [[number, number], [number, number]] | null {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  const ring = (pt: number[]) => {
    const [lng, lat] = pt;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  };
  const walk = (coords: unknown): void => {
    if (!Array.isArray(coords) || coords.length === 0) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      ring(coords as number[]);
      return;
    }
    for (const x of coords) walk(x);
  };
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === "GeometryCollection") continue;
    walk((g as GeoJSON.Polygon | GeoJSON.MultiPolygon | GeoJSON.Point).coordinates as unknown);
  }
  if (!Number.isFinite(minLng) || minLng === Infinity) return null;
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

/** Tighter bounds → allow closer zoom (city / metro search). */
function maxZoomForSearchExtent(lonSpan: number, latSpan: number): number {
  const s = Math.max(lonSpan, latSpan, 1e-10);
  if (s > 12) return 5;
  if (s > 6) return 6;
  if (s > 3) return 7;
  if (s > 1.5) return 8;
  if (s > 0.75) return 9;
  if (s > 0.35) return 10;
  if (s > 0.15) return 12;
  if (s > 0.06) return 13;
  if (s > 0.025) return 14;
  return 15;
}

/** Min/max of a numeric GeoJSON property (skips null / missing / non-finite). */
function numericPropertyRange(fc: GeoJSON.FeatureCollection, key: string): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const f of fc.features) {
    const v = f.properties?.[key];
    let n: number | null = null;
    if (typeof v === "number" && Number.isFinite(v)) n = v;
    else if (typeof v === "string" && v.trim() !== "") {
      const x = Number(v);
      if (Number.isFinite(x)) n = x;
    }
    if (n == null) continue;
    min = Math.min(min, n);
    max = Math.max(max, n);
  }
  if (!Number.isFinite(min) || min === Infinity) return null;
  return { min, max };
}

function clampPctDomain(lo: number, hi: number): { lo: number; hi: number } {
  return { lo: Math.max(0, lo), hi: Math.min(100, hi) };
}

/**
 * Stretch the color ramp across the observed [min,max] so nearby scores read as different hues.
 * Composite / percent-like metrics are clamped to 0–100 after padding.
 */
function choroplethDomain(
  range: { min: number; max: number } | null,
  key: string
): { lo: number; hi: number } {
  const pctLike = key === "composite_score" || key === "nh_map_value" || key.endsWith("_pct");
  if (!range) {
    return { lo: 0, hi: 100 };
  }
  let { min, max } = range;
  let span = max - min;
  if (span < 1e-6) {
    const half = key === "composite_score" ? 12 : 10;
    const mid = (min + max) / 2;
    min = mid - half;
    max = mid + half;
    span = max - min;
  }
  if ((key === "composite_score" || key === "nh_map_value") && span < 14) {
    const padMid = (14 - span) / 2;
    min -= padMid;
    max += padMid;
    span = max - min;
  } else if (pctLike && span < 10) {
    const padMid = (10 - span) / 2;
    min -= padMid;
    max += padMid;
    span = max - min;
  }
  const pad = Math.max(span * 0.08, 0.75);
  const lo = min - pad;
  const hi = max + pad;
  if (pctLike) return clampPctDomain(lo, hi);
  return { lo, hi };
}

/** MapLibre expression: true when the choropleth field is missing or null (no modeled value). */
function choroplethNoDataExpr(key: string): unknown[] {
  return ["any", ["!", ["has", key]], ["==", ["get", key], ["literal", null]]];
}

/** Five-stop ramp: cream → sand → terracotta → deep brick → near-black. */
const CHORO_STOP_FRACS = [0, 0.22, 0.48, 0.74, 1] as const;
const CHORO_COLORS = ["#faf6ef", "#e8c4b0", "#d4896e", "#b85c3a", "#2c1810"] as const;

/** Stable key order for MapLibre `match` on `nh_bivariate_class`. */
const BIVARIATE_CLASS_KEYS = ["1-1", "1-2", "1-3", "2-1", "2-2", "2-3", "3-1", "3-2", "3-3"] as const;

function bivariateFillColorExpr(): unknown[] {
  const expr: unknown[] = ["match", ["get", "nh_bivariate_class"]];
  for (const k of BIVARIATE_CLASS_KEYS) {
    expr.push(k, BIVARIATE_COLORS[k]);
  }
  expr.push("#cccccc");
  return expr;
}

/** Short numeric label for a choropleth legend bound (e.g. "32%" for a pct metric, "47" for composite). */
function formatLegendBound(value: number, key: string): string {
  const rounded = Math.round(value);
  if (key === "composite_score" || key === "nh_map_value" || key === "heat_index") return String(rounded);
  if (key.endsWith("_pct") || key === "structural_vacancy_rate") return `${rounded}%`;
  return String(rounded);
}

function buildChoroplethColorStops(lo: number, hi: number): (number | string)[] {
  const span = hi - lo;
  const out: (number | string)[] = [];
  for (let i = 0; i < CHORO_STOP_FRACS.length; i++) {
    out.push(lo + span * CHORO_STOP_FRACS[i], CHORO_COLORS[i]);
  }
  return out;
}

function NeighborMapInner({
  stateFips,
  data,
  mapStyle,
  onSelectTract,
  variant = "default",
  fitBoundsToData = false,
  zoomToResultsKey = 0,
  fillProperty = null,
  fillLabel = "Priority index",
  choroplethStyle = "ramp",
  suppressBuiltInBivariateLegend = false,
  showMetricControl = true,
  selectedGeoid = null,
  hoverLegendBottomClassName,
  exploreLayerTabs = null,
  statePickerGeoJSON = null,
  onSelectStateFips,
  exploreMapRef,
  onExploreMapMoveEnd,
}: Props) {
  const mapRef = useRef<MapRef>(null);

  if (exploreMapRef) {
    exploreMapRef.current = mapRef.current;
  }

  useEffect(() => {
    if (!exploreMapRef) return;
    return () => {
      exploreMapRef.current = null;
    };
  }, [exploreMapRef]);
  const styleUrl = mapStyle ?? process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? DEFAULT_MAP_STYLE;

  /** Insert choropleth before this basemap layer so roads/shields/place names stay on top. */
  const [basemapLabelBeforeId, setBasemapLabelBeforeId] = useState(DEFAULT_BASEMAP_LABEL_BEFORE_ID);

  useEffect(() => {
    setBasemapLabelBeforeId(DEFAULT_BASEMAP_LABEL_BEFORE_ID);
  }, [styleUrl]);

  const onMapLoad = useCallback((e: { target: MapLibreMap }) => {
    const anchor = firstSymbolLayerIdFromStyle(e.target);
    if (anchor) setBasemapLabelBeforeId(anchor);
  }, []);

  const [colorBy, setColorBy] = useState<string>("composite_score");
  const effectiveKey = fillProperty ?? colorBy;
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const hoveredGeoidRef = useRef<string | null>(null);
  const hasTracts = Boolean(data?.features?.length);
  const showStatePicker = Boolean(
    statePickerGeoJSON?.features?.length && typeof onSelectStateFips === "function"
  );

  const statePickerKey = useMemo(() => {
    if (!statePickerGeoJSON?.features?.length) return "0";
    return `${statePickerGeoJSON.features.length}-${statePickerGeoJSON.features[0]?.properties?.state_fips ?? ""}`;
  }, [statePickerGeoJSON]);

  const fillOpacity = 0.78;
  const fillOpacityHover = Math.min(0.95, fillOpacity + 0.08);

  const choroplethRange = useMemo(() => {
    if (choroplethStyle === "bivariate" || !data?.features?.length) return null;
    return numericPropertyRange(data, effectiveKey);
  }, [data, effectiveKey, choroplethStyle]);

  const colorDomain = useMemo(() => {
    // nh_map_value carries composite scores or normalized component-score blends,
    // all on the same 0–100 national scale.  Use a fixed domain so the same shade
    // represents the same burden level regardless of which state is loaded.
    if (effectiveKey === "nh_map_value") return { lo: 0, hi: 100 };
    return choroplethDomain(choroplethRange, effectiveKey);
  }, [choroplethRange, effectiveKey]);

  const colorStops = useMemo(
    () => buildChoroplethColorStops(colorDomain.lo, colorDomain.hi),
    [colorDomain.lo, colorDomain.hi]
  );

  const fillChoroplethKey = choroplethStyle === "bivariate" ? "nh_bivariate_class" : effectiveKey;

  const fillPaint = useMemo(() => {
    const fillOpacityExpr: unknown = [
      "case",
      ["boolean", ["feature-state", "hover"], false],
      fillOpacityHover,
      ["literal", fillOpacity],
    ];
    if (choroplethStyle === "bivariate") {
      const noBio = choroplethNoDataExpr("nh_bivariate_class");
      const fillColor: unknown[] = ["case", noBio, NO_DATA_CHOROPLETH_FILL, bivariateFillColorExpr()];
      return {
        "fill-color": fillColor,
        "fill-opacity": fillOpacityExpr,
      };
    }
    const key = effectiveKey;
    const noData = choroplethNoDataExpr(key);
    const ramp: unknown[] = [
      "interpolate",
      ["linear"],
      ["to-number", ["get", key]],
      ...colorStops,
    ];
    const fillColor: unknown[] = ["case", noData, NO_DATA_CHOROPLETH_FILL, ramp];
    return {
      "fill-color": fillColor,
      "fill-opacity": fillOpacityExpr,
    };
  }, [choroplethStyle, effectiveKey, colorStops, fillOpacity, fillOpacityHover]);

  const lineWidthBase = 0.45;
  const linePaint = useMemo(() => {
    const key = fillChoroplethKey;
    const noData = choroplethNoDataExpr(key);
    const sel = selectedGeoid?.trim() ?? "";
    const isSelected: unknown[] =
      sel.length > 0 ? (["==", ["to-string", ["get", "geoid"]], sel] as unknown[]) : (["literal", false] as unknown[]);
    /** Selected: terracotta ring. No-data tracts: soft peach. Default outlines: dark teal (distinct from selection). */
    return {
      "line-color": [
        "case",
        isSelected,
        "#c45c3e",
        noData,
        "#d6a889",
        "#042f2e",
      ],
      "line-width": [
        "case",
        isSelected,
        3.5,
        ["boolean", ["feature-state", "hover"], false],
        2.75,
        ["literal", lineWidthBase],
      ],
      "line-opacity": [
        "case",
        isSelected,
        1,
        ["boolean", ["feature-state", "hover"], false],
        0.95,
        ["case", noData, 0.38, 0.42],
      ],
    };
  }, [lineWidthBase, fillChoroplethKey, selectedGeoid]);

  const onClick = useCallback(
    (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f) return;
      const layerId = f.layer?.id ?? "";
      if (layerId === "state-fill") {
        const p = f.properties as Record<string, unknown> | undefined;
        const sf = typeof p?.state_fips === "string" ? p.state_fips : "";
        const ok = p?.nh_has_data === true;
        if (sf && ok) onSelectStateFips?.(sf);
        return;
      }
      const geoid = f.properties?.geoid as string | undefined;
      if (geoid) onSelectTract?.(geoid);
    },
    [onSelectTract, onSelectStateFips]
  );

  const clearHoverFeatureState = useCallback((map: MapLibreMap) => {
    const prev = hoveredGeoidRef.current;
    if (prev != null) {
      try {
        map.setFeatureState({ source: "tracts", id: prev }, { hover: false });
      } catch {
        /* ignore */
      }
      hoveredGeoidRef.current = null;
    }
  }, []);

  const onMouseMove = useCallback(
    (e: MapLayerMouseEvent) => {
      if (!hasTracts) {
        if (showStatePicker && e.features?.[0]?.layer?.id === "state-fill") {
          const p = e.features[0].properties as Record<string, unknown> | undefined;
          e.target.getCanvas().style.cursor = p?.nh_has_data === true ? "pointer" : "default";
        } else if (showStatePicker) {
          e.target.getCanvas().style.cursor = "";
        }
        return;
      }
      const map = e.target;
      const f = e.features?.[0];
      const props = f?.properties as Record<string, unknown> | undefined;
      const geoid = props?.geoid as string | undefined;
      const canvas = map.getCanvas();

      if (geoid) {
        canvas.style.cursor = "pointer";
        if (hoveredGeoidRef.current !== geoid) {
          clearHoverFeatureState(map);
          hoveredGeoidRef.current = geoid;
          try {
            map.setFeatureState({ source: "tracts", id: geoid }, { hover: true });
          } catch {
            /* ignore */
          }
        }
        setHoverInfo(propsToHover(props, fillChoroplethKey));
      } else {
        canvas.style.cursor = "";
        clearHoverFeatureState(map);
        setHoverInfo(null);
      }
    },
    [hasTracts, showStatePicker, clearHoverFeatureState, fillChoroplethKey]
  );

  const onMouseLeave = useCallback(
    (e: { target: MapLibreMap }) => {
      e.target.getCanvas().style.cursor = "";
      clearHoverFeatureState(e.target);
      setHoverInfo(null);
    },
    [clearHoverFeatureState]
  );

  const center = useMemo(() => {
    if (stateFips == null) {
      const v = getExploreUsOverviewView();
      return [v.lng, v.lat] as [number, number];
    }
    const v = getExploreBrowsePlaceholderView(stateFips);
    return [v.lng, v.lat] as [number, number];
  }, [stateFips]);

  const zoom = stateFips == null ? getExploreUsOverviewView().zoom : getExploreBrowsePlaceholderView(stateFips).zoom;

  const boundsKey = useMemo(() => {
    if (!data?.features?.length) return "0";
    return `${data.features.length}-${data.features[0]?.properties?.geoid ?? ""}-${
      data.features[data.features.length - 1]?.properties?.geoid ?? ""
    }`;
  }, [data]);

  useEffect(() => {
    const isSearchFit = fitBoundsToData && Boolean(data?.features?.length);
    const isBrowseExploreFit =
      variant === "explore" &&
      !fitBoundsToData &&
      Boolean(data?.features?.length) &&
      stateFips != null;
    if (!isSearchFit && !isBrowseExploreFit) return;
    if (!data?.features?.length) return;
    const raw = bboxFromGeoJSON(data);
    if (!raw) return;
    let [[west, south], [east, north]] = raw;
    let lonSpan = Math.abs(east - west);
    let latSpan = Math.abs(north - south);
    const pad = 0.004;
    if (lonSpan < pad) {
      west -= pad;
      east += pad;
      lonSpan = Math.abs(east - west);
    }
    if (latSpan < pad) {
      south -= pad;
      north += pad;
      latSpan = Math.abs(north - south);
    }
    const bounds: [[number, number], [number, number]] = [
      [west, south],
      [east, north],
    ];
    const maxZoom = maxZoomForSearchExtent(lonSpan, latSpan);

    let cancelled = false;
    const fitOpts = {
      padding: { top: 96, bottom: 56, left: 56, right: 56 },
      maxZoom,
    } as const;

    const applyAnimated = () => {
      if (cancelled) return;
      const map = mapRef.current?.getMap();
      if (!map) return;
      try {
        map.resize();
        map.fitBounds(bounds, {
          ...fitOpts,
          duration: 1100,
        });
      } catch {
        /* ignore fit errors for degenerate bounds */
      }
    };

    const applySnap = () => {
      if (cancelled) return;
      const map = mapRef.current?.getMap();
      if (!map) return;
      try {
        map.resize();
        map.fitBounds(bounds, {
          ...fitOpts,
          duration: 0,
        });
      } catch {
        /* ignore */
      }
    };

    let raf = 0;
    const waitMap = () => {
      if (cancelled) return;
      const map = mapRef.current?.getMap();
      if (!map) {
        raf = requestAnimationFrame(waitMap);
        return;
      }
      const kick = () => {
        if (cancelled) return;
        applyAnimated();
        map.once("idle", applySnap);
      };
      if (map.loaded()) kick();
      else map.once("load", kick);
    };
    raf = requestAnimationFrame(() => requestAnimationFrame(waitMap));
    const fallback = window.setTimeout(() => {
      if (!cancelled) applyAnimated();
    }, 900);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(fallback);
    };
  }, [fitBoundsToData, data, boundsKey, zoomToResultsKey, variant, stateFips]);

  useEffect(() => {
    hoveredGeoidRef.current = null;
    setHoverInfo(null);
  }, [data, boundsKey, choroplethStyle]);

  const fmtPct = (v: number | null, digits = 0) =>
    v != null && Number.isFinite(v) ? `${digits ? v.toFixed(digits) : Math.round(v)}%` : "—";

  const hoverBottom =
    variant === "explore"
      ? hoverLegendBottomClassName ?? "bottom-5 sm:bottom-4"
      : "bottom-4";

  const hoverLegend =
    hoverInfo && hasTracts ? (() => {
      const { headline, subline } = formatHoverLocation(hoverInfo);
      const hasMetrics = hoverHasShownMetrics(hoverInfo);
      return (
        <div
          className={`pointer-events-none absolute left-1/2 z-10 w-[min(94vw,26rem)] max-w-[calc(100%-1rem)] -translate-x-1/2 ${hoverBottom}`}
        >
          <div className="max-h-[min(40dvh,20rem)] overflow-y-auto overscroll-contain rounded-xl border border-nh-brown/40 bg-nh-brown/95 px-4 py-3 text-left text-white shadow-xl backdrop-blur-sm sm:max-h-[min(45dvh,22rem)]">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-100/90">Area under cursor</p>
            <p className="mt-1 line-clamp-2 text-sm font-semibold leading-snug">{headline}</p>
            {subline ? (
              <p className="mt-0.5 line-clamp-3 text-xs leading-snug text-slate-300">{subline}</p>
            ) : null}
            <p className="mt-1 font-mono text-[11px] text-slate-400">Tract ID {hoverInfo.geoid}</p>
            {hoverInfo.missingActiveChoropleth ? (
              <p className="mt-2 rounded-md border border-orange-400/55 bg-orange-900/75 px-2 py-1.5 text-[11px] leading-snug text-orange-100">
                <span className="font-semibold text-orange-200">Map fill:</span> light{" "}
                <strong className="text-orange-200">orange</strong> means no value for{" "}
                <strong>
                  {choroplethStyle === "bivariate"
                    ? "Bivariate class (housing stress × health burden)"
                    : METRICS.find((m) => m.id === effectiveKey)?.label ?? fillLabel}
                </strong>{" "}
                on this tract (see legend on the map).
              </p>
            ) : null}
            {!hasMetrics ? (
              <p className="mt-2 rounded-md border border-amber-500/40 bg-amber-950/40 px-2 py-1.5 text-[11px] leading-snug text-amber-100/95">
                No risk score or indicators loaded for this tract (boundary only, not ingested, or a different data
                year).
              </p>
            ) : (
              <dl className="mt-2 grid grid-cols-[minmax(0,7.5rem)_1fr] gap-x-3 gap-y-1 border-t border-white/10 pt-2 text-xs">
                <dt className="text-slate-400">Composite risk</dt>
                <dd className="font-medium text-nh-cream">
                  {hoverInfo.composite_score != null ? Math.round(hoverInfo.composite_score) : "—"}
                </dd>
                <dt className="text-slate-400">Rent burden</dt>
                <dd>{fmtPct(hoverInfo.rent_burden_pct)}</dd>
                <dt className="text-slate-400">Uninsured</dt>
                <dd>{fmtPct(hoverInfo.uninsured_pct, 1)}</dd>
                <dt className="text-slate-400">Asthma</dt>
                <dd>{fmtPct(hoverInfo.asthma_pct, 1)}</dd>
              </dl>
            )}
          </div>
        </div>
      );
    })() : null;

  const layerPanel =
    showMetricControl && !fillProperty ? (
      <div className="rounded-lg border border-nh-brown/10 bg-white/95 p-3 shadow-md backdrop-blur-sm">
        <label className="text-[10px] font-semibold uppercase tracking-wide text-nh-brown-muted">Map color</label>
        <select
          className="mt-1 w-full min-w-[11rem] rounded border border-nh-brown/15 px-2 py-1.5 text-xs text-nh-brown"
          value={colorBy}
          onChange={(e) => setColorBy(e.target.value)}
        >
          {METRICS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <p className="mt-2 text-[10px] leading-snug text-nh-brown-muted">
          One metric at a time. Use the legend for the scale and how missing data is shown.
        </p>
      </div>
    ) : null;

  const legendMetricLabel = fillProperty ? fillLabel : METRICS.find((m) => m.id === effectiveKey)?.label ?? "Choropleth";
  const legendScaleHint =
    effectiveKey === "nh_map_value"
      ? "Scale: 0–100 normalized across the national cohort. Same shade = same burden level in every state."
      : choroplethRange != null
        ? `Scale spans ~${Math.round(colorDomain.lo)}–${Math.round(colorDomain.hi)} on tracts shown here so similar values read as different shades.`
        : "No numeric values found for this metric on the current layer.";

  const bivariateLegend =
    choroplethStyle === "bivariate" ? (
      <div className="rounded-lg border border-nh-brown/10 bg-white/95 px-3 py-2 shadow-md backdrop-blur-sm">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-nh-brown-muted">{fillLabel}</p>
        <p className="mt-1 max-w-[12rem] text-[9px] leading-snug text-nh-brown-muted">
          3×3 matrix: housing stress (columns 1–3) × health burden (rows 1–3). Tertiles within the map.
        </p>
        <div
          className="mt-2 grid w-[4.5rem] grid-cols-3 gap-0.5 rounded border border-nh-brown/10 p-0.5"
          aria-label="Bivariate color key"
        >
          {(["3-1", "3-2", "3-3", "2-1", "2-2", "2-3", "1-1", "1-2", "1-3"] as const).map((cell) => (
            <div
              key={cell}
              className="aspect-square rounded-[1px]"
              style={{ backgroundColor: BIVARIATE_COLORS[cell] }}
              title={cell}
            />
          ))}
        </div>
        <div className="mt-2 flex items-start gap-2 rounded-md border border-orange-200 bg-orange-50/95 px-2 py-1.5">
          <span
            className="mt-0.5 h-4 w-4 shrink-0 rounded-sm border border-orange-400/70 shadow-sm"
            style={{ backgroundColor: NO_DATA_CHOROPLETH_FILL }}
            aria-hidden
          />
          <p className="mt-0.5 text-[9px] text-orange-800">No bivariate class (missing blend)</p>
        </div>
      </div>
    ) : null;

  const legend = (
    <div className="rounded-lg border border-nh-brown/10 bg-white/95 px-3 py-2 shadow-md backdrop-blur-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-nh-brown-muted">{legendMetricLabel}</p>
      <div
        className="mt-2 h-3 w-36 rounded-full shadow-inner ring-1 ring-slate-200/80"
        style={{
          background: `linear-gradient(to right, ${CHORO_COLORS.join(", ")})`,
        }}
      />
      <div className="mt-1 flex justify-between text-[10px] text-nh-brown-muted">
        <span>↓ {(effectiveKey === "nh_map_value" || choroplethRange != null) ? formatLegendBound(colorDomain.lo, effectiveKey) : "Lower"}</span>
        {effectiveKey === "nh_map_value" ? (
          <span className="text-nh-brown-muted/50">50</span>
        ) : null}
        <span>{(effectiveKey === "nh_map_value" || choroplethRange != null) ? formatLegendBound(colorDomain.hi, effectiveKey) : "Higher"} ↑</span>
      </div>
      <div className="mt-2 flex items-start gap-2 rounded-md border border-orange-200 bg-orange-50/95 px-2 py-1.5">
        <span
          className="mt-0.5 h-4 w-4 shrink-0 rounded-sm border border-orange-400/70 shadow-sm"
          style={{ backgroundColor: NO_DATA_CHOROPLETH_FILL }}
          aria-hidden
        />
        <p className="text-[9px] text-orange-800 mt-0.5">
         No data available for this metric
        </p>
      </div>
      <p className="mt-1.5 max-w-[11rem] text-[11px] leading-snug text-nh-brown-muted">{legendScaleHint}</p>
    </div>
  );

  const statePickerLegend =
    showStatePicker && !hasTracts ? (
      <div className="rounded-lg border border-nh-brown/10 bg-white/95 px-3 py-2 shadow-md backdrop-blur-sm">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-nh-brown-muted">Data coverage</p>
        <div className="mt-2 flex items-center gap-2 text-[10px] text-nh-brown-muted">
          <span className="h-3 w-5 shrink-0 rounded-sm bg-[#d4896e]/80 ring-1 ring-nh-brown/15" aria-hidden />
          Tracts loaded in app
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-[10px] text-nh-brown-muted">
          <span className="h-3 w-5 shrink-0 rounded-sm bg-[#e8dfd6] ring-1 ring-nh-brown/10" aria-hidden />
          Not available yet
        </div>
      </div>
    ) : null;

  const interactiveLayerIds = useMemo(() => {
    const ids: string[] = [];
    if (hasTracts) ids.push("tract-fill");
    else if (showStatePicker) ids.push("state-fill");
    return ids;
  }, [hasTracts, showStatePicker]);

  const mapPointerHandlers = hasTracts || showStatePicker;

  const mapEl = (
    <Map
      ref={mapRef}
      key={fitBoundsToData ? "explore-search" : `explore-${stateFips ?? "us"}`}
      style={{ width: "100%", height: "100%" }}
      initialViewState={{ longitude: center[0], latitude: center[1], zoom }}
      mapStyle={styleUrl}
      interactiveLayerIds={interactiveLayerIds}
      onClick={onClick}
      onMouseMove={mapPointerHandlers ? onMouseMove : undefined}
      onMouseLeave={mapPointerHandlers ? onMouseLeave : undefined}
      onMoveEnd={
        onExploreMapMoveEnd
          ? (e) =>
              onExploreMapMoveEnd({
                lng: e.viewState.longitude,
                lat: e.viewState.latitude,
                zoom: e.viewState.zoom,
              })
          : undefined
      }
      onLoad={onMapLoad}
    >
      {showStatePicker && statePickerGeoJSON ? (
        <Source id="us-states-picker" key={`sp-${statePickerKey}`} type="geojson" data={statePickerGeoJSON} promoteId="state_fips">
          <Layer
            id="state-fill"
            type="fill"
            beforeId={basemapLabelBeforeId}
            paint={{
              "fill-color": [
                "case",
                ["==", ["get", "nh_has_data"], true],
                "#d4896e",
                "#e8dfd6",
              ],
              "fill-opacity": ["case", ["==", ["get", "nh_has_data"], true], 0.45, 0.18],
            }}
          />
          <Layer
            id="state-outline"
            type="line"
            beforeId={basemapLabelBeforeId}
            paint={{
              "line-color": "#2c1810",
              "line-width": 0.65,
              "line-opacity": 0.35,
            }}
          />
        </Source>
      ) : null}
      {hasTracts && data ? (
        <Source id="tracts" key={`tract-src-${boundsKey}`} type="geojson" data={data} promoteId="geoid">
          <Layer id="tract-fill" type="fill" beforeId={basemapLabelBeforeId} paint={fillPaint as never} />
          <Layer id="tract-outline" type="line" beforeId={basemapLabelBeforeId} paint={linePaint as never} />
        </Source>
      ) : null}
    </Map>
  );

  if (variant === "explore") {
    /* Fill parent flex height; avoid raw 100vh so bottom UI (compare tray) does not clip the map/hover card. */
    const leftChrome = exploreLayerTabs ?? layerPanel;
    const rightLegend =
      showStatePicker && !hasTracts
        ? statePickerLegend
        : hasTracts && choroplethStyle === "bivariate" && !suppressBuiltInBivariateLegend
          ? bivariateLegend
          : hasTracts && choroplethStyle === "ramp"
            ? legend
            : null;
    return (
      <div className="relative isolate h-full min-h-[220px] w-full flex-1 overflow-hidden rounded-xl border border-nh-brown/10 bg-nh-sand/40 shadow-inner sm:min-h-[260px]">
        {leftChrome ? (
          <div className="pointer-events-none absolute left-3 top-3 z-10 max-h-[70vh] overflow-y-auto">
            <div className="pointer-events-auto flex flex-col gap-2">{leftChrome}</div>
          </div>
        ) : null}
        {rightLegend ? (
          <div className="pointer-events-none absolute right-3 top-3 z-10">
            <div className="pointer-events-auto">{rightLegend}</div>
          </div>
        ) : null}
        {hoverLegend}
        <div className="absolute inset-0 z-0">{mapEl}</div>
      </div>
    );
  }

  return (
    <div className="flex h-[min(720px,80vh)] flex-col gap-3 lg:flex-row">
      <div className="flex w-full flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm lg:max-w-xs">
        <div>
          <label className="text-xs font-medium uppercase text-slate-500">Map color</label>
          <select
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            value={colorBy}
            onChange={(e) => setColorBy(e.target.value)}
          >
            {METRICS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-slate-500">
          Choose a single metric to color tracts. Tract outlines stay on; the color ramp matches the selected field.
        </p>
      </div>
      <div className="relative min-h-[420px] flex-1 overflow-hidden rounded-lg border border-slate-200 shadow-inner">
        {hoverLegend}
        {mapEl}
      </div>
    </div>
  );
}

export const NeighborMap = memo(NeighborMapInner);
