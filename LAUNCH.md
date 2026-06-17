# LAUNCH.md — путь от «код готов» до продакшна

> Назначение: операционный чеклист запуска. **Не дублирует** BRIEF.md (спека) и
> CLAUDE.md (инструкции ассистента) — здесь только то, что стоит между текущим
> состоянием кода и боевым запуском. Источник правды по фазам — `CLAUDE.md` §Status.

## Где мы сейчас (верифицировано по коду 2026-06-15)

Фазы **0, 1, 2 закрыты на уровне кода** (проверено пофайлово, не по статусу):

- **Phase 0** — 14 таблиц (`src/db/schema.ts`), миграции `0000`–`0007` (up/down),
  два DB-пути (Supabase anon+RLS / Drizzle owner), auth-триггер.
- **Phase 1** — auth, 6 импорт-парсеров (`src/lib/import/`, включая Listening и
  Full Reading), admin-загрузка+publish, каталог с фильтрами, exam-режим
  (таймер/навигатор/autosave/audio), серверный грейдинг + per-type breakdown,
  result/review, dashboard. Все 9 Reading + 1 Listening sample парсятся.
- **Phase 2** — rating+leaderboard, badges, referrals, tiers+payment (миграции
  `0003`–`0006`, применены к Supabase).
- **Launch hardening** — PostHog, Sentry, submit-throttle, notification centre.

Phase 3 (AI) — заморожена, последняя. Не входит в запуск.

**Вывод: «код фаз 0–1–2 готов» ≠ «готов к проду».** Ниже — что осталось.
Блокеры в основном НЕ кодовые (деплой, ключи, контент, замеры).

---

## Gate A — Развернуть инфраструктуру (нужны аккаунты/ключи, кода почти нет)

1. **Supabase prod**: применить **все** миграции `0000`–`0007`. ⚠️ `0007`
   (`one in_progress attempt`) на Supabase **ещё не применён** — это последний
   незакрытый шаг в hardening.
2. **Env в Vercel**: `DATABASE_URL` (pooler :6543), `DIRECT_URL` (:5432),
   `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`.
   Спецсимволы в пароле БД — percent-encode.
3. **Аудио в Storage**: перенести из локального `public/` в Supabase Storage;
   premium-аудио — через **signed URLs** (anti-leech, §11). Сейчас путь к аудио в
   `passage.audio_path`.
4. **Контент в live БД**: загрузить тесты через `/admin` (парсер + publish).
   Это ручной шаг при деплое, не код.
5. **Deploy** на Vercel + CDN; включить cron `/api/cron/expire-premium`
   (Bearer `CRON_SECRET`).

## Gate B — Обязательно до открытия для пользователей

6. **Browser e2e вживую** — ещё ни разу не «прокликано»: регистрация → вход →
   пройти тест (Reading + Listening) → сабмит → результат+разбор → tier-гейт.
   Каждый слой проверен по отдельности, сквозной прогон в браузере — нет.
7. **Quality bar §8** — замерить Lighthouse/Web Vitals против целей
   (LCP < 2s на 4G, ≥95 Performance/Accessibility/Best Practices, CLS < 0.1).
   Сейчас **нет** ни perf-бюджета, ни сбора Web Vitals — метрики на бою неизвестны.
8. **Anti-bot на signup** (§11, реальный контроль за принятыми gaps 2C) —
   Turnstile/captcha + email-verification + signup velocity. Нужны ключи
   Cloudflare + тумблер в Supabase. Без этого реферальная награда фармится.
9. **Платежи** — развилка:
   - **9a.** Запуск с монетизацией → реализовать реальные схемы вебхуков
     Payme/Click/Uzum (сейчас HMAC и парсинг тела — плейсхолдер,
     `src/lib/payments/index.ts`), получить merchant-ключи.
   - **9b.** Запуск без оплаты (набор аудитории) → все на Basic, `/upgrade`
     помечается «coming soon». Снимает блокер 9a с критического пути.
10. **OAuth** — Apple/Facebook нужны dev-ключи (Apple Developer платный, §10).
    Альтернатива: старт только с email-входом.
11. **Basic daily limit** — выбрать число `N` (сейчас плейсхолдер `BASIC_DAILY_LIMIT=3`).
12. **Дизайн-планка §0/§1/§7.1** — ⚠️ **требует решения**: проходил ли текущий UI
    дизайн-фазу (Claude Design, «взрослый WOW», dark-first, design-tokens), или
    это функциональный MVP-вид? North Star — «визуально топ-1%». Если планка §8
    Design QA не пройдена — это разрыв между «работает» и «продукт №1».

## Gate C — Сразу после запуска (не блокирует старт)

- **Sentry source maps** — сейчас upload отключён (`sourcemaps.disable`),
  стектрейсы на бою минифицированы. Включить org/project/authToken.
- **Weekly digest + email** — таблица `notification` и in-app центр есть; джоба
  дайджеста + провайдер доставки писем — TODO.
- **Full re-grade** — version bump + пересчёт `attempt` + пометка «балл уточнён»
  (сейчас только guard от потери данных при ре-импорте).
- **i18n** — RU/UZ (на старте EN, §10).
- **Phase 3 (AI Writing/Speaking)** — разморозка по решению, последней.

---

## Минимальный путь к запуску (рекомендация)

Если цель — **набрать аудиторию быстро** (как и заявлено в стратегии заморозки AI):

`Gate A (1–5)` → `9b (запуск без оплаты)` → `6 (e2e)` → `7 (perf)` →
`8 (anti-bot)` → `12 (решение по дизайну)` → **открытие**.

Платежи (9a), OAuth (10), монетизация — вторым релизом, когда есть аудитория.
Это снимает с критического пути всё, что требует merchant-ключей и платного
Apple Developer, и совпадает с продуктовой логикой «сначала аудитория».
