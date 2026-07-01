# Authorization State is a server-only module with a cached and a fresh read

The `{ is_admin, is_disabled }` pair is read in four places — the edge proxy, `verifyAdmin`, the login route, and the browser `AuthContext`. We consolidated the three **server** readers behind one module (`lib/auth/authorization-state.ts`) that owns the query, the 30s cache, and its invalidation, exposing a **cached** read (edge) and a **fresh** read (admin/login). We deliberately left the browser `AuthContext` read out and did **not** collapse everything to a single cached path.

## Why

- **Keep the cached-vs-fresh split.** `proxy.ts` runs on every request and may serve a 30s-stale decision (a documented CPU saver); `verifyAdmin` and login read live so disabling an admin is enforced immediately on admin pages. Making everyone cached weakens that live backstop; making everyone fresh drops the edge cache.
- **Don't unify the browser read.** `AuthContext`'s `is_admin` is a UI affordance only, never a security boundary, and the per-isolate server cache can't cross into the browser anyway. Folding it in would couple a security gate to a cosmetic hint for no leverage.

## Consequences

- The cache + `invalidateAuthorizationState` moved **out** of `proxy.ts`; `proxy` is now just another reader and `app/api/user/delete` imports invalidation from `lib/auth/authorization-state.ts`, not `@/proxy`.
- A future review will see "four reads of the same two columns" and may suggest merging them — this ADR records why the browser read stays separate and why both a cached and a fresh server read exist.
