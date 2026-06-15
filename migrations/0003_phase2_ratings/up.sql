-- 0003_phase2_ratings :: up
-- Milestone 2A (Elo rating + Leaderboard). Adds the test-side Elo columns to
-- content_item (BRIEF §4.6: difficulty self-calibrates from rated attempts) and
-- seeds the Uzbekistan region hierarchy (BRIEF §5: profile.region_id -> region)
-- so leaderboard scope can be filtered by viloyat. Written idempotently
-- (guards via WHERE NOT EXISTS) so a re-run does not duplicate rows.

-- a) Elo difficulty on the test container. Starts at the same 1000 floor as a
--    fresh profile; difficulty_count tracks how many rated attempts have moved it.
ALTER TABLE content_item ADD COLUMN difficulty_rating integer NOT NULL DEFAULT 1000;
ALTER TABLE content_item ADD COLUMN difficulty_count  integer NOT NULL DEFAULT 0;

-- b) Seed Uzbekistan (country) + its 14 first-level divisions (level 'region').
--    region.id is uuid default gen_random_uuid() and name has NO unique
--    constraint, so every insert is guarded. The CTE captures the country id
--    (whether just inserted or pre-existing) and the children reference it.
WITH ins_country AS (
  INSERT INTO region (name, level, parent_id)
  SELECT 'Uzbekistan', 'country', NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM region WHERE level = 'country' AND name = 'Uzbekistan'
  )
  RETURNING id
),
country AS (
  SELECT id FROM ins_country
  UNION ALL
  SELECT id FROM region WHERE level = 'country' AND name = 'Uzbekistan'
  LIMIT 1
)
INSERT INTO region (name, level, parent_id)
SELECT v.name, 'region', country.id
FROM country
CROSS JOIN (VALUES
  ('Andijan'),
  ('Bukhara'),
  ('Fergana'),
  ('Jizzakh'),
  ('Khorezm'),
  ('Namangan'),
  ('Navoiy'),
  ('Kashkadarya'),
  ('Samarkand'),
  ('Syrdarya'),
  ('Surkhandarya'),
  ('Tashkent Region'),
  ('Tashkent City'),
  ('Karakalpakstan')
) AS v(name)
WHERE NOT EXISTS (
  SELECT 1 FROM region r
  WHERE r.name = v.name
    AND r.level = 'region'
    AND r.parent_id = country.id
);
