import { cloudflare } from '@cloudflare/vite-plugin';
import vinext from 'vinext';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  fmt: {
    printWidth: 100,
    tabWidth: 2,
    singleQuote: true,
    semi: true,
    trailingComma: 'es5',
    bracketSpacing: true,
    arrowParens: 'always',
    jsxSingleQuote: false,
    ignorePatterns: [
      '**/*.md',
      'lib/supabase/database.types.ts',
      'lib/cloudflare-env.d.ts',
      'next-env.d.ts',
      'supabase/migrations/*.sql',
      '**/*.lock',
      '**/pnpm-lock.yaml',
    ],
  },
  lint: {
    jsPlugins: [
      { name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' },
      { name: 'anti-slop', specifier: './tools/oxlint/anti-slop/index.ts' },
    ],
    rules: {
      'vite-plus/prefer-vite-plus-imports': 'error',
      'anti-slop/no-chained-type-assertions': 'error',
      'anti-slop/no-conditional-empty-object-spread': 'error',
      'anti-slop/no-known-value-widening': 'error',
      'anti-slop/no-module-mocking': 'error',
      'anti-slop/no-object-parameters': 'error',
      'anti-slop/no-reflect-apply': 'error',
      'anti-slop/no-reflect-get': 'error',
      'anti-slop/no-runtime-typeof': 'off',
      'anti-slop/no-shape-in-symbol-names': 'off',
      'anti-slop/no-unknown-parameters': 'error',
      'anti-slop/no-unknown-returns': 'error',
      'anti-slop/no-unknown-type-aliases': 'error',
      'anti-slop/no-unsafe-dictionary-type': 'error',
      'anti-slop/no-widen-then-assert': 'error',
      'anti-slop/require-safety-comment-for-type-assertion': 'error',
      'no-console': 'error',
    },
    overrides: [
      {
        files: ['lib/log.ts', 'tests/**'],
        rules: {
          'no-console': 'off',
        },
      },
      {
        files: ['tests/**'],
        rules: {
          'anti-slop/require-safety-comment-for-type-assertion': 'warn',
        },
      },
    ],
    ignorePatterns: [
      '**/cloudflare-env.d.ts',
      'lib/supabase/database.types.ts',
      'worker.ts',
      'scripts/**',
      'tools/**',
    ],
  },
  staged: {
    '*.{js,jsx,ts,tsx,json,css,md}': ['vp check --fix'],
    'package.json': ["bash -c 'pnpm install'", 'git add pnpm-lock.yaml'],
  },
  plugins: [
    vinext(),
    cloudflare({
      viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
    }),
  ],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
