import { foreignKey, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { classStates } from "./class-states";
import type { ChangeResult } from "@/lib/queue/change-detector";
import type { ClassInfo } from "@/lib/types/class";

export const pendingSectionNotifications = pgTable(
  "pending_section_notifications",
  {
    id: uuid("id").notNull().defaultRandom(),
    class_nbr: text("class_nbr").notNull(),
    term: text("term").notNull(),
    class_info: jsonb("class_info").$type<ClassInfo>().notNull(),
    changes: jsonb("changes").$type<ChangeResult>().notNull(),
    expires_at: timestamp("expires_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now() + interval '30 minutes'`),
    lease_id: uuid("lease_id"),
    leased_until: timestamp("leased_until", { withTimezone: true, mode: "string" }),
  },
  (t) => [
    primaryKey({ columns: [t.class_nbr, t.term] }),
    foreignKey({
      columns: [t.class_nbr, t.term],
      foreignColumns: [classStates.class_nbr, classStates.term],
    }).onDelete("cascade"),
  ],
);
