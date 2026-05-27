"use client";

import { useState } from "react";
import type { DisplayIndicator } from "@/lib/api";

type Props = {
  indicators: DisplayIndicator[];
};

export function AdditionalIndicatorsPanel({ indicators }: Props) {
  const [open, setOpen] = useState(false);

  if (indicators.length === 0) return null;

  return (
    <section className="mt-12">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-nh-brown/10 bg-white/80 px-5 py-4 text-left shadow-sm hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nh-terracotta"
        aria-expanded={open}
      >
        <div>
          <h2 className="font-display text-xl font-semibold text-nh-brown">
            Additional health indicators
          </h2>
          <p className="mt-0.5 text-xs text-nh-brown-muted">
            Not included in the composite score. Shown for clinical and program planning context.
          </p>
        </div>
        <span className="shrink-0 text-nh-brown-muted" aria-hidden>
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
          {indicators.map((ind) => (
            <div
              key={ind.metric_name}
              className="rounded-xl border border-nh-brown/10 bg-white/80 px-4 py-3 shadow-sm"
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-nh-brown-muted">
                {ind.display_name}
              </p>
              <p className="mt-1 font-display text-2xl font-bold text-nh-brown">
                {ind.value != null ? `${ind.value.toFixed(1)}%` : "—"}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
