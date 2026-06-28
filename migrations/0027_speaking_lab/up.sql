-- 0027_speaking_lab :: up
-- Phase 3 (Speaking Lab, Part 2 MVP). Five additive tables for AI audio evaluation
-- + one profile column for biometric consent. Core R/L and Writing untouched.
-- RLS mirrors writing_*: task published-gated, submission/feedback owner-read,
-- speaking_feedback_debug hard-locked (like answer_key), audio_event owner-read.
-- Voice = biometrics: private bucket + storage policy live in setup-speaking-storage.ts.

CREATE TYPE speaking_part               AS ENUM ('part2');
CREATE TYPE speaking_submission_status  AS ENUM ('uploading', 'pending', 'evaluating', 'completed', 'failed');
CREATE TYPE speaking_confidence         AS ENUM ('low', 'medium', 'high');
CREATE TYPE speaking_delete_reason      AS ENUM ('user', 'retention', 'account');
CREATE TYPE speaking_task_status        AS ENUM ('draft', 'published');
CREATE TYPE speaking_audio_event_kind   AS ENUM (
  'consent_given', 'uploaded', 'sent_to_provider',
  'delete_requested', 'deleted_user', 'deleted_retention', 'deleted_account', 'consent_revoked'
);

-- Consent is a property of the USER (given once), not of an attempt. Nullable
-- default null = no consent; recording is server-gated on this being non-null.
ALTER TABLE profile ADD COLUMN recording_consent_at timestamptz;

-- speaking_task: admin-authored Part 2 cue-card. Published-gated like writing_task.
CREATE TABLE speaking_task (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part              speaking_part NOT NULL DEFAULT 'part2',
  prompt            text NOT NULL,
  bullets           jsonb NOT NULL,
  closing_prompt    text NOT NULL,
  prep_seconds      integer NOT NULL DEFAULT 60,
  max_speak_seconds integer NOT NULL DEFAULT 120,
  tier_required     user_tier NOT NULL DEFAULT 'ultra',
  status            speaking_task_status NOT NULL DEFAULT 'draft',
  created_by        uuid REFERENCES profile(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX speaking_task_status_idx ON speaking_task (status);

ALTER TABLE speaking_task ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON speaking_task TO authenticated;
GRANT ALL ON speaking_task TO service_role;
CREATE POLICY speaking_task_select_published ON speaking_task
  FOR SELECT TO authenticated USING (status = 'published');

-- speaking_submission: a user's attempt. Holds an audio_path (private bucket key),
-- NOT the audio. updated_at drives the reaper. delete/retention columns track the
-- biometric lifecycle.
CREATE TABLE speaking_submission (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
  task_id             uuid NOT NULL REFERENCES speaking_task(id) ON DELETE CASCADE,
  audio_path          text NOT NULL,
  status              speaking_submission_status NOT NULL DEFAULT 'uploading',
  delete_requested_at timestamptz,
  audio_deleted_at    timestamptz,
  audio_deleted_reason speaking_delete_reason,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX speaking_submission_user_created_idx ON speaking_submission (user_id, created_at);
CREATE INDEX speaking_submission_status_updated_idx ON speaking_submission (status, updated_at);

ALTER TABLE speaking_submission ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON speaking_submission TO authenticated;
GRANT ALL ON speaking_submission TO service_role;
CREATE POLICY speaking_submission_select_own ON speaking_submission
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- speaking_feedback: user-visible snapshot. Owner-read THROUGH the submission.
-- Holds the transcript (user-delete wipes it). No raw, no audio.
CREATE TABLE speaking_feedback (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id  uuid NOT NULL UNIQUE REFERENCES speaking_submission(id) ON DELETE CASCADE,
  band_low       numeric(2,1) NOT NULL,
  band_high      numeric(2,1) NOT NULL,
  confidence     speaking_confidence NOT NULL,
  criteria       jsonb NOT NULL,
  transcript     text NOT NULL,
  annotations    jsonb NOT NULL,
  top_fixes      jsonb NOT NULL,
  drills         jsonb NOT NULL,
  provider       text NOT NULL,
  model          text NOT NULL,
  prompt_version text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE speaking_feedback ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON speaking_feedback TO authenticated;
GRANT ALL ON speaking_feedback TO service_role;
CREATE POLICY speaking_feedback_select_own ON speaking_feedback
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM speaking_submission s
    WHERE s.id = speaking_feedback.submission_id AND s.user_id = auth.uid()
  ));

-- speaking_feedback_debug: raw model output. HARD-LOCKED like answer_key.
CREATE TABLE speaking_feedback_debug (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id  uuid NOT NULL REFERENCES speaking_submission(id) ON DELETE CASCADE,
  raw_output     text NOT NULL,
  provider       text NOT NULL,
  model          text NOT NULL,
  prompt_version text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX speaking_feedback_debug_submission_idx ON speaking_feedback_debug (submission_id);

ALTER TABLE speaking_feedback_debug ENABLE ROW LEVEL SECURITY;
GRANT ALL ON speaking_feedback_debug TO service_role;
REVOKE ALL ON speaking_feedback_debug FROM anon, authenticated, PUBLIC;

-- speaking_audio_event: durable biometric audit trail. on-delete = SET NULL so the
-- trail survives account/submission deletion (else the audit is self-defeating).
CREATE TABLE speaking_audio_event (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid REFERENCES speaking_submission(id) ON DELETE SET NULL,
  user_id       uuid REFERENCES profile(id) ON DELETE SET NULL,
  event         speaking_audio_event_kind NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX speaking_audio_event_user_idx ON speaking_audio_event (user_id, created_at);

ALTER TABLE speaking_audio_event ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON speaking_audio_event TO authenticated;
GRANT ALL ON speaking_audio_event TO service_role;
CREATE POLICY speaking_audio_event_select_own ON speaking_audio_event
  FOR SELECT TO authenticated USING (user_id = auth.uid());
