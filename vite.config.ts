import { resolve } from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import posthogRollupPlugin from "@posthog/rollup-plugin";
import react from "@vitejs/plugin-react";
import vinext from "vinext";
import { defineConfig, loadEnv, type Plugin } from "vite-plus";
import {
  failOpenSourcemapUpload,
  shouldUploadPosthogSourcemaps,
} from "./lib/analytics/sourcemap-upload";
import { log } from "./lib/log";

/**
 * Builds the PostHog source-map upload plugin — ONLY when the deploy script
 * exports POSTHOG_UPLOAD_SOURCEMAPS=true. Ordinary builds (including
 * production builds and dry-runs) never upload, even when credentials exist.
 * Credentials come from Vite env loading (.env* + process.env) and are read
 * only here; they must never be inlined into client output.
 * Missing credentials warn and skip the upload (Cloudflare Builds has no
 * access to the gitignored local deploy env) — add them to the build env to
 * re-enable it. Upload is observability, never a deploy blocker: PostHog API
 * failures during the build are caught by failOpenSourcemapUpload.
 */
function sourceMapUploadPlugin(mode: string): Plugin | null {
  if (process.env.POSTHOG_UPLOAD_SOURCEMAPS !== "true") return null;

  const uploadRequested = process.env.POSTHOG_UPLOAD_SOURCEMAPS === "true";
  const env = loadEnv(mode, process.cwd(), "");
  const apiKey = env.POSTHOG_API_KEY || process.env.POSTHOG_API_KEY;
  const projectId = env.POSTHOG_PROJECT_ID || process.env.POSTHOG_PROJECT_ID;
  const uploadSourceMaps = shouldUploadPosthogSourcemaps(uploadRequested, apiKey, projectId);

  if (!uploadSourceMaps || !apiKey || !projectId) {
    log("vite").warn(
      "POSTHOG_UPLOAD_SOURCEMAPS=true but POSTHOG_API_KEY/POSTHOG_PROJECT_ID are unset; skipping source-map upload.",
    );

    return null;
  }

  const plugin: unknown = posthogRollupPlugin({
    personalApiKey: apiKey,
    projectId: projectId,
    host: "https://us.posthog.com",
    sourcemaps: {
      enabled: true,
      deleteAfterUpload: true,
      releaseName: "pickmyclass",
    },
  });

  // SAFETY: The PostHog plugin uses standard Rollup hooks supported by Vite+'s
  // Rolldown compatibility layer; only the package contexts differ.
  return failOpenSourcemapUpload(plugin as Plugin);
}

const IGNORE_PATTERNS = [
  "dist/**",
  "lib/cloudflare-env.d.ts",
  ".agent/**",
  ".agents/**",
  ".claude/**",
  ".codex/**",
  ".continue/**",
  ".cursor/**",
  ".gemini/**",
  ".opencode/**",
  ".pi/**",
  ".roo/**",
  ".windsurf/**",
  "tools/oxlint/anti-slop/**",
];

export default defineConfig(({ mode }) => {
  const isTest = Boolean(process.env.VITEST);
  const sourcemapPlugin = isTest ? null : sourceMapUploadPlugin(mode);

  return {
    fmt: {
      ignorePatterns: [
        ...IGNORE_PATTERNS,
        "**/*.md", // Markdown is not formatted.
        "next-env.d.ts", // Generated Next.js declarations.
        "db/migrations/*.sql", // Generated database migrations.
        "**/*.lock", // Package lockfiles.
        "**/pnpm-lock.yaml", // pnpm lockfiles.
      ],
    },
    lint: {
      plugins: ["react", "typescript", "jsx-a11y", "oxc"],
      options: { typeAware: true, typeCheck: true },
      jsPlugins: [
        { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
        { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
      ],
      rules: {
        "vite-plus/prefer-vite-plus-imports": "error",
        "no-console": "error",
        "oxc/no-accumulating-spread": "error",
        "typescript/no-explicit-any": "warn",
        "typescript/no-unused-vars": "error",
        "anti-slop/no-array-filter-map": "error",
        "anti-slop/no-reduce-accumulator-copy": "error",
        "anti-slop/no-chained-type-assertions": "error",
        "anti-slop/no-conditional-empty-object-spread": "error",
        "anti-slop/no-known-value-widening": "error",
        "anti-slop/no-module-mocking": "error",
        "anti-slop/no-object-parameters": "error",
        "anti-slop/no-reflect-apply": "error",
        "anti-slop/no-reflect-get": "error",
        "anti-slop/no-runtime-typeof": "error",
        "anti-slop/no-shape-in-symbol-names": "error",
        "anti-slop/no-unknown-parameters": "error",
        "anti-slop/no-unknown-returns": "error",
        "anti-slop/no-unknown-type-aliases": "error",
        "anti-slop/no-unsafe-dictionary-type": "error",
        "anti-slop/no-widen-then-assert": "error",
        "anti-slop/require-readable-spacing": "error",
        "anti-slop/require-safety-comment-for-type-assertion": "error",
      },
      overrides: [
        {
          files: ["tests/**"],
          rules: {
            "typescript/unbound-method": "off",
            "typescript/no-base-to-string": "off",
            "typescript/no-misused-spread": "off",
            "typescript/no-this-alias": "off",
            "typescript/no-explicit-any": "off",
            "unicorn/no-thenable": "off",
            "jsx-a11y/control-has-associated-label": "off",
            "no-control-regex": "off",
            "no-console": "off",
          },
        },
        {
          files: ["scripts/**", "lib/log.ts"],
          rules: { "no-console": "off" },
        },
      ],
      ignorePatterns: [
        ...IGNORE_PATTERNS,
        "**/cloudflare-env.d.ts", // Generated Cloudflare declarations at any depth.
      ],
    },
    staged: {
      "*.{js,jsx,ts,tsx,json,css}": ["vp check --fix"],
      "package.json": ["bash -c 'pnpm install'", "git add pnpm-lock.yaml"],
    },
    test: {
      globals: true,
      typecheck: { enabled: true, tsconfig: "./tsconfig.json" },
      alias: {
        "@": resolve(import.meta.dirname, "./"),
        "cloudflare:workers": resolve(import.meta.dirname, "./tests/mocks/cloudflare-workers.ts"),
        "vinext/server/app-router-entry": resolve(
          import.meta.dirname,
          "./tests/mocks/vinext-app-router-entry.ts",
        ),
      },
      exclude: ["node_modules", ".next", "dist", ".worktrees/**"],
      projects: [
        {
          test: {
            name: "unit",
            environment: "jsdom",
            setupFiles: ["./tests/setup.ts"],
            include: ["tests/unit/**/*.{test,spec}.{ts,tsx}"],
          },
        },
        {
          test: {
            name: "integration",
            environment: "jsdom",
            setupFiles: ["./tests/setup.ts"],
            include: ["tests/integration/**/*.{test,spec}.{ts,tsx}"],
            exclude: [
              "node_modules",
              ".next",
              "dist",
              ".worktrees/**",
              "tests/integration/db/drizzle-live.test.ts",
            ],
          },
        },
        {
          test: {
            name: "db",
            environment: "node",
            include: ["tests/integration/db/drizzle-live.test.ts"],
            fileParallelism: false,
            maxWorkers: 1,
            sequence: { concurrent: false },
            testTimeout: 30_000,
            hookTimeout: 60_000,
            teardownTimeout: 30_000,
          },
        },
      ],
      coverage: {
        provider: "v8",
        reporter: ["text", "json", "html"],
        include: [
          "lib/**/*.{ts,tsx}",
          "app/**/*.{ts,tsx}",
          "components/**/*.{ts,tsx}",
          "worker.ts",
        ],
        exclude: [
          "node_modules",
          ".next",
          "**/*.d.ts",
          "**/types.ts",
          "lib/types/**",
          "next.config.ts",
          "postcss.config.mjs",
          "tests/**",
          "lib/clerk/config.ts",
        ],
        thresholds: { branches: 80, functions: 80, lines: 80, statements: 80 },
      },
    },
    plugins: isTest
      ? [react()]
      : [
          vinext(),
          cloudflare({
            viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
          }),
          // Top-level Vite plugin, per PostHog's Vite source-map docs; inside
          // build.rollupOptions.plugins its Vite `config` hook is ignored.
          ...(sourcemapPlugin ? [sourcemapPlugin] : []),
        ],
    optimizeDeps: {
      exclude: ["lucide-react"],
    },
  };
});
