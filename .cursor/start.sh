#!/usr/bin/env bash
# Cloud Agent start phase (per-boot reconciliation, idempotent).
#
# Brings up local PostgreSQL and ensures the dev database matches the app schema.
# Must tolerate restarts and reach a clear ready state.
set -euo pipefail

# Start the PostgreSQL service (no-op if already running).
sudo service postgresql start >/dev/null 2>&1 || sudo pg_ctlcluster 16 main start || true

# Wait for the server to accept connections.
for _ in $(seq 1 30); do
  if sudo -u postgres pg_isready -q 2>/dev/null; then
    break
  fi
  sleep 1
done

# Match the credentials used by wrangler.jsonc's Hyperdrive localConnectionString
# (postgresql://postgres:postgres@localhost:5432/postgres).
sudo -u postgres psql -qc "ALTER USER postgres WITH PASSWORD 'postgres';" >/dev/null 2>&1 || true

# Apply the consolidated PlanetScale schema. It is the authoritative current
# schema (tables + SECURITY DEFINER RPCs) and is fully idempotent
# (CREATE ... IF NOT EXISTS / CREATE OR REPLACE), so re-running is safe.
PGPASSWORD=postgres psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -f db/migrations/20260822000000_planetscale_schema.sql >/dev/null

echo "PostgreSQL ready on localhost:5432 with the PickMyClass schema applied."
