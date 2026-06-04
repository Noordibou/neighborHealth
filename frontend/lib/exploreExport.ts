import type { AppliedFilters } from "@/types";

export function hasActiveExploreFilters(applied: AppliedFilters): boolean {
  return (
    applied.minScore > 0 ||
    applied.minPopulation > 0 ||
    applied.excludeInstitutional ||
    applied.minRent > 0 ||
    applied.minUninsured > 0 ||
    applied.asthmaHigh ||
    applied.urbanRural !== "" ||
    applied.clinicDist !== ""
  );
}

/** Query string for GET /api/export/filtered-tracts from explore applied filters. */
export function buildFilteredTractsExportQuery(stateFips: string, applied: AppliedFilters): string {
  const p = new URLSearchParams();
  p.set("state_fips", stateFips.padStart(2, "0").slice(0, 2));
  if (applied.minScore > 0) p.set("min_score", String(Math.round(applied.minScore)));
  if (applied.minPopulation > 0) p.set("min_population", String(applied.minPopulation));
  if (applied.excludeInstitutional) p.set("exclude_institutional", "true");
  if (applied.minRent > 0) p.set("min_rent_burden", String(applied.minRent));
  if (applied.minUninsured > 0) p.set("min_uninsured", String(applied.minUninsured));
  if (applied.asthmaHigh) p.set("high_asthma", "true");
  if (applied.clinicDist === "1" || applied.clinicDist === "2" || applied.clinicDist === "5") {
    p.set("max_clinic_dist", applied.clinicDist);
  } else if (applied.clinicDist === "over5") {
    p.set("min_clinic_dist", "5");
  }
  return p.toString();
}
