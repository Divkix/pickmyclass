# Cutover Runbook: Clerk Auth (production import) + Hyperdrive Data Plane

**Scope:** #353 epic P6–P7 (issue #352). Works for initial live cutover (2026-08-22, 175 users) and any future re-import. See also `docs/runbooks/data-import.md` (vanilla PG CSV import) and ADRs 0012/0013/0014. Owner executes freeze/import/deploy; agent provides commands + verification.

## Prerequisites (owner checklist from #353 — all [x] at live cutover)

- [x] PlanetScale org/database (`pickmyclass`, region + PS-5) + `wrangler hyperdrive create HYPERDRIVE --caching-disabled` → `wrangler.jsonc` binding `HYPERDRIVE` id `4dd6f09232fe48e181099b2db23d889a`.
- [x] Clerk production instance (`clerk.pickmyclass.app`), custom domain CNAME `clerk → frontend-api.clerk.services` (grey-cloud), session claim `{"ext_id":"{{user.external_id || user.id}}"}` (Dashboard → Sessions → Customize token), `username OFF` (failed 175 imports otherwise).
- [x] Clerk secrets via `wrangler secret put`: `CLERK_SECRET_KEY` (`sk_live_...`), `CLERK_PUBLISHABLE_KEY` (`pk_live_Y2xlcmsucGlja215Y2xhc3MuYXBwJA` literal also in `lib/clerk/config.ts`), `CLERK_JWT_KEY` (PEM 9 lines), `CLERK_WEBHOOK_SIGNING_SECRET` (`whsec_...` at `POST /api/webhooks/clerk` `user.created/updated/deleted`). Local `.dev.vars` (0600, gitignored) holds `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` alias.
- [x] Google Cloud Console: existing OAuth client + redirect `https://clerk.pickmyclass.app/v1/oauth_callback` + origins `https://pickmyclass.app` + `https://clerk.pickmyclass.app` → paste Client ID/Secret into Dashboard → Social Connections → Google (scopes `openid email profile`).
- [x] Supabase pooler URL (`postgresql://...pooler.supabase.com:5432/postgres`, no IPv4 add-on), kept read-only after cutover. PlanetScale schema `supabase/migrations/20260822000000_planetscale_schema.sql` already applied (includes `users.clerk_user_id TEXT UNIQUE`).

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

1. **Register** → Clerk `createUser` → `ok(null)` both duplicate & new (anti-enumeration), no `form_identifier_exists` leak.
2. **Duplicate register** same email → still `200` `ok(null)`.
3. **Email verify** → `/api/auth/email-verified` or Clerk email link → `user_profiles` marks verified + `invalidateAuthorizationState`.
4. **Login** → `verifyEmailPassword` + ticket → dashboard. **Lockout** 5/15m → `423` on 6th, `check-lockout` omits `attempts`, WAF ~20/min/IP holds.
5. **Google OAuth** → `https://clerk.pickmyclass.app/v1/oauth_callback` → `app/auth/post-oauth` → re-link by verified email (existing `chauhan.divanshu@gmail.com:Div2521#` + Google provider both map to `externalId 441c99ce...`, username `chauhan.divanshu_441c`).
6. **Consent gate** → protected `/dashboard` redirects to `/consent` until `age_verified && agreed_to_terms`, then `invalidateAuthorizationState`.
7. **Watch create** → `POST /api/class-watches` → `create_class_watch_with_limit` RPC advisory lock enforces `MAX_WATCHES_PER_USER` (10).
8. **Cron → queue → processSection → Email:** `curl -H "Authorization: Bearer $CRON_SECRET" /api/cron` enqueues stagger groups; `worker.ts queue()` direct `processSection()` ordering (reset → upsert `(class_nbr,term)` **before** send; first-observation guard; `non_reserved_seats ?? seats_available`) → `tryRecordNotificationsBatch` claims + `sendBatchEmailsOptimized` + rollback failed. DLQ `pickmyclass-dlq` always ack.
9. **Unsubscribe** → HMAC `UNSUBSCRIBE_SIGNING_SECRET` 90d `?token=` (`List-Unsubscribe` + `One-Click`) → updates `notifications_enabled`.
10. **Admin** → `verifyAdmin()` fresh read on `app/admin/layout.tsx` + each admin page + RLS; demote → 30s cache invalidated.
11. **Polling** → `useRealtimeClassStates` polls `GET /api/class-watches/states` with `useMemo`'d `classNumbers` (not Realtime channel); map keyed `sectionRefKey`.
12. **Health** → `GET /api/monitoring/health` DB + ASU API + CronLock + email + config 200.
13. **Sign-out** → `AuthButton` `await clerk.signOut()` (clears `__session` client) → `POST /api/auth/signout` (`revokeSession` + `CLERK_COOKIES_TO_CLEAR` 6 names) → `window.location.href='/login'` hard redirect (not bounce). Bug before 773b5d4e was only server revoke leaving client `__session` alive → decrypted blank render.

## Unfreeze

- Remove maintenance mode, allow writes. Announce cutover complete. Keep Supabase project **read-only fallback for N≥14 days** before dropping publication/subscription; do not `DROP PUBLICATION` yet.

## Rollback (data loss window = freeze-to-cutover writes, ∼5 min)

- **Auth rollback:** `wrangler secret put` old `CLERK_*` → revert `lib/clerk/config.ts` literal, or repoint to Supabase GoTrue (requires re-enabling `auth` project). Imported Clerk rows have `externalId`; rollback keeps them but Supabase `auth.users` still readable — replays not needed.
- **Data rollback:** repoint `HYPERDRIVE` binding to Supabase connection string (`wrangler hyperdrive update`) or revert `wrangler.jsonc` binding + `wrangler deploy`.
- **Code rollback:** `git revert` Clerk commits (1a40540, 99cd5e6, a9f29eb) — Supabase code still in `lib/supabase/` deprecated but functional for 14 days.
- Document data-loss caveat in incident channel: any watches created during window on PlanetScale must be manually re-created or `pg_dump`'d and replayed.

## Known windows/risks

- **Legal consent:** `skipLegalChecks:true` only for one-time import; new signups still must tick Terms (checkbox copy unchanged). Keep `legal_consent_enabled` ON in Clerk.
- **Username:** set `username OFF` (failed 175 imports when `on`). If re-enabled, migration-tool must generate `username` (max20) again.
- **Disposable-email KV:** `PICKMYCLASS_DISPOSABLE_DOMAINS` sync daily GitHub → KV, fails open (verification email is real gate); requires ≥1000 domains before overwrite.
- **Dedup lifecycle:** daily `0 4 * * *` `expire_stale_notifications()` is load-bearing (frees 24h slots) + hard-deletes past-term watches via `getPastTermCodes`.
- **Edge HTML cache:** HIT skips `proxy.ts` + RSC for anonymous GETs (`/`, `/faq`, `/about`, `/blog/*`, `/legal/*`); `?_rsc` / `RSC:` requests excluded (ADR 0009).
