import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });

// Drizzle Kit config for future schema evolution (`npm run db:generate`).
// The shipped, executable migrations live in /migrations (up/down) and are
// applied by scripts/migrate.ts — see SCHEMA_NOTES.md. schemaFilter keeps the
// Supabase-managed `auth` schema out of Drizzle's purview.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  schemaFilter: ["public"],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
