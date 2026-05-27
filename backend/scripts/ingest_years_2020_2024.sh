#!/usr/bin/env bash
# Run full ingest for each ACS / PLACES analysis year 2020–2024 (default states: CA, FL, IL, NY, TX).
# Usage (from repo root or backend/ — script cds to backend):
#   ./scripts/ingest_years_2020_2024.sh
#   ./scripts/ingest_years_2020_2024.sh 48
set -euo pipefail
STATES="${1:-06,12,17,36,48}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
for year in 2020 2021 2022 2023 2024; do
  echo "========== Ingest year ${year} (states=${STATES}) =========="
  python ingest.py --states "$STATES" --year "$year"
done
echo "Done."
