# Cutover Runbook: Clerk Auth (production import) + Hyperdrive Data Plane

**Scope:** #353 epic P6–P7 (issue #352). Works for initial live cutover (2026-08-22, 175 users) and any future re-import. See also `docs/runbooks/data-import.md` (vanilla PG CSV import) and ADRs 0012/0013/0014. Owner executes freeze/import/deploy; agent provides commands + verification.

## Prerequisites (owner checklist from #353 — all [x] at live cutover)

- [x] PlanetScale org/database (`pickmyclass`, region + PS-5) + `wrangler hyperdrive create HYPERDRIVE --caching-disabled` → `wrangler.jsonc` binding `HYPERDRIVE` id `749d7808617942ceabbca1059710fbbf`.
- [x] Clerk production instance (`clerk.pickmyclass.app`), custom domain CNAME `clerk → frontend-api.clerk.services` (grey-cloud), session claim `{"ext_id":"{{user.external_id || user.id}}"}` (Dashboard → Sessions → Customize token), `username OFF` (failed 175 imports otherwise).
- [x] Clerk secrets via `wrangler secret put`: `CLERK_SECRET_KEY` (`sk_live_...`), `CLERK_PUBLISHABLE_KEY` (`pk_live_Y2xlcmsucGlja215Y2xhc3MuYXBwJA` literal also in `lib/clerk/config.ts`), `CLERK_JWT_KEY` (PEM 9 lines), `CLERK_WEBHOOK_SIGNING_SECRET` (`whsec_...` at `POST /api/webhooks/clerk` `user.created/updated/deleted`). Local `.dev.vars` (0600, gitignored) holds `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` alias.
- [x] Google Cloud Console: existing OAuth client + redirect `https://clerk.pickmyclass.app/v1/oauth_callback` + origins `https://pickmyclass.app` + `https://clerk.pickmyclass.app` → paste Client ID/Secret into Dashboard → Social Connections → Google (scopes `openid email profile`).
- [x] Supabase pooler URL (`postgresql://...pooler.supabase.com:5432/postgres`, no IPv4 add-on), kept read-only after cutover. PlanetScale schema `db/migrations/20260822000000_planetscale_schema.sql` already applied (includes `users.clerk_user_id TEXT UNIQUE`).
- [ ] Clerk Dashboard Paths (manual, set before/with deploy of #354): Sign-in path `/sign-in`, Sign-up path `/sign-up`, custom domain `clerk.pickmyclass.app`. The hosted components render at those routes with `routing="path"`.

## Pre-freeze (T-30 min, no downtime yet)

1. **Replication lag (if logical replication):** on replica `SELECT received_lsn, pg_last_wal_replay_timestamp()` vs primary `SELECT pg_current_wal_lsn()` — lag < 10 MB / 5 s before freeze. For pooler `\copy` method, just `psql $SRC -c "SELECT count(*) FROM auth.users"` baseline.
2. **Codify freeze window:** announce maintenance window, set `user_profiles` writes paused in app (no deploys).
3. **Capture pre-check:** `wrangler whoami` (expected `chauhan.divanshu@gmail.com`, account `64fb...`, workers write), `wrangler secret list` (7 `SUPABASE_*` removed, 4 `CLERK_*` present), `dig @1.1.1.1 clerk.pickmyclass.app CNAME` → `frontend-api.clerk.services → worker.clerkprod-cloudflare.net` (4 answers), `curl --resolve clerk... https://clerk.pickmyclass.app/v1/client` → `405` with `x-clerk-trace-id` / `client_3IH...`.
4. **Baseline counts:** `psql $SRC -c "SELECT count(*) FROM auth.users"` (175) + `psql $TGT -c "SELECT count(*) FROM users"` if any, and `pnpm run check && pnpm run type-check && pnpm exec knip && pnpm run build` (all green before freeze; `pnpm run test:coverage` 66/14 files 733/162 tests, overall 67% (<80% global threshold — see #352 consolidation) — 14 skipped integration suites are `@ts-nocheck` Clerk-migration placeholders, not regressions).

## Freeze (put Supabase read-only, 2–5 min window)

```bash
# If using publication/subscription: on primary
ALTER PUBLICATION supabase_migration SET (publish = 'insert,update,delete'); -- keep readable
# Or just stop writes: app maintenance mode + no `supabase db push`
```

## Final catch-up (still frozen, no writes)

### CSV path (data plane, PlanetScale) — if re-importing PG tables

```bash
for t in class_states class_watches notifications_sent user_profiles failed_login_attempts; do
  psql "$SRC" -c "\copy (SELECT * FROM public.$t) TO '/tmp/$t.csv' WITH CSV HEADER"
  psql "$TGT" -c "\copy public.$t FROM '/tmp/$t.csv' WITH CSV HEADER"
done
# users mirror pre-Clerk (optional if Clerk import does it)
psql "$SRC" -c "\copy (SELECT id::text,email,email_confirmed_at::text,created_at::text,last_sign_in_at::text FROM auth.users) TO '/tmp/users.csv' WITH CSV HEADER"
psql "$TGT" -c "\copy public.users FROM '/tmp/users.csv' WITH CSV HEADER"
```

### Clerk production import (auth plane) — the live path

```bash
# 1. Export (uses Supabase pooler, reads auth.users.encrypted_password bcrypt; needs no IPv4 add-on)
git clone https://github.com/clerk/migration-tool /tmp/migration-tool
cd /tmp/migration-tool && bun install
DATABASE_URL="$SRC" bun --env-file .env run export --transformer supabase -f /tmp/supabase-users.json
# → /tmp/supabase-users.json 175 users (175/175 email, 125/175 confirmed, 61/175 password, 0 phone) 156 KiB
# Transformer patches for this instance (src/transformers/supabase.ts):
#   defaults.skipLegalChecks:true (125 legal_accepted_at failures otherwise)
#   keep all emails as "email" not unverified (Supabase emails are verified or pending)
#   generate username = emailPrefix.slice(0,15)+'_'+userId.slice(0,4) (max20) when auth_config username:on — later set OFF so this is legacy
cp /tmp/supabase-users.json supabase-users.json

# 2. Import (creates Clerk users with externalId = old UUID → zero FK remapping for class_watches.user_id)
bun --env-file .env run migrate -y -t supabase -f supabase-users.json --clerk-secret-key "$CLERK_SECRET_KEY"
# → Processed 175 → Successfully imported:175, Failed:0 (was 50 username + 125 legal before patch)
# → log migration-*.log 175 success user_3IH...
CLERK_SECRET_KEY=$CLERK_SECRET_KEY curl -s "https://api.clerk.com/v1/users?limit=10" | jq '.[].external_id'
```

## Advance sequences (CSV path only, not Clerk import)

```sql
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT 'public.'||c.relname AS seq, replace(c.relname,'_id_seq','') AS tbl
           FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relkind='S' LOOP
    EXECUTE format('SELECT setval(%L, COALESCE((SELECT MAX(id) FROM %I),0)+1,false)', r.seq, r.tbl);
  END LOOP; END $$;
```

## Deploy Worker with new bindings

```bash
pnpm run build
wrangler secret put CLERK_SECRET_KEY
wrangler secret put CLERK_PUBLISHABLE_KEY  # value = NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
wrangler secret put CLERK_JWT_KEY          # paste 9-line PEM
wrangler secret put CLERK_WEBHOOK_SIGNING_SECRET
# HYPERDRIVE binding already in wrangler.jsonc; no secret needed for it
pnpm run deploy # vinext build (253 modules, 112 assets, 64 reused, ~740 KiB gzip) + wrangler deploy + wrangler triggers deploy
# → Version d0dd5a8c / 773b5d4e triggers "0,30 * * * *" + "0 4 * * *", placements remote-ZRH etc.
curl -I https://pickmyclass.app --resolve clerk... # 200 + CSP *.clerk.accounts.dev clerk.pickmyclass.app challenges.cloudflare.com *.protect.clerk.com:* + img.clerk.com
```

## Smoke (all must 200/expected, <5 min)

1. **Sign-up** → hosted `/sign-up` (Clerk `<SignUp>` component) creates the account; email verification completes inside the hosted flow; the `/api/webhooks/clerk` mirror writes `user_profiles` and the edge gate stops bouncing within its 30s cache TTL.
2. **Duplicate sign-up** same email → Clerk's own "identifier already taken" error renders in the component (no server anti-enumeration route anymore).
3. **Unverified resume** → signed-in but unverified user hitting a protected page bounces to `/sign-in`, where the hosted flow offers the verification step (`/sign-in` is allow-listed in `decideGate` rule ② to avoid a self-redirect loop).
4. **Sign-in** → hosted `/sign-in` (`<SignIn>`), password checked by Clerk → dashboard. **Lockout** is Clerk Attack Protection's job now — no `/api/auth/login` ticket flow, no 423, no `check-lockout` endpoint.
5. **Google OAuth** → hosted connection → lands on `/auth/post-oauth` via the SignUp fallback redirect → mirror-race repair + re-link by verified email (`externalId` mapping from the 2026-08-22 import still keys this).
12. **Health** → `GET /api/monitoring/health` DB + ASU API + CronLock + email + config 200.
13. **Sign-out** → `AuthButton` `await clerk.signOut()` (clears `__session` client) → `POST /api/auth/signout` (`revokeSession` + `CLERK_COOKIES_TO_CLEAR`) → `window.location.href='/sign-in'` hard redirect (not bounce; server-revoke-only used to leave client `__session` alive).

## Unfreeze

- Remove maintenance mode, allow writes. Announce cutover complete. Keep Supabase project **read-only fallback for N≥14 days** before dropping publication/subscription; do not `DROP PUBLICATION` yet.

## Rollback (data loss window = freeze-to-cutover writes, ∼5 min)

- **Data rollback (the only remaining path):** repoint `HYPERDRIVE` binding to Supabase connection string (`wrangler hyperdrive update`) or revert `wrangler.jsonc` binding + `wrangler deploy`.
  Auth-plane rollback via code is gone: since #354 the `lib/supabase/*` shims and the custom login/register pages no longer exist, so `git revert` cannot restore a working Supabase auth stack — reverting auth means re-importing/re-enabling GoTrue at the Clerk/Supabase project level (ops task), not a code revert.
- Document data-loss caveat in incident channel: any watches created during window on PlanetScale must be manually re-created or `pg_dump`'d and replayed.

## Known windows/risks

- **Legal consent:** `skipLegalChecks:true` only for one-time import; new signups still must tick Terms (checkbox copy unchanged). Keep `legal_consent_enabled` ON in Clerk.
- **Username:** set `username OFF` (failed 175 imports when `on`). If re-enabled, migration-tool must generate `username` (max20) again.
- **Dedup lifecycle:** daily `0 4 * * *` `expire_stale_notifications()` is load-bearing (frees 24h slots) + hard-deletes past-term watches via `getPastTermCodes`.
- **Edge HTML cache:** HIT skips `proxy.ts` + RSC for anonymous GETs (`/`, `/faq`, `/about`, `/blog/*`, `/legal/*`); `?_rsc` / `RSC:` requests excluded (ADR 0009).
