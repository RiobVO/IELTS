import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import * as schema from "./schema";

/**
 * Server-side Drizzle client. Connects with DATABASE_URL (the Supabase
 * service-role / direct connection). This client is for server contexts only
 * (Route Handlers, jobs) — the browser never holds these credentials.
 *
 * `prepare: false` is recommended when running behind the Supabase transaction
 * pooler (pgbouncer).
 */
const client = postgres(env.DATABASE_URL, { prepare: false });

export const db = drizzle(client, { schema });
export { schema };
