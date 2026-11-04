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
```

Create a Hyperdrive config for the same database with caching disabled (dashboard, or the one-off `pnpm dlx wrangler hyperdrive create HYPERDRIVE --connection-string="postgres://…" --caching-disabled`) and put its id in `alchemy.run.ts`.

### 3. Clerk

1. Set the instance's publishable key as `CLERK_PUBLISHABLE_KEY` in `VARS` in `alchemy.run.ts`, and add its Frontend API host to `CLERK_CSP` in `lib/clerk/config.ts`.
2. Sessions → Customize session token: `{"ext_id":"{{user.external_id || user.id}}"}`.

   The client and server use this app user id for watchlist ownership, preserving migrated users' external ids.
3. Webhooks → add `https://your-domain.com/api/webhooks/clerk` for `user.created`, `user.updated` and `user.deleted`.
4. Enable Google under Social Connections if you want OAuth sign-in.

Disabled accounts are signed out and shown an account-disabled notice on `/sign-in` with a support contact.

### 4. Configuration and secrets

Every variable is listed and explained in `.env.example`. Locally, copy it to `.env` (gitignored; `alchemy dev` reads it). In production, non-secret values are `VARS` in `alchemy.run.ts`, and secrets are Worker secrets set in the dashboard (or with the one-off `pnpm dlx wrangler secret put <NAME>`). Alchemy leaves secrets it did not upload alone, so deploys never remove them:

`CLERK_SECRET_KEY CLERK_JWT_KEY CLERK_WEBHOOK_SIGNING_SECRET ASU_API_BASE_URL ASU_API_TOKEN CRON_SECRET UNSUBSCRIBE_SIGNING_SECRET OTEL_BROWSER_INGEST_KEY`

### 5. Deploy

Every Cloudflare resource is declared in `alchemy.run.ts` and deployed with [Alchemy](https://alchemy.run). Connect it to Cloudflare once with `pnpm exec alchemy profile edit --add Cloudflare`, or export `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.

```bash
DATABASE_URL="postgres://…" pnpm run deploy   # build, migrate, alchemy deploy --stage prod, IndexNow ping
```

Production deploys run from `.github/workflows/deploy.yml` on every push to `main` (and on manual dispatch). It needs the repository secrets `CLOUDFLARE_API_TOKEN` and `DATABASE_URL` and the variable `CLOUDFLARE_ACCOUNT_ID`. The first deploy creates the queue, its dead-letter queue and the Workflow schedules. If the Worker or queues already exist, take them over once with `pnpm exec alchemy deploy --stage prod --adopt`. Alchemy keeps its state in the account's state store (`pnpm exec alchemy state bootstrap` creates it once per account), shared by laptop and CI deploys; if it is lost, the same `--adopt` deploy rebuilds it. Legal pages under `app/routes/legal/` name `support@pickmyclass.app`; change them for your deployment. Check `https://your-domain.com/api/monitoring/health` afterwards.

## Development

```bash
docker run --name pickmyclass-postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:18
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres pnpm run db:migrate
cp .env.example .env   # fill in Clerk development instance keys

pnpm run dev       # alchemy dev: the Worker in workerd on localhost:3000, bindings emulated
pnpm run verify    # format, lint, type-check, knip (pre-commit hook and CI)
pnpm run test      # tests, live database excluded
```

`pnpm run dev` needs Cloudflare credentials (the profile or env vars above) even though everything runs locally. Its Hyperdrive binding points at `LOCAL_DATABASE_URL` (default: the container above). Clerk development keys (`pk_test_`) authorize `localhost:3000` plus `NEXT_PUBLIC_SITE_URL`. Production keys (`pk_live_`) authorize only `NEXT_PUBLIC_SITE_URL`.

The full command list is the `scripts` block of `package.json`.

CI runs verification, coverage, database tests and the build in parallel on GitHub-hosted runners; the required **CI Success** check aggregates all four. The shared setup caches `node_modules` by runner OS/architecture, Node version, lockfile, workspace configuration, patches and `.npmrc`, and only installs on an exact cache miss. PostgreSQL starts before dependency setup so initialization overlaps it.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Branch from `main`, run `pnpm run verify`, use Conventional Commits and open a PR. The dependency policy lives in the comments of [`pnpm-workspace.yaml`](pnpm-workspace.yaml) and [`.github/dependabot.yml`](.github/dependabot.yml); Dependabot PRs are reviewed and merged by hand.

## License

MIT. See [LICENSE](LICENSE).
