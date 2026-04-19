"use client";

import type { ReactNode } from "react";

type Props = {
  title: string;
  valueLabel: string;
  statePct: number | null;
  nationalPct: number | null;
  icon?: ReactNode;
};

/** Percentile 0–100 → lit quintile blocks (1–5) */
function quintileActive(pct: number | null): number {
  if (pct == null || Number.isNaN(pct)) return 0;
  return Math.min(5, Math.max(1, Math.ceil(pct / 20)));
}

export function MetricCard({ title, valueLabel, statePct, nationalPct, icon }: Props) {
  const qState = quintileActive(statePct);
  const qNat = quintileActive(nationalPct);

  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        {icon && <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-700">{icon}</div>}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
          <p className="mt-1 text-2xl font-bold text-[#0f2940]">{valueLabel}</p>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <div>
          <div className="mb-0.5 flex justify-between text-[10px] font-medium text-slate-500">
            <span>State</span>
            {statePct != null && <span className="text-teal-800">{Math.round(statePct)}th</span>}
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-teal-600 transition-all"
              style={{ width: statePct != null ? `${Math.min(100, statePct)}%` : "0%" }}
            />
          </div>
        </div>
        <div>
          <div className="mb-0.5 flex justify-between text-[10px] font-medium text-slate-500">
            <span>National</span>
            {nationalPct != null && <span className="text-orange-600">{Math.round(nationalPct)}th</span>}
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-orange-500 transition-all"
              style={{ width: nationalPct != null ? `${Math.min(100, nationalPct)}%` : "0%" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
