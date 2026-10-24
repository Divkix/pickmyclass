import { resolve } from "node:path";
import { build, createBuilder, type Plugin } from "vite-plus";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { noEffectInClient } from "@/tools/vite/no-effect-in-client";

const ROOT = resolve(import.meta.dirname, "../../..");

// `.ts`, so the entry can use `import type`.
const ENTRY = "virtual:entry.ts";

/** A package whose name starts with "effect" but is not Effect. */
const LOOK_ALIKE = "effectful";

/** Serves the entry and the look-alike package from memory, so no fixture files are needed. */
function entryModule(code: string): Plugin {
  return {
    name: "test:entry",
    resolveId: (id) => (id === ENTRY || id === LOOK_ALIKE ? `\0${id}` : undefined),
    load: (id) => {
      if (id === `\0${ENTRY}`) return code;

      return id === `\0${LOOK_ALIKE}` ? "export const value = 1;" : undefined;
    },
  };
}

// Never mark `effect` external here: rolldown skips resolveId for external specifiers, so the
// server case would pass without the guard's environment check ever running.
function buildEntry(code: string, ssr: boolean) {
  return build({
    configFile: false,
    logLevel: "silent",
    root: import.meta.dirname,
    publicDir: false,
    envDir: false,
    plugins: [noEffectInClient(), entryModule(code)],
    build: { write: false, ssr, rolldownOptions: { input: ENTRY } },
  });
}

/** The code of every chunk a non-watch build emitted. */
async function emittedCode(output: ReturnType<typeof build>): Promise<string> {
  const result = await output;
  const outputs = Array.isArray(result) ? result : [result];
  const code: string[] = [];

  for (const entry of outputs) {
    if (!("output" in entry)) throw new Error("expected a non-watch build");

    for (const file of entry.output) if (file.type === "chunk") code.push(file.code);
  }

  return code.join("\n");
}

describe("noEffectInClient", () => {
  it("fails a browser build that imports effect", async () => {
    await expect(
      buildEntry('import { Option } from "effect"; console.log(Option);', false),
    ).rejects.toThrow(/"effect" is imported by .*browser bundle/);
  });

  it("fails a browser build that imports an effect subpath or @effect package", async () => {
    await expect(buildEntry('import "effect/Schema";', false)).rejects.toThrow(/"effect\/Schema"/);
    await expect(buildEntry('import "@effect/vitest";', false)).rejects.toThrow(
      /"@effect\/vitest"/,
    );
  });

  it("lets a browser build import look-alike packages", async () => {
    await expect(
      buildEntry(`import { value } from "${LOOK_ALIKE}"; console.log(value);`, false),
    ).resolves.toBeDefined();
  });

  it("lets a browser build use an erased type-only import", async () => {
    await expect(
      buildEntry(
        'import type { Option } from "effect"; export const none: Option.Option<number> | null = null;',
        false,
      ),
    ).resolves.toBeDefined();
  });

  it("lets a server build import effect", async () => {
    // The SSR build externalises the dependency after the guard's resolveId has seen it.
    await expect(
      emittedCode(buildEntry('import { Option } from "effect"; console.log(Option);', true)),
    ).resolves.toMatch(/from\s*"effect"/);
  });
});

describe("vite.config.ts", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("runs the effect guard in the client build environment only", async () => {
    // vite.config.ts drops every build plugin when VITEST is set.
    vi.stubEnv("VITEST", undefined);

    const builder = await createBuilder({
      root: ROOT,
      configFile: resolve(ROOT, "vite.config.ts"),
      logLevel: "silent",
    });

    const guard = noEffectInClient().name;

    const guarded = Object.fromEntries(
      Object.entries(builder.environments).map(([name, environment]) => [
        `${name}:${environment.config.consumer}`,
        environment.plugins.some((plugin) => plugin.name === guard),
      ]),
    );

    // Exact on purpose: unwiring the guard, a vinext change to the client `consumer`, or a new
    // environment each fails here and needs a decision.
    expect(guarded).toEqual({ "client:client": true, "rsc:server": false, "ssr:server": false });
  });
});
