#!/usr/bin/env bash
# Rebuilds the database from scratch: schema, sample data, Phase 0 additions.
# Usage: ./reset_db.sh            (uses PG* environment variables, e.g. PGHOST, PGUSER, PGDATABASE)
set -euo pipefail
cd "$(dirname "$0")"
for f in 01_schema.sql 02_sample_data.sql 03_phase0_additions.sql; do
  echo ">> $f"
  psql -v ON_ERROR_STOP=1 -q -f "$f"
done
echo "Database ready."
