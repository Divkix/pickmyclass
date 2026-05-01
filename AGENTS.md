# Repository Guidelines

## Project Structure & Module Organization

```
app/              # vinext app routes (pages, API routes, layouts)
  api/            # API endpoints (cron, queue, webhooks)
  dashboard/      # User dashboard pages
  admin/          # Admin panel pages
lib/              # Core business logic and utilities
  db/             # Database query helpers
  supabase/       # Supabase client configurations
  email/          # Email templates and Resend integration
  asu/            # ASU Class Search API client
  auth/           # Authentication utilities
  queue/          # Queue processing and DLQ consumer
components/       # React components (shadcn/ui based)
tests/            # Test files (unit and integration)
  unit/           # Unit tests organized by module
  integration/    # Integration tests
worker.ts         # Cloudflare Worker entrypoint (cron, queue handlers)
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

Run `bun run lint:fix && bun run format` before committing.

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

**PR Requirements**:
- All CI checks must pass (lint, test, typecheck, build)
- Use the PR template with summary, changes, and testing details
- Squash and merge to `main`

## Cloudflare Workers Notes

- **No global state**: Workers are stateless; use Durable Objects for coordination
- **Memory limit**: 128MB per Worker
- **Execution time**: 30s (HTTP), 15min (cron)
- Always test with `bun run preview` before deploying
- `worker.ts` handles fetch, scheduled (cron), and queue handlers
