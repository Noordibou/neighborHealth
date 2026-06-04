/**
 * API response shapes — types that mirror direct backend payloads.
 * Import from "@/types" (re-exported via index.ts), not directly from this file.
 */

/** Minimal tract record returned by GET /api/tracts list */
export type TractSummary = {
  geoid: string;
  name: string | null;
  state_fips: string;
  county_fips: string;
  county_name: string | null;
  place_name: string | null;
  composite_score: number | null;
  /** Present when backend supports sort_by; units match the active layer. */
  layer_value?: number | null;
  year: number | null;
};

/** Display-only (non-scored) health indicator shown on the tract profile */
export type DisplayIndicator = {
  metric_name: string;
  display_name: string;
  value: number | null;
  source: string;
};

/** Raw indicator value with percentile ranks for one metric */
export type IndicatorRow = {
  source: string;
  metric_name: string;
  value: number | null;
  value_moe: number | null;
  year: number;
  percentile_national: number | null;
  percentile_state: number | null;
  percentile_county: number | null;
};

/** Full tract detail from GET /api/tracts/{geoid} */
export type TractDetail = TractSummary & {
  centroid_lat: number | null;
  centroid_lon: number | null;
  median_rent: number | null;
  median_household_income: number | null;
  indicators: IndicatorRow[];
  display_indicators: DisplayIndicator[];
  risk_score: {
    composite_score: number;
    component_scores: Record<string, number> | null;
    year: number;
    rank?: number | null;
    rank_total?: number | null;
  } | null;
  /** True when ≥2 years of risk_scores exist (enables trend chart). */
  has_trend?: boolean;
  /** Weighted sum of state percentile ranks (0–100); state-relative composite. */
  state_composite_score?: number | null;
};

/** One year's composite score with optional data quality note */
export type TractScorePoint = {
  year: number;
  composite_score: number;
  data_quality_note: string | null;
};

/** Response from GET /api/tracts/{geoid}/trend */
export type TractScoreTrendPayload = {
  geoid: string;
  trend: TractScorePoint[];
};

/** State-level summary from GET /api/states */
export type StateSummary = {
  state_fips: string;
  state_name: string;
  tract_count: number;
};

/** Tract row returned by search endpoints */
export type SearchResultRow = {
  geoid: string;
  name: string | null;
  state_fips: string;
  county_name: string | null;
  composite_score: number | null;
};

/** Response from POST /api/search/from-address */
export type AddressSearchResponse = {
  query: string;
  matched_address: string | null;
  longitude: number | null;
  latitude: number | null;
  results: SearchResultRow[];
  census_tract_geoid: string | null;
  resolver: "none" | "census_geographies" | "postgis_point";
  message: string | null;
};

/** Autocomplete suggestion item from GET /api/search/suggest */
export type SearchSuggestItem = {
  kind: "state" | "county" | "place";
  label: string;
  detail?: string | null;
  query: string;
  state_fips?: string | null;
};

/** Tract demographics from GET /api/tracts/{geoid}/demographics */
export type TractDemographicsRow = {
  geoid: string;
  year: number;
  total_population: number | null;
  median_age: number | null;
  pct_white: number | null;
  pct_black: number | null;
  pct_hispanic: number | null;
  pct_asian: number | null;
  pct_other_race: number | null;
  pct_non_english_home: number | null;
  pct_foreign_born: number | null;
  pct_no_hs_diploma: number | null;
};

/** Nearby FQHC clinic from GET /api/tracts/{geoid}/clinics */
export type NearbyClinicPayload = {
  clinic_id: number;
  name: string;
  address: string | null;
  city: string | null;
  zip_code: string | null;
  latitude: number;
  longitude: number;
  distance_miles: number;
  // API can return null for rank when loaded outside the tract_clinics join
  rank: number | null;
  site_type: string | null;
};
