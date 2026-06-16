import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', '.next'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['lib/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', 'worker.ts'],
      exclude: [
        'node_modules',
        '.next',
        '**/*.d.ts',
        '**/types.ts',
        'lib/types/**',
        'vitest.config.ts',
        'next.config.ts',
        'postcss.config.mjs',
        'tests/**',
        'lib/supabase/database.types.ts',
      ],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
      },
    },
    typecheck: {
      enabled: true,
      tsconfig: './tsconfig.json',
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './'),
      'cloudflare:workers': resolve(__dirname, './tests/mocks/cloudflare-workers.ts'),
      'vinext/server/app-router-entry': resolve(
        __dirname,
        './tests/mocks/vinext-app-router-entry.ts'
      ),
    },
  },
});
