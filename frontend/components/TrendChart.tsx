"use client";

import { getTractTrend } from "@/lib/api";
import { useEffect, useState } from "react";
import type { TractScorePoint, TrendChartProps } from "@/types";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TooltipProps } from "recharts";

const TREND_STROKE = "#c45c3e";

// ─── Pure helpers (exported for testing) ────────────────────────────────────

/** Returns the last n items from trend sorted ascending by year. */
export function filterToLastNYears(
  trend: TractScorePoint[],
  n: number
): TractScorePoint[] {
  return [...trend].sort((a, b) => a.year - b.year).slice(-n);
}

/** Auto-scaled [min, max] domain with padding so small changes are visible. */
export function computeYAxisDomain(trend: TractScorePoint[]): [number, number] {
  if (!trend.length) return [0, 100];
  const scores = trend.map((t) => t.composite_score);
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const padding = Math.max(5, (maxScore - minScore) * 0.3);
  return [
    Math.max(0, Math.floor(minScore - padding)),
    Math.min(100, Math.ceil(maxScore + padding)),
  ];
}

/** Change between first and last year in the displayed series (positive = more burden). */
export function computeScoreChange(trend: TractScorePoint[]): number | null {
  if (trend.length < 2) return null;
  const sorted = [...trend].sort((a, b) => a.year - b.year);
  return sorted[sorted.length - 1].composite_score - sorted[0].composite_score;
}

// ─── Tooltip ────────────────────────────────────────────────────────────────

type TrendTooltipProps = TooltipProps<number, string> & {
  payload?: { payload: TractScorePoint }[];
};

function TrendTooltip({ active, payload }: TrendTooltipProps) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-nh-brown/15 bg-white px-3 py-2 text-xs shadow-md">
      <p className="font-semibold tabular-nums text-nh-brown">
        {p.year}: {Math.round(p.composite_score)}
      </p>
      {p.data_quality_note ? (
        <p className="mt-1 max-w-[14rem] leading-snug text-nh-brown-muted">{p.data_quality_note}</p>
      ) : null}
    </div>
  );
}

// ─── Dot ────────────────────────────────────────────────────────────────────

type DotProps = {
  cx?: number;
  cy?: number;
  stroke?: string;
  payload?: TractScorePoint;
};

/** Exported for tests: renders hollow circle when payload has data_quality_note. */
export function TrendDot(props: DotProps) {
  const { cx, cy, stroke, payload } = props;
  if (cx == null || cy == null || !payload) return null;
  const s = stroke ?? TREND_STROKE;
  const r = 3;
  if (payload.data_quality_note) {
    return <circle cx={cx} cy={cy} r={r} fill="none" stroke={s} strokeWidth={2} />;
  }
  return <circle cx={cx} cy={cy} r={r} fill={s} />;
}

// ─── Chart ──────────────────────────────────────────────────────────────────

export function TrendChart({ geoid, has_trend }: TrendChartProps) {
  const [loading, setLoading] = useState(has_trend);
  const [series, setSeries] = useState<TractScorePoint[] | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!has_trend) {
      setLoading(false);
      setSeries(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setSeries(null);

    void (async () => {
      try {
        const json = await getTractTrend(geoid);
        if (cancelled) return;
        setSeries(json.trend);
      } catch {
        if (!cancelled) setSeries(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [geoid, has_trend]);

  if (!has_trend) return null;

  if (loading) {
    return <div className="h-[60px] w-full animate-pulse rounded-md bg-nh-sand" aria-hidden />;
  }

  if (!series?.length) return null;

  const allSorted = [...series].sort((a, b) => a.year - b.year);
  const displayed = showAll ? allSorted : filterToLastNYears(allSorted, 3);

  const yAxisDomain = computeYAxisDomain(displayed);
  const scoreChange = computeScoreChange(displayed);
  const absChange = scoreChange != null ? Math.abs(scoreChange) : 0;
  const hasSignificantChange = scoreChange != null && absChange >= 5;

  const firstYear = displayed[0].year;
  const lastYear = displayed[displayed.length - 1].year;
  const canToggle = allSorted.length > 3;
  const hasFlagged = displayed.some((d) => d.data_quality_note);
  const shows2020Note = showAll && allSorted.some((d) => d.year === 2020);

  const smallChangeTitle =
    scoreChange != null && !hasSignificantChange
      ? "Score changed less than 5 points — change may reflect estimate variance rather than real conditions change."
      : undefined;

  return (
    <div className="w-full">
      {hasSignificantChange && scoreChange != null && (
        <div className="mb-1">
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
              scoreChange > 0 ? "bg-red-50 text-red-600" : "bg-green-50 text-green-700"
            }`}
          >
            {scoreChange > 0 ? "↑" : "↓"} {Math.round(absChange)} pts
          </span>
        </div>
      )}

      <div className="h-[72px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={displayed} margin={{ top: 6, right: 8, left: 4, bottom: 2 }}>
            <XAxis
              dataKey="year"
              type="number"
              domain={["dataMin", "dataMax"]}
              ticks={displayed.map((d) => d.year)}
              tick={{ fontSize: 10, fill: "#5c4033" }}
              tickFormatter={(v) => String(Math.round(Number(v)))}
              axisLine={false}
              tickLine={false}
            />
            <YAxis domain={yAxisDomain} hide />
            <Tooltip content={<TrendTooltip />} cursor={false} wrapperStyle={{ outline: "none" }} />
            <Line
              type="monotone"
              dataKey="composite_score"
              stroke={TREND_STROKE}
              strokeWidth={2}
              dot={(dotProps) => <TrendDot {...dotProps} />}
              activeDot={(props: DotProps) => {
                const { cx, cy, stroke, payload } = props;
                if (cx == null || cy == null || !payload) return null;
                const s = stroke ?? TREND_STROKE;
                const r = 4;
                if (payload.data_quality_note) {
                  return <circle cx={cx} cy={cy} r={r} fill="none" stroke={s} strokeWidth={2} />;
                }
                return <circle cx={cx} cy={cy} r={r} fill={s} stroke="#fff" strokeWidth={1} />;
              }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p
        className="mt-1.5 text-xs leading-relaxed text-nh-brown-muted"
        title={smallChangeTitle}
      >
        Composite score trend · {firstYear}–{lastYear} · ACS 5-year estimates
        {hasFlagged ? " · ○ indicates elevated uncertainty (2020)" : null}
      </p>

      <p className="text-[10px] text-nh-brown-muted/60">Y-axis scaled to this tract&apos;s range</p>

      {shows2020Note && (
        <p className="mt-1 text-[10px] leading-snug text-nh-brown-muted">
          2020 ACS data has elevated uncertainty due to COVID-19 collection disruptions.
        </p>
      )}

      {canToggle && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-1.5 text-[10px] text-nh-brown-muted/70 underline hover:text-nh-brown-muted"
        >
          {showAll ? "Show less" : "Show from 2020"}
        </button>
      )}
    </div>
  );
}
