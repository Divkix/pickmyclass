import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";

const root = resolve(import.meta.dirname, "../../..");

/** Modules that must never reach a browser bundle. Type-only imports are erased, so they are exempt. */
const SERVER_ONLY =
  /^(effect(\/|$)|@effect\/|@\/lib\/(effect\/|db\/(index|guard|errors)$|asu\/(asu-client|api)$))/;

const TYPE_ONLY_IMPORT = /(?:import|export)\s+type\b[^;]*?from\s*["'][^"']+["'];?/g;
const IMPORT = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name);

    if (statSync(join(root, path)).isDirectory()) {
      return sourceFiles(path);
    }

    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** Root-relative file of a local import (`@/` alias or relative to `importer`); undefined for a package. */
function resolveLocal(specifier: string, importer: string): string | undefined {
  const base = specifier.startsWith("@/")
    ? specifier.slice(2)
    : specifier.startsWith(".")
      ? join(dirname(importer), specifier)
      : undefined;

  if (base === undefined) return undefined;

  return [".ts", ".tsx", "/index.ts", "/index.tsx"]
    .map((suffix) => `${base}${suffix}`)
    .find((candidate) => existsSync(join(root, candidate)));
}

/**
 * Every local file a browser can load: "use client" files, the client instrumentation, and their
 * imports. Local imports are recorded as their resolved `@/` path, so `./errors` and `@/lib/db`
 * are checked as the files they load.
 */
function clientGraph(): Map<string, string[]> {
  const seeds = [...sourceFiles("app"), ...sourceFiles("components"), ...sourceFiles("lib")].filter(
    (file) => /^["']use client["']/.test(readFileSync(join(root, file), "utf8")),
  );

  const queue = [...seeds, "instrumentation-client.ts"];
  const graph = new Map<string, string[]>();

  for (const file of queue) {
    if (graph.has(file)) {
      continue;
    }

    const source = readFileSync(join(root, file), "utf8").replace(TYPE_ONLY_IMPORT, "");

    const imports = [...source.matchAll(IMPORT)].map((match) => {
      const specifier = match[1] ?? "";
      const local = resolveLocal(specifier, file);

      if (local === undefined) return specifier;

      queue.push(local);

      return `@/${local.replace(/\.tsx?$/, "")}`;
    });

    graph.set(file, imports);
  }

  return graph;
}

describe("browser boundary", () => {
  it("finds the client entry points and follows relative imports", () => {
    const graph = clientGraph();

    expect(graph.has("instrumentation-client.ts")).toBe(true);
    expect(graph.size).toBeGreaterThan(10);
    expect(graph.get("components/admin/ClassesTable.tsx")).toContain(
      "@/components/admin/SortableHeader",
    );
  });

  it("keeps Effect and server-only modules out of everything the browser loads", () => {
    const leaks = [...clientGraph()].flatMap(([file, specifiers]) =>
      specifiers.flatMap((specifier) =>
        SERVER_ONLY.test(specifier) ? [`${file} -> ${specifier}`] : [],
      ),
    );

    expect(leaks).toEqual([]);
  });
});
