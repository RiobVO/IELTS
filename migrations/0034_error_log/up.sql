-- 0034_error_log :: up
-- Self-hosted error sink (§11 monitoring). Written by logError() (the client-error endpoint
-- + explicit server catch calls), read by /admin/errors — owner path (Drizzle, RLS-bypass).
-- SERVER-ONLY: RLS enabled + all grants revoked (no anon/authenticated policy) like
-- signup_throttle — stack traces and urls may carry internal detail, never client-readable.
-- Own sink so prod errors are visible in-app without an external service (Sentry stays an
-- optional no-op). user_id is nullable (client crashes may happen before/without auth) and
-- ON DELETE SET NULL so removing a user doesn't drop their error history.
CREATE TABLE error_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source     text NOT NULL,
  message    text NOT NULL,
  stack      text,
  url        text,
  user_id    uuid REFERENCES profile(id) ON DELETE SET NULL,
  context    jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX error_log_created_idx ON error_log (created_at);

ALTER TABLE error_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON error_log FROM anon, authenticated, PUBLIC;
