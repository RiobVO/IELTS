-- 0004_seed_badges :: down
-- Remove the 12 seeded catalog badges by code. Any user_badge rows that reference
-- them are removed automatically via the FK (user_badge.badge_id -> badge.id is
-- ON DELETE CASCADE), so no extra cleanup is needed here.

DELETE FROM badge WHERE code IN (
  'first_test',
  'tests_10',
  'tests_50',
  'streak_3',
  'streak_7',
  'streak_30',
  'perfect',
  'rating_1200',
  'rating_1500',
  'tfng_sniper',
  'completion_pro',
  'champion'
);
