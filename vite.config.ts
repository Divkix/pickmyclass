import { execSync } from 'node:child_process';
import { cloudflare } from '@cloudflare/vite-plugin';
import vinext from 'vinext';
import { defineConfig } from 'vite';

function resolveCacheVersion(): string {
  if (process.env.CACHE_VERSION) {
    return process.env.CACHE_VERSION;
  }

  try {
    return execSync('git rev-parse --short HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return 'dev';
  }
}

const cacheVersion = resolveCacheVersion();
const buildTimestamp = process.env.BUILD_TIMESTAMP ?? new Date().toISOString();
const defineValues: Record<string, string> = {
  // biome-ignore lint/style/useNamingConvention: Vite define requires dunder global identifiers
  __cacheVersion__: JSON.stringify(cacheVersion),
  // biome-ignore lint/style/useNamingConvention: Vite define requires dunder global identifiers
  __buildTimestamp__: JSON.stringify(buildTimestamp),
};

export default defineConfig({
  define: defineValues,
  plugins: [
    vinext(),
    cloudflare({
      viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
    }),
  ],
});
