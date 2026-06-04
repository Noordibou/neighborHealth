"use client";

import { API_BASE } from "@/lib/api";
import { useEffect, useLayoutEffect, useState } from "react";
import { RACE_SEGMENTS } from "@/lib/demographics";
import { CollapseChevron } from "@/components/CollapseChevron";
import type { TractDemographicsRow } from "@/types";

function dashNum(v: number | null | undefined, digits: number): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

function dashPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(1)}%`;
}


function DemographicsSkeleton() {
  return (
    <div className="mt-10 rounded-2xl border border-nh-brown/10 bg-white p-6 shadow-sm">
      <div className="h-6 w-40 animate-pulse rounded-md bg-nh-sand" />
      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex justify-between gap-4">
              <div className="h-4 w-28 animate-pulse rounded bg-nh-sand" />
              <div className="h-4 w-16 animate-pulse rounded bg-nh-cream-dark" />
            </div>
          ))}
        </div>
        <div className="space-y-3">
          <div className="h-8 w-full animate-pulse rounded-lg bg-nh-sand" />
          <div className="flex flex-wrap gap-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-4 w-24 animate-pulse rounded bg-nh-cream-dark" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function RaceEthnicityBar({ data }: { data: TractDemographicsRow }) {
  const segments = RACE_SEGMENTS.map((s) => ({
    ...s,
    pct: data[s.key],
  })).filter((s) => s.pct != null && Number.isFinite(s.pct) && s.pct > 0);

  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-nh-brown-muted">Race / ethnicity</p>
      {segments.length > 0 ? (
        <div className="mt-2 flex h-10 w-full overflow-hidden rounded-lg ring-1 ring-nh-brown/10">
          {segments.map((s) => (
            <div
              key={s.key}
              className="relative flex min-w-0 items-center justify-center"
              style={{ width: `${s.pct}%`, backgroundColor: s.barColor }}
              title={`${s.label}: ${s.pct!.toFixed(1)}%`}
            >
              {s.pct! > 8 ? (
                <span className={`truncate px-1 text-[11px] font-semibold tabular-nums ${s.labelClass}`}>
                  {s.pct!.toFixed(1)}%
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-2 flex h-10 w-full items-center justify-center rounded-lg bg-nh-cream/80 ring-1 ring-nh-brown/10 text-sm text-nh-brown-muted">
          —
        </div>
      )}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-nh-brown-muted">
        {RACE_SEGMENTS.map((s) => {
          const v = data[s.key];
          return (
            <li key={s.key} className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm ring-1 ring-nh-brown/15"
                style={{ backgroundColor: s.barColor }}
                aria-hidden
              />
              <span className="text-nh-brown-muted">{s.label}</span>
              <span className="font-semibold tabular-nums text-nh-brown">{dashPct(v)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}


export function DemographicsPanel({ geoid }: { geoid: string }) {
  const [state, setState] = useState<"loading" | "absent" | "ready">("loading");
  const [data, setData] = useState<TractDemographicsRow | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  useLayoutEffect(() => {
    setPanelOpen(true);
  }, [geoid]);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setData(null);

    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/tracts/${geoid}/demographics`, {
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        if (cancelled) return;
        if (res.status === 404) {
          setState("absent");
          setData(null);
          return;
        }
        if (!res.ok) {
          setState("absent");
          setData(null);
          return;
        }
        const json = (await res.json()) as TractDemographicsRow;
        setData(json);
        setState("ready");
      } catch {
        if (!cancelled) {
          setState("absent");
          setData(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [geoid]);

  if (state === "loading") {
    return <DemographicsSkeleton />;
  }
  if (state === "absent" || !data) {
    return null;
  }

  return (
    <details
      key={geoid}
      open={panelOpen}
      onToggle={(e) => setPanelOpen(e.currentTarget.open)}
      className="mt-10 rounded-2xl border border-nh-brown/10 bg-white shadow-sm [&_summary::-webkit-details-marker]:hidden"
    >
      <summary
        className="flex cursor-pointer list-none items-center justify-between gap-3 px-6 py-4 font-display text-lg font-semibold text-nh-brown transition hover:bg-nh-cream/40"
        title="Click to expand or collapse demographics"
      >
        <span>Demographics</span>
        <CollapseChevron isOpen={panelOpen} />
      </summary>
      <div className="border-t border-nh-brown/10 px-6 pb-6 pt-4">
        <div className="grid gap-8 sm:grid-cols-2">
          <div className="space-y-4 text-sm">
            <div className="flex justify-between gap-4 border-b border-nh-brown/5 pb-3">
              <span className="text-nh-brown-muted">Median age</span>
              <span className="font-semibold tabular-nums text-nh-brown">{dashNum(data.median_age, 1)}</span>
            </div>
            <div className="flex justify-between gap-4 border-b border-nh-brown/5 pb-3">
              <span className="text-nh-brown-muted">Foreign born</span>
              <span className="font-semibold tabular-nums text-nh-brown">{dashPct(data.pct_foreign_born)}</span>
            </div>
            <div className="flex justify-between gap-4 border-b border-nh-brown/5 pb-3">
              <span className="text-nh-brown-muted">Non-English at home</span>
              <span className="font-semibold tabular-nums text-nh-brown">{dashPct(data.pct_non_english_home)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-nh-brown-muted">No HS diploma</span>
              <span className="font-semibold tabular-nums text-nh-brown">{dashPct(data.pct_no_hs_diploma)}</span>
            </div>
          </div>
          <RaceEthnicityBar data={data} />
        </div>
        <p className="mt-4 text-[10px] text-nh-brown-muted">
          ACS 5-year estimates · Year <span className="tabular-nums">{data.year}</span>
        </p>
      </div>
    </details>
  );
}
