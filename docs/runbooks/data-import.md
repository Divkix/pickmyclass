# Data Import Runbook: Supabase to PlanetScale Postgres

> No Supabase Pro plan required — uses the free-tier connection pooler (Supavisor).

## Prerequisites

- Supabase pooler connection string (Supabase Dashboard > Settings > Database >
  Connection string > URI — the pooler URL on port 5432, NOT the direct connection)
- PlanetScale Postgres connection string (PlanetScale dashboard)
- `psql` installed locally (`brew install libpq` on macOS)

## Step 1 — Apply target schema

Apply the consolidated schema to PlanetScale. This creates all tables, indexes,
and functions from scratch. Do NOT use `pg_dump` of the Supabase schema (it
contains RLS policies, Supabase-specific roles, and `auth.uid()` references).

```bash
psql "$PLANETSCALE_URL" \
  -f supabase/migrations/20260822000000_planetscale_schema.sql
```

Set the env vars `SUPABASE_POOLER_URL` and `PLANETSCALE_URL` in your shell before
running the commands below. Get the Supabase pooler URI from the dashboard
(Settings > Database > Connection string > URI — use the session-mode pooler,
NOT the direct connection that requires the IPv4 add-on).

## Step 2 — Export data from Supabase

Use `\copy` to export each public table to a CSV file:

```bash
for table in class_states class_watches notifications_sent user_profiles failed_login_attempts; do
  echo "Exporting $table..."
  psql "$SUPABASE_POOLER_URL" -c "\copy (SELECT * FROM public.$table) TO '/tmp/${table}.csv' WITH CSV HEADER"
done
```

## Step 3 — Import into PlanetScale

```bash
for table in class_states class_watches notifications_sent user_profiles failed_login_attempts; do
  echo "Importing $table..."
  psql "$PLANETSCALE_URL" -c "\copy public.$table FROM '/tmp/${table}.csv' WITH CSV HEADER"
done
```

## Step 4 — Populate the users mirror table

Until the Clerk auth migration is complete, populate `users` from `auth.users`:

```bash
psql "$SUPABASE_POOLER_URL" -c \
  "\copy (SELECT id::text, email, email_confirmed_at::text, created_at::text, last_sign_in_at::text FROM auth.users) TO '/tmp/users.csv' WITH CSV HEADER"

psql "$PLANETSCALE_URL" -c \
  "\copy public.users FROM '/tmp/users.csv' WITH CSV HEADER"
```

The `id` is cast to `text` because the `users` table PK is `TEXT` (to accommodate
future Clerk user IDs). Existing FK data in `class_watches.user_id` and
`user_profiles.user_id` (already `TEXT` in the new schema) references these rows
directly.

## Step 5 — Advance sequences

CSV import does NOT advance sequences. Run this on PlanetScale before cutover:

```sql
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT 'public.' || c.relname AS seq_name,
           replace(c.relname, '_id_seq', '') AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'S'
  LOOP
    EXECUTE format('SELECT setval(%L, COALESCE((SELECT MAX(id) FROM %I), 0) + 1, false)',
                   r.seq_name, r.table_name);
    RAISE NOTICE 'Advanced % for table %', r.seq_name, r.table_name;
  END LOOP;
END $$;
```

## Step 6 — Verify

```bash
pnpm exec tsx scripts/verify-migration.ts \
  --source="$SUPABASE_POOLER_URL" \
  --target="$PLANETSCALE_URL"
```

This checks row counts and checksums for all five tables, and verifies sequences
are advanced.

## Step 7 — Cutover checklist

- [ ] All table row counts match between source and target
- [ ] All checksums match
- [ ] All sequences advanced
- [ ] `users` mirror table populated
- [ ] Hyperdrive binding created and ID in `wrangler.jsonc`
- [ ] Deploy and smoke test
