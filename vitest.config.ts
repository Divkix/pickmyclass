import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

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
      include: ['lib/**', 'app/**', 'components/**'],
      exclude: [
        'node_modules',
        '.next',
        '**/*.d.ts',
        '**/types.ts',
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
    },
  },
});
