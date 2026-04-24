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
            <th className="px-4 py-3 font-semibold text-nh-brown-muted">State pct.</th>
            <th className="px-4 py-3 font-semibold text-nh-brown-muted">National pct.</th>
            <th className="min-w-[140px] px-4 py-3 font-semibold text-nh-brown-muted">Distribution</th>
          </tr>
        </thead>
        <tbody>
          {METRIC_KEYS.map((key: MetricKey) => {
            const ind = byName.get(key);
            const nat = ind?.percentile_national;
            return (
              <tr key={key} className="border-b border-nh-brown/5">
                <td className="px-4 py-3 font-medium text-nh-brown">{METRIC_LABELS[key]}</td>
                <td className="px-4 py-3 font-semibold text-nh-terracotta">
                  {formatMetricValue(key, ind?.value ?? null)}
                </td>
                <td className="px-4 py-3 text-nh-brown-muted">
                  {ind?.percentile_state != null ? `${Math.round(ind.percentile_state)}th` : "—"}
                </td>
                <td className="px-4 py-3 text-nh-brown-muted">{nat != null ? `${Math.round(nat)}th` : "—"}</td>
                <td className="px-4 py-3">
                  <div className="relative h-2 w-full rounded-full bg-nh-sand">
                    {nat != null ? (
                      <span
                        className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-nh-brown bg-white shadow"
                        style={{ left: `${Math.min(100, Math.max(0, nat))}%` }}
                        title={`National percentile ${Math.round(nat)}`}
                      />
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
