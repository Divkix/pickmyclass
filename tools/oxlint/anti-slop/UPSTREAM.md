# Vendored anti-slop Oxlint plugins

Source: [`dmmulroy/anti-slop`](https://github.com/dmmulroy/anti-slop), skill `install-anti-slop`.

## Installed copy

Copied wholesale from the skill bundle with:

```bash
node ~/.agents/skills/install-anti-slop/scripts/install.mjs
```

The copy is byte-identical to upstream revision `e6676e8d0bf17c678cb45b9dacb2bd6ca8dea53a` (2026-09-10, "feat(effect): prefer Match for literal branches") — the last upstream commit touching `skills/install-anti-slop/assets/anti-slop` — and to upstream HEAD `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b` at install time (2026-09-21). Verified by comparing every file's Git blob SHA-1 against the GitHub tree API, not by version label.

Snapshot digest of the 38 upstream files: `ec3dc884d2e76c1f73076c0f3b1d1b1f2fcb675e71b38abdcc58ed5c3209ee21`. This record is the only file here that upstream does not ship, and the only one excluded from the digest — `vendor/eslint-stylistic/UPSTREAM.md` is upstream and included. Reproduce with `git hash-object --stdin --no-filters` per file, then sha256 the sorted `<blob-sha>  <path>` lines joined by newlines. Recompute after any edit: a changed digest means this tree has diverged from upstream, and the next update must follow the no-base port path in the skill's `references/update.md` rather than a three-way merge.

`vendor/eslint-stylistic/UPSTREAM.md` records the separate provenance of the vendored `padding-line-between-statements` rule (ESLint Stylistic commit `435c3ea0fd26a5fef9042c4b36b6e165fbbf8d08`) and its local adaptations.

## Registered entry points

| Plugin | Entry point | Registered |
| --- | --- | --- |
| `anti-slop` | `tools/oxlint/anti-slop/index.ts` | yes — all 18 generic rules at `error`, plus native `oxc/no-accumulating-spread`, in `vite.config.ts` |
| `anti-slop-effect` | `tools/oxlint/anti-slop/effect/index.ts` | no — this repository has no direct `effect` dependency |

## Dependency pair

`vp lint` resolves `oxlint` 1.81.0 through `vite-plus` 0.3.1; there is deliberately no direct `oxlint` dependency, because `AGENTS.md` requires toolchain bumps to go through `vp migrate`. `@oxlint/plugins` is pinned exactly to `1.81.0` in `devDependencies` so the plugin API package tracks the linter that loads it; `vite-plus` keeps its own nested `@oxlint/plugins@1.79.0` untouched.

## Local deviations

- No edits inside this directory — the upstream source is verbatim.
- Excluded from application tooling, because Oxlint loads it at runtime and it is not application source: `lint.ignorePatterns` and `fmt.ignorePatterns` in `vite.config.ts`, `exclude` in `tsconfig.json`, and `ignore` in `knip.json`. Without the type-check exclusion, the vendored `.ts`-suffixed relative imports fail TS5097.
- `effect/` ships with the bundle but stays unregistered; deleting or regenerating it is safe.

## Updating

Re-run the install script into a staging directory and follow the skill's update procedure; never point it at this live tree. After a merge, refresh the digest above and record adopted changes, retained local policy, and deferred upstream changes here.
