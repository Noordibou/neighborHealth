#!/usr/bin/env python3
"""
Load HRSA FQHC site CSV into ``clinics`` and (optionally) rebuild ``tract_clinics``.

Uses the same database URL rules and HRSA helpers as ``ingest.py`` (Docker-aware).

Prerequisites:
  - ``clinics`` and ``tract_clinics`` tables exist (``alembic upgrade head``).
  - ``tracts`` populated with ``centroid_lat`` / ``centroid_lon`` for distance ranking.

Run from ``backend/``:

  source .venv/bin/activate
  python scripts/load_hrsa_clinics.py

Environment:
  - ``DATABASE_URL`` / ``DOCKER_INGEST_DATABASE_URL`` — same as ingest.
  - ``HRSA_SITES_CSV_URL`` — optional override for the HRSA CSV download URL.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

_backend = Path(__file__).resolve().parent.parent
if str(_backend) not in sys.path:
    sys.path.insert(0, str(_backend))

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from ingest import (
    _ingest_database_url,
    compute_tract_clinic_distances,
    fetch_hrsa_clinics,
)

log = logging.getLogger("load_hrsa_clinics")


async def _run(session: AsyncSession, *, clinics: bool, distances: bool) -> None:
    if clinics:
        log.info("Fetching and upserting HRSA clinics…")
        await fetch_hrsa_clinics(session)
        await session.flush()
    if distances:
        log.info("Computing tract–clinic distances…")
        await compute_tract_clinic_distances(session)
        await session.flush()
    await session.commit()


async def main_async(*, clinics: bool, distances: bool) -> None:
    database_url = _ingest_database_url()
    log.info("Database URL (host/db): %s", _db_hint(database_url))
    engine = create_async_engine(database_url, echo=False)
    async_session = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with async_session() as session:
            await _run(session, clinics=clinics, distances=distances)
    finally:
        await engine.dispose()
    log.info("Finished.")


def _db_hint(url: str) -> str:
    """Log fragment without credentials."""
    try:
        tail = url.split("@", 1)[-1]
        return tail if tail else url
    except Exception:
        return "(configured)"


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument(
        "--clinics-only",
        action="store_true",
        help="Only download/upsert HRSA clinics; skip tract_clinics rebuild",
    )
    p.add_argument(
        "--distances-only",
        action="store_true",
        help="Only recompute tract_clinics from existing operational clinics",
    )
    args = p.parse_args()
    if args.clinics_only and args.distances_only:
        p.error("Use at most one of --clinics-only and --distances-only")
    clinics = not args.distances_only
    distances = not args.clinics_only
    asyncio.run(main_async(clinics=clinics, distances=distances))


if __name__ == "__main__":
    main()
