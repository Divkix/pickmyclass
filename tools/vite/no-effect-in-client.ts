import type { Plugin } from "vite-plus";

/**
 * Packages the browser bundle must never import. `@scope/*` covers every package in the scope;
 * each entry also covers its subpaths (`effect/Schema`). drizzle-orm (lib/db/schema through
 * lib/onboarding.ts) and next/server (lib/api/response.ts) still reach the client today, so they
 * are not listed yet; add them once those imports are gone. vinext swaps next/server for its
 * shim (vinext/dist/shims/server.js) through resolve.alias, so check that this filter fires on it
 * before relying on it.
 */
const SERVER_ONLY_PACKAGES = ["effect", "@effect/*"];

function specifierPattern(packages: readonly string[]): RegExp {
  const names = packages.map((name) =>
    name.endsWith("/*")
      ? `${name.slice(0, -2).replaceAll(".", "\\.")}/[^/]+`
      : name.replaceAll(".", "\\."),
  );

  return new RegExp(`^(?:${names.join("|")})(?:/.*)?$`);
}

const SERVER_ONLY_SPECIFIER = specifierPattern(SERVER_ONLY_PACKAGES);

/**
 * Fails the build when the browser bundle imports a server-only package, directly or through
 * any module it reaches. Effect is server-only (AGENTS.md → Effect); browser-imported contracts
 * use Zod. `import type` is erased before resolution, so it passes.
 */
export function noEffectInClient(): Plugin {
  return {
    name: "pickmyclass:no-effect-in-client",
    apply: "build",
    applyToEnvironment: (environment) => environment.config.consumer === "client",
    resolveId: {
      order: "pre",
      filter: { id: SERVER_ONLY_SPECIFIER },
      handler(source, importer) {
        this.error(
          `"${source}" is imported by ${importer ?? "a client entry"}, which the browser bundle reaches. It is server-only: keep it out of client-reachable modules (AGENTS.md → Effect).`,
        );
      },
    },
  };
}
