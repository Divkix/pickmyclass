/**
 * Shared row shapes for the class-watch domain.
 *
 * Inferred from the Drizzle schema (`lib/db/schema`) rather than the retired
 * hand-written registry in `lib/db/types`; the historical type names are kept
 * for the browser components and the client-side creation seam. The inferred
 * shapes are identical to the previous interfaces (same columns, same
 * nullability, ISO-8601 strings for timestamptz via `mode: 'string'`).
 */
import type { ClassState, ClassWatch } from '@/lib/db/schema';

/** A single `class_watches` row (schema-inferred). */
export type ClassWatchRow = ClassWatch;

/** A single `class_states` row (schema-inferred). */
export type ClassStateRow = ClassState;
