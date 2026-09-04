import { resolve } from 'node:path';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/db/drizzle-live.test.ts'],
    exclude: ['node_modules', '.next'],
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
