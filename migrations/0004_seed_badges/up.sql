-- 0004_seed_badges :: up
-- Milestone 2B (Badges / achievements). Seeds the 12 catalog badges read by the
-- public-read badge table + matched by the post-submit eval engine (BRIEF §4.7).
-- criteria is the shared discriminated-union jsonb contract (keyed on "type").
-- Idempotent: ON CONFLICT (code) DO NOTHING (code has a UNIQUE constraint), so a
-- re-run inserts nothing. id is omitted -> defaults to gen_random_uuid().

INSERT INTO badge (code, name, icon, description, criteria) VALUES
  ('first_test',     'Первый шаг',        '🎯', 'Сдай свой первый тест',                            '{"type":"volume","tests":1}'::jsonb),
  ('tests_10',       'Разогрев',          '🔥', 'Сдай 10 тестов',                                   '{"type":"volume","tests":10}'::jsonb),
  ('tests_50',       'Марафонец',         '🏃', 'Сдай 50 тестов',                                   '{"type":"volume","tests":50}'::jsonb),
  ('streak_3',       'На разгоне',        '⚡', 'Серия 3 дня подряд',                               '{"type":"streak","days":3}'::jsonb),
  ('streak_7',       'Неделя огня',       '🔥', 'Серия 7 дней подряд',                              '{"type":"streak","days":7}'::jsonb),
  ('streak_30',      'Несокрушимый',      '💎', 'Серия 30 дней подряд',                             '{"type":"streak","days":30}'::jsonb),
  ('perfect',        'Безупречно',        '💯', 'Набери 100% за тест',                              '{"type":"perfect"}'::jsonb),
  ('rating_1200',    'Восходящая звезда', '⭐', 'Достигни рейтинга 1200',                           '{"type":"rating","min":1200}'::jsonb),
  ('rating_1500',    'Мастер',            '👑', 'Достигни рейтинга 1500',                           '{"type":"rating","min":1500}'::jsonb),
  ('tfng_sniper',    'Снайпер',           '🎯', '≥90% по True/False/Not Given (мин. 20 вопросов)',  '{"type":"accuracy","qtype":"tfng","minQuestions":20,"minPct":90}'::jsonb),
  ('completion_pro', 'Мастер заполнения', '✍️', '≥90% по Sentence Completion (мин. 15)',            '{"type":"accuracy","qtype":"sentence_completion","minQuestions":15,"minPct":90}'::jsonb),
  ('champion',       'Чемпион',           '🏆', '1-е место в мировом рейтинге за всё время',         '{"type":"first_place","scope":"global","period":"all_time"}'::jsonb)
ON CONFLICT (code) DO NOTHING;
