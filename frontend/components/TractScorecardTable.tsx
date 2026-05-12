import { formatMetricValue, METRIC_LABELS } from "@/lib/metricDisplay";
import type { TractDetail } from "@/lib/api";
import { METRIC_KEYS, type MetricKey } from "@/lib/riskScore";

export function TractScorecardTable({ tract }: { tract: TractDetail }) {
  const byName = new Map(tract.indicators.map((i) => [i.metric_name, i]));

  return (
    <div className="overflow-x-auto rounded-2xl border border-nh-brown/10 bg-white shadow-sm">
      <table className="min-w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-nh-brown/10 bg-nh-cream/80">
            <th className="px-4 py-3 font-semibold text-nh-brown">Indicator</th>
            <th className="px-4 py-3 font-semibold text-nh-brown">Tract</th>
            <th className="px-4 py-3 font-semibold text-nh-brown-muted">County pct.</th>
            <th className="px-4 py-3 font-semibold text-nh-brown-muted">State pct.</th>
            <th className="px-4 py-3 font-semibold text-nh-brown-muted">National pct.</th>
          </tr>
        </thead>
        <tbody>
          {METRIC_KEYS.map((key: MetricKey) => {
            const ind = byName.get(key);
            const nat = ind?.percentile_national;
            const val = ind?.value ?? null;
            const moe = ind?.value_moe;
            const showMoe = moe != null && Number.isFinite(moe);
            const highUncertainty =
              showMoe &&
              val != null &&
              Number.isFinite(val) &&
              val !== 0 &&
              Math.abs(moe / val) > 0.3;
            return (
              <tr key={key} className="border-b border-nh-brown/5">
                <td className="px-4 py-3 font-medium text-nh-brown">{METRIC_LABELS[key]}</td>
                <td className="px-4 py-3 font-semibold text-nh-terracotta">
                  <span className="inline-flex flex-wrap items-center gap-x-1.5 align-middle">
                    <span>{formatMetricValue(key, val)}</span>
                    {showMoe ? (
                      <span className="font-normal" style={{ color: "var(--color-text-tertiary)" }}>
                        ±{moe.toFixed(1)}%
                      </span>
                    ) : null}
                    {highUncertainty ? (
                      <span
                        className="inline-flex shrink-0 text-amber-600"
                        role="img"
                        aria-label="High uncertainty — small population in this tract."
                        title="High uncertainty — small population in this tract."
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          className="h-4 w-4"
                          aria-hidden
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                          />
                        </svg>
                      </span>
                    ) : null}
                  </span>
                </td>
                <td className="px-4 py-3 text-nh-brown-muted">
                  {ind?.percentile_county != null ? `${Math.round(ind.percentile_county)}th` : "—"}
                </td>
                <td className="px-4 py-3 text-nh-brown-muted">
                  {ind?.percentile_state != null ? `${Math.round(ind.percentile_state)}th` : "—"}
                </td>
                <td className="px-4 py-3 text-nh-brown-muted">{nat != null ? `${Math.round(nat)}th` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
