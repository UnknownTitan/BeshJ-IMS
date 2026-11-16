#!/usr/bin/env bash
# Rebuilds the database from scratch by running every numbered script (01_, 02_, ...) in order.
# Usage: ./reset_db.sh            (uses PG* environment variables, e.g. PGHOST, PGUSER, PGDATABASE)
set -euo pipefail
cd "$(dirname "$0")"
for f in 0[0-9]_*.sql; do
  echo ">> $f"
  psql -v ON_ERROR_STOP=1 -q -f "$f"
done
echo "Database ready."
