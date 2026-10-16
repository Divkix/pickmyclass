# Vendored anti-slop Oxlint plugins

Source: [`dmmulroy/anti-slop`](https://github.com/dmmulroy/anti-slop), skill `install-anti-slop`, path `skills/install-anti-slop/assets/anti-slop`.

## Baseline

Upstream revision `d2a9aea3b896ffcb291a85f2c1301aa2543ad8c8` (2026-09-14, "feat: keep consecutive single-line bindings grouped in require-readable-spacing"), which is the last upstream commit touching the plugin as of upstream HEAD `13909c9e07590f5a85d93c62712259fe14a883f7` (checked 2026-10-15). Verified by comparing every file's Git blob SHA-1 against the GitHub tree API at both commits, not by version label.

Pristine upstream digest of the 38 files: `35f1401589a2d18a73bdd5772b49662bce88440065574215c4589e98bf26ee9b`. Local digest (with the deviation below applied): `0ef36717e81b7132c15925a5c0f685e9de440500e02eac0a77eb556ad56270e6`. Both exclude only this file. Reproduce with `git hash-object --stdin --no-filters` per file, then sha256 the sorted `<blob-sha>  <path>` lines joined by newlines. A local digest that differs from the one above means the tree has diverged from this record.

Recovering the base for a three-way merge: fetch the upstream tree at the baseline revision above, or take this directory from the commit that last updated this file and swap the import specifier back (see Local deviations).

`vendor/eslint-stylistic/UPSTREAM.md` records the separate provenance of the vendored `padding-line-between-statements` rule (ESLint Stylistic commit `435c3ea0fd26a5fef9042c4b36b6e165fbbf8d08`) and its local adaptations.

## History

| Date | Upstream | Change |
| --- | --- | --- |
| 2026-09-21 | `e6676e8` | Initial vendor, verbatim. |
| 2026-09-24 | — | Import specifier `@oxlint/plugins` → `vite-plus/lint/plugins` in every `.ts` file (`96e62d3`, "migrate to vite+ fully"). |
| 2026-10-15 | `d2a9aea` | Three-way merge from base `e6676e8`. Adopted `rules/require-readable-spacing.ts`, `vendor/eslint-stylistic/padding-line-between-statements.ts` and `vendor/eslint-stylistic/UPSTREAM.md` (all upstream-only changes); the local specifier swap was re-applied to both `.ts` files. Effect: consecutive single-line bindings (optionally exported) no longer need blank lines between them, unless the next one has its own leading comment. No other upstream changes exist; the tree now equals the baseline modulo the specifier. |

## Registered entry points

| Plugin | Entry point | Registered |
| --- | --- | --- |
| `anti-slop` | `tools/oxlint/anti-slop/index.ts` | yes, with all 18 generic rules at `error` plus native `oxc/no-accumulating-spread`, in `vite.config.ts` |
| `anti-slop-effect` | `tools/oxlint/anti-slop/effect/index.ts` | yes, plugin loaded globally; all 5 rules at `error` only through a `lint.overrides` entry for `lib/asu/**` and `tests/integration/asu/**` |

## Dependency pair

There is no direct `oxlint` or `@oxlint/plugins` dependency. `vp lint` runs the `oxlint` 1.87.0 bundled with `vite-plus` 1.1.0, and the plugin imports its API from `vite-plus/lint/plugins`, so the linter and plugin API always move together with the toolchain.

## Local deviations

- Every `.ts` file imports from `vite-plus/lint/plugins` instead of `@oxlint/plugins`. This is the only source edit.
- Excluded from application tooling, because Oxlint loads it at runtime and it is not application source: `lint.ignorePatterns` and `fmt.ignorePatterns` in `vite.config.ts`, `exclude` in `tsconfig.json`, and `ignore` in `knip.json`.

## Effect rule scope

Enabled 2026-10-15. `effect` is a direct dependency but `AGENTS.md` confines it to the ASU client, so the Effect rules apply only there. Enabled repo-wide, `prefer-effect-match` flagged chained literal ternaries in non-Effect code (`components/admin/SortableHeader.tsx`, `lib/email/templates/index.ts`, `app/api/monitoring/health/route.ts`), and obeying it would have pulled Effect past that boundary. If Effect spreads to other modules, widen the override's `files` to match.

## Updating

Re-run the install script into a staging directory and follow the skill's update procedure. Never point the script at this live tree. After a merge, refresh both digests and the history table above.
