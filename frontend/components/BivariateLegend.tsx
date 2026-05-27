"use client";

import { BIVARIATE_COLORS } from "@/lib/mapGeojson";

/**
 * Rows top → bottom: health burden high → low.
 * Columns left → right: housing stress low → high.
 */
const GRID_ROWS: [string, string, string][] = [
  ["3-1", "3-2", "3-3"],
  ["2-1", "2-2", "2-3"],
  ["1-1", "1-2", "1-3"],
];

/** Compact map overlay: title + 3×3 (20px cells, 1px gap) + axis labels, max ~120×130px. */
export function BivariateLegend() {
  return (
    <div
      className="box-border max-h-[130px] max-w-[120px] rounded-lg border border-nh-brown/10 bg-white/95 p-1 shadow-md backdrop-blur-sm"
      role="img"
      aria-label="Bivariate map legend: housing stress versus health burden, three by three tertiles"
    >
      <p className="text-center text-[11px] font-semibold leading-tight text-nh-brown-muted">
        Where burdens overlap
      </p>
      <div className="mt-0.5 flex items-center justify-center gap-px">
        <div className="flex h-[62px] w-[11px] shrink-0 items-center justify-center overflow-visible">
          <span className="inline-block origin-center -rotate-90 whitespace-nowrap text-[10px] leading-none text-nh-brown-muted">
            ↑ Health burden
          </span>
        </div>
        <div
          className="grid shrink-0 grid-cols-3 gap-px"
          style={{ width: "62px", height: "62px" }}
          aria-hidden
        >
          {GRID_ROWS.flatMap((row) =>
            row.map((cell) => (
              <div
                key={cell}
                className="h-5 w-5 shrink-0 rounded-[0.5px]"
                style={{ backgroundColor: BIVARIATE_COLORS[cell] ?? "#cccccc" }}
                title={cell}
              />
            ))
          )}
        </div>
      </div>
      <p className="mt-0.5 text-center text-[10px] leading-tight text-nh-brown-muted">Housing stress →</p>
    </div>
  );
}
