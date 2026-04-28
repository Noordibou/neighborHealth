# NeighborHealth

NeighborHealth is a housing and health equity prioritization tool for nonprofits and local planners. It combines public data (CDC PLACES, U.S. Census ACS, tract boundaries) into a composite **Housing–Health Risk Score** (0–100), maps it at census tract scale, and supports comparison, search, CSV/PDF export, and optional AI-written tract summaries (Anthropic Claude).

## Architecture

| Layer    | Stack |
|----------|--------|
| Frontend | Next.js 14 (App Router), TypeScript (strict), Tailwind CSS, MapLibre GL JS (`maplibre-gl` + `react-map-gl/maplibre`), Recharts |
| Backend  | FastAPI, SQLAlchemy 2 (async), Pydantic v2, PostGIS (via GeoAlchemy2) |
| Database | PostgreSQL 16 + PostGIS (see `docker-compose.yml`) |

## Prerequisites

- Python 3.9+ (3.10+ recommended) with `pip`
- Node.js 20+ and `npm`
- **PostgreSQL with PostGIS** reachable from your machine — easiest path is Docker (see below); without it you must install Postgres + PostGIS yourself and set `DATABASE_URL`
- The map does **not** require a Mapbox account; it uses **MapLibre** with a default public style (optional `NEXT_PUBLIC_MAP_STYLE_URL` to override)
- Optional: `ANTHROPIC_API_KEY` for AI summaries; `CENSUS_API_KEY` for higher Census API rate limits

## Environment variables

| Variable | Service | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | API | Async SQLAlchemy URL, e.g. `postgresql+asyncpg://neighborhealth:neighborhealth@localhost:5432/neighborhealth` |
| `JWT_SECRET` | API | Secret for signing JWTs (auth / saved views) |
| `ANTHROPIC_API_KEY` | API | Claude summaries on `/api/tracts/{geoid}/summary` |
| `MAPBOX_TOKEN` | API | Optional legacy; unused by the MapLibre frontend |
| `CDC_API_KEY` | Ingest / API | Optional Socrata app token for CDC PLACES |
| `CENSUS_API_KEY` | Ingest | Optional Census API key |

**Frontend** (`frontend/.env.local`):

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_MAP_STYLE_URL` | Optional MapLibre style JSON URL (defaults to OpenFreeMap Liberty; override if a CDN fails TLS on your network) |
| `NEXT_PUBLIC_API_URL` | Backend base URL (default `http://localhost:8000`) |

## Local setup

### 1. Database

Run this from the **repository root** (`neighborHealth/`), not from inside `backend/`:

```bash
cd /path/to/neighborHealth
docker compose up -d
```

Wait until Postgres is healthy, then confirm something is listening on port 5432 (for example `ss -tlnp | grep 5432` on Linux).

This starts PostGIS on port `5432` with user/password/database `neighborhealth`, matching the default `DATABASE_URL` in `backend/.env.example`.

**If you see `ConnectionRefusedError` / `[Errno 111] Connect call failed ('127.0.0.1', 5432)` when running `alembic upgrade head`:** nothing is accepting connections on that host/port. Start the database first (`docker compose up -d`), or point `DATABASE_URL` in `backend/.env` at your real Postgres host. On WSL2, install [Docker Desktop](https://docs.docker.com/desktop/wsl/) and enable WSL integration so `docker` works inside your distro.

**Shell tip:** If your prompt already shows `~/projects/neighborHealth/backend`, you are **inside** `backend` — run `alembic upgrade head` directly; do **not** run `cd backend` again (that path does not exist from there).

### 2. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # edit DATABASE_URL if needed
alembic upgrade head        # required: creates tracts, risk_scores, etc.
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

If the API returns **`relation "risk_scores" does not exist`**, the database connected by `DATABASE_URL` has no tables yet — run **`alembic upgrade head`** again from `backend/` (same DB as in `.env`). If you use multiple Postgres instances, confirm you are not pointing at an empty database.

### 3. Data pipeline (`ingest.py`)

Ingestion downloads TIGER tract boundaries, ACS 5-year housing tables, and CDC PLACES tract health estimates for the selected states, writes `tracts` + `indicators`, computes percentiles, then recomputes `risk_scores`.

Default sample states: **CA, FL, IL, NY, TX** (FIPS `06,12,17,36,48`).

```bash
cd backend
source .venv/bin/activate
python ingest.py --states 06,12,17,36,48
```

- Idempotent: re-run to refresh data for those states (same analysis year).
- **HUD CHAS**: ACS proxies are used for rent burden and overcrowding in this MVP; CHAS-specific files can be wired into `ingest.py` later.
- Docker-aware DB targeting: when run on host, `ingest.py` now auto-targets the Docker DB (`localhost:5432`) whenever the Compose `db` service is running, to avoid splitting data across two Postgres instances. Set `DOCKER_INGEST_DATABASE_URL` to override the default Docker target.

### 4. Frontend

```bash
cd frontend
cp .env.example .env.local   # set NEXT_PUBLIC_API_URL; optional NEXT_PUBLIC_MAP_STYLE_URL
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## API overview

- `GET /api/tracts` — Filtered tract list with scores  
- `GET /api/tracts/{geoid}` — Detail + indicators  
- `GET /api/tracts/{geoid}/score` — Score breakdown (optional per-metric weights as query params)  
- `GET /api/tracts/{geoid}/summary` — Cached AI summary (or placeholder without API key)  
- `GET /api/compare?geoids=a,b,c` — Comparison payload for radar + table  
- `GET /api/map/tracts?state_fips=48` — GeoJSON for choropleth (includes indicator fields in properties)  
- `GET /api/search?q=...` — Search by name or GEOID  
- `GET /api/states` — States with tract counts  
- `POST /api/export/pdf` — Generate PDF report (WeasyPrint)  
- `GET /api/export/tracts.csv` — CSV export of tract list  
- `POST /api/auth/register` | `POST /api/auth/login` | `GET /api/auth/saved-views` — JWT auth + saved views (MVP)

## Tests

**Backend** (from `backend/`):

```bash
pytest tests/ -q
```

**Frontend**:

```bash
cd frontend && npm test
```

## Screenshots

<!-- Add screenshots here after running the app, e.g. map + scorecard -->

- _Placeholder: Map view with choropleth and tract sidebar_  
- _Placeholder: Compare mode radar chart_  

## License

Provided as reference implementation for the NeighborHealth concept; adjust licensing for your organization as needed.
