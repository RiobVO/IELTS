-- 0000_init :: up
-- Schema for the IELTS data model (BRIEF §5). Mirrors src/db/schema.ts.
-- Assumes Supabase-provided `auth.users` exists (locally emulated by
-- scripts/bootstrap-supabase-local.sql).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE region_level AS ENUM ('country', 'region', 'district');
CREATE TYPE auth_provider AS ENUM ('email', 'apple', 'facebook');
CREATE TYPE user_role AS ENUM ('student', 'admin');
CREATE TYPE user_tier AS ENUM ('basic', 'premium', 'ultra');
CREATE TYPE content_section AS ENUM ('reading', 'listening');
CREATE TYPE content_category AS ENUM (
  'passage_1', 'passage_2', 'passage_3', 'full_reading',
  'part_1', 'part_2', 'part_3', 'part_4', 'full_listening'
);
CREATE TYPE band_type AS ENUM ('reading_academic', 'reading_general', 'listening');
CREATE TYPE content_status AS ENUM ('draft', 'published');
CREATE TYPE question_type AS ENUM (
  'tfng', 'ynng', 'mcq_single', 'mcq_multi',
  'matching_headings', 'matching_info', 'matching_features',
  'matching_sentence_endings', 'sentence_completion', 'summary_completion',
  'note_completion', 'flowchart_completion', 'table_completion',
  'diagram_label', 'map_labelling', 'form_completion', 'short_answer'
);
CREATE TYPE answer_mode AS ENUM ('mcq_set', 'text_accept', 'exact');
CREATE TYPE attempt_mode AS ENUM ('practice', 'mock');
CREATE TYPE attempt_status AS ENUM ('in_progress', 'submitted');
CREATE TYPE referral_status AS ENUM ('sent', 'registered', 'rewarded');
CREATE TYPE leaderboard_period AS ENUM ('weekly', 'monthly', 'all_time');
CREATE TYPE topic_skill AS ENUM ('writing', 'speaking');
CREATE TYPE notification_type AS ENUM (
  'streak_reminder', 'weekly_digest', 'badge_unlocked', 'system'
);

-- ---------------------------------------------------------------------------
-- region
-- ---------------------------------------------------------------------------
CREATE TABLE region (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES region (id) ON DELETE SET NULL,
  name      text NOT NULL,
  level     region_level NOT NULL
);

-- ---------------------------------------------------------------------------
-- profile  (BRIEF §5 `user`; id 1:1 with auth.users.id)
-- ---------------------------------------------------------------------------
CREATE TABLE profile (
  id                       uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email                    text NOT NULL UNIQUE,
  auth_provider            auth_provider NOT NULL DEFAULT 'email',
  display_name             text,
  avatar_url               text,
  region_id                uuid REFERENCES region (id) ON DELETE SET NULL,
  role                     user_role NOT NULL DEFAULT 'student',
  tier                     user_tier NOT NULL DEFAULT 'basic',
  premium_until            timestamptz,
  rating                   integer NOT NULL DEFAULT 1000,
  peak_rating              integer NOT NULL DEFAULT 1000,
  rated_count              integer NOT NULL DEFAULT 0,
  xp                       integer NOT NULL DEFAULT 0,
  current_streak           integer NOT NULL DEFAULT 0,
  longest_streak           integer NOT NULL DEFAULT 0,
  last_activity_date       date,
  target_band              numeric(2, 1),
  timezone                 text NOT NULL DEFAULT 'UTC',
  referral_code            text NOT NULL UNIQUE,
  referred_by              uuid REFERENCES profile (id) ON DELETE SET NULL,
  hidden_from_leaderboard  boolean NOT NULL DEFAULT false,
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX profile_region_id_idx ON profile (region_id);
CREATE INDEX profile_rating_idx ON profile (rating);

-- ---------------------------------------------------------------------------
-- content_item
-- ---------------------------------------------------------------------------
CREATE TABLE content_item (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section          content_section NOT NULL,
  category         content_category NOT NULL,
  title            text NOT NULL,
  source_file_path text,
  duration_seconds integer,
  tier_required    user_tier NOT NULL DEFAULT 'basic',
  band_type        band_type NOT NULL,
  question_types   text[] NOT NULL DEFAULT '{}'::text[],
  band_scale       jsonb,
  status           content_status NOT NULL DEFAULT 'draft',
  version          integer NOT NULL DEFAULT 1,
  created_by       uuid REFERENCES profile (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX content_item_section_category_idx ON content_item (section, category);
CREATE INDEX content_item_question_types_idx ON content_item USING gin (question_types);

-- ---------------------------------------------------------------------------
-- passage
-- ---------------------------------------------------------------------------
CREATE TABLE passage (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id uuid NOT NULL REFERENCES content_item (id) ON DELETE CASCADE,
  "order"         integer NOT NULL,
  title           text,
  body_html       text NOT NULL,
  audio_path      text
);
CREATE INDEX passage_content_item_id_idx ON passage (content_item_id);

-- ---------------------------------------------------------------------------
-- question
-- ---------------------------------------------------------------------------
CREATE TABLE question (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id uuid NOT NULL REFERENCES content_item (id) ON DELETE CASCADE,
  passage_id      uuid NOT NULL REFERENCES passage (id) ON DELETE CASCADE,
  number          integer NOT NULL,
  qtype           question_type NOT NULL,
  prompt_html     text NOT NULL,
  options         jsonb,
  group_key       text,
  evidence_ref    text,
  "order"         integer NOT NULL
);
CREATE INDEX question_content_item_id_idx ON question (content_item_id);
CREATE INDEX question_passage_id_idx ON question (passage_id);

-- ---------------------------------------------------------------------------
-- answer_key  (locked to service-role by RLS in 0001)
-- ---------------------------------------------------------------------------
CREATE TABLE answer_key (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL UNIQUE REFERENCES question (id) ON DELETE CASCADE,
  mode        answer_mode NOT NULL,
  accept      jsonb NOT NULL,
  explanation text,
  evidence    jsonb
);

-- ---------------------------------------------------------------------------
-- attempt
-- ---------------------------------------------------------------------------
CREATE TABLE attempt (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES profile (id) ON DELETE CASCADE,
  content_item_id    uuid NOT NULL REFERENCES content_item (id) ON DELETE CASCADE,
  mode               attempt_mode NOT NULL,
  status             attempt_status NOT NULL DEFAULT 'in_progress',
  answers            jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at         timestamptz NOT NULL DEFAULT now(),
  submitted_at       timestamptz,
  time_used_seconds  integer,
  raw_score          integer,
  band_score         numeric(2, 1),
  per_type_breakdown jsonb
);
CREATE INDEX attempt_user_submitted_idx ON attempt (user_id, submitted_at);
CREATE INDEX attempt_content_item_id_idx ON attempt (content_item_id);

-- ---------------------------------------------------------------------------
-- badge / user_badge
-- ---------------------------------------------------------------------------
CREATE TABLE badge (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  description text,
  icon        text,
  criteria    jsonb
);

CREATE TABLE user_badge (
  user_id   uuid NOT NULL REFERENCES profile (id) ON DELETE CASCADE,
  badge_id  uuid NOT NULL REFERENCES badge (id) ON DELETE CASCADE,
  earned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, badge_id)
);

-- ---------------------------------------------------------------------------
-- referral
-- ---------------------------------------------------------------------------
CREATE TABLE referral (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_id uuid NOT NULL REFERENCES profile (id) ON DELETE CASCADE,
  invitee_id uuid REFERENCES profile (id) ON DELETE SET NULL,
  code       text NOT NULL UNIQUE,
  status     referral_status NOT NULL DEFAULT 'sent',
  reward     text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- leaderboard_entry  (scope = 'global' | <region_id as text>)
-- ---------------------------------------------------------------------------
CREATE TABLE leaderboard_entry (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES profile (id) ON DELETE CASCADE,
  period     leaderboard_period NOT NULL,
  scope      text NOT NULL DEFAULT 'global',
  rating     integer,
  score      integer,
  rank       integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leaderboard_entry_user_period_scope_key UNIQUE (user_id, period, scope)
);
CREATE INDEX leaderboard_entry_rank_idx ON leaderboard_entry (period, scope, rank);

-- ---------------------------------------------------------------------------
-- topic  (Writing/Speaking stub)
-- ---------------------------------------------------------------------------
CREATE TABLE topic (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill         topic_skill NOT NULL,
  prompt        text NOT NULL,
  tier_required user_tier NOT NULL DEFAULT 'basic',
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- notification
-- ---------------------------------------------------------------------------
CREATE TABLE notification (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES profile (id) ON DELETE CASCADE,
  type       notification_type NOT NULL,
  title      text NOT NULL,
  body       text,
  data       jsonb,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_user_created_idx ON notification (user_id, created_at);
