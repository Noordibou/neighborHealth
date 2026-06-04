import { buildFilteredTractsExportQuery, hasActiveExploreFilters } from "@/lib/exploreExport";
import type { AppliedFilters } from "@/types";

const DEFAULT: AppliedFilters = {
  minScore: 0,
  minPopulation: 0,
  excludeInstitutional: false,
  minRent: 0,
  minUninsured: 0,
  asthmaHigh: false,
  urbanRural: "",
  clinicDist: "",
};

describe("hasActiveExploreFilters", () => {
  it("is false when all filters are default", () => {
    expect(hasActiveExploreFilters(DEFAULT)).toBe(false);
  });

  it("is true when any filter is non-default", () => {
    expect(hasActiveExploreFilters({ ...DEFAULT, minScore: 50 })).toBe(true);
    expect(hasActiveExploreFilters({ ...DEFAULT, clinicDist: "over5" })).toBe(true);
  });
});

describe("buildFilteredTractsExportQuery", () => {
  it("maps explore filters to export query params", () => {
    const qs = buildFilteredTractsExportQuery("6", {
      ...DEFAULT,
      minScore: 40,
      minRent: 30,
      clinicDist: "2",
    });
    const p = new URLSearchParams(qs);
    expect(p.get("state_fips")).toBe("06");
    expect(p.get("min_score")).toBe("40");
    expect(p.get("min_rent_burden")).toBe("30");
    expect(p.get("max_clinic_dist")).toBe("2");
  });
});
