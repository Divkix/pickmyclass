# Authorization State is a server-only module with cached and fresh reads

The `{ is_admin, is_disabled, has_consent }` access decision is owned by one server module (`lib/auth/authorization-state.ts`). `has_consent` is derived from both legal-consent timestamps rather than stored separately. The module owns the query, 30s cache, and invalidation, exposing a **cached** read (edge) and a **fresh** read (admin/login). We deliberately left the browser `AuthContext` admin-only read out and did **not** collapse everything to a single cached path.

## Why

- **Keep the cached-vs-fresh split.** `proxy.ts` runs on every request and may serve a 30s-stale decision (a documented CPU saver); `verifyAdmin` and login read live so disabling an admin is enforced immediately on admin pages. Making everyone cached weakens that live backstop; making everyone fresh drops the edge cache.
- **Don't unify the browser read.** `AuthContext`'s `is_admin` is a UI affordance only, never a security boundary, and the per-isolate server cache can't cross into the browser anyway. Folding it in would couple a security gate to a cosmetic hint for no leverage.
- **Keep legal consent in the same edge decision.** Protected-route access depends on both timestamps. Reading them with the existing profile query avoids a second edge round-trip, and `/api/auth/consent` invalidates the cached decision immediately after recording them.

## Consequences

- The cache + `invalidateAuthorizationState` moved **out** of `proxy.ts`; `proxy` is now just another reader and `app/api/user/delete` imports invalidation from `lib/auth/authorization-state.ts`, not `@/proxy`.
- The Google OAuth callback and protected `/consent` gate repair pre-existing accounts with missing timestamps on their next sign-in; timestamps are not silently backfilled without an explicit confirmation.
- A future review may suggest merging the browser admin hint into this state — this ADR records why it stays separate and why both cached and fresh server reads exist.
