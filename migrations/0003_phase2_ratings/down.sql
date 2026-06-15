-- 0003_phase2_ratings :: down
-- Fully reverse the up: drop the 14 seeded region rows + the Uzbekistan country
-- row (matched by name + level), then drop the content_item Elo columns.

DELETE FROM region
WHERE level = 'region'
  AND name IN (
    'Andijan',
    'Bukhara',
    'Fergana',
    'Jizzakh',
    'Khorezm',
    'Namangan',
    'Navoiy',
    'Kashkadarya',
    'Samarkand',
    'Syrdarya',
    'Surkhandarya',
    'Tashkent Region',
    'Tashkent City',
    'Karakalpakstan'
  )
  AND parent_id IN (SELECT id FROM region WHERE level = 'country' AND name = 'Uzbekistan');

DELETE FROM region
WHERE level = 'country' AND name = 'Uzbekistan';

ALTER TABLE content_item DROP COLUMN difficulty_count;
ALTER TABLE content_item DROP COLUMN difficulty_rating;
