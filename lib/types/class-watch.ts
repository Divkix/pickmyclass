import type { ClassState, ClassWatch } from "@/lib/db/schema";

export type ClassWatchRow = ClassWatch;

/** A watch as its owner sees it: `user_id` is implied, so the dashboard query doesn't select it. */
export type UserClassWatch = Omit<ClassWatchRow, "user_id">;

/** A class_states row plus whether its add-deadline cutoff has passed (`public.section_alerts_ended`). */
export type ClassStateRow = ClassState & { alerts_ended: boolean };
