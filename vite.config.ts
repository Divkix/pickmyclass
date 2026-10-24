import { resolve } from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import vinext from "vinext";
import { defineConfig } from "vite-plus";
import { noEffectInClient } from "./tools/vite/no-effect-in-client";

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

// Workers Builds sets these on every build; production deploys come from main.
// https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#environment-variables
function deploymentEnvironment(): DeploymentEnvironment {
  if (!process.env.WORKERS_CI) return "development";

  return process.env.WORKERS_CI_BRANCH === "main" ? "production" : "preview";
}

export default defineConfig(() => {
  const isTest = Boolean(process.env.VITEST);

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
        { name: "anti-slop-effect", specifier: "./tools/oxlint/anti-slop/effect/index.ts" },
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
          // Effect is confined to the ASU client (see AGENTS.md), so its rules are too.
          files: ["lib/asu/**", "tests/integration/asu/**"],
          rules: {
            "anti-slop-effect/no-manual-effect-error-tag": "error",
            "anti-slop-effect/no-manual-tag-comparison": "error",
            "anti-slop-effect/no-manual-tagged-construction": "error",
            "anti-slop-effect/no-service-constructor-imports": "error",
            "anti-slop-effect/prefer-effect-match": "error",
          },
        },
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
            name: "integration",
            environment: "node",
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
      },
    },
    plugins: isTest
      ? []
      : [
          noEffectInClient(),
          vinext(),
          cloudflare({
            viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
          }),
        ],
    optimizeDeps: {
      exclude: ["lucide-react"],
    },
    define: {
      __DEPLOYMENT_ENVIRONMENT__: JSON.stringify(deploymentEnvironment()),
      __BUILD_COMMIT__: JSON.stringify(process.env.WORKERS_CI_COMMIT_SHA?.slice(0, 12) ?? "dev"),
    },
  };
});
