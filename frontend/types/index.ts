/**
 * Single source of truth for all shared TypeScript types in the NeighborHealth frontend.
 * Import from "@/types" rather than from scattered source files.
 */

import type { MetricKey as _MetricKey } from "@/lib/riskScore";
import type { TractScorePoint as _TractScorePoint } from "./api";

// ============================================================
// API
// ============================================================
// Direct API response shapes (defined in ./api.ts)

export type {
  TractSummary,
  DisplayIndicator,
  IndicatorRow,
  TractDetail,
  TractScorePoint,
  TractScoreTrendPayload,
  StateSummary,
  SearchResultRow,
  AddressSearchResponse,
  SearchSuggestItem,
  TractDemographicsRow,
  NearbyClinicPayload,
} from "./api";

// ============================================================
// INDICATORS AND METRICS
// ============================================================
// The 7 scored metrics, MetricKey literal union, and weight map

/** Ordered tuple of the 7 scored metric keys — order is preserved for normalization and display */
export { METRIC_KEYS } from "@/lib/riskScore";
export type { MetricKey, TractValues } from "@/lib/riskScore";

/** Weights keyed by every scored metric — must sum to 1 after clampWeights() */
export type WeightMap = Record<_MetricKey, number>;

// ============================================================
// MAP
// ============================================================
// Layer modes, GeoJSON display modes, and bivariate classification

/** Choropleth layer tabs available in the map explorer */
export type MapLayerMode = "composite" | "housing" | "health";

/** All map layer modes including the bivariate overlap view */
export type ExploreLayerMode = MapLayerMode | "overlap";

/** Map interaction mode — browsing ranked tracts vs viewing search results */
export type MapMode = "browse" | "search";

// ============================================================
// GEOGRAPHY
// ============================================================
// Viewport and spatial navigation types

/** Map camera state — kept in URL params and session storage */
export type Viewport = { lng: number; lat: number; zoom: number };

// ============================================================
// COMPOSITE SCORING
// ============================================================
// Scored tract rows for the ranked list and export

/** Tract row used in the TopTractsPanel ranked list */
export type RankedTractRow = {
  geoid: string;
  composite_score: number | null;
  layer_value: number | null;
  name: string | null;
  county_name: string | null;
};

// ============================================================
// EXPLORE URL / FILTERS
// ============================================================
// Applied and draft filter state persisted in URL params

/** Active filter state reflected in the URL and sent to the API */
export type AppliedFilters = {
  minScore: number;
  minPopulation: number;
  excludeInstitutional: boolean;
  minRent: number;
  minUninsured: number;
  asthmaHigh: boolean;
  urbanRural: "" | "urban" | "rural";
  clinicDist: "" | "1" | "2" | "5" | "over5";
};

/** Uncommitted slider/field values before the user clicks Apply */
export type DraftFilters = {
  minScore: number;
  minRent: number;
  minUninsured: number;
  asthma: number;
  urbanRural: "" | "urban" | "rural";
};

// ============================================================
// SESSION
// ============================================================
// Explore map session persisted to sessionStorage for Back-button restore

export type { ExploreMapSessionV1 } from "@/lib/exploreMapSession";

// ============================================================
// DEMOGRAPHICS
// ============================================================
// Income map used by the compare insights generator

/** Per-GEOID income lookup used by buildCompareInsights */
export type CompareDemographicsIncomeMap = Record<
  string,
  { median_household_income: number | null } | null
>;

// ============================================================
// COMPARE
// ============================================================
// Types for the compare page trend chart

/** One tract's contribution to the CompareTrendChart series */
export type TractTrendSeries = {
  geoid: string;
  label: string;
  trend: _TractScorePoint[] | null;
};

// ============================================================
// UI STATE
// ============================================================
// Reusable generic for async loading states and shared component props

/** Generic discriminated union for async data — replaces ad-hoc "loading"/"ready"/"error" strings */
export type AsyncState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: T };

/** Props for TrendChart and TrendChartLazy */
export type TrendChartProps = {
  geoid: string;
  has_trend: boolean;
};
