-- 0028_speaking_lab_hardening :: up
-- (1) Anti-farm: at most ONE active (uploading|pending|evaluating) speaking
--     submission per user — blocks concurrent preview/cap farming (mirrors 0024).
--     'uploading' is included: it holds a slot until the reaper frees it.
-- (2) Defense-in-depth: REVOKE client write-grants (RLS already denies writes;
--     this removes Supabase's default [SIUD] grant so owner-path is the only writer).

CREATE UNIQUE INDEX speaking_submission_one_active_idx
  ON speaking_submission (user_id)
  WHERE status IN ('uploading', 'pending', 'evaluating');

REVOKE INSERT, UPDATE, DELETE ON speaking_task         FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON speaking_submission   FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON speaking_feedback     FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON speaking_audio_event  FROM anon, authenticated;
REVOKE ALL ON speaking_task        FROM anon;
REVOKE ALL ON speaking_submission  FROM anon;
REVOKE ALL ON speaking_feedback    FROM anon;
REVOKE ALL ON speaking_audio_event FROM anon;
