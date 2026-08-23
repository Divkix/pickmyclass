# Auth plane: GoTrue → Clerk (edge JWT, mirror, webhooks)

**Date:** 2026-08-22. **Status:** Accepted. Supersedes GoTrue auth; `user_profiles` stays authorization source of truth.

## Context

Supabase GoTrue coupled auth to PostgREST: `auth.users` + RLS, `proxy.ts` SSR cookie gate via `@supabase/ssr`, Send Email Hook, admin reads of `auth.users`. Moving off Supabase for cost meant replacing auth, not just the DB. Requirements: edge verification under `vinext`/`workerd`, zero FK remapping for existing `class_watches`, preserve app-owned behavior (lockout 5/15m, anti-enumeration, consent gate, WAF on `check-lockout`, unsubscribe HMAC, disposable-email fail-open, dedup lifecycle).

## Decision

* **Clerk is the identity provider.** `@clerk/backend` edge verification + `@clerk/react` `<ClerkProvider>` (via `components/ClerkClientProvider.tsx`). **Not** `@clerk/nextjs` (Node-runtime assumptions vs vinext/workerd isolates). Spike verified `createClerkClient(...).authenticateRequest` + `verifyToken({ jwtKey })` networkless under `workerd` before merge.
* **Publishable key is a committed literal** in `lib/clerk/config.ts` (`pk_live_...`); runtime secrets are `CLERK_SECRET_KEY`, `CLERK_JWT_KEY` (PEM), `CLERK_WEBHOOK_SIGNING_SECRET`, exposed via `lib/cloudflare-env.supplemental.d.ts`.
* **Session claim is `ext_id`.** Dashboard → Sessions → Customize token: `{"ext_id":"{{user.external_id || user.id}}"}`. Edge gate reads `ext_id` first, falls back to `sub` only if absent. Custom domain `clerk.pickmyclass.app` (CNAME `clerk → frontend-api.clerk.services`, grey-cloud) so `*.clerk.accounts.dev` + `clerk.pickmyclass.app` are in CSP (`lib/clerk/config.ts`).
* **`user_profiles` stays the authorization truth** (`is_admin`, `is_disabled`, consent, onboarding). Clerk is identity; app is authorization. `lib/auth/authorization-state.ts` owns the 30s per-isolate cache (cached edge read / fresh admin+login read) and invalidation. `lib/db/users.ts` mirrors Clerk users and solely owns primary-email selection + race repair: `syncUserMirrorFromClerkUser` handles Svix-verified `user.created/updated` at `/api/webhooks/clerk` (route only verifies signatures and delegates; `appUserId = external_id ?? id`, email lowercasing, `age_verified/agreed_to_terms` from `public_metadata`), while `repairUserMirror` lets `/auth/post-oauth` and `/api/auth/consent` repair the webhook race before consent writes. `clerk_user_id TEXT UNIQUE`; `user.deleted` → `softDeleteUserById`.
* **Migration via official `clerk/migration-tool`.** `export:supabase` reads `auth.users.encrypted_password` bcrypt via pg pooler; transformer patched for this instance (`skipLegalChecks:true`, keep verified emails, generate `username` when `username:on`). `externalId` = old Supabase UUID → existing `class_watches.user_id` needs no remapping. Google identities re-link by verified email on next sign-in.
* **Unchanged app-owned behavior stays:** `loginAttemptPolicy` (5/15m, `increment_failed_attempts` RPC, `failed_login_attempts` RLS service-role only), `register` anti-enumeration (`ClerkAPIResponseError` 422 `form_identifier_exists` → `ok(null)`), consent gate (`proxy` blocks `has_consent=false`), WAF rate-limit on `check-lockout` (omits `attempts` count), unsubscribe HMAC (90d, not single-use).

## Why not alternatives

* Supabase Auth + Hyperdrive: keeps GoTrue coupling, still needs Supabase project.
* `@clerk/nextjs`: assumes Node `headers()`/`cookies()` shape; breaks under vinext `proxy.ts`/`workerd`.
* Hand-rolled JWT: loses webhook + social + email lifecycle.

## Consequences

* `lib/supabase/client.ts`/`server.ts` deprecated (knip-ignored); `lib/supabase/config.ts` deprecated; secrets renamed `SUPABASE_*` → `CLERK_*`.
* Edge gate is `lib/auth/clerk-session.ts`: `getClerkClient` per-isolate cache + `jwtKey`, `getSessionIdentity` (ext_id), `verifyEmailPassword`, `createSignInTicket`, `revokeAllUserSessions`. Networkless `jwtKey` avoids JWKS fetch in hot path.
* Webhook must return 2xx fast; Svix retries on 4xx/5xx. Keep `user_profiles` columns via `prevent_user_profile_escalation` trigger (non-service writes no-op).
* Browser compat layer `lib/contexts/AuthContext.tsx` maps `useUser`/`useClerk` to legacy `CompatUser` shape (includes `email_confirmed_at` from `verification.status`).
* Deployment: `wrangler secret put CLERK_SECRET_KEY/CLERK_PUBLISHABLE_KEY/CLERK_JWT_KEY/CLERK_WEBHOOK_SIGNING_SECRET`; `.dev.vars` local only (gitignored, 0600).
