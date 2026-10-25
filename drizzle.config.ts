/**
 * Edit lib/db/schema, then run pnpm run db:generate for table changes. Functions,
 * triggers and data fixes use pnpm run db:generate --custom; replace functions
 * with CREATE OR REPLACE in a new migration, never by editing an applied file.
 *
 * migrations_pg is the schema history, tracked in drizzle.__drizzle_migrations.
 * Its 0000_baseline + 0001_baseline_functions reproduce production at 2026-10-01.
 * db/migrations is frozen pre-Drizzle history; add nothing there.
 */
// The database's 20s statement cap also applies to migrations (lib/db/guard.ts).
// A migration with a statement that may exceed it starts with SET statement_timeout = 0;
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/schema/index.ts",
  out: "./migrations_pg",
  dialect: "postgresql",
  dbCredentials: {
    // Generate works offline; push, migrate, and studio need a real DATABASE_URL.
    url:
      process.env.DATABASE_URL ?? "postgres://unset-DATABASE_URL:unset@localhost:5432/pickmyclass",
  },
});
