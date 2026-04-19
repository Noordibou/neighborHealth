"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map, { Layer, Source, type MapRef } from "react-map-gl/maplibre";
import type { Map as MapLibreMap, MapLayerMouseEvent } from "maplibre-gl";

/**
 * Vector basemap (roads, labels, landcover) without an API key.
 * Carto CDN (`basemaps.cartocdn.com`) can hit ERR_SSL_PROTOCOL_ERROR on some networks; this host is a reliable default.
 * Override with NEXT_PUBLIC_MAP_STYLE_URL (e.g. Carto Voyager) if your environment loads it fine.
 */
export const DEFAULT_MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

const METRICS = [
  { id: "composite_score", label: "Composite risk" },
  { id: "rent_burden_pct", label: "Rent burden (30%+)" },
  { id: "overcrowding_pct", label: "Overcrowding" },
  { id: "vacancy_rate", label: "Vacancy rate" },
  { id: "uninsured_pct", label: "Uninsured (access)" },
  { id: "asthma_pct", label: "Asthma prevalence" },
  { id: "disability_pct", label: "Disability" },
  { id: "heat_index", label: "Heat index (proxy)" },
] as const;

/** Census state FIPS (2 digits) → USPS postal abbreviation */
const US_STATE_FIPS_TO_POSTAL: Record<string, string> = {
  "01": "AL",
  "02": "AK",
  "04": "AZ",
  "05": "AR",
  "06": "CA",
  "08": "CO",
  "09": "CT",
  "10": "DE",
  "11": "DC",
  "12": "FL",
  "13": "GA",
  "15": "HI",
  "16": "ID",
  "17": "IL",
  "18": "IN",
  "19": "IA",
  "20": "KS",
  "21": "KY",
  "22": "LA",
  "23": "ME",
  "24": "MD",
  "25": "MA",
  "26": "MI",
  "27": "MN",
  "28": "MS",
  "29": "MO",
  "30": "MT",
  "31": "NE",
  "32": "NV",
  "33": "NH",
  "34": "NJ",
  "35": "NM",
  "36": "NY",
  "37": "NC",
  "38": "ND",
  "39": "OH",
  "40": "OK",
  "41": "OR",
  "42": "PA",
  "44": "RI",
  "45": "SC",
  "46": "SD",
  "47": "TN",
  "48": "TX",
  "49": "UT",
  "50": "VT",
  "51": "VA",
  "53": "WA",
  "54": "WV",
  "55": "WI",
  "56": "WY",
};

function statePostalFromFips(fips: string | null | undefined): string | null {
  if (fips == null || typeof fips !== "string") return null;
  const k = fips.padStart(2, "0").slice(0, 2);
  return US_STATE_FIPS_TO_POSTAL[k] ?? null;
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
const NO_DATA_CHOROPLETH_FILL = "#fed7aa";

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
  const pctLike = key === "composite_score" || key.endsWith("_pct");
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
  if (key === "composite_score" && span < 14) {
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
  let lo = min - pad;
  let hi = max + pad;
  if (pctLike) return clampPctDomain(lo, hi);
  return { lo, hi };
}

/** MapLibre expression: true when the choropleth field is missing or null (no modeled value). */
function choroplethNoDataExpr(key: string): unknown[] {
  return ["any", ["!", ["has", key]], ["==", ["get", key], ["literal", null]]];
}

/** Five-stop ramp: very light → sky → teal → deep teal → near-black (strong luminance spread). */
const CHORO_STOP_FRACS = [0, 0.22, 0.48, 0.74, 1] as const;
const CHORO_COLORS = ["#d5f2ef", "#4ecfc2", "#178f83", "#0f766e", "#020617"] as const;

function buildChoroplethColorStops(lo: number, hi: number): (number | string)[] {
  const span = hi - lo;
  const out: (number | string)[] = [];
  for (let i = 0; i < CHORO_STOP_FRACS.length; i++) {
    out.push(lo + span * CHORO_STOP_FRACS[i], CHORO_COLORS[i]);
  }
  return out;
}

export function NeighborMap({
  stateFips,
  data,
  mapStyle,
  onSelectTract,
  variant = "default",
  fitBoundsToData = false,
  zoomToResultsKey = 0,
}: Props) {
  const mapRef = useRef<MapRef>(null);
  const styleUrl = mapStyle ?? process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? DEFAULT_MAP_STYLE;

  const [colorBy, setColorBy] = useState<string>("composite_score");
  const [visible, setVisible] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {};
    METRICS.forEach((m) => {
      o[m.id] = true;
    });
    o.boundaries = true;
    return o;
  });
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const hoveredGeoidRef = useRef<string | null>(null);
  const hasTracts = Boolean(data?.features?.length);

  const fillOpacity = visible[colorBy] === false ? 0 : 0.78;
  const fillOpacityHover = fillOpacity > 0 ? Math.min(0.95, fillOpacity + 0.08) : 0.62;

  const choroplethRange = useMemo(
    () => (data?.features?.length ? numericPropertyRange(data, colorBy) : null),
    [data, colorBy]
  );

  const colorDomain = useMemo(
    () => choroplethDomain(choroplethRange, colorBy),
    [choroplethRange, colorBy]
  );

  const colorStops = useMemo(
    () => buildChoroplethColorStops(colorDomain.lo, colorDomain.hi),
    [colorDomain.lo, colorDomain.hi]
  );

  const fillPaint = useMemo(() => {
    const key = colorBy;
    const noData = choroplethNoDataExpr(key);
    const ramp: unknown[] = [
      "interpolate",
      ["linear"],
      ["to-number", ["get", key]],
      ...colorStops,
    ];
    const fillColor: unknown[] = ["case", noData, NO_DATA_CHOROPLETH_FILL, ramp];
    const fillOpacityExpr: unknown =
      fillOpacity === 0
        ? ["literal", 0]
        : [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            fillOpacityHover,
            ["literal", fillOpacity],
          ];
    return {
      "fill-color": fillColor,
      "fill-opacity": fillOpacityExpr,
    };
  }, [colorBy, colorStops, fillOpacity, fillOpacityHover]);

  const lineWidthBase = visible.boundaries ? 0.45 : 0;
  const linePaint = useMemo(() => {
    const key = colorBy;
    const noData = choroplethNoDataExpr(key);
    return {
      "line-color": ["case", noData, "#fb923c", "#042f2e"],
      "line-width": [
        "case",
        ["boolean", ["feature-state", "hover"], false],
        2.75,
        ["literal", lineWidthBase],
      ],
      "line-opacity": [
        "case",
        ["boolean", ["feature-state", "hover"], false],
        0.95,
        ["case", noData, 0.38, 0.42],
      ],
    };
  }, [lineWidthBase, colorBy]);

  const onClick = useCallback(
    (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      const geoid = f?.properties?.geoid as string | undefined;
      if (geoid) onSelectTract?.(geoid);
    },
    [onSelectTract]
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
      if (!hasTracts) return;
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
        setHoverInfo(propsToHover(props, colorBy));
      } else {
        canvas.style.cursor = "";
        clearHoverFeatureState(map);
        setHoverInfo(null);
      }
    },
    [hasTracts, clearHoverFeatureState, colorBy]
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
    if (stateFips == null) return [-98, 39] as [number, number];
    const c: Record<string, [number, number]> = {
      "06": [-119, 37],
      "12": [-81.5, 27.5],
      "17": [-89, 40],
      "36": [-75, 43],
      "48": [-99, 31],
    };
    return c[stateFips] ?? [-98, 39];
  }, [stateFips]);

  const zoom = stateFips == null ? 3.5 : stateFips === "06" ? 5.5 : 6;

  const boundsKey = useMemo(() => {
    if (!data?.features?.length) return "0";
    return `${data.features.length}-${data.features[0]?.properties?.geoid ?? ""}-${
      data.features[data.features.length - 1]?.properties?.geoid ?? ""
    }`;
  }, [data]);

  useEffect(() => {
    if (!fitBoundsToData || !data?.features?.length) return;
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
    const apply = () => {
      if (cancelled) return;
      const map = mapRef.current?.getMap();
      if (!map) return;
      try {
        map.resize();
        map.fitBounds(bounds, {
          padding: { top: 96, bottom: 56, left: 56, right: 56 },
          duration: 1100,
          maxZoom,
        });
      } catch {
        /* ignore fit errors for degenerate bounds */
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
        apply();
        map.once("idle", apply);
      };
      if (map.loaded()) kick();
      else map.once("load", kick);
    };
    raf = requestAnimationFrame(() => requestAnimationFrame(waitMap));
    const fallback = window.setTimeout(apply, 650);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(fallback);
    };
  }, [fitBoundsToData, data, boundsKey, zoomToResultsKey]);

  useEffect(() => {
    hoveredGeoidRef.current = null;
    setHoverInfo(null);
  }, [data, boundsKey]);

  const fmtPct = (v: number | null, digits = 0) =>
    v != null && Number.isFinite(v) ? `${digits ? v.toFixed(digits) : Math.round(v)}%` : "—";

  const hoverLegend =
    hoverInfo && hasTracts ? (() => {
      const { headline, subline } = formatHoverLocation(hoverInfo);
      const hasMetrics = hoverHasShownMetrics(hoverInfo);
      return (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 w-[min(94vw,26rem)] -translate-x-1/2">
          <div className="rounded-xl border border-slate-600/80 bg-[#0f2940]/95 px-4 py-3 text-left text-white shadow-xl backdrop-blur-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-teal-200/90">Area under cursor</p>
            <p className="mt-1 line-clamp-2 text-sm font-semibold leading-snug">{headline}</p>
            {subline ? (
              <p className="mt-0.5 line-clamp-3 text-xs leading-snug text-slate-300">{subline}</p>
            ) : null}
            <p className="mt-1 font-mono text-[11px] text-slate-400">GEOID {hoverInfo.geoid}</p>
            {hoverInfo.missingActiveChoropleth ? (
              <p className="mt-2 rounded-md border border-orange-400/55 bg-orange-900/75 px-2 py-1.5 text-[11px] leading-snug text-orange-100">
                <span className="font-semibold text-orange-200">Map fill:</span> light{" "}
                <strong className="text-orange-200">orange</strong> means no value for{" "}
                <strong>{METRICS.find((m) => m.id === colorBy)?.label ?? "this metric"}</strong> on this tract (see
                legend on the map).
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
                <dd className="font-medium text-teal-100">
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

  const layerPanel = (
    <div className="rounded-lg border border-slate-200 bg-white/95 p-3 shadow-md backdrop-blur-sm">
      <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Choropleth</label>
      <select
        className="mt-1 w-full max-w-[200px] rounded border border-slate-300 px-2 py-1.5 text-xs"
        value={colorBy}
        onChange={(e) => setColorBy(e.target.value)}
      >
        {METRICS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
      <div className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-xs">
        {METRICS.slice(0, 5).map((m) => (
          <label key={m.id} className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={visible[m.id] !== false}
              onChange={(e) => setVisible((v) => ({ ...v, [m.id]: e.target.checked }))}
            />
            <span className="truncate">{m.label}</span>
          </label>
        ))}
        <label className="flex cursor-pointer items-center gap-2 border-t border-slate-100 pt-1">
          <input
            type="checkbox"
            checked={visible.boundaries !== false}
            onChange={(e) => setVisible((v) => ({ ...v, boundaries: e.target.checked }))}
          />
          <span>Boundaries</span>
        </label>
      </div>
    </div>
  );

  const legendMetricLabel = METRICS.find((m) => m.id === colorBy)?.label ?? "Choropleth";
  const legendScaleHint =
    choroplethRange != null
      ? `Teal ramp spans ~${Math.round(colorDomain.lo)}–${Math.round(colorDomain.hi)} on tracts shown here so similar values read as different shades.`
      : "No numeric values found for this metric on the current layer.";

  const legend = (
    <div className="rounded-lg border border-slate-200 bg-white/95 px-3 py-2 shadow-md backdrop-blur-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{legendMetricLabel}</p>
      <div
        className="mt-2 h-3 w-36 rounded-full shadow-inner ring-1 ring-slate-200/80"
        style={{
          background: `linear-gradient(to right, ${CHORO_COLORS.join(", ")})`,
        }}
      />
      <div className="mt-1 flex justify-between text-[10px] text-slate-500">
        <span>Lower</span>
        <span>Higher</span>
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
      <p className="mt-1.5 max-w-[11rem] text-[9px] leading-snug text-slate-500">{legendScaleHint}</p>
    </div>
  );

  const mapEl = (
    <Map
      ref={mapRef}
      key={fitBoundsToData ? "explore-search" : `explore-${stateFips ?? "us"}`}
      style={{ width: "100%", height: "100%" }}
      initialViewState={{ longitude: center[0], latitude: center[1], zoom }}
      mapStyle={styleUrl}
      interactiveLayerIds={hasTracts ? ["tract-fill"] : []}
      onClick={onClick}
      onMouseMove={hasTracts ? onMouseMove : undefined}
      onMouseLeave={hasTracts ? onMouseLeave : undefined}
    >
      {hasTracts && data ? (
        <Source id="tracts" key={`tract-src-${boundsKey}`} type="geojson" data={data} promoteId="geoid">
          <Layer id="tract-fill" type="fill" paint={fillPaint as never} />
          <Layer id="tract-outline" type="line" paint={linePaint as never} />
        </Source>
      ) : null}
    </Map>
  );

  if (variant === "explore") {
    /* Explicit height: parent `h-full` + `lg:min-h-0` often collapses to 0 on flex layouts, which hides the map canvas. */
    return (
      <div className="relative isolate h-[560px] w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100 shadow-inner sm:h-[64vh] lg:h-[calc(100vh-5rem)]">
        <div className="pointer-events-none absolute left-3 top-3 z-10 max-h-[70vh] overflow-y-auto">
          <div className="pointer-events-auto">{layerPanel}</div>
        </div>
        <div className="pointer-events-none absolute right-3 top-3 z-10">
          <div className="pointer-events-auto">{legend}</div>
        </div>
        {hoverLegend}
        <div className="absolute inset-0 z-0">{mapEl}</div>
      </div>
    );
  }

  return (
    <div className="flex h-[min(720px,80vh)] flex-col gap-3 lg:flex-row">
      <div className="flex w-full flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm lg:max-w-xs">
        <div>
          <label className="text-xs font-medium uppercase text-slate-500">Choropleth</label>
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
          Choose which field drives the color scale. Toggles hide the fill when that metric is selected for
          choropleth.
        </p>
        <div className="grid grid-cols-1 gap-1 text-sm">
          {METRICS.map((m) => (
            <label key={m.id} className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={visible[m.id] !== false}
                onChange={(e) => setVisible((v) => ({ ...v, [m.id]: e.target.checked }))}
              />
              <span>{m.label}</span>
            </label>
          ))}
          <label className="flex cursor-pointer items-center gap-2 border-t border-slate-100 pt-2">
            <input
              type="checkbox"
              checked={visible.boundaries !== false}
              onChange={(e) => setVisible((v) => ({ ...v, boundaries: e.target.checked }))}
            />
            <span>Boundaries</span>
          </label>
        </div>
      </div>
      <div className="relative min-h-[420px] flex-1 overflow-hidden rounded-lg border border-slate-200 shadow-inner">
        {hoverLegend}
        {mapEl}
      </div>
    </div>
  );
}
