import { resolve } from 'node:path';
import { defineConfig } from 'vite-plus';

/**
 * Live-database Drizzle suite (run via `pnpm run test:db`).
 *
 * Deliberately service-free for the default CI suite: this config executes
 * ONLY `tests/integration/db/drizzle-live.test.ts`, which requires a real
 * PostgreSQL reachable at `DATABASE_URL` carrying the consolidated baseline
 * (`db/migrations/20260822000000_planetscale_schema.sql`). It must never be
 * picked up by `vitest.config.ts` runs.
 *
 * Node environment (jsdom/browser mocks are irrelevant here), repository
 * aliases reused so the production `getDb` path resolves unchanged, and a
 * single worker with sequential execution so run-scoped fixtures observe
 * deterministic database state.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/db/drizzle-live.test.ts'],
    exclude: ['node_modules', '.next'],
    // Deterministic serial execution: one process, one file, no concurrent
    // tests — the suite shares one connection pool and run-scoped fixtures.
    fileParallelism: false,
    maxWorkers: 1,
    sequence: { concurrent: false },
    retry: 0,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './'),
      'cloudflare:workers': resolve(__dirname, './tests/mocks/cloudflare-workers.ts'),
    },
  },
});
