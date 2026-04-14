"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { NeighborMap } from "@/components/NeighborMap";
import { SiteFooter } from "@/components/SiteFooter";
import { getMapGeoJSON, getTract, getTractList, searchTracts } from "@/lib/api";

const STATES = [
  { fips: "06", label: "California" },
  { fips: "48", label: "Texas" },
  { fips: "36", label: "New York" },
  { fips: "12", label: "Florida" },
  { fips: "17", label: "Illinois" },
];

const STATE_ABBR: Record<string, string> = {
  "06": "CA",
  "48": "TX",
  "36": "NY",
  "12": "FL",
  "17": "IL",
};

type Preview = { rent: number | null; uninsured: number | null };

function ExploreInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const initialQ = sp.get("q") ?? "";

  const [stateFips, setStateFips] = useState("06");
  const [geojson, setGeojson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState(initialQ);
  const [ranked, setRanked] = useState<
    { geoid: string; composite_score: number | null; name: string | null; county_name: string | null }[]
  >([]);
  const [previews, setPreviews] = useState<Record<string, Preview>>({});

  const [draft, setDraft] = useState({
    minScore: 0,
    minRent: 0,
    minUninsured: 0,
    asthma: 0,
    urbanRural: "" as "" | "urban" | "rural",
  });
  const [applied, setApplied] = useState({
    minScore: 0,
    minRent: 0,
    minUninsured: 0,
    asthmaHigh: false,
    urbanRural: "" as "" | "urban" | "rural",
  });

  useEffect(() => {
    setErr(null);
    getMapGeoJSON(stateFips)
      .then(setGeojson)
      .catch((e: Error) => setErr(e.message));
  }, [stateFips]);

  const fetchList = useCallback(() => {
    const params: Record<string, string | undefined> = {
      state: stateFips,
      limit: "50",
    };
    if (applied.minScore > 0) params.min_score = String(applied.minScore);
    if (applied.minRent > 0) params.min_rent_burden = String(applied.minRent);
    if (applied.minUninsured > 0) params.min_uninsured = String(applied.minUninsured);
    if (applied.asthmaHigh) params.high_asthma = "true";
    if (applied.urbanRural) params.urban_rural = applied.urbanRural;

    getTractList(params)
      .then((r) =>
        setRanked(
          r.items.map((i) => ({
            geoid: i.geoid,
            composite_score: i.composite_score,
            name: i.name,
            county_name: i.county_name,
          }))
        )
      )
      .catch(() => setRanked([]));
  }, [stateFips, applied]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    const top = ranked.slice(0, 6);
    if (!top.length) {
      setPreviews({});
      return;
    }
    let cancelled = false;
    Promise.all(
      top.map(async (r) => {
        try {
          const d = await getTract(r.geoid);
          const rent = d.indicators.find((i) => i.metric_name === "rent_burden_pct")?.value ?? null;
          const uninsured = d.indicators.find((i) => i.metric_name === "uninsured_pct")?.value ?? null;
          return { geoid: r.geoid, rent, uninsured };
        } catch {
          return { geoid: r.geoid, rent: null, uninsured: null };
        }
      })
    ).then((rows) => {
      if (cancelled) return;
      const next: Record<string, Preview> = {};
      rows.forEach((row) => {
        next[row.geoid] = { rent: row.rent, uninsured: row.uninsured };
      });
      setPreviews(next);
    });
    return () => {
      cancelled = true;
    };
  }, [ranked]);

  async function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    const r = await searchTracts(q);
    if (r.results[0]) {
      const d = await getTract(r.results[0].geoid);
      setStateFips(d.state_fips);
      router.push(`/tract/${d.geoid}`);
    }
  }

  function applyFilters() {
    setApplied({
      minScore: draft.minScore,
      minRent: draft.minRent,
      minUninsured: draft.minUninsured,
      asthmaHigh: draft.asthma >= 12,
      urbanRural: draft.urbanRural,
    });
  }

  const onSelectTract = useCallback(
    async (geoid: string) => {
      router.push(`/tract/${geoid}`);
    },
    [router]
  );

  const stateLabel = useMemo(() => STATES.find((s) => s.fips === stateFips)?.label ?? stateFips, [stateFips]);
  const stateAbbr = STATE_ABBR[stateFips] ?? stateFips;

  const featureCount = geojson?.features?.length ?? 0;
  const noData = !err && geojson != null && featureCount === 0;

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col bg-[#f0f4f8]">
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="w-full shrink-0 border-b border-slate-200 bg-white lg:w-[380px] lg:border-b-0 lg:border-r">
          <div className="max-h-[48vh] overflow-y-auto p-4 lg:max-h-[calc(100vh-4rem)]">
            <form onSubmit={onSearchSubmit} className="mb-6">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Search</label>
              <div className="mt-1 flex gap-2">
                <div className="relative flex-1">
                  <svg
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm text-[#0f2940] placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                    placeholder="Search by city, county, or census t"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                </div>
                <button type="submit" className="rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800">
                  Go
                </button>
              </div>
            </form>

            <div className="mb-4">
              <button
                type="button"
                className="flex w-full items-center justify-between text-left text-sm font-semibold text-[#0f2940]"
                aria-expanded
              >
                State
                <span className="text-slate-400">▾</span>
              </button>
              <ul className="mt-2 space-y-2">
                {STATES.map((s) => (
                  <li key={s.fips}>
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                      <input
                        type="radio"
                        name="state"
                        checked={stateFips === s.fips}
                        onChange={() => setStateFips(s.fips)}
                        className="rounded-full border-slate-300 text-teal-600 focus:ring-teal-500"
                      />
                      {s.label}
                    </label>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-4 border-t border-slate-100 pt-4">
              <div>
                <div className="flex justify-between text-xs font-medium text-slate-600">
                  <span>Rent burden %</span>
                  <span>{draft.minRent}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={draft.minRent}
                  onChange={(e) => setDraft((d) => ({ ...d, minRent: Number(e.target.value) }))}
                  className="mt-1 w-full accent-teal-600"
                />
              </div>
              <div>
                <div className="flex justify-between text-xs font-medium text-slate-600">
                  <span>Uninsured rate</span>
                  <span>{draft.minUninsured}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={50}
                  value={draft.minUninsured}
                  onChange={(e) => setDraft((d) => ({ ...d, minUninsured: Number(e.target.value) }))}
                  className="mt-1 w-full accent-teal-600"
                />
              </div>
              <div>
                <div className="flex justify-between text-xs font-medium text-slate-600">
                  <span>Asthma rate</span>
                  <span>{draft.asthma}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={30}
                  value={draft.asthma}
                  onChange={(e) => setDraft((d) => ({ ...d, asthma: Number(e.target.value) }))}
                  className="mt-1 w-full accent-teal-600"
                />
                <p className="mt-1 text-[10px] text-slate-400">≥12% counts as high asthma when you apply filters.</p>
              </div>
              <div>
                <div className="flex justify-between text-xs font-medium text-slate-600">
                  <span>Min risk score</span>
                  <span>{draft.minScore}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={draft.minScore}
                  onChange={(e) => setDraft((d) => ({ ...d, minScore: Number(e.target.value) }))}
                  className="mt-1 w-full accent-teal-600"
                />
              </div>
            </div>

            <div className="mt-4 border-t border-slate-100 pt-4">
              <p className="text-sm font-semibold text-[#0f2940]">Area type</p>
              <div className="mt-2 space-y-2">
                {(["", "urban", "rural"] as const).map((v) => (
                  <label key={v || "any"} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="urban_rural"
                      checked={draft.urbanRural === v}
                      onChange={() => setDraft((d) => ({ ...d, urbanRural: v }))}
                      className="border-slate-300 text-teal-600 focus:ring-teal-500"
                    />
                    {v === "" ? "Any" : v === "urban" ? "Urban" : "Rural"}
                  </label>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={applyFilters}
              className="mt-6 w-full rounded-xl bg-[#0f2940] py-3 text-sm font-semibold text-white shadow-sm hover:bg-[#0a1f30]"
            >
              Apply filters
            </button>

            <div className="mt-8">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Top high-risk tracts</h2>
              <p className="text-xs text-slate-400">{stateLabel}</p>
              {noData && (
                <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                  No tract rows in the database yet. Run the ingest script (see repo README) to load boundaries and
                  scores.
                </p>
              )}
              <ul className="mt-3 space-y-3">
                {ranked.slice(0, 8).map((r) => {
                  const pv = previews[r.geoid];
                  const label = r.name ?? `Tract ${r.geoid}`;
                  const sub = r.county_name ? `${r.county_name.split(",")[0]?.trim()}, ${stateAbbr}` : stateAbbr;
                  return (
                    <li key={r.geoid}>
                      <button
                        type="button"
                        onClick={() => onSelectTract(r.geoid)}
                        className="flex w-full gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-left transition hover:border-teal-300 hover:bg-white"
                      >
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-50 text-lg font-bold text-red-500">
                          {r.composite_score != null ? Math.round(r.composite_score) : "—"}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold text-[#0f2940]">{label}</p>
                          <p className="truncate text-xs text-slate-500">{sub}</p>
                          <p className="mt-1 text-xs text-slate-600">
                            {pv?.rent != null ? `${Math.round(pv.rent)}% rent burden` : "—"} ·{" "}
                            {pv?.uninsured != null ? `${pv.uninsured.toFixed(1)}% uninsured` : "—"}
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </aside>

        <div className="relative min-h-[420px] flex-1 p-3 lg:min-h-0 lg:p-4">
          {err && <p className="mb-2 text-sm text-red-600">{err}</p>}
          {!err && geojson == null && (
            <div className="flex min-h-[400px] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/80 text-sm text-slate-500">
              Loading map data…
            </div>
          )}
          {noData && (
            <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-sm">
              <p className="font-semibold">No map data for this state</p>
              <p className="mt-1 text-amber-900/90">
                The API returned an empty GeoJSON layer. The database has the schema but no census tracts loaded for{" "}
                <strong>{stateLabel}</strong>. From the project <code className="rounded bg-white/80 px-1">backend/</code>{" "}
                folder, with Postgres running and <code className="rounded bg-white/80 px-1">DATABASE_URL</code> set, run:
              </p>
              <pre className="mt-3 overflow-x-auto rounded-lg bg-[#0f2940] px-3 py-2 text-xs text-teal-100">
                python ingest.py --states 06,12,17,36,48
              </pre>
              <p className="mt-2 text-xs text-amber-800/90">
                This downloads tract boundaries and indicators (several minutes, requires network). Then refresh this
                page.
              </p>
            </div>
          )}
          {geojson && featureCount > 0 && (
            <NeighborMap
              stateFips={stateFips}
              data={geojson}
              variant="explore"
              onSelectTract={onSelectTract}
            />
          )}
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}

export default function ExplorePage() {
  return (
    <Suspense fallback={<div className="flex min-h-[50vh] items-center justify-center text-slate-500">Loading map…</div>}>
      <ExploreInner />
    </Suspense>
  );
}
