"use client";

import { useMemo } from "react";
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
import type { TractScorePoint } from "@/lib/api";
import { LINE_COLORS } from "@/lib/compareColors";

type TractTrendSeries = {
  geoid: string;
  label: string;
  trend: TractScorePoint[] | null;
};

export function CompareTrendChart({ series }: { series: TractTrendSeries[] }) {
  const { chartData, lines, unavailable } = useMemo(() => {
    const available = series.filter((s) => s.trend && s.trend.length > 0);
    const unavailableList = series.filter((s) => !s.trend || s.trend.length === 0);
    const years = new Set<number>();
    for (const s of available) {
      for (const p of s.trend!) years.add(p.year);
    }
    const sortedYears = Array.from(years).sort((a, b) => a - b);
    const data = sortedYears.map((year) => {
      const row: Record<string, number | string> = { year };
      for (const s of available) {
        const pt = s.trend!.find((t) => t.year === year);
        if (pt) row[s.geoid] = pt.composite_score;
      }
      return row;
    });
    const lineDefs = available.map((s, i) => ({
      geoid: s.geoid,
      label: s.label,
      color: LINE_COLORS[i % LINE_COLORS.length],
    }));
    return { chartData: data, lines: lineDefs, unavailable: unavailableList };
  }, [series]);

  if (!lines.length && unavailable.length === series.length) {
    return (
      <p className="px-4 py-6 text-sm text-nh-brown-muted">Trend data is not available for the selected tracts.</p>
    );
  }

  return (
    <div className="space-y-4 px-4 pb-4 pt-2">
      {lines.length > 0 ? (
        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ebe6df" />
              <XAxis dataKey="year" tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} width={36} />
              <Tooltip
                formatter={(value: number) => [Math.round(value), "Composite score"]}
                labelFormatter={(year) => `Year ${year}`}
              />
              <Legend />
              {lines.map((ln) => (
                <Line
                  key={ln.geoid}
                  type="monotone"
                  dataKey={ln.geoid}
                  name={ln.label}
                  stroke={ln.color}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : null}
      {unavailable.length > 0 ? (
        <ul className="space-y-1 text-xs text-nh-brown-muted">
          {unavailable.map((s) => (
            <li key={s.geoid}>
              <span className="font-medium text-nh-brown">{s.label}</span>: trend data not available.
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
