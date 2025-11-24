import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    ignores: [
      // Default ignores of eslint-config-next:
      '.next/**',
      'out/**',
      'build/**',
      'next-env.d.ts',
      // Cloudflare Workers build artifacts:
      '.open-next/**',
      '.wrangler/**',
      'cloudflare-env.d.ts',
      // Generated TypeScript files:
      'lib/supabase/database.types.ts',
      '*.tsbuildinfo',
      // Dependencies:
      'node_modules/**',
      // Scraper service (separate Node.js project):
      'scraper/**',
    ],
  },
];
