# Repository Guidelines

## Project Structure & Module Organization

```
app/          # Routes, pages, and API endpoints (Next.js App Router, no route groups)
lib/          # Core business logic and utilities
components/   # React components (ui/, admin/, landing/, blog/, + shared root components)
tests/        # Test files (unit/, integration/, mocks/)
worker.ts     # Cloudflare Worker (fetch, cron, queue, CronLockDO)
middleware.ts # CDN cache headers only — NOT an auth gate
supabase/     # Supabase CLI config and database migrations
scripts/      # Build and utility scripts (e.g., OG image generation)
```

**Key `lib/` sub-modules:** `asu/` (ASU API client + terms), `auth/`, `db/` (Supabase queries), `email/` (send + templates), `queue/` (section processing, DLQ), `supabase/` (clients + generated types), `types/`, `cache/`, `hooks/`, `contexts/`, `api/` (Zod schemas + validation).

**Important naming collision:** `lib/utils.ts` is the shadcn/ui `cn()` utility only; `lib/utils/` contains custom utilities (crypto, formatting, seat-badge, time-format). Do not confuse them.

## Build, Test, and Development Commands

```bash
bun run dev              # Start development server (localhost:3000)
bun run build            # Build application for production
bun run preview          # Build and preview on Cloudflare Workers locally
bun run deploy           # Build and deploy to Cloudflare Workers

bun run check            # Format, lint, and type-check (all-in-one; does NOT cover worker.ts or scripts/ — see note below)
bun run check:fix        # Auto-fix format and lint issues, then type-check
bun run lint             # Run Oxlint linter
bun run lint:fix         # Auto-fix lint issues
bun run format           # Format code with Oxfmt

bun run test             # Run vitest in watch mode
bun run test:run         # Run tests once (CI mode)
bun run test:coverage    # Run tests with coverage (80% threshold required)

bun run knip             # Find unused exports/dependencies
bun run type-check       # TypeScript type checking (authoritative full check — covers both app and worker.ts/scripts/)
```

> **`bun run check` type-check scope**: `vite.config.ts` excludes `worker.ts` and `scripts/**` from Oxlint's type-aware pass because they require the separate `tsconfig.worker.json` context (Cloudflare Workers types such as `cloudflare:workers` and `Cloudflare.Env` are not available under the app tsconfig). As a result, **`bun run check` does not type-check `worker.ts` or `scripts/`**. Run `bun run type-check` (which runs both `tsc --noEmit` and `tsc -p tsconfig.worker.json --noEmit`) as the authoritative full check before committing any changes to those files.

## Coding Style & Naming Conventions

- **Toolchain**: Vite+ (Oxlint for linting, Oxfmt for formatting) with 2-space indentation, line width 100
- **Strings**: Single quotes, semicolons required
- **Naming**: camelCase for variables/functions, PascalCase for types/components
- **Imports**: Auto-organized by formatter
- **Tests**: colocated in `tests/` directory, not alongside source files
- **Test file naming**: `*.test.ts`, `*.test.tsx`, `*.spec.ts`, `*.spec.tsx`

Run `bun run check:fix` before committing (formats, lints, and type-checks in one pass). If you changed `worker.ts` or `scripts/`, also run `bun run type-check` to cover the worker tsconfig.

## Generated Files

Two files are auto-generated and must be kept in sync when the database or Cloudflare config changes:

| File | Command | When to regenerate |
|------|---------|-------------------|
| `lib/supabase/database.types.ts` | `bunx supabase gen types typescript --project-id osopxwuebsefhoxgeojh > lib/supabase/database.types.ts` | After any Supabase migration (new tables, columns, RPC functions) |
| `lib/cloudflare-env.d.ts` | `bun run cf-typegen` | After changing `wrangler.jsonc` (bindings, vars, queues, DO, KV) |

**Important**: If you see `as unknown as` casts on `.rpc()` calls with a comment like "not yet in generated types", regenerate `database.types.ts` and remove the cast. Wrangler secrets (e.g. `SUPABASE_SERVICE_ROLE_KEY`, `ASU_API_TOKEN`) are not in `wrangler.jsonc` and will never appear in the generated CF types — `env as unknown as Env` casts for those are correct and intentional.

There is also `lib/cloudflare-env.supplemental.d.ts` for manually typing secrets that `cf-typegen` cannot generate (e.g. `SUPABASE_SERVICE_ROLE_KEY`). Edit this file when adding new Wrangler secrets.

## Testing Guidelines

- **Framework**: Vitest with React Testing Library
- **Coverage**: 80% threshold for branches, functions, lines, statements
- **Location**: All tests in `tests/` directory
- **Naming**: `*.test.ts` or `*.spec.ts` suffix
- **Setup**: Global test setup in `tests/setup.ts`

Run single test file:
```bash
bunx vitest run tests/unit/lib/utils.test.ts
```

## Commit & Pull Request Guidelines

**Commit Convention**: [Conventional Commits](https://www.conventionalcommits.org/)

```
type(scope): description
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `security`

**Examples**:
- `feat(dashboard): add real-time seat count updates`
- `fix(notifications): prevent duplicate emails on race condition`
- `chore: upgrade deps`

**Branch naming**: `feature/`, `fix/`, `docs/`, `refactor/` prefixes.

**PR Requirements**:
- All CI checks must pass (lint, test, typecheck, build)
- Use the PR template with summary, changes, and testing details
- Squash and merge to `main`
- No `console.log` debugging or hardcoded secrets/URLs

## Cloudflare Workers Notes

- **No global state**: Workers are stateless; use Durable Objects for coordination
- **Memory limit**: 128MB per Worker
- **Execution time**: 30s (HTTP), 15min (cron)
- **`worker.ts`**: Handles `fetch` (routes to Next.js), `scheduled` (cron → `/api/cron` or `/api/cron/update-disposable-domains`), and `queue` (processes `pickmyclass-queue` and `pickmyclass-dlq`)
- **CronLockDO**: Durable Object for distributed cron locking; 25-minute auto-expiry. Binding: `PICKMYCLASS_CRON_LOCK_DO`
- **Queue**: `PICKMYCLASS_QUEUE` → `pickmyclass-queue`, `max_concurrency: 20`, `max_batch_size: 5`, `max_retries: 3`, DLQ: `pickmyclass-dlq`
- **KV**: `PICKMYCLASS_DISPOSABLE_DOMAINS` for disposable email domain blocklist
- **Email**: `EMAIL` binding (Cloudflare Email Service, `send_email`, remote mode)
- **Cron triggers**: `0,30 * * * *` (class checks), `0 4 * * *` (daily `update-disposable-domains`)
- **TypeScript**: Two separate `tsconfig.json` configs — `tsconfig.json` for the Next.js app and `tsconfig.worker.json` for `worker.ts` and CF types
- Always test with `bun run preview` before deploying

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
