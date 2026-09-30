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
