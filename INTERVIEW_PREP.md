# NeighborHealth Frontend — Interview Prep

> Study tonight. Skim the bold lines tomorrow morning.
> Every answer here cites actual code from the project.

---

## 1. PROJECT OVERVIEW (30-second elevator pitch)

NeighborHealth is a **geospatial public health prioritization tool** used by ~210 nonprofits, health departments, and government agencies to find census tracts where housing stress and health burden overlap. I built the **Next.js 15 App Router frontend** — a map explorer with a 9,000+ polygon choropleth, a side-by-side tract comparison page, individual tract scorecards with 3-year trend charts and nearby clinic panels, and PDF/CSV export. The most technically demanding part was the map explorer: I split GeoJSON augmentation into two functions — `augmentGeoJSONForYear` (O(N log N) bivariate classification, runs once on data load) and `applyLayerMode` (O(N) property write, runs on layer tab switch) — eliminating a complete re-sort on every layer toggle for California's 9,129-polygon dataset. I also extracted the URL sync and search logic from a 1,600-line ExploreInner component into two custom hooks, making the component testable and reducing it to ~500 lines.

**One-line summary:** A real production tool with a map, comparison UI, and export pipeline — I built all of it.

---

## 2. REACT AND COMPONENT ARCHITECTURE

### How I structured components and data flow

The app has **three main pages**: the map explorer (`/explore`), the side-by-side compare view (`/compare`), and individual tract profiles (`/tract/[geoid]`). Each page owns its own state and passes data down to shared components.

The component tree is split between **page-level orchestrators** and **feature-focused leaf components**. `ExploreInner` (`app/explore/page.tsx`) manages all explore state — selected tract, layer mode, filter draft/applied split, compare tray, search results, sessionStorage — and passes narrow slices to `NeighborMap`, `TopTractsPanel`, and `TractDetailPanel` via props. I deliberately avoided lifting state to a global store because the data flows in clear parent-to-child directions with no cross-page sharing beyond the compare tray.

The **shared component library** I built from scratch includes: `TrendChart` (sparkline with data quality flag dots), `TrendChartLazy` (next/dynamic wrapper), `DemographicsPanel` (collapsible with race bar + stat grid), `NearbyClinicPanel` (HRSA FQHC list), `TractScorecardTable` (indicator table with margin-of-error display), `CompareProfileChart` (Recharts line chart for 7-metric shapes), `CompareTrendChart` (multi-tract trend line), `AdditionalIndicatorsPanel` (display-only health metrics accordion), `BivariateLegend` (3×3 housing×health matrix), `TopTractsPanel` (ranked list with filter panel and CSV export), `TractDetailPanel` (map sidebar), `ScorecardActions` (PDF/CSV/Share/Compare buttons), `CollapseChevron` (animated svg), `TractMapBackControl` (router.back() wrapper), `AppChrome` (conditional header routing), `SiteHeader`, and `BrandWordmark`.

Parent-to-child data flow is explicit: `ExploreInner` holds `TractDetail | null` and passes it to `TractDetailPanel`. The compare page holds the API response in a single `data` state object and derives everything else via `useMemo`. Leaf components fire callbacks (`onSelectTract`, `onAddToCompare`) to signal intent upward.

**One-line summary:** Three page orchestrators, ~18 shared components, props-down/callbacks-up, no global state library.

---

### Custom hooks I built

**`useExploreUrlSync`** (`frontend/app/explore/useExploreUrlSync.ts`)
- **Problem:** URL sync for selected tract, layer mode, five filter params, and viewport (lat/lng/zoom) was tangled into `ExploreInner`'s render logic.
- **What it does:** Reads URL on first hydration, writes URL on every relevant state change (via `window.history.replaceState` + `router.replace`), handles viewport debounce (500ms), defers viewport writes when the map is animating (`suppressViewportUrl`), and fires a pending `map.jumpTo()` when the map becomes ready after a page load.
- **Returns:** `{ onExploreMapMoveEnd, clearViewport, suppressViewportUrl }` — three callbacks the explore page uses to talk back to the URL sync.
- **Why extracted:** The URL logic had its own ref-based debounce timers and was hiding in `ExploreInner`. Extracting it let me test `parseExploreUrl` independently and cut ~300 lines from the page component.

**`useExploreSearch`** (`frontend/app/explore/useExploreSearch.ts`)
- **Problem:** Address geocoding, text search, suggestion autocomplete, and map GeoJSON loading were all mixed into `ExploreInner`.
- **What it does:** Maintains `q`, `suggestions`, `suggestOpen`, `searchNarrowFips`, and `searchResultsExpanded` state. Runs a 260ms debounced suggest fetch on keystroke. On submit, tries Census Bureau address geocoding first (`searchFromAddress`), falls through to text search (`searchTracts`), then fetches GeoJSON for matched GEOIDs (`postMapTractsByGeoids`). Calls parent setters for map mode, GeoJSON, search results, and errors.
- **Returns:** `{ q, setQ, suggestions, suggestOpen, setSuggestOpen, onSearchSubmit, onPickSuggestion, clearSearch, ... }` — everything the search bar UI needs.
- **Why extracted:** Search had an internal fallback chain (address → text), its own abort pattern, and its own side effects. It belonged in one place, not scattered across `ExploreInner`.

**One-line summary:** Two custom hooks extracted from a 1,600-line component — one for URL/viewport sync, one for search/geocoding.

---

### State management decisions

**Page-level state:** `ExploreInner` holds ~20 `useState` calls: `stateFips`, `geojson`, `mapMode`, `searchGeojson`, `searchResults`, `layerMode`, `compareTray`, `selectedGeoid`, `selectedDetail`, draft/applied filter split, session flags, and more. This is intentional — each state slice is used by multiple child components, and the page is the right owner.

**Custom hooks for stateful logic:** URL sync state (`viewportForUrl`, `pendingUrlFly`) and search state (`q`, `suggestions`, `searchNarrowFips`) live in their respective hooks because the logic owning that state doesn't belong at the page level.

**Compare tray as sessionStorage:** The compare tray (`frontend/lib/compareTray.ts`) persists up to 4 GEOIDs in `sessionStorage` under key `nh-compare-tray`. This means tray contents survive navigation within a session but reset on a new tab. The tray is passed to the compare page via URL param: `/compare?geoids=12345,67890`. I chose sessionStorage over localStorage because the tray is session-intent, not a saved preference.

**URL params as state:** The explore URL encodes `state`, `tract`, `layer`, `score_min`, `pop_min`, `excl_inst`, `clinic_dist`, `f_rent`, `f_uninsured`, and viewport (`lat`, `lng`, `zoom`). This means any URL is a fully restorable bookmark — no server session needed.

**Why no Context:** Nothing in this app is shared across multiple sibling subtrees in a way that would make prop-drilling painful. `compareTray` could have been Context, but it's a flat array that flows from `ExploreInner` to `TopTractsPanel` in one hop. Adding a Context provider would have added indirection without benefit.

**The `fetchIdRef` race condition guard** (`TopTractsPanel.tsx`, line 71): When filters change, `fetchList` fires a new API call before the previous one resolves. Without a guard, the slower first call might resolve after the faster second call and overwrite the correct state. I use `const id = ++fetchIdRef.current` — an ever-incrementing integer — and check `if (fetchIdRef.current !== id) return` before updating state. I used `useRef` instead of `useState` because the ID is not UI state: it doesn't need to trigger a re-render, and changing it mid-render would be wrong. `useRef` gives a mutable container that persists across renders without causing them.

**One-line summary:** Page-level state, custom hooks for URL/search logic, sessionStorage for tray, URL for bookmarkable explore views, useRef for the race guard.

---

## 3. NEXT.JS SPECIFICS

I used **Next.js 15 with the App Router**. All pages use the `app/` directory. The App Router gave me server-side rendering for the tract profile page by default — `app/tract/[geoid]/page.tsx` has no `'use client'` directive, so it runs as a React Server Component and can `await getTract(geoid)` directly, making the initial HTML arrive with the score and indicators already populated. The compare and explore pages are fully client-side (`'use client'` at the top) because they rely on browser APIs, URL params via `useSearchParams`, and interactive state.

**Server vs. client boundary:** I kept `app/layout.tsx` as a server component — it renders the `<html>` and `<body>` tags and loads fonts. `AppChrome` (`components/AppChrome.tsx`) is a client component because it reads `usePathname()` to decide whether to render `LandingHeader`, `SiteHeader`, or nothing (on `/explore`, no header renders so the map can be full-screen).

**Dynamic routes:** `/tract/[geoid]/page.tsx` matches any 11-digit GEOID. Next.js passes `params: Promise<{ geoid: string }>` and I `await params` at the top. The page calls `getTract(geoid)` and `getTractSummary(geoid)` in parallel using `Promise.allSettled` — so a failed AI summary doesn't block the scorecard from rendering.

**`next/dynamic` for lazy loading:** I lazy-loaded everything that touches Recharts. In `compare/page.tsx`, `CompareProfileChart` and `CompareTrendChart` are both loaded via `dynamic()` with `ssr: false` — Recharts manipulates the DOM and can't run server-side. `TrendChartLazy.tsx` wraps `TrendChart` the same way for the tract profile page. The `ssr: false` flag means these bundles are excluded from the server-rendered HTML and fetched separately when the browser hydrates.

**`next.config.mjs`:** One setting — `transpilePackages: ["maplibre-gl", "react-map-gl"]`. MapLibre GL uses ES module syntax that Next.js's webpack config doesn't handle natively; `transpilePackages` tells the compiler to process these through Babel/SWC.

**Fonts:** `app/layout.tsx` loads `Fraunces` (display serif, used for headings via `font-display` Tailwind class) and `Inter` (body) via `next/font/google`. Both are self-hosted by Next.js — no external font request.

**One-line summary:** App Router, server component for the tract page, `next/dynamic` for Recharts bundles, `transpilePackages` for MapLibre GL.

---

## 4. TYPESCRIPT

**API response types** live in `frontend/types/api.ts` and are re-exported from `frontend/types/index.ts`. The main types are `TractSummary` (minimal list row), `TractDetail` (extends TractSummary, adds `indicators: IndicatorRow[]`, `display_indicators`, `risk_score`, `has_trend`, `state_composite_score`), `IndicatorRow` (value + value_moe + three percentile ranks), `TractScorePoint`, and `TractDemographicsRow`.

**Discriminated union for demographics state** (`DemographicsPanel.tsx`, line 113):
```typescript
const [state, setState] = useState<"loading" | "absent" | "ready">("loading")
```
I chose a string literal union over separate `isLoading`/`isAbsent`/`data` booleans because the states are mutually exclusive — you can never be both `loading` and `ready`. The literal union means TypeScript enforces exhaustive handling: if I forget the `"absent"` branch in JSX, the compiler warns. The compare page uses a similar pattern with `DemographicsEntry` as a discriminated union: `{ status: "absent" } | { status: "error"; message: string } | { status: "ready"; data: TractDemographicsRow; median_household_income: number | null }`.

**`METRIC_KEYS` typed with const assertion** (`frontend/lib/riskScore.ts`):
```typescript
export const METRIC_KEYS = ["rent_burden_pct", "overcrowding_pct", ...] as const
export type MetricKey = (typeof METRIC_KEYS)[number]
```
The `as const` makes `METRIC_KEYS` a readonly tuple of string literals. `MetricKey` is derived as the union of all those literals. Any function that takes a `MetricKey` parameter will reject strings like `"obesity_pct"` at compile time. `DEFAULT_WEIGHTS: Record<MetricKey, number>` means adding a new metric key to `METRIC_KEYS` without adding it to `DEFAULT_WEIGHTS` is a compile error.

**Where TypeScript caught a real bug:** `TractDemographicsPayload` in `DemographicsPanel.tsx` was a hand-written duplicate of `TractDemographicsRow` in `api.ts`. They had matching fields, but if the backend response had ever added a field (say, `median_household_income`), DemographicsPanel would silently receive it without type awareness. Consolidating to `TractDemographicsRow` in `frontend/types/api.ts` means a backend change now propagates to every consumer via one type update.

**One-line summary:** API shapes in `types/api.ts`, discriminated unions for async state, `METRIC_KEYS as const` for compile-time metric validation.

---

## 5. API INTEGRATION

### How API calls are structured

`frontend/lib/api.ts` has a private `api<T>()` function: it fetches `${API_BASE}${path}`, sets `Content-Type: application/json`, sets `cache: "no-store"`, throws on non-OK with the response text as the message, and returns `res.json() as Promise<T>`. Every exported function wraps this — `getTract(geoid)` returns `api<TractDetail>(\`/api/tracts/${geoid}\`)`. The base URL is resolved at module load from `NEXT_PUBLIC_API_URL` env var; on the server side it swaps `localhost` for `127.0.0.1` to avoid IPv6 resolution issues in some WSL/Docker environments.

Main API functions: `getTract`, `getTractList`, `getTractTrend`, `getTractSummary`, `getCompare`, `getDemographics`, `getStates`, `getMapGeoJSON`, `searchTracts`, `searchFromAddress`, `searchSuggest`, `postMapTractsByGeoids`, `postPdfExport`.

### Loading states

**Skeleton loading** is implemented in `NearbyClinicPanel` (`NearbyClinicSkeleton`) and `DemographicsPanel` (`DemographicsSkeleton`) — animated `animate-pulse` divs that match the real content's layout. `TrendChart` shows a `h-[60px] animate-pulse rounded-md bg-nh-sand` div while the trend fetch runs. The compare page shows `animate-pulse` cells in-line within the demographics table.

**Parallel fetch with `Promise.allSettled`:** In `app/tract/[geoid]/page.tsx`:
```typescript
const [tractResult, summaryResult] = await Promise.allSettled([
  getTract(geoid),
  getTractSummary(geoid),
])
```
If the AI summary fails (no API key, timeout), the page still renders with the full scorecard. `Promise.allSettled` vs `Promise.all` was the right choice here because the summary is optional.

### Error states

- **Ranked list (`TopTractsPanel`):** `rankedError: string | null` state; the component renders a red-bordered message box when set.
- **Demographics panel:** The `"absent"` state branch returns `null` (no panel); `"error"` branch doesn't exist in `DemographicsPanel` because a failed fetch is treated as absent data.
- **Compare demographics:** The `DemographicsEntry` union includes `{ status: "error"; message: string }`, which renders an amber "Failed to load" badge in the table cell.
- **404 vs network error in tract page:** `tractResult.reason.message.startsWith("404")` calls `notFound()` (Next.js 404 page); all other errors show an inline error card — because a temporary API outage shouldn't look like the tract doesn't exist.

### Race conditions

`TopTractsPanel` fetches the ranked list whenever filters or layer mode change. The **`fetchIdRef` pattern** (line 71): on every `fetchList` call, `const id = ++fetchIdRef.current` stamps this fetch with a monotonically increasing integer. Before any `setState` call in the async body, the code checks `if (fetchIdRef.current !== id) return`. If filters changed again while this fetch was in-flight, `fetchIdRef.current` will have advanced past `id` — so the stale response is silently discarded. I used `useRef` (not `useState`) because the counter is a mutable coordination primitive, not display data. Setting it wouldn't need to trigger a render.

### The compare tray

`readCompareTray()` / `writeCompareTray()` in `frontend/lib/compareTray.ts` read/write `sessionStorage` under `nh-compare-tray`. The tray is synced to sessionStorage on every change via `useEffect(() => { writeCompareTray(compareTray) }, [compareTray])` in `ExploreInner`. When the user clicks "Compare" from the explore map, the app navigates to `/compare?geoids=<id1>,<id2>,...`. The compare page reads the `geoids` URL param and fires `getCompare(geoids)`.

**One-line summary:** Central `api<T>()` helper, skeleton loaders, `Promise.allSettled` for optional parallel fetches, `fetchIdRef` for race guard, sessionStorage + URL params for the compare tray.

---

## 6. PERFORMANCE OPTIMIZATION

### Lazy loading

**Recharts** is lazy-loaded everywhere it appears. In `compare/page.tsx`:
```typescript
const CompareProfileChart = dynamic(() => import("@/components/CompareProfileChart"), { ssr: false })
const CompareTrendChart = dynamic(() => import("@/components/CompareTrendChart").then(m => ({ default: m.CompareTrendChart })), { ssr: false })
```
And `TrendChartLazy.tsx` wraps `TrendChart` the same way for the tract profile. The `ssr: false` flag means Recharts never runs server-side. These bundles are loaded only when the user navigates to `/compare` or opens a tract with trend data. The `/compare` First Load JS is 107KB — Recharts alone would add ~111KB if it were statically imported at the page level.

### Memoization

**`React.memo` on `NeighborMap`** (line 983 of `NeighborMap.tsx`): `export const NeighborMap = memo(NeighborMapInner)`. MapLibre GL carries a ~780KB WebGL runtime. A re-render of `ExploreInner` (which has ~20 state variables) without `memo` would re-render the entire map component on every keystroke or filter change. With `React.memo`, the map only re-renders when its props change — so I keep all callback props in `useCallback` to preserve referential stability: `onSelectTract`, `onSelectStateFromMap`, `goToUsOverview`, `clearSearchMap`, `onExploreMapMoveEnd`.

**`useMemo` in `ExploreInner`:**
- `augmentedBrowseBase`: runs `augmentGeoJSONForYear(geojson)` — expensive O(N log N) tertile sort + bivariate classification — only when `geojson` reference changes (i.e., a new state loads).
- `augmentedBrowse`: runs `applyLayerMode(augmentedBrowseBase, mapAugmentMode)` — cheap O(N) property write — only when base or mode changes.
- `statePickerGeoJSON`: merges state GeoJSON with availability data — only when either changes.
- `priorityFlagged`: counts above-threshold tracts — only when mode or augmented GeoJSON changes.
- `stateLabel`, `exploreDataStatus`: label lookups from `availableStates`.

**`useMemo` in `compare/page.tsx`:** `lineData` (formats metric scores for the profile chart), `insights` (runs `buildCompareInsights`), `sortedMetricKeys` (re-sorts the indicator table), `incomeMapForInsights` (merges demographics into income map), `collapsedIncomeHint` (formats the collapsed section preview text).

### GeoJSON optimization

The key architectural decision: I split what was one function into two. **`augmentGeoJSONForYear`** computes tertile breaks across all housing and health raw values (sort is O(N log N)), classifies each feature into a 3×3 bivariate grid, and attaches `nh_housing_class`, `nh_health_class`, `nh_bivariate_class`. **`applyLayerMode`** just writes `nh_map_value` (composite score, rent burden, or health blend average) per feature — O(N) with no sorting. Before the split, the expensive sort ran every time the user clicked a layer tab. After the split, two separate `useMemo` calls have different dependency arrays: `augmentedBrowseBase` depends on `[geojson]`, `augmentedBrowse` depends on `[augmentedBrowseBase, mapAugmentMode]`. Switching from "Composite" to "Housing" layer hits only the cheap O(N) path.

### The draft/applied filter split

The explore filter panel has sliders for min score, min rent burden, and min uninsured rate. Connecting sliders directly to `applied` state would fire an API call on every pixel of movement — ~70 calls dragging from 0% to 70%. I keep `draft` state in the panel (local to the slider) and only commit to `applied` when the user clicks "Apply filters". This pattern appears in `TopTractsPanel` and `ExploreInner`: `draft.minScore` vs `applied.minScore`. The `applied` state drives the API fetch; `draft` drives the slider visual only.

**One-line summary:** Recharts lazy-loaded (saves ~111KB on /compare), `React.memo` on MapLibre GL component, two-stage GeoJSON memoization eliminates O(N log N) sort on layer switch, draft/applied split kills filter-slider thrashing.

---

## 7. COMPONENT LIBRARIES AND DESIGN SYSTEM

I did **not** use Mantine, shadcn/ui, or any component library. Every UI element is custom-built using **Tailwind CSS** with a project-specific design token layer defined in `tailwind.config.ts`:

```typescript
nh: {
  cream: "#faf6ef",       // page background
  "cream-dark": "#f0e8dc",
  terracotta: "#c45c3e",  // primary action color
  "terracotta-dark": "#a34a32",
  brown: "#2c1810",       // primary text
  "brown-muted": "#5c4033",
  sand: "#e8dfd4",        // skeleton/neutral fills
  ink: "#1a120e",
}
```

Fonts are defined as CSS variables in `layout.tsx` (`--font-display` for Fraunces serif, implicit Inter for body) and consumed as Tailwind utility classes: `font-display` for headings, `font-sans` for body.

Every shared primitive is custom: `CollapseChevron` (SVG that rotates 180° on `isOpen`), `BivariateLegend` (3×3 grid reading from `BIVARIATE_COLORS`), `TractMapBackControl` (calls `router.back()` — specifically uses Back so the explore page can hydrate from its sessionStorage snapshot), `MetricCard` (dual state/national percentile bar), `BrandWordmark` (SVG triangle logo + beta badge + wordmark as a single link).

The deliberate avoidance of a component library means every interaction, color, and animation matches the design exactly — no overriding library CSS specificity. The tradeoff is that I built things like modals and dropdowns from scratch, but the app's UI surface is focused enough that nothing exotic was needed.

**One-line summary:** No component library — all custom Tailwind with `nh-*` design tokens, Fraunces + Inter fonts via next/font.

---

## 8. CODE QUALITY AND MAINTAINABILITY

### What was found and fixed

**The `ExploreInner` god component:** Before refactoring, the explore page was growing toward 1,600+ lines with URL sync, search logic, filter debounce, sessionStorage persistence, and rendering all interleaved. I extracted `useExploreUrlSync` and `useExploreSearch` as described above. The page is now readable as an orchestrator: it holds state, wires hooks together, and passes slices to components.

**Scattered threshold constants:** Score tier boundaries (`tier1: 70`, `tier2: 50`), priority badge threshold (`55`), and map flag threshold (`50`) were defined inline in multiple component files. If a product decision changed "tier 1" from 70 to 75, it would need to change in three places — and historically caused a bug where the same tract showed "Tier 1" on one page and "Priority" on another page because they used different hardcoded values. All of these now live in one place: `frontend/lib/constants.ts` — `SCORE_THRESHOLDS`, `COMMON_STRESSOR_THRESHOLD`, `DIVERGENCE_THRESHOLD`, `HIGH_ASTHMA_THRESHOLD`, `SCORE_HIGH_THRESHOLD`, `SCORE_MID_THRESHOLD`, `INCOME_SURVIVAL_THRESHOLD`, `INCOME_HIGH_THRESHOLD`.

**Duplicate type definitions:** `TractDemographicsPayload` in `DemographicsPanel.tsx` was byte-for-byte identical to `TractDemographicsRow` in `api.ts`. `PersistedSearchResult` in `exploreMapSession.ts` was identical to `SearchResultRow` in `api.ts`. Both duplicates were eliminated by moving all API types to `frontend/types/api.ts` and updating 22 files to import from `@/types`.

**Shared lookup tables:** `LINE_COLORS` (4 hex values for compare chart lines) and `RACE_SEGMENTS` (5 race/ethnicity entries with bar colors and label classes) were extracted to `frontend/lib/compareColors.ts` and `frontend/lib/demographics.ts` respectively. The full 50-state FIPS-to-postal abbreviation map lives in `frontend/lib/geo.ts` instead of being re-typed per component.

### The shared constants architecture

`frontend/lib/constants.ts` is the single source of truth for every numeric threshold used in scoring display, map flagging, and insight generation. The key invariant: **the same GEOID should show the same tier label on every page**. When thresholds live in one file, that's guaranteed. When they're inline, it's a bug waiting to happen.

**One-line summary:** God-component split into hooks, threshold constants unified, duplicate types eliminated, lookup tables extracted to shared lib files.

---

## 9. SCENARIO QUESTIONS — PREPARED ANSWERS

### "You inherit a codebase with inconsistent state and duplicated logic"

The first thing I'd do is read every file before touching anything. On this project, that audit revealed three categories of problems: (1) state ownership was unclear — the explore page was both managing state and containing rendering logic for things that should be in hooks; (2) the same values were defined in multiple places with no single source of truth; (3) types were duplicated across files, meaning a change in one place didn't propagate to consumers.

**What I found:** `ExploreInner` approaching 1,600 lines with URL sync mixed into render logic. Score tier thresholds hardcoded as `70` and `50` in three different files. `TractDemographicsPayload` in `DemographicsPanel.tsx` duplicating `TractDemographicsRow` in `api.ts` byte-for-byte. `LINE_COLORS` and `RACE_SEGMENTS` inline in the files that used them.

**How I fixed it:** Extracted URL sync into `useExploreUrlSync` and search logic into `useExploreSearch`. Created `frontend/lib/constants.ts` with every numeric threshold. Created `frontend/types/api.ts` with all API response shapes, deleted all 12 scattered copies, updated 22 import sites. Moved shared data to `lib/` files. In each case the goal was the same: one place to change a thing, one place to find it.

---

### "A REST API occasionally returns inconsistent data. How do you protect the frontend?"

The main defense I built is **explicit null checks at every display site**. `TractDetail.risk_score` is typed `| null` — the tract page checks `score != null` before rendering the score badge. `IndicatorRow.value` is `number | null` — `formatMetricValue()` returns `"—"` for null. The ACS API returns `-666666666` for suppressed values; the backend converts those to null before writing to the DB, so by the time the frontend sees data it's either a real number or null.

For async data, the **`DemographicsEntry` discriminated union** in `compare/page.tsx` makes impossible states impossible to render. You can't accidentally render `entry.data` when `entry.status === "error"` because TypeScript won't allow it.

The **`fetchIdRef` race guard** protects against the API returning responses out of order. Without it, dragging a filter slider quickly and releasing could leave the UI showing results for an intermediate filter value, not the final one.

For the address search flow (`useExploreSearch.ts`), I wrapped the Census geocoder call in a try/catch and fall through to text search on failure — so a Census API timeout degrades gracefully to keyword search instead of showing an error.

---

### "A GIS dashboard has rendering slowdowns with large datasets"

This was the actual problem with California's 9,129-polygon GeoJSON. The original code called one `augmentGeoJSONForMap(geojson, mode)` function every time the user switched between Composite, Housing, Health, and Overlap layer tabs. That function sorted all housing stress raw values and all health burden raw values to find tertile breaks — O(N log N). Switching tabs 4 times = 4 full re-sorts of 9,129 items.

My investigation was straightforward: read the `useMemo` dependencies. The original memo had `[geojson, layerMode]` as dependencies, so it re-ran on both data changes and layer changes. The fix was to **split into two functions with two separate memos**:

1. `augmentGeoJSONForYear` — computes tertile breaks and bivariate class per feature. Memo depends only on `[geojson]`. Runs once per state load.
2. `applyLayerMode` — sets `nh_map_value` per feature based on the active layer. Memo depends on `[augmentedBase, mapAugmentMode]`. O(N) property write.

Switching tabs now hits only the cheap path. The expensive path runs only when a new state's GeoJSON loads.

The other piece was **`React.memo` on `NeighborMap`**: the explore page re-renders frequently (filter changes, search input, compareTray updates). Without `memo`, each re-render would force MapLibre GL's WebGL state to reconcile. With `memo`, the map only re-renders when its data or a callback prop actually changes — and I keep all callbacks in `useCallback` to maintain referential equality.

---

### "You disagree with a senior engineer's technical direction"

I'd start by making sure I understand their reasoning, not just their conclusion. On this project, a decision was made to skip building a parallel coordinates chart for the compare page and use a line chart instead. My initial instinct was that parallel coordinates would be more appropriate for multi-tract, multi-metric data. But after looking at how the data actually structured (7 metrics, each normalized 0–100, 2–4 tracts), the line chart communicating "profile shape" per tract turned out to be clearer for the nonprofit analysts using the tool — parallel coordinates would have required explanation, the line chart didn't. I think the lesson is: bring a concrete concern ("parallel coordinates is standard for this data structure") but stay open to the product constraint ("our users aren't data scientists, they need to read this in 10 seconds"). I'd state my view once with a reason, then commit to the team's decision.

---

## 10. THINGS TO KNOW COLD

1. **"`NeighborMap` is wrapped in `React.memo`** (line 983: `export const NeighborMap = memo(NeighborMapInner)`) because every `ExploreInner` state change would otherwise re-render the 780KB MapLibre GL WebGL runtime."

2. **"I split GeoJSON augmentation into two functions** — `augmentGeoJSONForYear` (O(N log N) tertile sort, runs once) and `applyLayerMode` (O(N) property write, runs on layer switch) — each with its own `useMemo` dependency array."

3. **"The `fetchIdRef` pattern** in `TopTractsPanel.tsx` (line 71) guards against stale API responses overwriting state when filters change faster than requests resolve."

4. **"Recharts is lazily loaded** in two places — `compare/page.tsx` for `CompareProfileChart` and `CompareTrendChart`, and `TrendChartLazy.tsx` for the sparkline — using `next/dynamic` with `ssr: false`."

5. **"The compare tray persists via `sessionStorage`** under key `nh-compare-tray`, synced on every change, and passed to `/compare` as a URL param: `?geoids=id1,id2,id3`."

6. **"The explore URL encodes 10 parameters**: `state`, `tract`, `layer`, `score_min`, `pop_min`, `excl_inst`, `clinic_dist`, `f_rent`, `f_uninsured`, and viewport (`lat`, `lng`, `zoom`)."

7. **"The tract profile page is a React Server Component** — no `'use client'`, it awaits `getTract()` and `getTractSummary()` in parallel via `Promise.allSettled` before returning HTML."

8. **"`METRIC_KEYS` is typed with `as const`** and `MetricKey` is derived as `typeof METRIC_KEYS[number]` — any string not in the scored 7 is a compile error as a `MetricKey`."

9. **"All score thresholds live in `frontend/lib/constants.ts`** — `SCORE_THRESHOLDS.tier1 = 70`, `tier2 = 50`, `priorityBadge = 55` — unified after different pages showed different tier labels for the same tract."

10. **"The design system has no component library** — everything is custom Tailwind with eight `nh-*` design tokens (`cream`, `terracotta`, `brown`, `brown-muted`, `sand`, `ink`, `cream-dark`, `terracotta-dark`) defined in `tailwind.config.ts`."

---

## 11. QUESTIONS TO ASK THE INTERVIEWER

1. **"How do you handle the performance tradeoff between serving pre-simplified geometries and letting users zoom into full-resolution census tract boundaries? Do you use PMTiles or a tile server, or serve GeoJSON per state?"** — This shows I've thought about the next step beyond what I already built (GZip-compressed state GeoJSON is the current approach, but California at 9,129 polygons is approaching the limit).

2. **"When your team has a map-heavy feature that involves real-time data (sensor feeds, live incident tracking), how do you architect the data pipeline into the frontend? WebSockets, SSE, or polling?"** — Demonstrates awareness of the gap between what I built (batch-ingest data, no real-time) and where GIS-heavy frontends can go.

3. **"What's your team's approach to bundle size budgets on data-heavy pages? Do you set a First Load JS limit that fails CI, or is it more informal?"** — Shows I'm thinking about performance as a discipline, not a one-time fix.

4. **"How does the team handle the tradeoff between full TypeScript strictness and iteration speed — especially on API integration where the backend schema is still evolving?"** — The `strict: true` flag is in our tsconfig; I want to understand how they balance rigor with shipping.

5. **"What does the code review process look like for a junior developer on this team — specifically around performance and architecture decisions? Is there a senior engineer whose job is to catch things like an over-large `useMemo` dependency array before they ship?"** — Shows I want mentorship and understand what "good review culture" means for my growth.
