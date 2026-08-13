-- 0045_seed_study_badges :: down
-- Remove the 4 seeded study-loop badges by code. Any user_badge rows that
-- reference them are removed automatically via the FK (user_badge.badge_id ->
-- badge.id is ON DELETE CASCADE), so no extra cleanup is needed here.

DELETE FROM badge WHERE code IN (
  'mistakes_cleared_5',
  'mistakes_cleared_15',
  'mistakes_cleared_40',
  'weakness_crusher'
);
