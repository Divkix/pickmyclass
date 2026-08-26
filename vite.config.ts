import posthogPlugin from '@posthog/rollup-plugin';
import { cloudflare } from '@cloudflare/vite-plugin';
import vinext from 'vinext';
import { defineConfig, loadEnv, type PluginOption } from 'vite-plus';

export default defineConfig(({ mode }) => {
  // Source-map upload is strictly opt-in: the deploy script sets
  // POSTHOG_UPLOAD_SOURCEMAPS=true. Ordinary builds — including production-mode
  // builds and dry runs — never upload, even though POSTHOG_API_KEY /
  // POSTHOG_PROJECT_ID exist in the local (gitignored) env files.
  const uploadSourceMaps = process.env.POSTHOG_UPLOAD_SOURCEMAPS === 'true';
  const env = uploadSourceMaps ? loadEnv(mode, process.cwd(), '') : {};

  const plugins: PluginOption[] = [
    vinext(),
    cloudflare({
      viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
    }),
  ];

  if (uploadSourceMaps) {
    if (!env.POSTHOG_API_KEY || !env.POSTHOG_PROJECT_ID) {
      throw new Error(
        'POSTHOG_UPLOAD_SOURCEMAPS=true requires POSTHOG_API_KEY and POSTHOG_PROJECT_ID in the environment.'
      );
    }
    const plugin: unknown = posthogPlugin({
      personalApiKey: env.POSTHOG_API_KEY,
      projectId: env.POSTHOG_PROJECT_ID,
      host: 'https://us.posthog.com',
      sourcemaps: {
        enabled: true,
        deleteAfterUpload: true,
        releaseName: 'pickmyclass',
      },
    });
    // SAFETY: The PostHog plugin uses standard Rollup hooks supported by
    // Vite+'s Rolldown compatibility layer; only the package contexts differ.
    plugins.push(plugin as PluginOption);
  }

  return {
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
        'lib/cloudflare-env.d.ts',
        'next-env.d.ts',
        'db/migrations/*.sql',
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
    plugins,
    optimizeDeps: {
      exclude: ['lucide-react'],
    },
  };
});
