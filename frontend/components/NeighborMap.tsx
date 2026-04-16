"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useMemo, useState } from "react";
import Map, { Layer, Source } from "react-map-gl/maplibre";
import type { MapLayerMouseEvent } from "maplibre-gl";

/** Default vector style (no API key). Override with NEXT_PUBLIC_MAP_STYLE_URL. */
export const DEFAULT_MAP_STYLE = "https://demotiles.maplibre.org/style.json";

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

type Props = {
  /** When null, map shows the continental US overview with no tract layer. */
  stateFips: string | null;
  /** When null or empty, no tract choropleth is drawn (overview mode). */
  data: GeoJSON.FeatureCollection | null;
  mapStyle?: string;
  onSelectTract?: (geoid: string) => void;
  /** Full controls on left vs compact overlay (explore dashboard) */
  variant?: "default" | "explore";
};

export function NeighborMap({ stateFips, data, mapStyle, onSelectTract, variant = "default" }: Props) {
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

  const fillOpacity = visible[colorBy] === false ? 0 : 0.75;

  const fillPaint = useMemo(() => {
    const key = colorBy;
    return {
      "fill-color": [
        "interpolate",
        ["linear"],
        ["coalesce", ["get", key], 0],
        0,
        "#ccfbf1",
        25,
        "#5eead4",
        50,
        "#14b8a6",
        75,
        "#0f766e",
        100,
        "#134e4a",
      ],
      "fill-opacity": fillOpacity,
    };
  }, [colorBy, fillOpacity]);

  const linePaint = useMemo(
    () =>
      ({
        "line-color": "#0f2940",
        "line-width": visible.boundaries ? 0.35 : 0,
        "line-opacity": 0.35,
      }) as const,
    [visible]
  );

  const onClick = useCallback(
    (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      const geoid = f?.properties?.geoid as string | undefined;
      if (geoid) onSelectTract?.(geoid);
    },
    [onSelectTract]
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
  const hasTracts = Boolean(data?.features?.length);

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

  const legend = (
    <div className="rounded-lg border border-slate-200 bg-white/95 px-3 py-2 shadow-md backdrop-blur-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Risk score</p>
      <div className="mt-2 h-3 w-36 rounded-full bg-gradient-to-r from-teal-100 via-teal-400 to-teal-900" />
      <div className="mt-1 flex justify-between text-[10px] text-slate-500">
        <span>Low</span>
        <span>High</span>
      </div>
    </div>
  );

  const mapEl = (
    <Map
      key={stateFips ?? "us"}
      style={{ width: "100%", height: "100%" }}
      initialViewState={{ longitude: center[0], latitude: center[1], zoom }}
      mapStyle={styleUrl}
      interactiveLayerIds={hasTracts ? ["tract-fill"] : []}
      onClick={onClick}
    >
      {hasTracts && data ? (
        <Source id="tracts" type="geojson" data={data}>
          <Layer id="tract-fill" type="fill" paint={fillPaint as never} />
          <Layer id="tract-outline" type="line" paint={linePaint as never} />
        </Source>
      ) : null}
    </Map>
  );

  if (variant === "explore") {
    return (
      <div className="relative h-full min-h-[560px] w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100 shadow-inner">
        <div className="absolute left-3 top-3 z-10 max-h-[70vh] overflow-y-auto">{layerPanel}</div>
        <div className="absolute right-3 top-3 z-10">{legend}</div>
        <div className="h-full w-full">{mapEl}</div>
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
        {mapEl}
      </div>
    </div>
  );
}
