import { readFileSync } from "node:fs";

// Vite+ requires the `vite` alias (@voidzero-dev/vite-plus-core) to match the
// vite-plus release. Dependabot bumps vite-plus but not the npm: alias, which
// silently leaves TanStack Start and Vite plugins on an older core. Fail instead.
const lockfile = readFileSync(process.argv[2] ?? "pnpm-lock.yaml", "utf-8");

/** Distinct versions of a package keyed at the top of the lockfile's packages/snapshots maps. */
function lockedVersions(name: string): string[] {
  const escaped = name.replace(/[/.]/g, "\\$&");
  const key = new RegExp(`^  '?${escaped}@([^(':]+)`, "gm");

  return [...new Set([...lockfile.matchAll(key)].map((m) => m[1]!))];
}

const core = lockedVersions("@voidzero-dev/vite-plus-core");
const vitePlus = lockedVersions("vite-plus");

if (core.length !== 1 || vitePlus.length !== 1 || core[0] !== vitePlus[0]) {
  console.error(
    `vite-plus-core [${core.join(", ")}] is out of lockstep with vite-plus [${vitePlus.join(", ")}].\n` +
      "Run `pnpm exec vp migrate` to re-pin the vite alias and vite-plus together.",
  );
  process.exit(1);
}

console.log(`vite-plus and vite-plus-core locked in step at ${core[0]}.`);
