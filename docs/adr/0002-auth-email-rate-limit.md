# Auth email rate limit can be raised above Supabase's default

Supabase Auth caps the number of auth emails (signup confirmation, password reset, email-change, magic links) that can be sent **per hour**. When the cap is hit, the API returns an "email rate limit exceeded" error and no email is sent. We raise this above the conservative default.

## Why

PickMyClass does **not** use Supabase's bundled SMTP. Auth emails are delivered through a custom **Send Email Hook** that calls the Cloudflare Email Service (`app/api/auth/send-email-hook/route.ts`). There is no per-send cost or third-party SMTP quota, so the default conservative limit is unnecessarily low.

## Consequences

- **Production** — the authoritative setting lives in Supabase Dashboard → **Authentication** → **Rate Limits** → **"Number of emails that can be sent per hour"**. Raise it to fit expected signup/reset volume (e.g. 30+). `supabase/config.toml` does **not** govern production.
- **Local CLI stack** — `supabase/config.toml` → `[auth.rate_limit]` → `email_sent` (currently `30`), kept in sync only for local parity.
- Related: send hook `app/api/auth/send-email-hook/route.ts`; templates `lib/email/auth-templates.ts`.
