# Data Import Runbook: Supabase → PlanetScale Postgres

> Official guide: <https://planetscale.com/docs/postgres/imports/supabase>

## Prerequisites (owner actions)

1. **Enable Supabase IPv4 add-on** (dashboard warns of possible brief downtime — schedule accordingly).
2. **Share the direct Postgres connection URL** (pooled endpoints are unsuitable for dumps/replication).

## Step 1 — Prepare source

```sql
-- On Supabase (via SQL Editor or direct connection)
ALTER ROLE postgres SET statement_timeout = 0;
```

This prevents WAL/disk buildup on the source during the copy.

## Step 2 — Apply target schema

Apply the consolidated schema migration to the PlanetScale branch:

```bash
psql "$PLANETSCALE_CONNECTION_STRING" \
  -f supabase/migrations/20260822000000_planetscale_schema.sql
```

This creates all tables, indexes, and functions from scratch — do NOT use a raw `pg_dump` of the Supabase schema (it contains RLS policies, Supabase-specific roles, and `auth.uid()` references that don't exist in PlanetScale).

## Step 3 — Copy data

### Option A: Logical replication (recommended for zero-downtime)

On Supabase:
```sql
CREATE PUBLICATION replicate_to_planetscale
  FOR TABLE public.class_states, public.class_watches,
            public.notifications_sent, public.user_profiles,
            public.failed_login_attempts;
```

On PlanetScale:
```sql
CREATE SUBSCRIPTION sub_from_supabase
  CONNECTION 'host=...supabase... port=5432 dbname=postgres user=postgres password=...'
  PUBLICATION replicate_to_planetscale
  WITH (copy_data = true);
```

Monitor until all tables are `ready`:
```sql
SELECT sr.relname, sr.srsubstate FROM pg_subscription_rel sr
JOIN pg_class c ON c.oid = sr.srrelid;
```

Compare LSNs to confirm replication is caught up.

### Option B: pgcopydb (alternative)

```bash
pgcopydb clone --follow \
  --source "$SUPABASE_DIRECT_URL" \
  --target "$PLANETSCALE_CONNECTION_STRING"
```

pgcopydb automatically resets sequences after the copy.

## Step 4 — Advance sequences

**Critical:** Logical replication does NOT sync sequences. Before cutover:

```sql
-- On PlanetScale, for each sequence, set it to max(id) + 1
SELECT setval('class_states_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM class_states));
-- Repeat for class_watches_id_seq, notifications_sent_id_seq, user_profiles_id_seq
```

Or use this dynamic script:
```sql
DO $$
DECLARE
  r RECORD;
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

## Step 5 — Populate the users mirror table

Until the Clerk auth migration is complete, populate `users` from `auth.users`:

```sql
INSERT INTO users (id, email, email_confirmed_at, created_at, last_sign_in_at)
SELECT
  id::text,
  email,
  email_confirmed_at,
  created_at,
  last_sign_in_at
FROM auth.users;
```

The `id` is cast to `text` because the `users` table PK is `TEXT` (to accommodate future Clerk user IDs). Existing FK data in `class_watches.user_id` and `user_profiles.user_id` (already `TEXT` in the new schema) will reference these rows directly.

## Step 6 — Verify

```bash
tsx scripts/verify-migration.ts \
  --source="$SUPABASE_DIRECT_URL" \
  --target="$PLANETSCALE_CONNECTION_STRING"
```

This checks row counts and checksums for all five tables, and verifies sequences are advanced.

## Step 7 — Cutover checklist

- [ ] All table row counts match between source and target
- [ ] All checksums match
- [ ] All sequences advanced (`setval` complete)
- [ ] `users` mirror table populated
- [ ] Hyperdrive binding created (`wrangler hyperdrive create PICKMYCLASS_HYPERDRIVE --connection-string="..." --caching-disabled`)
- [ ] Hyperdrive ID pasted into `wrangler.jsonc`
- [ ] All secrets set via `wrangler secret put` (ASU_API_BASE_URL, ASU_API_TOKEN, CRON_SECRET, UNSUBSCRIBE_SIGNING_SECRET)
- [ ] Deploy and smoke test
