-- 0013_annotation :: up
-- Reader annotations (W2-1 / REDESIGN S6): per-user highlights & notes on a
-- test's passages. Anchored by character offsets within a passage's plain text
-- (passage_order + start/end), with the quoted text kept for display/repair.
-- Writes go through owner-path server actions (like attempt); clients only READ
-- their own rows. Additive — touches nothing in grading/submit/RLS of other
-- tables.

CREATE TABLE annotation (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
  content_item_id uuid NOT NULL REFERENCES content_item(id) ON DELETE CASCADE,
  passage_order   integer NOT NULL,
  kind            text NOT NULL DEFAULT 'highlight',
  start_offset    integer NOT NULL,
  end_offset      integer NOT NULL,
  quote           text NOT NULL DEFAULT '',
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX annotation_user_content_idx ON annotation (user_id, content_item_id);

-- RLS (BRIEF §6.1): a user may READ only their own annotations. Writes are
-- owner-path only (server actions on the Drizzle owner role, which bypasses
-- RLS), so `authenticated` gets SELECT but NO insert/update/delete grant
-- (default-deny), mirroring the attempt write-lockdown rationale.
ALTER TABLE annotation ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON annotation TO authenticated;
GRANT ALL ON annotation TO service_role;
CREATE POLICY annotation_select_own ON annotation
  FOR SELECT TO authenticated USING (user_id = auth.uid());
