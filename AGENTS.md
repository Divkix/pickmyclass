# AGENTS.md

PickMyClass emails ASU students when a watched class section gains an open seat or a named instructor. One Cloudflare Worker: TanStack Start (React 19, strict TS, Vite+), PlanetScale Postgres via Hyperdrive (Drizzle over `pg`), Clerk, Workflows + Queues for seat checks, Cloudflare Email. Product overview and self-hosting: [README.md](README.md).

Domain terms (use them in code, tests and issues):
- **SectionRef**: the `{ class_nbr, term }` pair that identifies a section. Carry both fields everywhere; `class_states` is keyed on the pair.
- **Section Check**: one `processSection` run for one SectionRef.
- **Cron Cycle**: one `SectionCheckWorkflow` run; its `cycle` stamp rides on each queue message.

## Where the rules live

This file holds only rules that span files. Each module's rules live in its header comment, so read the header before editing:

| Touching | Read first |
| --- | --- |
| Seat checks, notifications, retries | `lib/queue/process-section.ts`, `pending-notifications.ts`, `notification-sender.ts` |
| Workflows, Free-plan limits | `lib/workflows/cron-workflows.ts`, `wrangler.jsonc` |
| External calls, timeouts, Effect | `lib/effect/external-call.ts`, `lib/effect/failure.ts`, `lib/db/guard.ts` |
| Schema or SQL functions | `drizzle.config.ts` (migration workflow) |
| Auth, CSP, cache headers | `app/start.ts`, `lib/auth/request-gate.ts`, `lib/auth/page-access.ts` |
| API routes | `app/routes/api/class-watches/index.ts` (the pattern to copy) |
| Logging and product events | `lib/log.ts` |
| SEO heads, new public pages | `lib/seo/head.ts`, `lib/seo/public-pages.ts` |
| Env vars, secrets, local setup | `.env.example` |
| Binding types | `lib/cloudflare-env.supplemental.d.ts` |
| Dependencies, toolchain bumps | `pnpm-workspace.yaml`, `.github/dependabot.yml` |

When you change behaviour, update the comment beside it in the same change. Add a line here only for a rule no single file can own.

## Cross-file rules

- Effect wraps external calls at the leaf only and stays out of browser code (`CLIENT_DENIED_SPECIFIERS` in `vite.config.ts` fails the build otherwise). When Effect reaches a new directory, add it to the `anti-slop-effect` override in `vite.config.ts`.
- Server-only code stays in server functions or server-only modules; Start's import protection fails the build otherwise. Fix the import, keep the protection.
- Alert cutoff and retention windows exist only in SQL (`public.section_alert_cutoff`, `public.purge_expired_data` in `migrations_pg/`). A retention change also updates `app/routes/legal/privacy.tsx`.
- Constants go in `lib/config.ts`. `lib/utils.ts` is shadcn's `cn()` only; custom helpers go in `lib/utils/`.
- Email templates pass every untrusted string through `escapeHtml` (`lib/utils/escape-html.ts`).
- User-facing dates use America/Phoenix (`lib/utils/time-format.ts`).
- Tests live in `tests/integration/`; API tests script the database with `createScriptedPostgres` (`tests/mocks/scripted-postgres.ts`).
- Commit generated `app/routeTree.gen.ts`.
- Dependabot opens PRs; nothing merges automatically. The owner reads each changelog, migrates code as needed and merges by hand.

## Done

1. `pnpm run verify` (check + type-check + knip; the pre-commit hook and CI `quality` job).
2. `pnpm run test:coverage` and `pnpm run build`.
3. Touched `worker.ts`, `wrangler.jsonc`, Workflows or `lib/queue/`: also `pnpm run preview`.
4. Touched SQL or migrations: `DATABASE_URL=… pnpm run test:db` against a disposable migrated Postgres.
5. Conventional Commits: `type(scope): summary`.

<!-- intent-skills:start -->
## Skill Loading

Use the repository’s installed Intent. If it is unavailable, report the missing dependency instead of downloading a replacement.
Before editing files for a substantial task:
- Run `pnpm exec intent list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `pnpm exec intent load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->
