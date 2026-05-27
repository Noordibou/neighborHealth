# NeighborHealth — Claude Code Context

NeighborHealth is a geospatial public health prioritization tool for US census
tracts. It combines HUD/ACS housing indicators with CDC PLACES health estimates
into a composite index (0–100) that identifies where housing stress and health
burden overlap. Used by ~210 nonprofits, health departments, and government
agencies for grant targeting, outreach planning, and community health needs
assessments.

---

## How to run things

```bash
# Backend dev server
uvicorn backend.app.main:app --reload

# Frontend dev server
npm run dev

# Run ingest (full national, latest year)
python -m backend.ingest --year 2022

# Run ingest (single state, for testing)
python -m backend.ingest --year 2022 --state 06

# Apply DB migrations
alembic upgrade head

# Backend tests
pytest backend/tests/ -v

# Frontend tests
npm test

# Frontend build
npm run build
```

---

## Stack

| Layer | Technology |
|---|---|
| Backend | Python, FastAPI (async), SQLAlchemy (async), Alembic |
| Database | PostgreSQL |
| Frontend | Next.js 14, React, TypeScript, Tailwind CSS |
| Map | MapLibre GL (780KB chunk — always lazy-context aware) |
| Charts | Recharts — lazy-loaded via next/dynamic on /compare and /tract only |
| PDF | WeasyPrint (server-side, Jinja2 templates) |
| Ingest HTTP | httpx (async) |

---

## Project structure

```
backend/
  app/
    api/            # FastAPI route handlers
      tracts.py     # /api/tracts — detail, score, trend, clinics, demographics
      compare.py    # /api/compare
      search.py     # /api/search, /api/search/suggest, /api/search/from-address
      export_api.py # /api/export/tracts.csv, compare-csv, compare-pdf, pdf
    models/         # SQLAlchemy models
    services/
      risk_score.py       # compute_batch_scores, clamp_weights, _min_max_normalize
      score_recalc.py     # recalculate_risk_scores, get_cached_metric_map,
                          # get_cached_default_scores, invalidate_metric_map_cache
      ai_service.py       # LLM tract summary generation
      pdf_export.py       # build_pdf_bytes, build_compare_pdf_bytes, _ordinal_suffix
    templates/      # Jinja2 HTML templates for PDF rendering
  alembic/
    versions/       # DB migrations — always read latest before creating new one
  ingest.py         # Full ingest pipeline entry point

frontend/
  app/
    explore/        # Map explorer — 1,753 lines, 49 hooks, treat carefully
    compare/        # Side-by-side tract comparison
    tract/[geoid]/  # Tract profile page
  components/
    NeighborMap.tsx         # MapLibre GL map — wrapped in React.memo
    TractScorecardTable.tsx # Indicator table with MOE display
    TrendChart.tsx          # 3-year sparkline — lazy, only when has_trend=true
    NearbyClinicPanel.tsx   # HRSA clinic list
    DemographicsPanel.tsx   # Demographics collapsible panel
    BivariateLegend.tsx     # 3×3 overlap map legend
  lib/
    mapGeojson.ts        # augmentGeoJSONForYear + applyLayerMode (SPLIT — read note)
    riskScore.ts         # Frontend mirror of scoring logic
    compareInsights.ts   # buildCompareInsights — rule-based auto-summary
    compareTray.ts       # sessionStorage compare tray, max 4 tracts
    api.ts               # Fetch utilities
```

---

## Data sources and vintages

| Source | Vintage | Endpoint | Notes |
|---|---|---|---|
| ACS housing | 2022 5-year | api.census.gov/data/2022/acs/acs5 | DATA_YEAR = 2022 |
| ACS demographics | 2022 5-year | Same endpoint | B01001, B03002, B16001, B15003 |
| ACS context fields | 2022 5-year | Same endpoint | B25058 (median rent), B19013 (income), B25004 (vacancy by reason) |
| CDC PLACES | 2023 release | chronicdata.cdc.gov/resource/hky2-3tpn.json | Dataset ID hky2-3tpn |
| HRSA FQHCs | Current | data.hrsa.gov/api/download?filename=HCSODSite_DATA_MAIN.csv | Operational sites only |
| Heat index | Computed | — | clamp(150 - 3 × centroid_lat, 0, 100) |
| 2020/2021 ACS | Backfilled | api.census.gov/data/2020/ and /2021/ | 2020 has elevated MOE — flagged in trend chart |

ACS sentinel for suppressed values: `-666666666` — always check before converting to float.

---

## The 7 scored metrics (METRIC_KEYS)

These are the only metrics that feed into the composite score.
Do not add to this list without updating the scoring pipeline, cache invalidation,
and the DB cohort inclusion rule.

| Key | Source | Formula | Default weight |
|---|---|---|---|
| rent_burden_pct | ACS B25070 | (007E+008E+009E+010E) / 001E × 100 | 0.25 |
| uninsured_pct | CDC PLACES | access2_crudeprev (passthrough) | 0.20 |
| overcrowding_pct | ACS B25014 | (005E+006E+007E+011E+012E+013E) / 001E × 100 | 0.20 |
| mental_health_pct | CDC PLACES | mhlth_crudeprev (passthrough) | 0.15 |
| asthma_pct | CDC PLACES | casthma_crudeprev (passthrough) | 0.10 |
| structural_vacancy_rate | ACS B25002 + B25004 | (B25002_003E − B25004_006E) / B25002_001E × 100 | 0.05 |
| heat_index | Computed | clamp(150 − 3 × lat, 0, 100) | 0.05 |

**disability_pct** is stored as an indicator (source: cdc_places, disability_crudeprev) but is **not scored**. It appears on the tract profile as a display-only context indicator. After this change, existing `risk_scores` rows computed with the old METRIC_KEYS are stale — run `DELETE FROM risk_scores;` then re-ingest or call `recalculate_risk_scores()` for each year before going live.

**Cohort inclusion rule:** A tract must have all 7 metrics present to receive a
composite score. Tracts missing any metric are excluded from scoring and
percentile computation. This is enforced in `score_recalc.py` and `ingest.py`.

**Missing value handling in normalization:** A missing metric value becomes 50.0
(not excluded) inside `_min_max_normalize`. This only affects the on-demand
custom-weight endpoint, not stored scores.

---

## Scoring architecture

```
compute_batch_scores() — backend/app/services/risk_score.py
  1. min-max normalize each metric to 0–100 across the full cohort
  2. weighted sum of normalized values
  3. clamp result to 0–100

Default weights: rent_burden 0.25 · uninsured 0.20 · overcrowding 0.20 · mental_health 0.15 · asthma 0.10 · structural_vacancy 0.05 · heat_index 0.05
Weight rules: negative weights clamped to 0, then renormalized to sum=1
```

**Two-layer in-process cache** — do not bypass or duplicate:
- Layer 1: `get_cached_metric_map(session, year)` — caches 147K indicator rows, TTL 1hr
- Layer 2: `get_cached_default_scores(session, year)` — caches full 21K-tract scored batch, TTL 1hr
- Custom weight requests use cached component scores + dot product (7 multiplications)
- Both layers invalidated by `invalidate_metric_map_cache()` at end of ingest

**Performance baseline (post-optimization):**
- /score default weights warm: 8–11ms
- /score custom weights warm: 7–12ms
- /score cold (cache miss): ~45ms
- /compare warm: 20–32ms

---

## Database schema (key tables)

```
indicators          (geoid, metric_name, year, value, source,
                     percentile_national, percentile_state, percentile_county,
                     value_moe)
                    — 589K rows, 7 metrics × 3 years × ~28K scored tracts

risk_scores         (geoid, year, composite_score, component_scores, weights_used)
                    — 84K rows, 3 years

tracts              (geoid, name, state_fips, county_name, population,
                     median_rent, median_household_income,
                     centroid_lat, centroid_lng, is_institutional)

tract_demographics  (geoid, year, total_population, median_age,
                     pct_white, pct_black, pct_hispanic, pct_asian,
                     pct_other_race, pct_non_english_home,
                     pct_foreign_born, pct_no_hs_diploma)

clinics             (id, hrsa_id, name, address, city, state_fips, zip_code,
                     latitude, longitude, is_operational, site_type, updated_at)

tract_clinics       (geoid, clinic_id, distance_miles, rank)
                    — rank 1/2/3 only, max 3 nearest clinics per tract
                    — PK: (geoid, rank)
```

**Performance indexes (all added in add_performance_indexes migration):**
- `ix_risk_scores_year` ON risk_scores(year)
- `ix_risk_scores_year_score` ON risk_scores(year, composite_score DESC)
- `ix_indicators_metric_year` ON indicators(metric_name, year)
- `ix_indicators_geoid_year` ON indicators(geoid, year)
- `ix_indicators_metric_year_value` ON indicators(metric_name, year, value DESC) — added in add_integrity_constraints_and_fixes migration; covers value-range filters (min_rent_burden, min_uninsured, high_asthma)

Note: CONCURRENTLY indexes cannot run inside a transaction block with asyncpg.
Production index creation SQL is in the migration docstring for out-of-band use.

**Indicators unique constraint:** `uq_indicator_tract_metric_year` on `(geoid, metric_name, year)`.
The old constraint `uq_indicator_tract_source_metric_year` included `source` in the key, which
allowed silent duplicate metrics if a source name changed. The new constraint is tighter.
Migration: add_integrity_constraints_and_fixes.

---

## Percentiles

Three scopes stored per indicator row: national, state, county.
Computed in `ingest.py :: update_percentiles()` using SQL `PERCENT_RANK()` window
functions — NOT the Python `_percentile_rank()` helper (which exists for
single-value lookups only and is O(log N) via bisect, not O(N) linear scan).

Higher percentile = higher raw value relative to peers.
For burden metrics (rent, overcrowding, uninsured) higher = worse.
This is intentional — the scoring treats all metrics as "higher is more burden."

state_fips is always zero-padded to 2 characters: str(state_fips).zfill(2)
This matters for single-digit FIPS codes (Alaska=02, Alabama=01, etc.).

---

## Frontend patterns

**Do not import recharts directly at the page level.** Use next/dynamic:
```typescript
const TrendChart = dynamic(() => import('@/components/TrendChart'), {
  ssr: false,
  loading: () => <div className="skeleton h-18 w-full" />
})
```

**NeighborMap is wrapped in React.memo** — keep all callback props in useCallback
to preserve referential stability. Primitive props (strings, booleans) are fine as-is.

**Explore `/explore` US overview (no state)** — Camera is fixed to conterminous US via
`getExploreUsOverviewView()` in `lib/exploreMapPlaceholder.ts`. With no `state=` / tract context,
`lat`/`lng`/`zoom` URL params are not applied on load and are not updated on pan/zoom, so a hard
reload never jumps to a saved “world” bookmark on the state picker.

**GeoJSON augmentation is split into two functions** — never combine them back:
- `augmentGeoJSONForYear(geojson)` — expensive, runs once on data load
  Computes bivariate classes, tertile breaks, housing/health scores per feature
- `applyLayerMode(augmentedGeoJSON, mode)` — cheap O(N), runs on layer switch
  Sets nh_map_value on each feature, uses setData() on MapLibre source

**Bivariate color matrix** — defined as BIVARIATE_COLORS in mapGeojson.ts.
9 combinations (1-1 through 3-3). X axis = housing stress, Y axis = health burden.
Do not hardcode these hex values elsewhere — import from mapGeojson.ts.

**Compare tray** — sessionStorage, max 4 tracts, geoids passed as URL param to /compare.
**Layer modes** — Composite, Housing, Health, Overlap (bivariate).

**Basemap label / symbol layer ordering** — Choropleth fills must be inserted **before** the
basemap's first `symbol` layer (or at least before any symbol layer that draws place/road text).
`NeighborMap.tsx` resolves this on `onLoad` from `map.getStyle().layers` and passes it as
`beforeId` for tract and state layers. Hard-coding `waterway_line_label` only matches OpenFreeMap
Liberty; styles like Carto Voyager use different ids (and place labels can appear *above* that
anchor if mis-ordered). If `beforeId` does not exist, MapLibre refuses to add the layer — labels
then look fine but tracts vanish.

**MapLibre GL 4.x worker setup** — In Next.js (webpack transpile), `maplibregl.getWorkerUrl()`
returns `""` by default, causing `new Worker("")` to silently fail. Geometry renders via a
fallback path, but glyphs (required for text labels) strictly need the worker. Fix:
- `public/maplibre-worker.js` is a copy of `node_modules/maplibre-gl/dist/maplibre-gl-csp-worker.js`
- `NeighborMap.tsx` calls `maplibregl.setWorkerUrl(new URL("/maplibre-worker.js", window.location.href).href)` once at module scope
- When updating `maplibre-gl`, re-copy the worker: `cp node_modules/maplibre-gl/dist/maplibre-gl-csp-worker.js public/maplibre-worker.js`

---

## PDF generation

Two templates in backend/app/templates/:
- Tract report: used by `build_pdf_bytes()`
- Compare report: used by `build_compare_pdf_bytes()`

WeasyPrint is synchronous — wrapped in `asyncio.to_thread()` to avoid blocking
the event loop. All colors in templates are hardcoded hex (WeasyPrint does not
resolve CSS variables).

**`_ordinal_suffix(n)`** — always use this for percentile display.
Handles 11th/12th/13th correctly (not 11st/12nd/13rd).

The compare PDF has NO county median column — it was removed because it was
computing the median of only the 2–4 selected tracts, not a true county statistic.
Do not add it back without building a real county benchmark from DB peers.

---

## Known technical debt

- **Task 20 (weight profiles) is not yet implemented.** The backend endpoint
  `GET /api/tracts/{geoid}/score` already accepts custom weight query params.
  The frontend weight slider UI (Task 1) is pending a product decision about
  scope — whether weights re-drive the full map or are a per-tract preview only.

- **The `/api/map/tracts` GeoJSON for large states** (CA = 9,129 polygons) is
  served with GZip compression (~0.6s after fix). If latency becomes an issue
  again, the next step is PostGIS `ST_Simplify(geometry, 0.001)` in the query
  or switching to PMTiles vector tiles.

- **Ingest scheduler** (Task 4) is a GitHub Actions workflow that triggers
  annually in December after ACS data release. No real-time data pipeline exists.

- **Search does not support ZIP code** unless zip_code column is populated.
  The column exists on the Tract model but ingest does not yet populate it
  (requires HUD USPS crosswalk — separate task).

- **HUD CHAS** is referenced in UI copy (tract profile data sources section)
  but the ingest pipeline uses ACS B25070/B25014 directly. Either update the
  UI copy or implement the CHAS loader.

- **backend/app/services/percentiles.py** has been deleted. If you see a
  reference to it anywhere, it is stale and should be removed.

---

## What NOT to do

- Do not add to METRIC_KEYS without updating scoring, cache, and DB cohort rule
- Do not call `load_metric_map_for_year` directly — use `get_cached_metric_map`
- Do not call `compute_batch_scores` for single-tract custom weight requests —
  use the cached component scores dot product path in `get_tract_score()`
- Do not run `SELECT * FROM tracts` or load the geometry column in ingest queries
  (geometry column is ~5KB per row — always SELECT explicit columns)
- Do not combine augmentGeoJSONForYear and applyLayerMode back into one function
- Do not import recharts at page level — always use next/dynamic
- Do not add the "County median" column back to compare PDF
- Do not use -666666666 ACS values as real data — always null-check before float conversion
- Do not create migrations with CREATE INDEX CONCURRENTLY inside a transaction
  (asyncpg driver issue — put CONCURRENTLY SQL in the migration docstring for
  manual production use, use op.create_index(if_not_exists=True) in the migration)

---

## Testing

```bash
# Run full backend suite
pytest backend/tests/ -v

# Run specific test file
pytest backend/tests/test_scoring.py -v

# Run frontend suite
npm test

# Run frontend in watch mode
npm test -- --watch
```

47 tests total across 3 test blocks (DB integrity, API endpoints, frontend components).
All 47 pass on main. Do not merge code that breaks any test.

Key tests to run after any scoring or ingest change:
- `test_compute_batch_scores_default_weights`
- `test_custom_weights_dot_product`
- `test_clamp_weights_negative`
- `test_ordinal_suffix`

---

## Sprint status

| Sprint | Items | Status |
|---|---|---|
| Sprint 1 | Tasks 1–9 | Tasks 3–9 complete. Tasks 1–2 (weight sliders + URL encoding) pending Task 20 product decision |
| Sprint 2 | Items 10–16 | Complete |
| Sprint 3 | Items 17–19 | Complete |
| Sprint 3 | Item 20 (weight profiles) | Not started — use Path B (localStorage) if no auth system |
| Optimization | Sessions 1–4 | Complete — all 8 profiling items resolved |