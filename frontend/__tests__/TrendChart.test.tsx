/**
 * TrendChart tests
 *
 * Pure-logic helpers are tested directly.
 * Component rendering is tested for the null case and the hollow-dot rule.
 * The Recharts wrapper itself is not rendered to avoid ResizeObserver/SVG
 * environment issues in jsdom — component integration is covered by the
 * manual browser verification step.
 */

import React from "react";
import { render } from "@testing-library/react";
import {
  computeScoreChange,
  computeYAxisDomain,
  filterToLastNYears,
  TrendChart,
  TrendDot,
} from "@/components/TrendChart";
import type { TractScorePoint } from "@/lib/api";

// ─── filterToLastNYears ──────────────────────────────────────────────────────

describe("filterToLastNYears", () => {
  const pts = (years: number[]): TractScorePoint[] =>
    years.map((y) => ({ year: y, composite_score: 60, data_quality_note: null }));

  it("returns the last n years sorted ascending", () => {
    const result = filterToLastNYears(pts([2020, 2021, 2022, 2023, 2024]), 3);
    expect(result.map((r) => r.year)).toEqual([2022, 2023, 2024]);
  });

  it("returns all years when n >= length", () => {
    const result = filterToLastNYears(pts([2020, 2021]), 3);
    expect(result.map((r) => r.year)).toEqual([2020, 2021]);
  });

  it("handles unsorted input", () => {
    const result = filterToLastNYears(pts([2024, 2020, 2022, 2023, 2021]), 3);
    expect(result.map((r) => r.year)).toEqual([2022, 2023, 2024]);
  });

  it("excludes 2020 by default when 5 years are available", () => {
    const result = filterToLastNYears(pts([2020, 2021, 2022, 2023, 2024]), 3);
    expect(result.some((r) => r.year === 2020)).toBe(false);
  });
});

// ─── computeYAxisDomain ──────────────────────────────────────────────────────

describe("computeYAxisDomain", () => {
  function pts(scores: number[]): TractScorePoint[] {
    return scores.map((s, i) => ({ year: 2022 + i, composite_score: s, data_quality_note: null }));
  }

  it("returns [0, 100] for empty input", () => {
    expect(computeYAxisDomain([])).toEqual([0, 100]);
  });

  it("is never 0–100 when scores are clustered", () => {
    const [lo, hi] = computeYAxisDomain(pts([60, 61, 62]));
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeLessThan(100);
  });

  it("minimum is at least 0", () => {
    const [lo] = computeYAxisDomain(pts([2, 3]));
    expect(lo).toBeGreaterThanOrEqual(0);
  });

  it("maximum is at most 100", () => {
    const [, hi] = computeYAxisDomain(pts([97, 99]));
    expect(hi).toBeLessThanOrEqual(100);
  });

  it("adds at least 5 points of padding on each side for flat data", () => {
    // scores all the same → padding = max(5, 0*0.3) = 5
    const [lo, hi] = computeYAxisDomain(pts([50, 50, 50]));
    expect(lo).toBeLessThanOrEqual(45);
    expect(hi).toBeGreaterThanOrEqual(55);
  });

  it("range is wider than the raw data range", () => {
    const scores = [58, 60, 62];
    const [lo, hi] = computeYAxisDomain(pts(scores));
    expect(lo).toBeLessThan(Math.min(...scores));
    expect(hi).toBeGreaterThan(Math.max(...scores));
  });
});

// ─── computeScoreChange ──────────────────────────────────────────────────────

describe("computeScoreChange", () => {
  function pt(year: number, score: number): TractScorePoint {
    return { year, composite_score: score, data_quality_note: null };
  }

  it("returns null for a single point", () => {
    expect(computeScoreChange([pt(2022, 65)])).toBeNull();
  });

  it("returns positive when score increased", () => {
    const change = computeScoreChange([pt(2022, 60), pt(2024, 70)]);
    expect(change).toBeCloseTo(10);
  });

  it("returns negative when score decreased", () => {
    const change = computeScoreChange([pt(2022, 70), pt(2024, 60)]);
    expect(change).toBeCloseTo(-10);
  });

  it("uses first-to-last not array order", () => {
    // Reversed input: change should still be last.year - first.year
    const change = computeScoreChange([pt(2024, 70), pt(2022, 60)]);
    expect(change).toBeCloseTo(10);
  });
});

// ─── TrendDot (hollow circle for 2020 quality note) ─────────────────────────

describe("TrendDot", () => {
  it("renders a filled circle when no data_quality_note", () => {
    const { container } = render(
      <svg>
        <TrendDot
          cx={10}
          cy={10}
          payload={{ year: 2022, composite_score: 65, data_quality_note: null }}
        />
      </svg>
    );
    const circle = container.querySelector("circle");
    expect(circle).not.toBeNull();
    expect(circle?.getAttribute("fill")).not.toBe("none");
  });

  it("renders a hollow circle when data_quality_note is set (2020)", () => {
    const { container } = render(
      <svg>
        <TrendDot
          cx={10}
          cy={10}
          payload={{
            year: 2020,
            composite_score: 65,
            data_quality_note: "ACS 2020 data has elevated uncertainty",
          }}
        />
      </svg>
    );
    const circle = container.querySelector("circle");
    expect(circle).not.toBeNull();
    expect(circle?.getAttribute("fill")).toBe("none");
  });

  it("renders nothing when coordinates are missing", () => {
    const { container } = render(
      <svg>
        <TrendDot />
      </svg>
    );
    expect(container.querySelector("circle")).toBeNull();
  });
});

// ─── TrendChart component ────────────────────────────────────────────────────

// Stub out the async API call — has_trend=false never calls it anyway,
// but jest module isolation requires the mock to exist.
jest.mock("@/lib/api", () => ({
  getTractTrend: jest.fn(),
}));

// Recharts uses ResizeObserver; stub it for jsdom.
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

describe("TrendChart", () => {
  it("renders nothing when has_trend is false", () => {
    const { container } = render(<TrendChart geoid="060370001001" has_trend={false} />);
    expect(container.firstChild).toBeNull();
  });
});
