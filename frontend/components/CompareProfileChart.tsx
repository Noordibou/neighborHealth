"use client";

import { useCallback } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipContentProps } from "recharts";
import { METRIC_LABELS, formatMetricValue } from "@/lib/metricDisplay";
import { METRIC_KEYS } from "@/lib/riskScore";
import type { MetricKey } from "@/lib/riskScore";
import type { IndicatorRow } from "@/lib/api";
import { LINE_COLORS } from "@/lib/compareColors";

function ordinalSuffix(n: number): string {
  if (11 <= (n % 100) && (n % 100) <= 13) return "th";
  return ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
}

function nationalPercentilePhrase(p: number | null | undefined): string {
  if (p == null || Number.isNaN(p)) return "National rank unavailable";
  const n = Math.round(p);
  return `${n}${ordinalSuffix(n)} nationally`;
}

type SeriesRow = Record<string, string | number>;

type Props = {
  lineData: SeriesRow[];
  series: SeriesRow[];
  raw_indicators: Record<string, IndicatorRow[]>;
};

export default function CompareProfileChart({ lineData, series, raw_indicators }: Props) {
  const tooltipContent = useCallback(
    (props: TooltipContentProps) => {
      const { active, payload } = props;
      if (!active || !payload?.length) return null;
      const row0 = payload[0]?.payload;
      const mk = row0?.metricKey as MetricKey | undefined;
      if (!mk || !(METRIC_KEYS as readonly string[]).includes(mk)) return null;
      const metricName = METRIC_LABELS[mk];
      return (
        <div
          className="max-w-[260px] rounded-xl border border-[#e8dfd4] bg-white px-3 py-2 text-xs text-nh-brown shadow-sm"
          style={{ borderRadius: 12 }}
        >
          <p className="font-semibold text-nh-brown">{metricName}</p>
          <ul className="mt-2 space-y-2 text-nh-brown-muted">
            {payload
              .filter((entry) => entry.dataKey != null && String(entry.dataKey).length > 0)
              .map((entry) => {
                const gid = String(entry.dataKey);
                const tract = series.find((s) => String(s.geoid) === gid);
                const tname = tract ? String(tract.label ?? tract.geoid) : gid;
                const ind = raw_indicators[gid]?.find((i) => i.metric_name === mk);
                const rawTxt = ind?.value != null ? formatMetricValue(mk, ind.value) : "—";
                const natTxt = nationalPercentilePhrase(ind?.percentile_national ?? null);
                return (
                  <li key={gid} className="leading-snug">
                    <span className="font-medium text-nh-brown">{tname}</span>
                    <div className="mt-0.5">
                      <span className="text-nh-brown">{rawTxt}</span>
                      <span className="text-nh-brown-muted"> · {natTxt}</span>
                    </div>
                  </li>
                );
              })}
          </ul>
        </div>
      );
    },
    [series, raw_indicators]
  );

  return (
    <div className="mt-10">
      <div className="rounded-2xl border border-nh-brown/10 bg-white p-4 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-nh-brown-muted">Profile shape</p>
        <p className="text-[11px] text-nh-brown-muted">
          Each line = one tract; bar position = national percentile rank. Hover a point for raw value and
          national rank.
        </p>
        <div className="mt-2 h-[360px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={lineData} margin={{ top: 8, right: 8, left: 0, bottom: 56 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e8dfd4" />
              <XAxis
                dataKey="metric"
                tick={{ fontSize: 9, fill: "#5c4033" }}
                interval={0}
                angle={-35}
                textAnchor="end"
                height={78}
              />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#5c4033" }} width={32} />
              <Tooltip
                content={tooltipContent}
                cursor={{ stroke: "#e8dfd4", strokeWidth: 1 }}
                wrapperStyle={{ outline: "none" }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {series.map((s, i) => (
                <Line
                  key={String(s.geoid)}
                  type="monotone"
                  dataKey={String(s.geoid)}
                  name={String(s.label ?? s.geoid)}
                  stroke={LINE_COLORS[i % LINE_COLORS.length]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
