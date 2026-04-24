"use client";

import type { ReactNode } from "react";

type Props = {
  title: string;
  valueLabel: string;
  statePct: number | null;
  nationalPct: number | null;
  icon?: ReactNode;
};

export function MetricCard({ title, valueLabel, statePct, nationalPct, icon }: Props) {
  return (
    <div className="flex flex-col rounded-xl border border-nh-brown/10 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        {icon && (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-nh-cream text-nh-terracotta">
            {icon}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-nh-brown-muted">{title}</p>
          <p className="mt-1 text-2xl font-bold text-nh-brown">{valueLabel}</p>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <div>
          <div className="mb-0.5 flex justify-between text-[10px] font-medium text-nh-brown-muted">
            <span>State</span>
            {statePct != null && <span className="text-nh-brown">{Math.round(statePct)}th</span>}
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-nh-sand">
            <div
              className="h-full rounded-full bg-nh-terracotta transition-all"
              style={{ width: statePct != null ? `${Math.min(100, statePct)}%` : "0%" }}
            />
          </div>
        </div>
        <div>
          <div className="mb-0.5 flex justify-between text-[10px] font-medium text-nh-brown-muted">
            <span>National</span>
            {nationalPct != null && <span className="text-nh-terracotta">{Math.round(nationalPct)}th</span>}
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-nh-sand">
            <div
              className="h-full rounded-full bg-nh-terracotta/70 transition-all"
              style={{ width: nationalPct != null ? `${Math.min(100, nationalPct)}%` : "0%" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
