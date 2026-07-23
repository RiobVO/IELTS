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
const client = postgres(env.DATABASE_URL, {
  prepare: false,
  // Pool tuning for serverless + the Supabase transaction pooler (pgbouncer):
  // a modest per-instance `max` — many short-lived instances share the pooler and
  // pgbouncer multiplexes downstream — yet enough to cover our in-instance
  // parallelism (Promise.all on submit/dashboard/exam). `idle_timeout` closes idle
  // connections so a frozen serverless instance stops holding pooler slots;
  // `connect_timeout` fails fast instead of hanging if the pooler is unreachable.
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });
export { schema };
