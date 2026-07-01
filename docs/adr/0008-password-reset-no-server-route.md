# Password reset has no server route (fully client-side)

There is **no `reset-password` server route**. Password reset runs entirely through the Supabase **browser** client: `resetPasswordForEmail` → `/auth/callback?next=/reset-password` → `updateUser({ password })`.

## Why

The Supabase browser SDK already handles the recovery-token exchange and the authenticated `updateUser` call against RLS. Adding a server route would duplicate that flow with no security gain — the reset link's token is the gate, and the callback's `next` param is already open-redirect-guarded.

## Consequences

- **`proxy.ts` intentionally allows `/reset-password` while email is unconfirmed** and excludes it from `AUTH_PAGES`. This looks like a gap in the auth gate but is required — the recovery session hasn't confirmed email yet. **Don't "fix" this.**
- No server route means no `ok()/fail()` envelope or route handler to keep in sync for this flow; it lives with the other client-side Supabase auth calls.
