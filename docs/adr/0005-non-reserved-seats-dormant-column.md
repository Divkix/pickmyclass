# `non_reserved_seats` is a dormant safeguard, not dead code

`class_states.non_reserved_seats` exists and is referenced by `detectChanges` (primary seat signal is `non_reserved_seats ?? seats_available`), but migration `20260212000125` **NULLs the column in production**, so the fallback to `seats_available` is what actually runs today.

## Why

ASU returns **no real waitlist data**, so a "non-reserved seats" signal can't be computed reliably right now. Rather than delete the column and the code path, we keep both: if ASU ever exposes usable waitlist data, populating the column re-activates the more precise signal with no code change.

## Consequences

- **Don't remove it** and don't "clean up" the `non_reserved_seats ?? seats_available` fallback — it looks like dead code but is a deliberate dormant path.
- **Don't build features assuming it's populated** — in production it is always NULL.
- See memory `asu-no-waitlist-data`.
