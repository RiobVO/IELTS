-- 0025_writing_topic_meta :: up
-- Rich prompt catalog (handoff): per-topic presentation metadata on writing_task.
-- Additive + nullable so existing rows survive until backfilled; CHECK pins the
-- value sets the catalog UI maps over (an unknown value still degrades to a
-- neutral card). Content metadata only — grading/RLS/tier/answer_key untouched.

ALTER TABLE writing_task
  ADD COLUMN IF NOT EXISTS topic      text
    CHECK (topic IN ('society','environment','crime','technology','food','culture')),
  ADD COLUMN IF NOT EXISTS task_type  text
    CHECK (task_type IN ('discussion','agree_disagree','adv_disadv','two_part','pos_neg','opinion')),
  ADD COLUMN IF NOT EXISTS difficulty smallint
    CHECK (difficulty IN (1, 2, 3)),
  ADD COLUMN IF NOT EXISTS band_low   numeric(2,1),
  ADD COLUMN IF NOT EXISTS band_high  numeric(2,1);
