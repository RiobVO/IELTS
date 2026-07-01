import "server-only"; // service-role client (bypasses RLS) — never bundle into the browser
import { createClient } from "@supabase/supabase-js";
import { env } from "@/env";

/** Service-role Supabase client (bypasses RLS). Server-only — для Storage/owner-операций. */
export function createServiceClient() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}
