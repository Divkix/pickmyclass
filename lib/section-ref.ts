/**
 * SectionRef — the identity of a Class Section.
 *
 * A section's identity is the `{ class_nbr, term }` pair: a section number
 * repeats across terms, so neither field identifies a section alone. This module
 * reifies that pair as a plain value with free helpers (function-first style, no
 * class), so callers pass one thing instead of re-pairing two loose strings.
 *
 * The snake_case field names match the `class_states` / `class_watches` rows and
 * `ClassCheckMessage`, which are already structurally `SectionRef` — they flow in
 * without conversion or wrapping.
 *
 * This is a prefactor: it adds the value and its helpers but wires no consumers.
 */

/**
 * The identity of a Class Section: its section number plus the term it runs in.
 * Both fields are required — a `class_nbr` repeats across terms.
 */
export interface SectionRef {
  /** Section number (e.g. "12431") */
  class_nbr: string;
  /** Term code (e.g. "2261" for Spring 2026) */
  term: string;
}

/**
 * Stable map key derived from both fields, in `term:class_nbr` order — the shape
 * of the hand-written `` `${term}:${class_nbr}` `` section-state map keys it is
 * meant to replace, so keys never collide across terms.
 */
export function sectionRefKey(ref: SectionRef): string {
  return `${ref.term}:${ref.class_nbr}`;
}
