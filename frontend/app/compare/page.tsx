"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
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
import { SiteFooter } from "@/components/SiteFooter";
import { getCompare, getTract, type IndicatorRow } from "@/lib/api";
import { buildCompareInsights, type CompareDemographicsIncomeMap } from "@/lib/compareInsights";
import { METRIC_KEYS } from "@/lib/riskScore";
import { METRIC_LABELS, formatMetricValue } from "@/lib/metricDisplay";
import type { MetricKey } from "@/lib/riskScore";

const LINE_COLORS = ["#c45c3e", "#2c6e49", "#b8860b", "#2563eb"];

/** Solid UI fill from compare chart hex (e.g. tract card swatch at 70% opacity). */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "").trim();
  if (h.length !== 6) return `rgba(0,0,0,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return `rgba(0,0,0,${alpha})`;
  return `rgba(${r},${g},${b},${alpha})`;
}

const LABELS: Record<string, string> = Object.fromEntries(
  METRIC_KEYS.map((k) => [k, METRIC_LABELS[k as MetricKey]])
) as Record<string, string>;

/** Profile shape chart x-axis only (short names). */
const METRIC_SHORT_LABELS: Record<MetricKey, string> = {
  rent_burden_pct: "Rent burden",
  overcrowding_pct: "Overcrowding",
  vacancy_rate: "Vacancy",
  uninsured_pct: "Uninsured",
  asthma_pct: "Asthma",
  disability_pct: "Disability",
  heat_index: "Heat index",
};

/**
 * Race/ethnicity bar colors — must match DemographicsPanel.tsx RACE_SEGMENTS barColor values.
 * Compare supports up to 4 tracts; value columns reuse the same min-width table layout as the indicator table.
 */
const COMPARE_RACE_SEGMENTS: {
  key: "pct_white" | "pct_black" | "pct_hispanic" | "pct_asian" | "pct_other_race";
  label: string;
  barColor: string;
}[] = [
  { key: "pct_white", label: "White", barColor: "#f2c49c" },
  { key: "pct_black", label: "Black", barColor: "#6ec4f0" },
  { key: "pct_hispanic", label: "Hispanic", barColor: "#8fb88f" },
  { key: "pct_asian", label: "Asian", barColor: "#eb9a8e" },
  { key: "pct_other_race", label: "Other", barColor: "#42a8ad" },
];

type TractDemographicsApiRow = {
  geoid: string;
  year: number;
  total_population: number | null;
  median_age: number | null;
  pct_white: number | null;
  pct_black: number | null;
  pct_hispanic: number | null;
  pct_asian: number | null;
  pct_other_race: number | null;
  pct_non_english_home: number | null;
  pct_foreign_born: number | null;
  pct_no_hs_diploma: number | null;
};

type CompareTractContext = {
  demographics: TractDemographicsApiRow;
  median_household_income: number | null;
};

function CollapseChevron({ open }: { open: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className={`h-5 w-5 shrink-0 text-nh-brown-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function formatMedianIncomeCell(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${Math.round(v).toLocaleString("en-US", { maximumFractionDigits: 0, useGrouping: true })}`;
}

function formatNonEnglishCell(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(1)}%`;
}

function buildCollapsedIncomeHint(
  series: ReadonlyArray<Record<string, unknown>>,
  byGeoid: Record<string, CompareTractContext | null>
): string | null {
  const amounts: number[] = [];
  for (const s of series) {
    const inc = byGeoid[String(s.geoid)]?.median_household_income;
    if (inc == null || !Number.isFinite(inc)) return null;
    amounts.push(inc);
  }
  const parts = amounts.map(
    (n) => `$${Math.round(n).toLocaleString("en-US", { maximumFractionDigits: 0, useGrouping: true })}`
  );
  const full = `Median household income: ${parts.join(" · ")}`;
  if (full.length <= 60) return full;
  const lo = Math.min(...amounts);
  const hi = Math.max(...amounts);
  return `Median income: $${Math.round(lo).toLocaleString("en-US", { maximumFractionDigits: 0, useGrouping: true })} – $${Math.round(hi).toLocaleString("en-US", { maximumFractionDigits: 0, useGrouping: true })} (${series.length} tracts)`;
}

function allRaceFieldsNull(d: TractDemographicsApiRow): boolean {
  return (
    (d.pct_white == null || !Number.isFinite(d.pct_white)) &&
    (d.pct_black == null || !Number.isFinite(d.pct_black)) &&
    (d.pct_hispanic == null || !Number.isFinite(d.pct_hispanic)) &&
    (d.pct_asian == null || !Number.isFinite(d.pct_asian)) &&
    (d.pct_other_race == null || !Number.isFinite(d.pct_other_race))
  );
}

function pluralityRaceLine(d: TractDemographicsApiRow): string | null {
  if (allRaceFieldsNull(d)) return null;
  let best: { label: string; v: number } | null = null;
  for (const seg of COMPARE_RACE_SEGMENTS) {
    const v = d[seg.key];
    if (v == null || !Number.isFinite(v) || v <= 0) continue;
    if (!best || v > best.v) best = { label: seg.label, v };
  }
  return best ? `${best.label} ${best.v.toFixed(0)}%` : null;
}

function RaceInlineBar({ d }: { d: TractDemographicsApiRow }) {
  if (allRaceFieldsNull(d)) return null;
  const segs = COMPARE_RACE_SEGMENTS.map((s) => ({ ...s, pct: d[s.key] })).filter(
    (s) => s.pct != null && Number.isFinite(s.pct) && (s.pct as number) > 0
  );
  if (!segs.length) return null;
  const sum = segs.reduce((a, s) => a + (s.pct as number), 0);
  if (sum <= 0) return null;
  return (
    <div className="flex h-2 w-full min-w-0 max-w-[200px] overflow-hidden rounded-sm ring-1 ring-nh-brown/10">
      {segs.map((s) => (
        <div
          key={s.key}
          className="min-w-0"
          style={{ width: `${((s.pct as number) / sum) * 100}%`, backgroundColor: s.barColor }}
        />
      ))}
    </div>
  );
}

function ordinalSuffix(n: number): string {
  if (11 <= (n % 100) && (n % 100) <= 13) return "th";
  return ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
}

function nationalPercentilePhrase(p: number | null | undefined): string {
  if (p == null || Number.isNaN(p)) return "National rank unavailable";
  const n = Math.round(p);
  return `${n}${ordinalSuffix(n)} nationally`;
}

function clientApiBase(): string {
  const t = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").trim().replace(/\/+$/, "");
  return t || "http://localhost:8000";
}

function compositeBadge(series: Record<string, number | string>): number | null {
  const nums = METRIC_KEYS.map((k) => series[k]).filter((v): v is number => typeof v === "number");
  if (!nums.length) return null;
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  return Math.round(avg);
}

function rawFor(geoid: string, metric: string, raw: Record<string, IndicatorRow[]> | undefined): IndicatorRow | undefined {
  return raw?.[geoid]?.find((i) => i.metric_name === metric);
}

/** Bar fill width from national percentile (0–100). */
function nationalPercentileBarWidth(percentileNational: number | null | undefined): number {
  if (percentileNational == null || Number.isNaN(percentileNational)) return 0;
  return Math.max(0, Math.min(100, percentileNational));
}

type IndicatorSortMode = "default" | "gap" | "highest_burden" | "national_pct";

const INDICATOR_SORT_OPTIONS: { id: IndicatorSortMode; label: string }[] = [
  { id: "default", label: "Default order" },
  { id: "gap", label: "Biggest gap" },
  { id: "highest_burden", label: "Highest burden" },
  { id: "national_pct", label: "National percentile" },
];

function metricValueSpread(metric: string, geoids: string[], raw: Record<string, IndicatorRow[]>): number {
  const vals = geoids
    .map((g) => rawFor(g, metric, raw)?.value)
    .filter((x): x is number => x != null && Number.isFinite(x));
  if (vals.length < 2) return 0;
  return Math.max(...vals) - Math.min(...vals);
}

function metricHighestValue(metric: string, geoids: string[], raw: Record<string, IndicatorRow[]>): number {
  const vals = geoids
    .map((g) => rawFor(g, metric, raw)?.value)
    .filter((x): x is number => x != null && Number.isFinite(x));
  if (!vals.length) return Number.NEGATIVE_INFINITY;
  return Math.max(...vals);
}

function metricAvgNationalPercentile(metric: string, geoids: string[], raw: Record<string, IndicatorRow[]>): number {
  const pcts = geoids
    .map((g) => rawFor(g, metric, raw)?.percentile_national)
    .filter((x): x is number => x != null && Number.isFinite(x));
  if (!pcts.length) return Number.NEGATIVE_INFINITY;
  return pcts.reduce((a, b) => a + b, 0) / pcts.length;
}

function sortMetricKeys(
  keys: readonly MetricKey[],
  mode: IndicatorSortMode,
  geoids: string[],
  raw: Record<string, IndicatorRow[]>
): MetricKey[] {
  if (mode === "default") return [...keys];
  const orderOf = (k: MetricKey) => keys.indexOf(k);
  return [...keys].sort((a, b) => {
    let cmp = 0;
    if (mode === "gap") {
      cmp = metricValueSpread(b, geoids, raw) - metricValueSpread(a, geoids, raw);
    } else if (mode === "highest_burden") {
      cmp = metricHighestValue(b, geoids, raw) - metricHighestValue(a, geoids, raw);
    } else if (mode === "national_pct") {
      cmp = metricAvgNationalPercentile(b, geoids, raw) - metricAvgNationalPercentile(a, geoids, raw);
    }
    if (cmp !== 0) return cmp;
    return orderOf(a) - orderOf(b);
  });
}

function CompareInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const raw = sp.get("geoids") ?? "";
  const geoids = useMemo(() => raw.split(",").map((g) => g.trim()).filter(Boolean), [raw]);
  const [data, setData] = useState<Awaited<ReturnType<typeof getCompare>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfErr, setPdfErr] = useState<string | null>(null);
  const [csvLoading, setCsvLoading] = useState(false);
  const [csvErr, setCsvErr] = useState<string | null>(null);
  const [addInput, setAddInput] = useState("");
  const [indicatorSort, setIndicatorSort] = useState<IndicatorSortMode>("default");
  const [demographicsByGeoid, setDemographicsByGeoid] = useState<Record<string, CompareTractContext | null>>({});
  const [demographicsLoading, setDemographicsLoading] = useState(false);
  const [populationContextOpen, setPopulationContextOpen] = useState(false);

  useEffect(() => {
    setIndicatorSort("default");
  }, [raw]);

  useEffect(() => {
    if (geoids.length < 2) {
      setData(null);
      setErr(null);
      return;
    }
    setErr(null);
    setPdfErr(null);
    setCsvErr(null);
    getCompare(geoids)
      .then(setData)
      .catch((e: Error) => {
        setErr(e.message);
        setData(null);
      });
  }, [geoids]);

  useEffect(() => {
    if (!data?.series?.length) {
      setDemographicsByGeoid({});
      setDemographicsLoading(false);
      return;
    }
    let cancelled = false;
    setDemographicsLoading(true);
    setDemographicsByGeoid({});
    const gids = data.series.map((s) => String(s.geoid));
    void (async () => {
      const entries = await Promise.all(
        gids.map(async (gid) => {
          try {
            const [demRes, tract] = await Promise.all([
              fetch(`${clientApiBase()}/api/tracts/${gid}/demographics`, {
                cache: "no-store",
                headers: { Accept: "application/json" },
              }),
              getTract(gid).catch(() => null),
            ]);
            if (!demRes.ok) return [gid, null] as const;
            const demographics = (await demRes.json()) as TractDemographicsApiRow;
            const median_household_income = tract?.median_household_income ?? null;
            return [gid, { demographics, median_household_income }] as const;
          } catch {
            return [gid, null] as const;
          }
        })
      );
      if (cancelled) return;
      const next: Record<string, CompareTractContext | null> = {};
      for (const [gid, row] of entries) next[gid] = row;
      setDemographicsByGeoid(next);
      setDemographicsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [data]);

  const incomeMapForInsights = useMemo((): CompareDemographicsIncomeMap => {
    if (!data || demographicsLoading) return {};
    const m: CompareDemographicsIncomeMap = {};
    for (const s of data.series) {
      const gid = String(s.geoid);
      const ctx = demographicsByGeoid[gid];
      m[gid] = ctx ? { median_household_income: ctx.median_household_income } : null;
    }
    return m;
  }, [data, demographicsByGeoid, demographicsLoading]);

  const collapsedIncomeHint = useMemo(
    () =>
      data && !demographicsLoading ? buildCollapsedIncomeHint(data.series as Record<string, unknown>[], demographicsByGeoid) : null,
    [data, demographicsByGeoid, demographicsLoading]
  );

  const lineData = useMemo(() => {
    if (!data) return [];
    return METRIC_KEYS.map((m) => {
      const row: Record<string, string | number> = { metric: METRIC_SHORT_LABELS[m], metricKey: m };
      data.series.forEach((s) => {
        const id = String(s.geoid);
        const v = s[m];
        if (typeof v === "number") row[id] = v;
      });
      return row;
    });
  }, [data]);

  const profileTooltipContent = useCallback((props: TooltipContentProps) => {
      const { active, payload } = props;
      if (!active || !payload?.length || !data) return null;
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
                const tract = data.series.find((s) => String(s.geoid) === gid);
              const tname = tract ? String(tract.label ?? tract.geoid) : gid;
              const ind = rawFor(gid, mk, data.raw_indicators);
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
  }, [data]);

  const insights = useMemo(
    () =>
      data
        ? buildCompareInsights(data.series as Record<string, number | string>[], incomeMapForInsights)
        : [],
    [data, incomeMapForInsights]
  );

  const sortedMetricKeys = useMemo(() => {
    if (!data) return [...METRIC_KEYS];
    const gids = data.series.map((s) => String(s.geoid));
    return sortMetricKeys(METRIC_KEYS, indicatorSort, gids, data.raw_indicators);
  }, [data, indicatorSort]);

  const downloadCompareCsv = useCallback(async () => {
    if (geoids.length < 2 || geoids.length > 4) return;
    setCsvErr(null);
    setCsvLoading(true);
    try {
      const res = await fetch(`${clientApiBase()}/api/export/compare-csv`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ geoids }),
        cache: "no-store",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Request failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "neighborhealth-compare.csv";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setCsvErr(e instanceof Error ? e.message : "CSV export failed");
    } finally {
      setCsvLoading(false);
    }
  }, [geoids]);

  const downloadComparePdf = useCallback(async () => {
    if (geoids.length < 2) return;
    setPdfErr(null);
    setPdfLoading(true);
    try {
      const res = await fetch(`${clientApiBase()}/api/export/compare-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ geoids }),
        cache: "no-store",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Request failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "neighborhealth-compare.pdf";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setPdfErr(e instanceof Error ? e.message : "PDF export failed");
    } finally {
      setPdfLoading(false);
    }
  }, [geoids]);

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
            Add at least two to load charts, the indicator table, and exports.
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
            <div className="flex flex-col items-end gap-1">
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void downloadCompareCsv()}
                  disabled={csvLoading || geoids.length > 4}
                  className="rounded-full border border-nh-brown/20 bg-white px-4 py-2 text-sm font-semibold text-nh-brown hover:bg-nh-cream disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {csvLoading ? "Exporting…" : "Export CSV"}
                </button>
                <button
                  type="button"
                  onClick={() => void downloadComparePdf()}
                  disabled={pdfLoading}
                  className="rounded-full bg-nh-brown px-4 py-2 text-sm font-semibold text-nh-cream hover:bg-nh-brown/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Print / PDF
                </button>
                {pdfLoading || csvLoading ? (
                  <span className="text-sm text-nh-brown-muted" aria-live="polite">
                    {pdfLoading ? "Generating PDF..." : "Exporting…"}
                  </span>
                ) : null}
              </div>
              {csvErr ? <p className="text-right text-sm text-red-600">{csvErr}</p> : null}
              {pdfErr ? <p className="text-right text-sm text-red-600">{pdfErr}</p> : null}
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
              Composite sub-scores (0–100) and raw indicators. Bar length shows national percentile rank. Dashed line =
              national median (50th percentile).
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
                      className="mt-4 h-12 w-full rounded-lg"
                      style={{
                        backgroundColor: hexToRgba(LINE_COLORS[i % LINE_COLORS.length], 0.7),
                      }}
                      title="Tract color matches profile chart"
                    />
                  </div>
                );
              })}
            </div>

            <div className="mt-10">
              <div className="rounded-2xl border border-nh-brown/10 bg-white p-4 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wide text-nh-brown-muted">Profile shape</p>
                <p className="text-[11px] text-nh-brown-muted">
                  Each line = one tract; bar position = national percentile rank. Hover a point for raw value and national
                  rank.
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
                        content={profileTooltipContent}
                        cursor={{ stroke: "#e8dfd4", strokeWidth: 1 }}
                        wrapperStyle={{ outline: "none" }}
                      />
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
                          activeDot={{ r: 5 }}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className="mt-10">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <p className="text-xs font-bold uppercase tracking-wide text-nh-brown-muted">Indicator table</p>
                <div
                  role="group"
                  aria-label="Sort indicator rows"
                  className="inline-flex flex-wrap gap-1 rounded-full border border-nh-brown/15 bg-white p-1"
                >
                  {INDICATOR_SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setIndicatorSort(opt.id)}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                        indicatorSort === opt.id
                          ? "bg-nh-brown text-nh-cream"
                          : "text-nh-brown hover:bg-nh-cream"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="overflow-x-auto rounded-2xl border border-nh-brown/10 bg-white shadow-sm">
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
                    <tr className="border-b border-nh-brown/10 bg-nh-cream/80">
                      <th className="px-4 pb-2 pt-0 text-left align-bottom" scope="row">
                        <span className="sr-only">Bar legend</span>
                      </th>
                      {data.series.map((s) => (
                        <th
                          key={`median-legend-${String(s.geoid)}`}
                          scope="col"
                          className="min-w-[200px] px-4 pb-2 pt-0 text-center text-[10px] font-medium leading-tight text-nh-brown-muted"
                          title="Dashed line on each bar marks the 50th percentile nationally"
                        >
                          National median
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedMetricKeys.map((k) => (
                      <tr key={k} className="border-b border-nh-brown/5">
                        <td className="px-4 py-3 font-medium text-nh-brown-muted">{LABELS[k] ?? k}</td>
                        {data.series.map((s) => {
                          const row = rawFor(String(s.geoid), k, data.raw_indicators);
                          const v = row?.value ?? null;
                          const pn = row?.percentile_national;
                          const w = nationalPercentileBarWidth(pn);
                          return (
                            <td key={`${s.geoid}-${k}`} className="px-4 py-3">
                              <div className="flex flex-col gap-1">
                                <span className="font-semibold text-nh-brown">{v != null ? formatMetricValue(k, v) : "—"}</span>
                                <div className="relative h-2 w-full rounded-full bg-nh-sand">
                                  <div
                                    className="pointer-events-none absolute left-1/2 top-0 z-[1] h-full w-0 -translate-x-1/2 border-l border-dashed"
                                    style={{ borderLeftColor: "var(--color-border-secondary)" }}
                                    aria-hidden
                                  />
                                  <div
                                    className="relative z-0 h-full rounded-full bg-nh-terracotta/90 transition-all duration-300 ease-out"
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
            </div>

            {/* Population context: same table column widths as indicator grid above (max 4 tracts). */}
            <details
              open={populationContextOpen}
              onToggle={(e) => setPopulationContextOpen(e.currentTarget.open)}
              className="mt-10 overflow-hidden rounded-2xl border border-nh-brown/10 bg-white shadow-sm [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 border-b border-nh-brown/10 bg-nh-cream/80 px-4 py-3 transition hover:bg-nh-cream/60">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
                  <span className="text-xs font-bold uppercase tracking-wide text-nh-brown-muted">Population context</span>
                  {!populationContextOpen && collapsedIncomeHint ? (
                    <span className="text-xs font-normal normal-case text-nh-brown-muted">{collapsedIncomeHint}</span>
                  ) : null}
                </div>
                <CollapseChevron open={populationContextOpen} />
              </summary>
              <div className="px-0 pb-0 pt-0">
                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse text-left text-sm">
                    <tbody>
                      <tr className="border-b border-nh-brown/5">
                        <td className="px-4 py-3 font-medium text-nh-brown-muted">Median income</td>
                        {data.series.map((s) => (
                          <td key={`inc-${s.geoid}`} className="min-w-[200px] px-4 py-3">
                            {demographicsLoading ? (
                              <div className="h-4 max-w-[100px] animate-pulse rounded bg-nh-sand" />
                            ) : (
                              <span className="font-semibold tabular-nums text-nh-brown">
                                {formatMedianIncomeCell(demographicsByGeoid[String(s.geoid)]?.median_household_income)}
                              </span>
                            )}
                          </td>
                        ))}
                      </tr>
                      <tr className="border-b border-nh-brown/5">
                        <td className="px-4 py-3 font-medium text-nh-brown-muted">Non-English at home</td>
                        {data.series.map((s) => (
                          <td key={`ne-${s.geoid}`} className="min-w-[200px] px-4 py-3">
                            {demographicsLoading ? (
                              <div className="h-4 max-w-[72px] animate-pulse rounded bg-nh-sand" />
                            ) : (
                              <span className="font-semibold tabular-nums text-nh-brown">
                                {formatNonEnglishCell(demographicsByGeoid[String(s.geoid)]?.demographics?.pct_non_english_home)}
                              </span>
                            )}
                          </td>
                        ))}
                      </tr>
                      <tr className="border-b border-nh-brown/5">
                        <td className="px-4 py-3 font-medium text-nh-brown-muted">Race / ethnicity</td>
                        {data.series.map((s) => {
                          const ctx = demographicsByGeoid[String(s.geoid)];
                          const d = ctx?.demographics;
                          return (
                            <td key={`race-${s.geoid}`} className="min-w-[200px] px-4 py-3">
                              {demographicsLoading ? (
                                <div className="space-y-2">
                                  <div className="h-2 w-full max-w-[200px] animate-pulse rounded-sm bg-nh-sand" />
                                  <div className="h-3 max-w-[88px] animate-pulse rounded bg-nh-cream-dark" />
                                </div>
                              ) : !d ? (
                                <span className="text-nh-brown-muted">—</span>
                              ) : allRaceFieldsNull(d) ? (
                                <span className="text-nh-brown-muted">—</span>
                              ) : (
                                <div className="flex flex-col gap-1.5">
                                  <RaceInlineBar d={d} />
                                  <span className="text-xs text-nh-brown-muted">{pluralityRaceLine(d) ?? "—"}</span>
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </details>

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
