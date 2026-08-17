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
      '.agent/**',
      '.agents/**',
      '.claude/**',
      '.codex/**',
      '.continue/**',
      '.cursor/**',
      '.gemini/**',
      '.opencode/**',
      '.pi/**',
      '.roo/**',
      '.windsurf/**',
      'tools/oxlint/anti-slop/**',
    ],
  },
  lint: {
    jsPlugins: [
      { name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' },
      { name: 'anti-slop', specifier: './tools/oxlint/anti-slop/index.ts' },
    ],
    rules: {
      'vite-plus/prefer-vite-plus-imports': 'error',
      // high-signal, zero-noise: keep at error
      'anti-slop/no-chained-type-assertions': 'error',
      'anti-slop/no-conditional-empty-object-spread': 'error',
      'anti-slop/no-object-parameters': 'error',
      'anti-slop/no-reflect-apply': 'error',
      'anti-slop/no-reflect-get': 'error',
      'anti-slop/no-unknown-parameters': 'error',
      'anti-slop/no-unknown-returns': 'error',
      'anti-slop/no-unknown-type-aliases': 'error',
      'anti-slop/require-safety-comment-for-type-assertion': 'error',
      'anti-slop/no-module-mocking': 'error',
      // Cloudflare env widening / dictionary types: legitimate at deploy boundary, warn not error
      'anti-slop/no-known-value-widening': 'warn',
      'anti-slop/no-widen-then-assert': 'warn',
      'anti-slop/no-unsafe-dictionary-type': 'warn',
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
          'anti-slop/no-module-mocking': 'off',
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
      '.agent/**',
      '.agents/**',
      '.claude/**',
      '.codex/**',
      '.continue/**',
      '.cursor/**',
      '.gemini/**',
      '.opencode/**',
      '.pi/**',
      '.roo/**',
      '.windsurf/**',
      'tools/oxlint/anti-slop/**',
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
