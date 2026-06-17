-- 0011_badge_i18n :: down
-- Restore the original Russian badge name/description from the 0004 seed.

UPDATE badge AS b
SET name = t.name, description = t.description
FROM (VALUES
  ('first_test',     'Первый шаг',        'Сдай свой первый тест'),
  ('tests_10',       'Разогрев',          'Сдай 10 тестов'),
  ('tests_50',       'Марафонец',         'Сдай 50 тестов'),
  ('streak_3',       'На разгоне',        'Серия 3 дня подряд'),
  ('streak_7',       'Неделя огня',       'Серия 7 дней подряд'),
  ('streak_30',      'Несокрушимый',      'Серия 30 дней подряд'),
  ('perfect',        'Безупречно',        'Набери 100% за тест'),
  ('rating_1200',    'Восходящая звезда', 'Достигни рейтинга 1200'),
  ('rating_1500',    'Мастер',            'Достигни рейтинга 1500'),
  ('tfng_sniper',    'Снайпер',           '≥90% по True/False/Not Given (мин. 20 вопросов)'),
  ('completion_pro', 'Мастер заполнения', '≥90% по Sentence Completion (мин. 15)'),
  ('champion',       'Чемпион',           '1-е место в мировом рейтинге за всё время')
) AS t(code, name, description)
WHERE b.code = t.code;
