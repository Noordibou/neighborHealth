"use client";

import Link from "next/link";
import type { TractDetail } from "@/lib/api";
import { METRIC_LABELS } from "@/lib/metricDisplay";

const SIDEBAR_METRIC_KEYS = [
  "rent_burden_pct",
  "overcrowding_pct",
  "uninsured_pct",
  "asthma_pct",
  "mental_health_pct",
] as const;

const SIDEBAR_METRICS = SIDEBAR_METRIC_KEYS.map((k) => ({
  metric_name: k,
  label: METRIC_LABELS[k],
}));

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

export function TractDetailPanel({
  tract,
  isInCompare,
  compareDisabled,
  onAddToCompare,
}: {
  tract: TractDetail | null;
  isInCompare: boolean;
  compareDisabled: boolean;
  onAddToCompare: () => void;
  onRemoveFromCompare?: () => void;
}) {
  if (!tract) return null;

  return (
    <div className="rounded-2xl border border-[#e8e3dc] bg-[#f9f7f2] p-4 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8e8e8e]">Selected tract</p>
      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-xl font-bold leading-tight text-[#2d2d2d]">
            {tract.name ?? `Tract ${tract.geoid}`}
          </h3>
          <p className="mt-1 text-sm text-[#6b6560]">
            <span className="font-mono text-[13px]">{tract.geoid}</span>
            <span className="text-[#c4bcb4]"> · </span>
            {tract.place_name ?? tract.county_name ?? "—"}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8e8e8e]">Index</p>
          <p className="font-display text-[2.75rem] font-bold leading-none text-[#c4a574]">
            {tract.risk_score?.composite_score != null
              ? Math.round(tract.risk_score.composite_score)
              : "—"}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Link
          href={`/tract/${tract.geoid}`}
          className="flex min-w-0 flex-1 basis-[calc(50%-0.25rem)] items-center justify-center rounded-full bg-[#b34d3a] px-4 py-2.5 text-center text-sm font-semibold text-white shadow-sm hover:bg-[#9a4131]"
        >
          View profile →
        </Link>
        <button
          type="button"
          onClick={onAddToCompare}
          disabled={isInCompare || compareDisabled}
          className={`flex min-w-0 flex-1 basis-[calc(50%-0.25rem)] items-center justify-center rounded-full border-2 px-4 py-2.5 text-sm font-semibold shadow-sm transition disabled:opacity-40 ${
            isInCompare
              ? "border-[#b34d3a] bg-white text-[#b34d3a]"
              : "border-[#d6cfc7] bg-white text-[#2d2d2d] hover:border-[#b34d3a]/40"
          }`}
        >
          {isInCompare ? "✓ In compare" : "+ Compare"}
        </button>
      </div>

      <div className="mt-6 space-y-4">
        {SIDEBAR_METRICS.map(({ metric_name, label }) => {
          const v = indicatorValue(tract.indicators, metric_name);
          const pct = v != null ? Math.min(100, Math.max(0, v)) : null;
          const indRow = tract.indicators.find((i) => i.metric_name === metric_name);
          const pCounty = indRow?.percentile_county;
          const pState = indRow?.percentile_state;
          const useCounty = pCounty != null && Number.isFinite(pCounty);
          const markerPos = useCounty
            ? Math.min(100, Math.max(0, pCounty))
            : pState != null && Number.isFinite(pState)
              ? Math.min(100, Math.max(0, pState))
              : 50;
          const markerTitle = useCounty
            ? "County median (percentile rank among tracts in this county)"
            : pState != null && Number.isFinite(pState)
              ? "State median (percentile rank among tracts in this state)"
              : "Peer median position unavailable";
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
                  className="pointer-events-none absolute top-0 z-[1] h-full w-px -translate-x-1/2 border-l border-dashed border-[#9ca3af]"
                  style={{ left: `${markerPos}%` }}
                  title={markerTitle}
                  aria-hidden
                />
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-5 border-t border-[#e8e3dc] pt-3 text-[10px] leading-snug text-[#8e8e8e]">
        <span className="inline-block translate-y-px border-l border-dashed border-[#9ca3af] pl-1">
          Dashed line = county median percentile vs peers in the same county when enough tracts; otherwise state
          median percentile.
        </span>
      </p>
    </div>
  );
}
