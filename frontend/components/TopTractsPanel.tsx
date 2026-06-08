"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE, getTractList } from "@/lib/api";
import { addToCompareTray, removeFromCompareTray } from "@/lib/compareTray";
import { HIGH_ASTHMA_THRESHOLD, SCORE_HIGH_THRESHOLD, SCORE_MID_THRESHOLD } from "@/lib/constants";
import { buildFilteredTractsExportQuery, hasActiveExploreFilters } from "@/lib/exploreExport";
import type {
  AppliedFilters,
  DraftFilters,
  ExploreLayerMode,
  RankedTractRow,
} from "@/types";

const TOP_TRACT_LAYER_HEADING: Record<ExploreLayerMode, string> = {
  composite: "Composite index",
  housing: "Rent burden",
  health: "Health blend",
  overlap: "Composite index",
};

const TOP_TRACT_SORT_HINT: Record<ExploreLayerMode, string> = {
  composite: "Sorted by composite housing–health score (highest first).",
  housing: "Sorted by rent burden % (highest first).",
  health: "Sorted by average of uninsured %, asthma %, and mental health % (highest first).",
  overlap: "Sorted by composite housing–health score (highest first).",
};

const LAYER_SORT_API: Record<ExploreLayerMode, "composite" | "housing" | "health"> = {
  composite: "composite",
  housing: "housing",
  health: "health",
  overlap: "composite",
};

export function TopTractsPanel({
  stateFips,
  layerMode,
  selectedGeoid,
  stateLabel,
  noData,
  draft,
  setDraft,
  applied,
  setApplied,
  compareTray,
  setCompareTray,
  onSelectTract,
  onRankedChange,
}: {
  stateFips: string | null;
  layerMode: ExploreLayerMode;
  selectedGeoid: string | null;
  stateLabel: string;
  noData: boolean;
  draft: DraftFilters;
  setDraft: React.Dispatch<React.SetStateAction<DraftFilters>>;
  applied: AppliedFilters;
  setApplied: React.Dispatch<React.SetStateAction<AppliedFilters>>;
  compareTray: string[];
  setCompareTray: React.Dispatch<React.SetStateAction<string[]>>;
  onSelectTract: (geoid: string) => void;
  onRankedChange?: (rows: RankedTractRow[]) => void;
}) {
  const [ranked, setRanked] = useState<RankedTractRow[]>([]);
  const [rankedTotal, setRankedTotal] = useState(0);
  const [rankedError, setRankedError] = useState<string | null>(null);
  const [rankingFiltersOpen, setRankingFiltersOpen] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const fetchIdRef = useRef(0);

  const filtersActive = stateFips != null && hasActiveExploreFilters(applied);

  async function downloadFilteredCsv() {
    if (!stateFips || !filtersActive) return;
    setExportErr(null);
    setExportLoading(true);
    try {
      const qs = buildFilteredTractsExportQuery(stateFips, applied);
      const res = await fetch(`${API_BASE}/api/export/filtered-tracts?${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "neighborhealth-filtered-tracts.csv";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportErr(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExportLoading(false);
    }
  }

  const fetchList = useCallback(async () => {
    if (!stateFips) {
      setRanked([]);
      setRankedTotal(0);
      setRankedError(null);
      onRankedChange?.([]);
      return;
    }
    const id = ++fetchIdRef.current;
    const params: Record<string, string | undefined> = {
      state: stateFips,
      limit: "50",
      sort_by: LAYER_SORT_API[layerMode],
    };
    if (applied.minScore > 0) params.min_score = String(Math.round(applied.minScore));
    if (applied.minPopulation > 0) params.min_population = String(applied.minPopulation);
    if (applied.excludeInstitutional) params.exclude_institutional = "true";
    if (applied.clinicDist === "1") params.max_clinic_distance_miles = "1";
    else if (applied.clinicDist === "2") params.max_clinic_distance_miles = "2";
    else if (applied.clinicDist === "5") params.max_clinic_distance_miles = "5";
    else if (applied.clinicDist === "over5") params.min_clinic_distance_miles = "5";
    if (applied.minRent > 0) params.min_rent_burden = String(applied.minRent);
    if (applied.minUninsured > 0) params.min_uninsured = String(applied.minUninsured);
    if (applied.asthmaHigh) params.high_asthma = "true";
    if (applied.urbanRural) params.urban_rural = applied.urbanRural;

    try {
      const r = await getTractList(params);
      if (fetchIdRef.current !== id) return;
      setRankedError(null);
      setRankedTotal(r.total);
      const rows = r.items.map((i) => ({
        geoid: i.geoid,
        composite_score: i.composite_score,
        layer_value: i.layer_value ?? null,
        name: i.name,
        county_name: i.county_name,
      }));
      setRanked(rows);
      onRankedChange?.(rows);
    } catch (err) {
      if (fetchIdRef.current !== id) return;
      setRanked([]);
      setRankedTotal(0);
      setRankedError(err instanceof Error ? err.message : "Failed to load rankings");
      onRankedChange?.([]);
    }
  }, [stateFips, applied, layerMode, onRankedChange]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    if (!stateFips) setRankingFiltersOpen(false);
  }, [stateFips]);

  function applyFilters() {
    setApplied((a) => ({
      ...a,
      minScore: draft.minScore,
      minRent: draft.minRent,
      minUninsured: draft.minUninsured,
      asthmaHigh: draft.asthma >= HIGH_ASTHMA_THRESHOLD,
      urbanRural: draft.urbanRural,
    }));
  }

  function resetRankingFilters() {
    setDraft({
      minScore: 0,
      minRent: 0,
      minUninsured: 0,
      asthma: 0,
      urbanRural: "",
    });
    setApplied((a) => ({
      ...a,
      minScore: 0,
      minPopulation: 0,
      excludeInstitutional: false,
      minRent: 0,
      minUninsured: 0,
      asthmaHigh: false,
      urbanRural: "",
      clinicDist: "",
    }));
  }

  return (
    <div className="rounded-2xl border border-[#e8e3dc] bg-[#f9f7f2] shadow-sm">
      <div className="border-b border-[#ebe6df] px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="min-w-0 flex-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[#5c4a42]">
            Top tracts — {TOP_TRACT_LAYER_HEADING[layerMode]}
          </h2>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="text-[11px] tabular-nums text-[#8e8e8e]">
              {ranked.length} / {rankedTotal || "—"}
            </span>
            {stateFips ? (
              <button
                type="button"
                onClick={() => setRankingFiltersOpen((v) => !v)}
                aria-expanded={rankingFiltersOpen}
                aria-controls="ranking-filters-panel"
                aria-label={rankingFiltersOpen ? "Hide ranking filters" : "Show ranking filters"}
                className={`rounded-lg p-1.5 text-[#8e8e8e] transition hover:bg-[#ebe6df] hover:text-[#5c534c] ${rankingFiltersOpen ? "bg-[#ebe6df] text-[#5c534c]" : ""}`}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                  />
                </svg>
              </button>
            ) : null}
          </div>
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-[#8e8e8e]">{TOP_TRACT_SORT_HINT[layerMode]}</p>
      </div>

      {stateFips && rankingFiltersOpen ? (
        <div id="ranking-filters-panel" className="space-y-3 border-b border-[#ebe6df] bg-[#faf8f5] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8e8e8e]">Refine ranking list</p>
          <div>
            <div className="flex justify-between gap-2 text-[11px] font-medium text-[#5c534c]">
              <span className="shrink-0">Min. composite score</span>
              <span className="tabular-nums">Score ≥ {draft.minScore}</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={draft.minScore}
              onChange={(e) => setDraft((d) => ({ ...d, minScore: Math.round(Number(e.target.value)) }))}
              className="mt-1 w-full accent-[#b34d3a]"
            />
          </div>
          <div>
            <label htmlFor="nh-pop-min" className="block text-[11px] font-medium text-[#5c534c]">
              Min. population
            </label>
            <select
              id="nh-pop-min"
              value={applied.minPopulation}
              onChange={(e) => setApplied((a) => ({ ...a, minPopulation: Number(e.target.value) }))}
              className="mt-1 w-full rounded-xl border border-[#ebe6df] bg-white py-2 pl-3 pr-8 text-sm text-[#2d2d2d] focus:border-[#b34d3a] focus:outline-none focus:ring-1 focus:ring-[#b34d3a]"
            >
              <option value={0}>Any</option>
              <option value={500}>500+</option>
              <option value={1000}>1,000+</option>
              <option value={2500}>2,500+</option>
              <option value={5000}>5,000+</option>
            </select>
          </div>
          <label className="flex cursor-pointer items-start gap-2.5 text-[11px] font-medium text-[#5c534c]">
            <input
              type="checkbox"
              checked={applied.excludeInstitutional}
              onChange={(e) => setApplied((a) => ({ ...a, excludeInstitutional: e.target.checked }))}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-[#d6cfc7] text-[#b34d3a] accent-[#b34d3a]"
            />
            <span>Exclude institutional tracts</span>
          </label>
          <div>
            <label htmlFor="nh-fqhc-access" className="block text-[11px] font-medium text-[#5c534c]">
              FQHC access
            </label>
            <select
              id="nh-fqhc-access"
              value={applied.clinicDist}
              onChange={(e) =>
                setApplied((a) => ({
                  ...a,
                  clinicDist: e.target.value as "" | "1" | "2" | "5" | "over5",
                }))
              }
              className="mt-1 w-full rounded-xl border border-[#ebe6df] bg-white py-2 pl-3 pr-8 text-sm text-[#2d2d2d] focus:border-[#b34d3a] focus:outline-none focus:ring-1 focus:ring-[#b34d3a]"
            >
              <option value="">Any</option>
              <option value="1">Within 1 mile</option>
              <option value="2">Within 2 miles</option>
              <option value="5">Within 5 miles</option>
              <option value="over5">Over 5 miles</option>
            </select>
          </div>
          <div>
            <div className="flex justify-between text-[11px] font-medium text-[#5c534c]">
              <span>Rent burden ≥</span>
              <span>{draft.minRent}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={draft.minRent}
              onChange={(e) => setDraft((d) => ({ ...d, minRent: Number(e.target.value) }))}
              className="mt-1 w-full accent-[#b34d3a]"
            />
          </div>
          <div>
            <div className="flex justify-between text-[11px] font-medium text-[#5c534c]">
              <span>Uninsured ≥</span>
              <span>{draft.minUninsured}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={50}
              value={draft.minUninsured}
              onChange={(e) => setDraft((d) => ({ ...d, minUninsured: Number(e.target.value) }))}
              className="mt-1 w-full accent-[#b34d3a]"
            />
          </div>
          <div className="flex flex-col gap-2">
            {filtersActive ? (
              <button
                type="button"
                onClick={() => void downloadFilteredCsv()}
                disabled={exportLoading}
                className="w-full rounded-xl border border-[#b34d3a]/40 bg-white py-2 text-sm font-semibold text-[#b34d3a] shadow-sm hover:bg-[#faf6f0] disabled:opacity-50"
              >
                {exportLoading ? "Exporting…" : "Export filtered tracts (CSV)"}
              </button>
            ) : (
              <p
                className="rounded-lg border border-dashed border-[#d6cfc7] px-3 py-2 text-center text-[11px] text-[#8e8e8e]"
                title="Apply filters to enable export"
              >
                Apply filters to enable export
              </p>
            )}
            {exportErr ? <p className="text-center text-[11px] text-red-700">{exportErr}</p> : null}
            <button
              type="button"
              onClick={() => {
                applyFilters();
                setRankingFiltersOpen(false);
              }}
              className="w-full rounded-xl bg-[#2d2d2d] py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#1f1f1f]"
            >
              Apply filters
            </button>
            <button
              type="button"
              onClick={() => {
                resetRankingFilters();
                setRankingFiltersOpen(false);
              }}
              className="w-full rounded-xl border border-[#d6cfc7] bg-white py-2 text-sm font-semibold text-[#5c534c] shadow-sm hover:bg-[#faf8f5]"
            >
              Reset filters
            </button>
          </div>
        </div>
      ) : null}

      <div className="space-y-0 px-3 pb-3 pt-2">
        <p className="px-1 text-[11px] text-[#8e8e8e]">{stateLabel}</p>
        {!stateFips && (
          <p className="mt-2 px-1 text-xs leading-relaxed text-[#6b6560]">
            Click a state on the map (highlighted) to load tract rankings.
          </p>
        )}
        {noData && (
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-2 text-xs text-amber-950">
            No tract rows in the database for this state yet.
          </p>
        )}
        {rankedError && (
          <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2 py-2 text-xs text-red-800">
            {rankedError}
          </p>
        )}
      </div>

      <ul className="max-h-[min(52vh,28rem)] divide-y divide-[#ebe6df] overflow-y-auto overscroll-contain">
        {ranked.slice(0, 16).map((r) => {
          const label = r.name ?? `Tract ${r.geoid}`;
          const inTray = compareTray.includes(r.geoid);
          const isSel = selectedGeoid === r.geoid;
          const rankMetric = r.layer_value ?? r.composite_score;
          const score = rankMetric != null ? Math.round(rankMetric) : null;
          const scoreDisplay =
            score != null
              ? `${score}${layerMode === "composite" || layerMode === "overlap" ? "" : "%"}`
              : "—";
          const scoreTone =
            score != null
              ? score >= SCORE_HIGH_THRESHOLD
                ? "bg-[#e8c9a5] text-[#2d2d2d]"
                : score >= SCORE_MID_THRESHOLD
                  ? "bg-[#efe0d0] text-[#2d2d2d]"
                  : "bg-[#f4ebe4] text-[#5c534c]"
              : "bg-[#ebe6df] text-[#8e8e8e]";
          const secondary = [r.county_name].filter(Boolean).join(" · ") || "—";
          return (
            <li
              key={r.geoid}
              className={`flex items-center gap-2 px-3 py-2.5 transition ${isSel ? "bg-[#f6e9e4]" : "hover:bg-[#faf6f0]"}`}
            >
              <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-bold tabular-nums ${scoreTone}`}>
                {scoreDisplay}
              </span>
              <button type="button" onClick={() => onSelectTract(r.geoid)} className="min-w-0 flex-1 text-left">
                <p className="truncate text-sm font-semibold text-[#2d2d2d]">{label}</p>
                <p className="truncate text-[11px] text-[#8e8e8e]">{secondary}</p>
              </button>
              <button
                type="button"
                aria-label={inTray ? "Remove from compare" : "Add to compare"}
                onClick={() =>
                  setCompareTray(inTray ? removeFromCompareTray(r.geoid) : addToCompareTray(r.geoid))
                }
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm font-semibold leading-none transition ${
                  inTray
                    ? "bg-[#b34d3a] text-white shadow-sm"
                    : "border border-[#d6cfc7] bg-white text-[#2d2d2d] hover:border-[#b34d3a]/50"
                }`}
              >
                {inTray ? "✓" : "+"}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
