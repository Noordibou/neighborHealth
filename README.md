# NeighborHealth

NeighborHealth is a geospatial public health prioritization tool for US census tracts. It combines ACS housing indicators with CDC PLACES health estimates into a composite index (0–100) that identifies where housing stress and health burden overlap.

---

## Local development setup

### Prerequisites

- Python 3.9+ (3.10+ recommended)
- Node.js 20+ and `npm`
- PostgreSQL with PostGIS — the included `docker-compose.yml` is the easiest path
- `CENSUS_API_KEY` — required for ingest; ACS requests redirect without one ([sign up](https://api.census.gov/data/key_signup.html))
- `ANTHROPIC_API_KEY` — optional, enables AI tract summary generation

### Backend setup

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env             # edit DATABASE_URL if needed
alembic upgrade head             # creates all tables
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Start the database first if using Docker:

```bash
# from the repository root (not backend/)
docker compose up -d
```

If `alembic upgrade head` fails with `ConnectionRefusedError`, nothing is accepting connections on port 5432 — start the database first and confirm with `ss -tlnp | grep 5432`.

### Frontend setup

```bash
cd frontend
cp .env.example .env.local       # set NEXT_PUBLIC_API_URL
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Running ingest

Ingest downloads TIGER tract boundaries, ACS 5-year housing tables, ACS demographics, and CDC PLACES tract health estimates. It writes `tracts` and `indicators`, computes percentiles, and recomputes `risk_scores`.

```bash
cd backend
source .venv/bin/activate

# Single state — fastest for testing (Texas)
python ingest.py --states 48 --year 2022

# Default sample states (CA, FL, IL, NY, TX)
python ingest.py --states 06,12,17,36,48 --year 2022

# Multi-year 2022–2024 via helper script
chmod +x scripts/ingest_years_2022_2024.sh
./scripts/ingest_years_2022_2024.sh
# Texas only: ./scripts/ingest_years_2022_2024.sh 48
docker compose exec backend ./scripts/ingest_years_2022_2024.sh
```

Flag notes:

| Flag | Default | Valid range |
|------|---------|-------------|
| `--states` | `06,12,17,36,48` | Any comma-separated FIPS codes |
| `--year` | `2022` | `2020`–`2024` |

Full national ingest takes 2–3 hours. HRSA clinics can be loaded independently (requires tract centroids already in the DB):

```bash
python scripts/load_hrsa_clinics.py
```

**Ingest troubleshooting**

- `invalid_key.html` / Census 302: `CENSUS_API_KEY` is invalid or has a trailing period. Test the ACS URL in a browser to confirm JSON.
- `ConnectTimeout` to `chronicdata.cdc.gov`: Usually transient (VPN, firewall, Docker/WSL networking). Retry or run ingest on the host rather than via `docker compose exec`.
- `404` from `api.census.gov/data/{year}/acs/acs5`: That vintage is not on the Census API yet. Use `--year 2020`–`2024`.

### Required environment variables

**Backend** (`backend/.env`):

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `DATABASE_URL` | Yes | Async SQLAlchemy connection string | `postgresql+asyncpg://neighborhealth:neighborhealth@localhost:5432/neighborhealth` |
| `JWT_SECRET` | Yes | Random 32-byte hex for signing JWTs | `openssl rand -hex 32` |
| `ANTHROPIC_API_KEY` | No | Claude API key for AI tract summaries | `sk-ant-...` |
| `CENSUS_API_KEY` | No* | Raises ACS rate limits; required in practice | — |
| `CDC_API_KEY` | No | Socrata app token for CDC PLACES | — |

**Frontend** (`frontend/.env.local`):

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `NEXT_PUBLIC_API_URL` | Yes | Backend base URL | `http://localhost:8000` |
| `NEXT_PUBLIC_MAP_STYLE_URL` | No | Override MapLibre base style (defaults to OpenFreeMap Liberty) | — |

---

## Database

### Schema overview

| Table | Description |
|-------|-------------|
| `tracts` | Census tract metadata — GEOID, name, state/county FIPS, population, median income, centroid, geometry |
| `indicators` | All metric values per `(geoid, metric_name, year)` — 589K rows across 7 scored + 11 display metrics × 3 years × ~28K tracts |
| `risk_scores` | Composite scores and component scores per `(geoid, year)` — 84K rows |
| `tract_demographics` | Race, age, language, education per `(geoid, year)` — from ACS B01001, B03002, B16001, B15003 |
| `clinics` | HRSA FQHC locations with lat/lng and operational status |
| `tract_clinics` | Nearest 3 clinics per tract with distance in miles — PK `(geoid, rank)` |
| `ai_summaries` | Cached LLM-generated tract narrative summaries |
| `users` | User accounts for saved views |
| `saved_views` | User-saved filter configurations |

### Key performance notes

- Two-layer in-process cache: metric map (TTL 1hr) + scored batch (TTL 1hr) — warm requests 8–12ms
- Six composite indexes on the `indicators` table
- GeoJSON endpoint uses GZip compression and `ST_SimplifyPreserveTopology`
- Percentiles computed at ingest time with SQL `PERCENT_RANK()` window functions
- `CONCURRENTLY` indexes cannot run inside a transaction block with asyncpg — see migration docstrings for out-of-band production SQL

---

## Known limitations and technical debt

- **~29.5% of US census tracts unscored** due to CDC PLACES coverage gaps, predominantly rural and very low-population tracts. A tract must have all 7 metrics present to receive a composite score.
- **Heat index is a latitude-based proxy** (`clamp(150 − 3 × lat, 0, 100)`) — not measured heat data. It does not account for urban heat island effects or altitude.
- **ACS 5-year estimates have overlapping survey years.** The trend chart between consecutive vintages reflects partially the same underlying respondents.
- **Structural vacancy rate has directional ambiguity** in resort and rural areas where seasonal vacancies (`B25004_006E`) are excluded but vacancy can still appear elevated.

- **Search does not support ZIP code** — the `zip_code` column exists on the `Tract` model but ingest does not yet populate it (requires HUD USPS crosswalk).
- **CDC PLACES does not cover US territories** — Puerto Rico and USVI coordinates may be in the DB but no tract data is scored.
- **Ingest is run manually** — no automated pipeline exists beyond a GitHub Actions stub for annual scheduling .
- **HUD CHAS** is referenced in some UI copy but the ingest pipeline uses ACS B25070/B25014 directly.

---

## API reference

### Tracts

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/tracts` | Filtered tract list with scores and sorting |
| `GET` | `/api/tracts/{geoid}` | Full tract detail with indicators |
| `GET` | `/api/tracts/{geoid}/score` | Composite score with optional per-metric weight overrides (query params) |
| `GET` | `/api/tracts/{geoid}/trend` | Multi-year score history |
| `GET` | `/api/tracts/{geoid}/demographics` | Demographic breakdown |
| `GET` | `/api/tracts/{geoid}/clinics` | Nearest 3 FQHCs with distances |
| `GET` | `/api/tracts/{geoid}/summary` | Cached AI narrative summary |

### Compare

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/compare` | Side-by-side comparison payload for 2–4 tracts |

### Search

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/search` | Full-text search across tract names, counties, and addresses |
| `GET` | `/api/search/suggest` | Autocomplete suggestions |
| `GET` | `/api/search/from-address` | Geocode address to tract |

### Export

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/export/tracts.csv` | CSV for filtered explore results |
| `POST` | `/api/export/compare-csv` | CSV for a compared tract set |
| `POST` | `/api/export/compare-pdf` | PDF for a compared tract set |
| `POST` | `/api/export/pdf` | PDF scorecard for a single tract |

### Map

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/map/tracts` | State-level GeoJSON for choropleth (GZip compressed) |
| `GET` | `/api/states` | States with tract counts |

### Auth

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Create account |
| `POST` | `/api/auth/login` | Login (returns JWT) |
| `GET` | `/api/auth/saved-views` | Retrieve saved filter views |

---

## Deployment

| Layer | Platform |
|-------|----------|
| Frontend | Vercel |
| Backend 
| Database | Fly.io Postgres (PostGIS enabled, 1GB volume minimum) |

Ingest is run manually from a local machine via `fly proxy` tunnel — it is not automated on the server.

---

## Contributing

- Run `alembic upgrade head` before starting any backend work
- Read `CLAUDE.md` before touching scoring, ingest, or caching code
- Do not modify `METRIC_KEYS` in `risk_score.py` without updating scoring, cache invalidation, and the DB cohort inclusion rule
- Frontend score threshold constants live in `frontend/lib/constants.ts` — do not hardcode thresholds in component files
- All 47 backend + frontend tests must pass before merging: `pytest backend/tests/ -v` and `npm test`

---

## Tests

```bash
# Backend
cd backend && pytest tests/ -v

# Frontend
cd frontend && npm test
```

Key tests to run after any scoring or ingest change: `test_compute_batch_scores_default_weights`, `test_custom_weights_dot_product`, `test_clamp_weights_negative`, `test_ordinal_suffix`.

---

## License


