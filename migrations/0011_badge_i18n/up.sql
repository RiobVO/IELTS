-- 0011_badge_i18n :: up
-- The site is English-only; the 12 badges seeded in 0004 carried Russian
-- name/description and surfaced to students (badge showcase, result unlock,
-- in-app notification title/body). Re-localize them to English in place.
--
-- A forward data fix, NOT an edit of 0004 (already applied + immutable): on the
-- live DB this UPDATE migrates the existing rows; on a fresh clone 0004 inserts
-- the RU seed first and this overwrites it to EN. Keyed by the UNIQUE code, so
-- re-running it is idempotent. criteria/icon are untouched.

UPDATE badge AS b
SET name = t.name, description = t.description
FROM (VALUES
  ('first_test',     'First Step',      'Complete your first test'),
  ('tests_10',       'Warming Up',      'Complete 10 tests'),
  ('tests_50',       'Marathoner',      'Complete 50 tests'),
  ('streak_3',       'Picking Up Speed','3-day streak'),
  ('streak_7',       'Week on Fire',    '7-day streak'),
  ('streak_30',      'Unbreakable',     '30-day streak'),
  ('perfect',        'Flawless',        'Score 100% on a test'),
  ('rating_1200',    'Rising Star',     'Reach a rating of 1200'),
  ('rating_1500',    'Master',          'Reach a rating of 1500'),
  ('tfng_sniper',    'Sniper',          '≥90% on True/False/Not Given (min. 20 questions)'),
  ('completion_pro', 'Completion Pro',  '≥90% on Sentence Completion (min. 15)'),
  ('champion',       'Champion',        '1st place in the all-time global ranking')
) AS t(code, name, description)
WHERE b.code = t.code;
