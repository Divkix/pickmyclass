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
      '**/bun.lock',
    ],
  },
  lint: {
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
    rules: { 'vite-plus/prefer-vite-plus-imports': 'error', 'no-console': 'warn' },
    ignorePatterns: ['**/cloudflare-env.d.ts', 'lib/supabase/database.types.ts', 'worker.ts'],
    options: { typeAware: true, typeCheck: true },
  },
  staged: {
    '*.{js,jsx,ts,tsx,json,css,md}': ['vp check --fix'],
    'package.json': ["bash -c 'bun install'", 'git add bun.lock'],
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
