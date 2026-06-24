/**
 * Cheap UUID-format guard for route/search params before they hit owner-path
 * (Drizzle) queries against `uuid` columns. Postgres casts a string parameter to
 * `uuid` at execution and throws `22P02 invalid input syntax for type uuid` on a
 * malformed value — an unhandled 500 instead of a clean 404. Screen the value
 * first so a bad id degrades to notFound() (parity with the legacy reading page,
 * which reads via the Supabase client and naturally returns null → notFound).
 *
 * Liberal 8-4-4-4-12 hex match (not version-specific): the goal is to reject
 * obvious garbage, not to mirror Postgres' exact parser. A well-formed but
 * non-existent id still falls through to an empty query → notFound, as intended.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | undefined | null): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
