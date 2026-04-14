"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { SiteFooter } from "@/components/SiteFooter";
import { getCompare, type IndicatorRow } from "@/lib/api";
import { METRIC_KEYS } from "@/lib/riskScore";
import { METRIC_LABELS, formatMetricValue } from "@/lib/metricDisplay";
import type { MetricKey } from "@/lib/riskScore";

const RADAR_COLORS = ["#15803d", "#ea580c", "#2563eb", "#7c3aed"];

const LABELS: Record<string, string> = Object.fromEntries(
  METRIC_KEYS.map((k) => [k, METRIC_LABELS[k as MetricKey]])
) as Record<string, string>;

function compositeBadge(series: Record<string, number | string>): number | null {
  const nums = METRIC_KEYS.map((k) => series[k]).filter((v): v is number => typeof v === "number");
  if (!nums.length) return null;
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  return Math.round(avg);
}

function rawFor(geoid: string, metric: string, raw: Record<string, IndicatorRow[]> | undefined): IndicatorRow | undefined {
  return raw?.[geoid]?.find((i) => i.metric_name === metric);
}

function cellTone(metric: string, value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "bg-slate-50 text-slate-700";
  if (metric === "heat_index") {
    if (value >= 75) return "bg-red-100 text-red-900";
    if (value >= 55) return "bg-amber-100 text-amber-900";
    return "bg-emerald-100 text-emerald-900";
  }
  if (value >= 45) return "bg-red-100 text-red-900";
  if (value >= 25) return "bg-amber-100 text-amber-900";
  return "bg-emerald-100 text-emerald-900";
}

function CompareInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const raw = sp.get("geoids") ?? "";
  const geoids = useMemo(() => raw.split(",").map((g) => g.trim()).filter(Boolean), [raw]);
  const [data, setData] = useState<Awaited<ReturnType<typeof getCompare>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [addInput, setAddInput] = useState("");

  useEffect(() => {
    if (geoids.length < 2) {
      setData(null);
      setErr(null);
      return;
    }
    setErr(null);
    getCompare(geoids)
      .then(setData)
      .catch((e: Error) => {
        setErr(e.message);
        setData(null);
      });
  }, [geoids]);

  const chartData = useMemo(() => {
    if (!data) return [];
    return METRIC_KEYS.map((k) => {
      const row: Record<string, string | number> = { metric: LABELS[k] ?? k };
      data.series.forEach((s) => {
        const id = String(s.geoid);
        const v = s[k];
        if (typeof v === "number") row[id] = v;
      });
      return row;
    });
  }, [data]);

  function setGeoids(next: string[]) {
    const q = next.join(",");
    router.push(q ? `/compare?geoids=${encodeURIComponent(q)}` : `/compare`);
  }

  function removeGeoid(g: string) {
    setGeoids(geoids.filter((x) => x !== g));
  }

  function addGeoid() {
    const g = addInput.trim();
    if (!g || geoids.includes(g) || geoids.length >= 4) return;
    setGeoids([...geoids, g]);
    setAddInput("");
  }

  if (geoids.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <h1 className="text-2xl font-bold text-[#0f2940]">Compare tracts</h1>
        <p className="mt-2 text-slate-600">
          Add one or more census tract GEOIDs to your comparison. You need at least two tracts to load the chart and
          table.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <input
            className="min-w-[200px] flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm"
            placeholder="11-digit GEOID"
            value={addInput}
            onChange={(e) => setAddInput(e.target.value)}
          />
          <button
            type="button"
            onClick={() => addGeoid()}
            className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white"
          >
            Add tract
          </button>
        </div>
        <p className="mt-6">
          <Link href="/explore" className="font-medium text-teal-700 hover:underline">
            ← Explore map
          </Link>
        </p>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <Link href="/explore" className="text-sm font-medium text-teal-700 hover:underline">
          ← Explore map
        </Link>

        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-bold text-[#0f2940]">
            Comparing {geoids.length} {geoids.length === 1 ? "area" : "areas"}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="min-w-[160px] rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="Add GEOID"
              value={addInput}
              onChange={(e) => setAddInput(e.target.value)}
              disabled={geoids.length >= 4}
            />
            <button
              type="button"
              onClick={addGeoid}
              disabled={geoids.length >= 4}
              className="rounded-xl border-2 border-dashed border-teal-400 bg-teal-50/50 px-4 py-2 text-sm font-semibold text-teal-900 hover:bg-teal-100 disabled:opacity-50"
            >
              + Add another
            </button>
          </div>
        </div>

        {geoids.length === 1 && (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Add a second tract (use the field above) to see the radar chart and side-by-side metrics.
          </p>
        )}

        {err && geoids.length >= 2 && <p className="mt-4 text-sm text-red-600">{err}</p>}

        {data && geoids.length >= 2 && (
          <>
            <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50/50 p-4 shadow-sm">
              <div className="h-[420px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={chartData}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11 }} />
                    <Tooltip />
                    {data.series.map((s, i) => (
                      <Radar
                        key={String(s.geoid)}
                        name={String(s.label ?? s.geoid)}
                        dataKey={String(s.geoid)}
                        stroke={RADAR_COLORS[i % RADAR_COLORS.length]}
                        fill={RADAR_COLORS[i % RADAR_COLORS.length]}
                        fillOpacity={0.12}
                      />
                    ))}
                  </RadarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 flex flex-wrap justify-center gap-6 text-sm">
                {data.series.map((s, i) => (
                  <div key={String(s.geoid)} className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-sm"
                      style={{ backgroundColor: RADAR_COLORS[i % RADAR_COLORS.length] }}
                    />
                    <span className="text-slate-700">
                      {String(s.label ?? s.geoid)} — {String(s.geoid)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-10 overflow-x-auto rounded-2xl border border-slate-200 shadow-sm">
              <table className="min-w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-4 py-3 font-semibold text-slate-700">Indicator</th>
                    {data.series.map((s) => {
                      const badge = compositeBadge(s as Record<string, number | string>);
                      return (
                        <th key={String(s.geoid)} className="min-w-[180px] px-4 py-3">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-2">
                                {badge != null && (
                                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-red-50 text-sm font-bold text-red-500">
                                    {badge}
                                  </span>
                                )}
                                <div>
                                  <div className="font-semibold text-[#0f2940]">{String(s.label ?? s.geoid)}</div>
                                  <div className="text-xs text-slate-500">{String(s.geoid)}</div>
                                </div>
                              </div>
                            </div>
                            <button
                              type="button"
                              className="text-slate-400 hover:text-red-600"
                              aria-label={`Remove ${s.geoid}`}
                              onClick={() => removeGeoid(String(s.geoid))}
                            >
                              ×
                            </button>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {METRIC_KEYS.map((k) => (
                    <tr key={k} className="border-b border-slate-100">
                      <td className="px-4 py-3 font-medium text-slate-700">{LABELS[k] ?? k}</td>
                      {data.series.map((s) => {
                        const row = rawFor(String(s.geoid), k, data.raw_indicators);
                        const v = row?.value ?? null;
                        return (
                          <td key={`${s.geoid}-${k}`} className={`px-4 py-3 font-medium ${cellTone(k, v)}`}>
                            {v != null ? formatMetricValue(k, v) : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <div className="mt-12">
          <SiteFooter />
        </div>
      </div>
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-500">Loading…</div>}>
      <CompareInner />
    </Suspense>
  );
}
