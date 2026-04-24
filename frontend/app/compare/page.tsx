"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SiteFooter } from "@/components/SiteFooter";
import { getCompare, type IndicatorRow } from "@/lib/api";
import { buildCompareInsights, compareSeriesToLineChartData } from "@/lib/compareInsights";
import { METRIC_KEYS } from "@/lib/riskScore";
import { METRIC_LABELS, formatMetricValue } from "@/lib/metricDisplay";
import type { MetricKey } from "@/lib/riskScore";

const LINE_COLORS = ["#c45c3e", "#2c6e49", "#b8860b", "#2563eb"];
const RADAR_COLORS = LINE_COLORS;

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

function barWidthPct(metric: string, value: number | null | undefined, geoids: string[], raw: Record<string, IndicatorRow[]>): number {
  if (value == null || Number.isNaN(value)) return 0;
  const vals = geoids
    .map((g) => rawFor(g, metric, raw)?.value)
    .filter((x): x is number => typeof x === "number" && !Number.isNaN(x));
  if (!vals.length) return 50;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  if (hi - lo < 1e-9) return 50;
  return Math.max(8, Math.min(100, ((value - lo) / (hi - lo)) * 100));
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

  const lineData = useMemo(() => (data ? compareSeriesToLineChartData(data.series as Record<string, number | string>[]) : []), [data]);

  const insights = useMemo(
    () => (data ? buildCompareInsights(data.series as Record<string, number | string>[]) : []),
    [data]
  );

  const downloadCsv = useCallback(() => {
    if (!data) return;
    const header = ["metric", ...data.series.map((s) => String(s.geoid))];
    const lines = [header.join(",")];
    for (const k of METRIC_KEYS) {
      const row: string[] = [k];
      for (const s of data.series) {
        const r = rawFor(String(s.geoid), k, data.raw_indicators);
        const cell = r?.value != null ? String(r.value) : "";
        row.push(cell);
      }
      lines.push(row.join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `neighborhealth-compare-${data.geoids.join("-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
      <div className="min-h-screen bg-nh-cream">
        <div className="mx-auto max-w-2xl px-4 py-14">
          <h1 className="font-display text-3xl font-semibold text-nh-brown">Compare tracts</h1>
          <p className="mt-3 text-nh-brown-muted">
            Enter census tract GEOIDs (up to four). Add at least two to load charts, the indicator table, and CSV
            export.
          </p>
          <div className="mt-8 flex flex-wrap gap-2">
            <input
              className="min-w-[200px] flex-1 rounded-xl border border-nh-brown/15 bg-white px-3 py-2.5 text-sm text-nh-brown"
              placeholder="11-digit GEOID"
              value={addInput}
              onChange={(e) => setAddInput(e.target.value)}
            />
            <button
              type="button"
              onClick={() => addGeoid()}
              className="rounded-xl bg-nh-brown px-5 py-2.5 text-sm font-semibold text-nh-cream hover:bg-nh-brown/90"
            >
              Add tract
            </button>
          </div>
          <p className="mt-8">
            <Link href="/explore" className="text-sm font-semibold text-nh-terracotta hover:underline">
              ← Back to map
            </Link>
          </p>
        </div>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-nh-cream text-nh-brown">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/explore" className="text-sm font-semibold text-nh-terracotta hover:underline">
            ← Back to map
          </Link>
          {data && geoids.length >= 2 && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={downloadCsv}
                className="rounded-full border border-nh-brown/20 bg-white px-4 py-2 text-sm font-semibold text-nh-brown hover:bg-nh-cream"
              >
                Export CSV
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="rounded-full bg-nh-brown px-4 py-2 text-sm font-semibold text-nh-cream hover:bg-nh-brown/90"
              >
                Print / PDF
              </button>
            </div>
          )}
        </div>

        <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-nh-terracotta">Compare</p>
            <h1 className="mt-1 font-display text-3xl font-semibold text-nh-brown md:text-4xl">
              {geoids.length} tracts side by side
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-nh-brown-muted">
              Composite sub-scores (0–100) and raw indicators. Bars in each cell are scaled to this comparison set.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="min-w-[140px] rounded-full border border-nh-brown/15 bg-white px-3 py-2 text-sm"
              placeholder="Add GEOID"
              value={addInput}
              onChange={(e) => setAddInput(e.target.value)}
              disabled={geoids.length >= 4}
            />
            <button
              type="button"
              onClick={addGeoid}
              disabled={geoids.length >= 4}
              className="rounded-full border border-dashed border-nh-terracotta bg-white px-4 py-2 text-sm font-semibold text-nh-terracotta hover:bg-nh-cream disabled:opacity-40"
            >
              + Add
            </button>
          </div>
        </div>

        {geoids.length === 1 && (
          <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            Add a second GEOID to load the comparison.
          </p>
        )}

        {err && geoids.length >= 2 && <p className="mt-6 text-sm text-red-600">{err}</p>}

        {data && geoids.length >= 2 && (
          <>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {data.series.map((s, i) => {
                const badge = compositeBadge(s as Record<string, number | string>);
                const flag = badge != null && badge >= 55 ? "Priority" : "Stable";
                return (
                  <div key={String(s.geoid)} className="relative rounded-2xl border border-nh-brown/10 bg-white p-4 shadow-sm">
                    <button
                      type="button"
                      className="absolute right-3 top-3 text-nh-brown-muted hover:text-red-600"
                      aria-label={`Remove ${s.geoid}`}
                      onClick={() => removeGeoid(String(s.geoid))}
                    >
                      ×
                    </button>
                    <p className="pr-8 font-semibold text-nh-brown">{String(s.label ?? s.geoid)}</p>
                    <p className="text-xs text-nh-brown-muted">{String(s.geoid)}</p>
                    <div className="mt-4 flex items-end justify-between">
                      <div>
                        <p className="text-[10px] font-bold uppercase text-nh-brown-muted">Composite</p>
                        <p className="font-display text-4xl font-bold text-nh-terracotta">{badge ?? "—"}</p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                          flag === "Priority" ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-900"
                        }`}
                      >
                        {flag}
                      </span>
                    </div>
                    <div
                      className="mt-4 h-12 rounded-lg bg-nh-cream"
                      style={{
                        backgroundImage: `linear-gradient(90deg, ${LINE_COLORS[i % LINE_COLORS.length]}44 0%, ${LINE_COLORS[i % LINE_COLORS.length]} 100%)`,
                      }}
                      title="Relative profile shape (decorative)"
                    />
                  </div>
                );
              })}
            </div>

            <div className="mt-10 grid gap-8 lg:grid-cols-2">
              <div className="rounded-2xl border border-nh-brown/10 bg-white p-4 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wide text-nh-brown-muted">Radar profile</p>
                <div className="h-[360px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={chartData}>
                      <PolarGrid stroke="#e8dfd4" />
                      <PolarAngleAxis dataKey="metric" tick={{ fontSize: 9, fill: "#5c4033" }} />
                      <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e8dfd4" }} />
                      {data.series.map((s, i) => (
                        <Radar
                          key={String(s.geoid)}
                          name={String(s.label ?? s.geoid)}
                          dataKey={String(s.geoid)}
                          stroke={RADAR_COLORS[i % RADAR_COLORS.length]}
                          fill={RADAR_COLORS[i % RADAR_COLORS.length]}
                          fillOpacity={0.15}
                        />
                      ))}
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="rounded-2xl border border-nh-brown/10 bg-white p-4 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wide text-nh-brown-muted">Profile shape</p>
                <p className="text-[11px] text-nh-brown-muted">Each line = one tract; normalized component scores 0–100.</p>
                <div className="mt-2 h-[360px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={lineData} margin={{ top: 8, right: 8, left: 0, bottom: 48 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e8dfd4" />
                      <XAxis dataKey="metric" tick={{ fontSize: 9, fill: "#5c4033" }} interval={0} angle={-20} textAnchor="end" height={70} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#5c4033" }} width={32} />
                      <Tooltip contentStyle={{ borderRadius: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      {data.series.map((s, i) => (
                        <Line
                          key={String(s.geoid)}
                          type="monotone"
                          dataKey={String(s.geoid)}
                          name={String(s.label ?? s.geoid)}
                          stroke={LINE_COLORS[i % LINE_COLORS.length]}
                          strokeWidth={2}
                          dot={{ r: 3 }}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className="mt-10 overflow-x-auto rounded-2xl border border-nh-brown/10 bg-white shadow-sm">
              <table className="min-w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-nh-brown/10 bg-nh-cream/80">
                    <th className="px-4 py-3 font-semibold text-nh-brown">Indicator</th>
                    {data.series.map((s) => (
                      <th key={String(s.geoid)} className="min-w-[200px] px-4 py-3">
                        <div className="font-semibold text-nh-brown">{String(s.label ?? s.geoid)}</div>
                        <div className="text-xs font-normal text-nh-brown-muted">{String(s.geoid)}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {METRIC_KEYS.map((k) => (
                    <tr key={k} className="border-b border-nh-brown/5">
                      <td className="px-4 py-3 font-medium text-nh-brown-muted">{LABELS[k] ?? k}</td>
                      {data.series.map((s) => {
                        const row = rawFor(String(s.geoid), k, data.raw_indicators);
                        const v = row?.value ?? null;
                        const w = barWidthPct(k, v, data.series.map((x) => String(x.geoid)), data.raw_indicators);
                        return (
                          <td key={`${s.geoid}-${k}`} className="px-4 py-3">
                            <div className="flex flex-col gap-1">
                              <span className="font-semibold text-nh-brown">{v != null ? formatMetricValue(k, v) : "—"}</span>
                              <div className="h-2 w-full overflow-hidden rounded-full bg-nh-sand">
                                <div
                                  className="h-full rounded-full bg-nh-terracotta/90 transition-all"
                                  style={{ width: `${w}%` }}
                                />
                              </div>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {insights.map((c) => (
                <div key={c.title} className="rounded-2xl border border-nh-brown/10 bg-white p-5 shadow-sm">
                  <p className="text-xs font-bold uppercase tracking-wide text-nh-terracotta">{c.title}</p>
                  <p className="mt-2 text-sm leading-relaxed text-nh-brown-muted">{c.body}</p>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="mt-14">
          <SiteFooter />
        </div>
      </div>
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<div className="flex min-h-[40vh] items-center justify-center bg-nh-cream text-nh-brown-muted">Loading…</div>}>
      <CompareInner />
    </Suspense>
  );
}
