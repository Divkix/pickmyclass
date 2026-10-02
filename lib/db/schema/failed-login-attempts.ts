import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Written only by the increment_failed_attempts RPC; declared here so drizzle-kit owns the table.
export const failedLoginAttempts = pgTable("failed_login_attempts", {
  email: text("email").primaryKey(),
  attempts: integer("attempts"),
  last_attempt_at: timestamp("last_attempt_at", { withTimezone: true, mode: "string" }),
  locked_until: timestamp("locked_until", { withTimezone: true, mode: "string" }),
});
