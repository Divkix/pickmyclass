import type { ClassState, ClassWatch } from "@/lib/db/schema";

export type ClassWatchRow = ClassWatch;

/** A class_states row plus whether its add-deadline cutoff has passed (`public.section_alerts_ended`). */
export type ClassStateRow = ClassState & { alerts_ended: boolean };
