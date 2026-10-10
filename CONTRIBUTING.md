# Contributing to PickMyClass

Thank you for your interest in contributing to PickMyClass! This document provides guidelines and instructions for contributing.

## Code of Conduct

Be respectful, inclusive, and constructive. We welcome contributors of all experience levels.

## Getting Started

### Prerequisites

- [pnpm](https://pnpm.io/) >= 9.0
- [Node.js](https://nodejs.org/) 22.22.1+ (pinned in .node-version)
- Git

### Development Setup

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/yourusername/pickmyclass.git
   cd pickmyclass
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your credentials
   ```

4. **Start the development server**
   ```bash
   pnpm run dev
   ```

## Development Workflow

### Branch Naming

Use descriptive branch names:
- `feature/add-user-settings` - New features
- `fix/notification-duplicate` - Bug fixes
- `docs/update-readme` - Documentation changes
- `refactor/extract-email-service` - Code refactoring

### Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description

[optional body]

[optional footer]
```

**Types:**
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation only
- `style` - Code style (formatting, semicolons, etc.)
- `refactor` - Code refactoring (no feature/fix)
- `test` - Adding or updating tests
- `chore` - Maintenance tasks

**Examples:**
```bash
git commit -m "feat(dashboard): add real-time seat count updates"
git commit -m "fix(notifications): prevent duplicate emails on race condition"
git commit -m "docs: update self-hosting guide with queue setup"
```

### Code Style

We use [Vite+](https://viteplus.dev/) (Oxlint + Oxfmt) for linting and formatting:

```bash
# Check and auto-fix everything (format + lint + typecheck)
pnpm run fix

# Check only (no fixes)
pnpm run check

# Full pre-commit and CI gate (check + app/worker type-check + unused-code check)
pnpm run verify

# Lint only
pnpm run lint

# Format only
pnpm run format
```

**Key Style Guidelines:**
- Use spaces, not tabs (2 spaces)
- Always use semicolons
- Double quotes for strings (Oxfmt defaults)
- TypeScript strict mode enabled

### Adding/Updating Dependencies

When modifying dependencies in `package.json`:

1. **Always run `pnpm install`** to update `pnpm-lock.yaml`
2. **Commit both files together** - `package.json` and `pnpm-lock.yaml` must be in the same commit
3. **Verify locally** before pushing:
   ```bash
   pnpm install --frozen-lockfile
   ```
   If this fails, your lockfile is out of sync. Run `pnpm install` again and commit the updated `pnpm-lock.yaml`.

Policy for this repo:

- Every version is a caret range (`^1.2.3`) — no exact pins, including the `catalog:` entries in
  `pnpm-workspace.yaml`. `packageManager` is the one deliberate exact pin.
- `minimumReleaseAge` is not configured, so pnpm's built-in 1440-minute (1 day) release age applies and stays
  non-strict. Don't add `minimumReleaseAgeExclude` entries: wait a day, or let the range resolve to the newest
  version that has aged past it.
- `pnpm update --latest` keeps `catalog:` references and updates the catalog entries in place.

Automation for dependencies:

- Dependabot checks npm and GitHub Actions daily with a 1-day cooldown on version updates (security updates are
  exempt). Minor and patch PRs squash-merge automatically once every check is green; majors are never
  auto-merged — the workflow requests a review from `@Divkix` and they are merged by hand (the branch is still
  deleted automatically).
- The auto-merge gate is `.github/workflows/dependabot-automerge.yml`. It reads PR metadata only (no PR code is
  checked out, installed or executed), requires the repo's required checks plus every other reported check and
  commit status to be an exact `success` (a `skipped` or `neutral` check does not count as green), re-checks the
  PR's author, base branch, draft state and head commit on every poll and again just before merging, and gives up
  after 45 minutes. It runs from `main`, so edits to it only take effect after they are merged.

### Testing Changes

Before submitting a PR:

1. **Run the full verification gate**
   ```bash
   pnpm run verify
   ```

2. **Build the project**
   ```bash
   pnpm run build
   ```

3. **Test with Cloudflare Workers locally**
   ```bash
   pnpm run preview
   ```

4. **Run tests**
   ```bash
   pnpm run test
   ```

**Test Guidelines:**
- All tests are in `tests/integration/` (not colocated with source files); projects are configured in the `test` block of `vite.config.ts`.
- Test files: `*.test.ts`, `*.test.tsx`, `*.spec.ts`, or `*.spec.tsx`
- Use `tests/mocks/` for Cloudflare Workers environment mocks
- Run one test file: `pnpm run test tests/integration/api/onboarding.test.ts`. Use `test:integration` for the integration project, `test:watch` for watch mode, and `DATABASE_URL=… pnpm run test:db` for the opt-in live database project.

## Pull Request Process

### Before Submitting

- [ ] Code follows the project's style guidelines
- [ ] Self-review completed
- [ ] Changes are documented (if applicable)
- [ ] No console.log debugging statements left behind
- [ ] No hardcoded secrets or URLs

### PR Description Template

```markdown
## Summary
Brief description of changes

## Changes
- Change 1
- Change 2

## Testing
How did you test these changes?

## Screenshots (if applicable)
```

### Review Process

1. Submit your PR against the `main` branch
2. Ensure CI checks pass
3. Request review from maintainers
4. Address feedback
5. Squash and merge once approved

## Architecture Guidelines

### Database Changes

1. Tables, columns, indexes and constraints: edit `lib/db/schema/`, then `pnpm run db:generate`.
2. Functions, triggers and data fixes: `pnpm run db:generate -- --custom --name=<name>` and write the SQL. To change a function, `CREATE OR REPLACE` it in a new migration; never edit an applied one.
3. Commit the new `migrations_pg/` files, including `meta/`. `pnpm run deploy` runs `db:migrate` before `wrangler deploy` (needs the direct PlanetScale `DATABASE_URL`).
4. `db/migrations/` is frozen pre-drizzle history; don't add to it.
5. Use Row Level Security (RLS) for all new tables

### API Validation

- Use `lib/api/schemas.ts` for zod schemas
- Use `lib/api/validation.ts` for input validation
- Validate all input at API boundaries

### Caching

- Use `lib/cache/ttl-cache.ts` for time-to-live caching
- Default TTL for ASU API responses: 2 minutes
- Cache key format: `[provider]-[endpoint]` (e.g., `asu-class-${classNbr}`)

### React Contexts

- Place contexts in `lib/contexts/`
- Export both provider and consumer hook
- Name files as `[Name]Context.tsx` (e.g., `AuthContext.tsx`)

### React Hooks

- Place custom hooks in `lib/hooks/`
- Name files as `use[Name].ts` (or `.tsx` if JSX is used)
- Include cleanup in `useEffect` for subscriptions

### Type Definitions

- Place domain types in `lib/types/`
- Use `.ts` extension (not `.d.ts` for domain types)
- Export interfaces and types from index files

### Utility Functions

- Place custom utilities in `lib/utils/`
- **Note:** `lib/utils.ts` is reserved for shadcn/ui utility (cn function)
- Import custom utilities as `@/lib/utils/[name]`
- Keep utility functions pure and testable

### Blog Content

- Place blog post data in `lib/blog/posts.ts`
- Use TypeScript for blog metadata
- Keep blog content separate from presentation logic

### API Routes

- Place API routes in `app/api/`
- Use the service role client for operations that bypass RLS
- Validate all input parameters
- Return consistent JSON responses:
  ```typescript
  // Success
  return Response.json({ success: true, data: result })

  // Error
  return Response.json({ success: false, error: message }, { status: 400 })
  ```

### Cloudflare Workers Considerations

- **No global state**: Workers are stateless; keep shared state in Postgres
- **Memory limits**: Workers have 128MB memory limit
- **Execution time**: 30 seconds for HTTP; Workflow steps retry independently
- **Queue consumers**: `max_concurrency: 20`, `max_batch_size: 5` for queue processing
- **Scheduled work**: `SectionCheckWorkflow` (every 15 min; each section every 30 min) and `MaintenanceWorkflow` (04:05 UTC: notification expiry + past-term watch deletion) run from Workflow `schedules` in `wrangler.jsonc`
- **Test with preview**: Always test with `pnpm run preview` before deploying

### Email Templates

- Email templates are in `lib/email/templates/`
- Use inline styles (many email clients don't support `<style>` tags)
- Test with different email clients

## Areas for Contribution

### Good First Issues

- Documentation improvements
- UI/UX enhancements
- Test coverage
- Accessibility improvements

### Feature Ideas

- Support for additional universities
- SMS notifications
- Mobile app
- Browser extension

### Bug Fixes

Check the [Issues](https://github.com/yourusername/pickmyclass/issues) page for bugs labeled `good first issue` or `help wanted`.

## Questions?

- Open a [Discussion](https://github.com/yourusername/pickmyclass/discussions)
- Check existing issues and discussions first

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
