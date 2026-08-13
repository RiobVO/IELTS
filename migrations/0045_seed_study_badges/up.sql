-- 0045_seed_study_badges :: up
-- Study-loop badges (BRIEF §12.3 step 2, W2-5): award for CLOSING mistakes
-- (`mistake_resolution` rows, incl. auto-resolve on SR graduation), not for
-- raw test volume. `weakness_crusher` targets clearing one weak qtype
-- specifically, not just accumulating closures anywhere. criteria is the same
-- discriminated-union jsonb contract as 0004 (keyed on "type"), evaluated by
-- badge-criteria.ts. Idempotent: ON CONFLICT (code) DO NOTHING.

INSERT INTO badge (code, name, icon, description, criteria) VALUES
  ('mistakes_cleared_5',  'Clean-Up Crew',    '🧹', 'Close 5 mistakes in Practice',                  '{"type":"mistakes_closed","count":5}'::jsonb),
  ('mistakes_cleared_15', 'Debugger',         '🧽', 'Close 15 mistakes in Practice',                 '{"type":"mistakes_closed","count":15}'::jsonb),
  ('mistakes_cleared_40', 'Exterminator',     '🛡️', 'Close 40 mistakes in Practice',                 '{"type":"mistakes_closed","count":40}'::jsonb),
  ('weakness_crusher',    'Weakness Crusher', '💪', 'Close 5 mistakes of the same question type',    '{"type":"weak_type_cleared","perType":5}'::jsonb)
ON CONFLICT (code) DO NOTHING;
