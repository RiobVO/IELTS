# Bando redesign — Спек 1: Foundation + Landing

> Источник дизайна: `design-drop/` (дизайн-система Bando, handoff под этот репозиторий).
> Дизайн-файлы — **референсы** (HTML/React-via-Babel); пересоздаём в реальном стеке
> (Next.js App Router, типизированные `.tsx`). CSS-токены — production-ready, берём как есть.
> Линейная карта редизайна: **Спек 1 (фундамент + лендинг)** → далее по экрану на спек.

## 1. Цель и scope

Заложить фундамент дизайн-системы Bando в проект и переверстать **лендинг** (`app/page.tsx`)
как пилотный экран — чтобы доказать, что подход (токены + портированные компоненты)
работает end-to-end на реальной странице. Заодно — ребренд видимого бренда **NINE → bando**
(дизайн-гайд: «earlier names/palettes are gone»).

**Входит:**
- Дизайн-токены в `app/tokens/` + entry в `app/globals.css`.
- Шрифты через `next/font` (Plus Jakarta Sans / Literata / JetBrains Mono).
- Минимальный набор компонентов как `.tsx`: `core/util`, `core/icons`, `core/Button`,
  `core/Card`, `core/Logo`, `marketing/FeatureGrid`.
- Переверстанный лендинг `app/page.tsx` по эталону `design-drop/ui_kits/nine/home.html`.
- Ребренд: `app/layout.tsx` metadata, логотип, копирайт лендинга → English.

**НЕ входит (следующие спеки):**
- Остальные 11 экранов: dashboard, catalog (reading/listening), exam runner, result,
  leaderboard, badges, profile, pricing-страница, auth, admin.
- Компоненты exam / results / gamification (ExamTimer, QuestionNavigator, AudioPlayer,
  MapLabelling, ResultBreakdown, ProgressChart, BadgeUnlock, LeaderboardRow, остальные core).
- Свап CDN-иллюстраций FeatureGrid на бренд-арт (accepted gap, плейсхолдеры на старте).
- i18n (EN at launch per BRIEF §10).
- Полная «levitate + glow» анимация логотипа (в спеке 1 — базовая, reduced-motion-safe).
- `package.json` `name: "ielts-platform"` — internal, не трогаем.

## 2. Архитектура

- **Парадигма стилизации без изменений.** И проект, и Bando стилизуют инлайн через
  `style={...}` со значениями из `var(--token)`. Tailwind / CSS-модули не вводим.
- **Источник значений — только токены.** Ноль хардкода цветов/отступов/радиусов/теней.
  Текущий `#6C5CE7`, `#fff`, `#666` и т.п. на лендинге уходят в токены.
- **Light-first.** `:root` = светлая тема (`color-scheme: light`), `[data-theme="dark"]` —
  производная (переключатель темы — вне scope спека 1).

### Размещение файлов
```
app/tokens/{base,colors,typography,spacing,radii,elevation,motion}.css   # 7 файлов, как есть
app/globals.css                                                          # entry: @import токенов + текущий badge-pop
public/bando-mark.svg                                                    # логотип
src/components/core/util.tsx        # sx, useInteractive, RING
src/components/core/icons.tsx       # Icon — инлайн-SVG обёртка (PATHS), zero-dependency
src/components/core/Button.tsx      # 'use client' — 3D push button
src/components/core/Card.tsx        # 'use client' — surface primitive
src/components/core/Logo.tsx        # 'use client' — знак + лёгкая анимация
src/components/marketing/FeatureGrid.tsx  # 'use client' — «what you get» сетка
```

### Токены и шрифты
- `design-drop/tokens/{base,colors,typography,spacing,radii,elevation,motion}.css` копируются
  в `app/tokens/` **дословно**. Папка без `page.tsx`/`route.ts` в App Router не маршрутизируется.
- `app/globals.css` становится единственным entry: `@import` семи токен-файлов + сохраняем
  существующий `badge-pop` keyframe и `.badge-unlock` (фича 2B, не трогаем).
- **Шрифты:** CDN-`@import` из `fonts.css` НЕ переносим. Вместо него `next/font/google` в
  `app/layout.tsx` с `variable: "--font-jakarta" | "--font-literata" | "--font-jbmono"`,
  переменные навешиваются на `<html>`; в `typography.css` токены `--font-ui/--font-reading/--font-mono`
  ссылаются на эти переменные.

### Иконки (исправление self-review)
`icons.jsx` в Bando — **не** `lucide-react`, а собственная `<svg>`-обёртка с картой `PATHS`
(пути скопированы из Lucide дословно). Портируем `icons.tsx` как есть. `lucide-react`
**не добавляем** — лишняя зависимость отпадает, и это точнее «как в Bando».

## 3. Компоненты (подход A — гибрид-порт)

Переиспользуем выверенную механику Bando, переписывая в типизированные `.tsx` с типами
из соответствующих `.d.ts`. Поведение (depress-on-press, hover-lift, focus-ring,
reduced-motion) сохраняем 1:1.

- **`util.tsx`** — `useInteractive()` (hover/focus/active + handlers), `sx(...objs)`,
  `RING`. Прямой порт + типы.
- **`icons.tsx`** — `Icon({name,size,strokeWidth,style})` + типизированная карта `PATHS`.
- **`Button.tsx`** — варианты `primary|secondary|ghost|danger|success`, размеры `sm|md|lg`;
  слоёный `boxShadow` (inset hairline + solid bottom edge), `translateY` при нажатии,
  `loading`-спиннер. `'use client'`.
- **`Card.tsx`** — `interactive`/`elevated`/`padding`/`as`; `--shadow-solid` по умолчанию,
  hover-lift в interactive-режиме. `'use client'`.
- **`Logo.tsx`** — `public/bando-mark.svg` (три бара, фиолетовый верхний) + wordmark
  «bando» (Plus Jakarta 800, фиолетовая `o`); базовая анимация появления, reduced-motion-safe.
- **`FeatureGrid.tsx`** — `FeatureCard` (media: `image` CDN-иллюстрация **или** tinted
  `Icon`-tile; title + description + hover-arrow) + `FeatureGrid` (responsive `columns`,
  `variant: plain|tactile`). `'use client'`.

Серверные страницы импортируют client-компоненты как островки — стандартно для App Router.

## 4. Лендинг — `app/page.tsx`

Переверстать по `design-drop/ui_kits/nine/home.html`. Секции:
1. **Nav** — логотип + ссылки (Reading · Listening · How it works · Pricing) + Log in / Start free (`Button`).
2. **Hero** — заголовок «Stop guessing your band.», подзаголовок, CTA. Декоративный
   `hero-canvas` — в спеке 1 упрощённо/опционально (или статичный фон), reduced-motion-safe.
3. **The bando difference** — overline + h2 + абзац (позиционирование «знай свой тип»).
4. **How it works / FeatureGrid** — 4 фичи: real exam mode, per-type breakdown,
   targeted drills, full mock tests (CDN-иллюстрации-плейсхолдеры).
5. **Pricing teaser** — Basic / Premium / Ultra (текущие 3 карточки на `Card` + токенах,
   Premium — highlight). Числа лимитов не фиксируем (подбираются при запуске).
6. **Footer** — бренд + базовые ссылки.

- **Копирайт → English**, sentence case (BRIEF §10 + дизайн-гайд). Русский текущего лендинга уходит.
- Tagline бренда: «Get your band.»; голос — second-person, «talk to the student».
- Все хардкод-цвета и локальные `*Cta`/`tierCard`-стили заменяются токенами и компонентами.

### Ребренд
- `app/layout.tsx` metadata `title`: «NINE — IELTS Platform» → bando-вариант
  (напр. «bando — Get your band»), `description` под bando.
- Видимый бренд везде на лендинге = bando (логотип + wordmark).

## 5. Verify (критерий приёмки)

Изменения — фронтовые (CSS/разметка/компоненты), поэтому проверяем **поведение артефакта**, не факт сборки:

1. `npx tsc --noEmit` → 0 ошибок.
2. `npm run build` → зелёный.
3. `npm run dev`, открыть `/`:
   - Визуальный осмотр: лендинг bando (nav/hero/difference/features/pricing/footer), фирменные 3D-кнопки.
   - DOM-проверка целевого элемента (скрипт `scripts/_*.ts` или ручная проверка в DevTools):
     у primary-`Button` вычисленный `box-shadow` содержит цвет `--brand-edge` (3D-кромка
     присутствует); `font-family` body = Plus Jakarta Sans; `--brand` = violet (НЕ `#6C5CE7`).
   - Скриншот лендинга.

Печать `[OK] <что проверено>` / `[FAIL] <что сломалось>`, exit 0 на успехе.

## 6. Риски и допущения

- **Client islands.** Компоненты с хуками (`Button`, `Card` interactive, `FeatureGrid`,
  `Logo`) — `'use client'`. Лендинг почти статичен, островки точечные — ок.
- **hero-canvas.** Полная декоративная физика фона эталона — отдельная задача; в спеке 1
  упрощаем, чтобы не раздувать пилот.
- **CDN-иллюстрации FeatureGrid** (Microsoft Fluent Emoji 3D, jsDelivr) — плейсхолдеры;
  свап на бренд-арт позже (accepted gap, как в handoff).
- **Копирайт EN** — соответствует BRIEF §10; русский UI вернётся через i18n (отложено).
- **OKLCH-цвета токенов** — поддерживаются целевыми браузерами; деградация не требуется
  (премиум web-app, не legacy).
