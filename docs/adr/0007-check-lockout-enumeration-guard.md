# `check-lockout` omits the attempts count and relies on a WAF rate limit

The unauthenticated `/api/auth/check-lockout` route **deliberately omits the raw failed-attempts count** and has **no in-app rate limiting**, relying instead on a **Cloudflare WAF rate-limit rule (~20 req/min/IP)**.

## Why

- **No attempts count (SEC-02):** returning the raw count turns the endpoint into an **account-enumeration oracle** — an attacker could probe which emails exist / are close to lockout. The route reports only lockout state, not the number.
- **WAF instead of in-app throttle:** the endpoint is unauthenticated and pre-session, so an app-layer limiter would itself need per-IP state at the edge. The Cloudflare WAF rule already provides that closer to the client, before the worker runs.

## Consequences

- **Don't add `attempts` back** to the response, and **don't remove the Cloudflare WAF rate-limit rule** — the two decisions are load-bearing together.
- Lockout itself lives in `failed_login_attempts` (RLS enabled, zero policies ⇒ service-role only), **5 attempts / 15 min**, via the atomic `increment_failed_attempts` RPC (granted to `service_role` only).
