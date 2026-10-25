# PickMyClass

<img width="1440" height="900" alt="PickMyClass - free ASU class seat tracker with open-seat email alerts" src=".github/screenshot.png" />

Free email alerts for ASU students: watch a class section and get an email when a seat opens or a named instructor replaces "Staff".

Built with TanStack Start (React 19, TypeScript) and deployed as one Cloudflare Worker, with PlanetScale Postgres through Hyperdrive, Clerk auth, Cloudflare Workflows + Queues for seat checks and Cloudflare Email for delivery.

## How it works

```
Workflow schedule (every 15 min) ─► SectionCheckWorkflow ─► Cloudflare Queue
                                                                  │
                                                                  ▼
             Postgres ◄── change detection ◄── ASU Class Search ◄── queue consumer
                │
                └─► notification claim ─► Cloudflare Email ─► student
```

1. A student watches a section from the dashboard.
2. Every 15 minutes `SectionCheckWorkflow` enqueues half the watched sections, so each one is checked every 30 minutes. An hourly `MaintenanceWorkflow` expires stale notifications and runs the retention purge.
3. The queue consumer (`worker.ts`) fetches each section from ASU, compares it with the stored state and records the change.
4. Watchers of a section that gained a seat or an instructor are claimed and emailed. Delivery is at-least-once: a send whose outcome is unknown is retried rather than dropped.
5. The dashboard polls `/api/class-watches/states` for fresh seat counts.

Where each part lives, and the rules that span files, are in [AGENTS.md](AGENTS.md).

## Self-hosting

### Prerequisites

- pnpm (version pinned in `package.json`) and Node (`.node-version`)
- A Postgres database (PlanetScale in production) and a Cloudflare Hyperdrive config pointing at it
- A Clerk application
- A Cloudflare account with Workers, Queues, Workflows and Email Sending
- ASU Class Search API access

### 1. Install

```bash
git clone https://github.com/Divkix/pickmyclass.git
cd pickmyclass
pnpm install
```

### 2. Database and Hyperdrive

Apply migrations with the **direct** database URL (drizzle-kit runs in Node, not through Hyperdrive):

```bash
DATABASE_URL="postgres://…" pnpm run db:migrate
wrangler hyperdrive create HYPERDRIVE --connection-string="postgres://…" --caching-disabled
```

Put the new Hyperdrive id in `wrangler.jsonc`.

### 3. Clerk

1. Set the instance's publishable key as `CLERK_PUBLISHABLE_KEY` in `wrangler.jsonc` `vars`, and add its Frontend API host to `CLERK_CSP` in `lib/clerk/config.ts`.
2. Sessions → Customize session token: `{"ext_id":"{{user.external_id || user.id}}"}`.
3. Webhooks → add `https://your-domain.com/api/webhooks/clerk` for `user.created`, `user.updated` and `user.deleted`.
4. Enable Google under Social Connections if you want OAuth sign-in.

### 4. Configuration and secrets

Every variable is listed and explained in `.env.example`. Locally, copy it to `.dev.vars` (gitignored; `dev` and `preview` read it). In production, non-secret values are `vars` in `wrangler.jsonc` and secrets are set with Wrangler:

```bash
for s in CLERK_SECRET_KEY CLERK_JWT_KEY CLERK_WEBHOOK_SIGNING_SECRET ASU_API_BASE_URL \
  ASU_API_TOKEN CRON_SECRET UNSUBSCRIBE_SIGNING_SECRET; do wrangler secret put "$s"; done
```

### 5. Deploy

```bash
DATABASE_URL="postgres://…" pnpm run deploy   # build, migrate, deploy Worker + Workflow schedules, IndexNow ping
```

`wrangler deploy` creates the queue and its dead-letter queue. Legal pages under `app/routes/legal/` name `support@pickmyclass.app`; change them for your deployment. Check `https://your-domain.com/api/monitoring/health` afterwards.

## Development

```bash
docker run --name pickmyclass-postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:18
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres pnpm run db:migrate
cp .env.example .dev.vars   # fill in Clerk development instance keys

pnpm run dev       # localhost:3000
pnpm run preview   # build + real Worker on localhost:8787
pnpm run verify    # format, lint, type-check, knip (pre-commit hook and CI)
pnpm run test      # tests, live database excluded
```

The full command list is the `scripts` block of `package.json`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Branch from `main`, run `pnpm run verify`, use Conventional Commits and open a PR. The dependency policy lives in the comments of [`pnpm-workspace.yaml`](pnpm-workspace.yaml) and [`.github/dependabot.yml`](.github/dependabot.yml); the auto-merge gate is [`.github/workflows/dependabot-automerge.yml`](.github/workflows/dependabot-automerge.yml).

## License

MIT. See [LICENSE](LICENSE).
