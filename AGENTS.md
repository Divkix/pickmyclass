# Repository Guidelines

## Project Structure & Module Organization

```
app/          # Routes, pages, and API endpoints
lib/          # Core business logic and utilities
components/   # React components (ui/, admin/, landing/, etc.)
tests/        # Test files (unit/, integration/, mocks/)
worker.ts     # Cloudflare Worker (cron, queue, Durable Objects)
middleware.ts # Auth and routing middleware
```

## Build, Test, and Development Commands

```bash
bun run dev              # Start development server (localhost:3000)
bun run build            # Build application for production
bun run preview          # Build and preview on Cloudflare Workers locally
bun run deploy           # Build and deploy to Cloudflare Workers

bun run lint             # Run Biome linter
bun run lint:fix         # Auto-fix lint issues
bun run format           # Format code with Biome

bun run test             # Run vitest in watch mode
bun run test:run         # Run tests once (CI mode)
bun run test:coverage    # Run tests with coverage (80% threshold required)

bun run knip             # Find unused exports/dependencies
bun run type-check       # TypeScript type checking
```

## Coding Style & Naming Conventions

- **Formatter**: Biome with 2-space indentation, line width 100
- **Strings**: Single quotes, semicolons required
- **Naming**: camelCase for variables/functions, PascalCase for types/components
- **Imports**: Auto-organized by Biome
- **Tests**: colocated in `tests/` directory, not alongside source files
- **Test file naming**: `*.test.ts`, `*.test.tsx`, `*.spec.ts`, `*.spec.tsx`

Run `bun run lint:fix && bun run format` before committing.

## Generated Files

Two files are auto-generated and must be kept in sync when the database or Cloudflare config changes:

| File | Command | When to regenerate |
|------|---------|-------------------|
| `lib/supabase/database.types.ts` | `bunx supabase gen types typescript --project-id osopxwuebsefhoxgeojh > lib/supabase/database.types.ts` | After any Supabase migration (new tables, columns, RPC functions) |
| `lib/cloudflare-env.d.ts` | `bun run cf-typegen` | After changing `wrangler.jsonc` (bindings, vars, queues, DO, KV) |

**Important**: If you see `as unknown as` casts on `.rpc()` calls with a comment like "not yet in generated types", regenerate `database.types.ts` and remove the cast. Wrangler secrets (e.g. `SUPABASE_SERVICE_ROLE_KEY`, `ASU_API_TOKEN`) are not in `wrangler.jsonc` and will never appear in the generated CF types — `env as unknown as Env` casts for those are correct and intentional.

## lib/ File Structure Note

The `lib/` directory contains both a file and a subdirectory with the same base name:

- `lib/utils.ts` is the shadcn/ui utility (cn function) imported as `@/lib/utils`
- `lib/utils/` contains custom utilities (crypto, formatting, seat badge, time format) imported as `@/lib/utils/*`

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

## Extra Directories

- `scripts/` — Build and utility scripts (e.g., OG image generation)
- `supabase/` — Supabase CLI configuration and database migrations
- `tests/mocks/` — Test mocks for Cloudflare Workers environment

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

**PR Requirements**:
- All CI checks must pass (lint, test, typecheck, build)
- Use the PR template with summary, changes, and testing details
- Squash and merge to `main`

## Cloudflare Workers Notes

- **No global state**: Workers are stateless; use Durable Objects for coordination
- **Memory limit**: 128MB per Worker
- **Execution time**: 30s (HTTP), 15min (cron)
- **CronLockDO**: Durable Object for distributed cron job locking to prevent duplicate cron execution
- **Queue consumer**: `max_concurrency: 20`, `max_batch_size: 5` (configured in `wrangler.jsonc`)
- **Cron triggers**: `0,30 * * * *` (class checks every 30min), `0 4 * * *` (daily `update-disposable-domains`)
- Always test with `bun run preview` before deploying
- `worker.ts` handles fetch, scheduled (cron), and queue handlers

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
