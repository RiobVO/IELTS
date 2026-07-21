# Bando redesign — Foundation + Landing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заложить дизайн-токены и core-компоненты Bando в проект и переверстать лендинг (`app/page.tsx`) как пилотный экран; ребренд NINE → bando.

**Architecture:** Инлайн-стилизация со значениями из `var(--token)` (как в проекте и в Bando — никакого Tailwind/CSS-модулей). Токены копируются дословно из `design-drop/tokens/`; компоненты портируются `.jsx → .tsx` (подход A: переиспользуем `util`/`icons`, типизируем по `.d.ts`). Компоненты с хуками — `'use client'`; лендинг остаётся серверным и втягивает их как островки.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript (strict), `next/font/google`. Иконки — собственная zero-dependency SVG-обёртка Bando (НЕ `lucide-react`).

> **Тестовая инфраструктура.** В проекте нет тест-раннера и линтера (CLAUDE.md). Верификация фронта — `npx tsc --noEmit` + `npm run build` + ad-hoc DOM-проба через `npx tsx scripts/_*.ts` + визуальный осмотр `/`. Юнит-тесты не вводим (нет инфраструктуры, нет ценности для CSS). Каждый таск завершается verify-шагом и коммитом.

> **Источник кода.** Референсные `.jsx`/`.css`/`.svg` лежат в `design-drop/` (в репозитории, gitignored). Порт = копия + типизация + `'use client'` + замена `.jsx`-импортов. Точные значения стилей лендинга сверять с `design-drop/ui_kits/nine/home.html`.

---

## File Structure

```
app/tokens/base.css            # reset, root surface, focus ring, .reading-prose, reduced-motion
app/tokens/colors.css          # semantic aliases (light :root + dark derived)
app/tokens/typography.css      # font tokens (→ next/font vars), type scale, weights, tracking
app/tokens/spacing.css         # --space-*
app/tokens/radii.css           # --radius-*
app/tokens/elevation.css       # --shadow-* (incl. --shadow-solid signature)
app/tokens/motion.css          # --duration-*, --ease-*
app/globals.css                # entry: @import всех токенов + текущий badge-pop
app/layout.tsx                 # MODIFY: next/font + rebrand metadata
public/bando-mark.svg          # logo (нейтральные бары адаптированы под light)
src/components/core/util.tsx   # sx, useInteractive, RING
src/components/core/icons.tsx  # Icon + PATHS (typed IconName)
src/components/core/Button.tsx # 'use client'
src/components/core/Card.tsx   # 'use client'
src/components/core/Logo.tsx   # 'use client'
src/components/marketing/FeatureGrid.tsx  # 'use client'
app/page.tsx                   # REWRITE: bando landing
```

---

## Task 1: Дизайн-токены + globals.css entry

**Files:**
- Create: `app/tokens/base.css`, `colors.css`, `typography.css`, `spacing.css`, `radii.css`, `elevation.css`, `motion.css`
- Modify: `app/globals.css`

- [ ] **Step 1: Скопировать 7 токен-файлов дословно**

Скопировать из `design-drop/tokens/` в `app/tokens/` без изменений: `base.css`, `colors.css`, `typography.css`, `spacing.css`, `radii.css`, `elevation.css`, `motion.css`. (НЕ копировать `fonts.css` — CDN-`@import` заменяем на `next/font` в Task 2.)

- [ ] **Step 2: В `typography.css` подключить next/font-переменные к шрифтовым токенам**

Заменить три первые строки `:root` так, чтобы next/font (Task 2) имел приоритет, а CDN/системные шрифты остались fallback'ом:

```css
  --font-ui: var(--font-jakarta), 'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-reading: var(--font-literata), 'Literata', Georgia, 'Iowan Old Style', 'Times New Roman', serif;
  --font-mono: var(--font-jbmono), 'JetBrains Mono', ui-monospace, 'SF Mono', 'Geist Mono', monospace;
```

(До Task 2 `var(--font-jakarta)` пуст → CSS падает на следующий шрифт в списке. Не ломается.)

- [ ] **Step 3: Переписать `app/globals.css` как entry**

```css
/* bando design system — global entry point. Light-first; [data-theme="dark"] derived. */
@import "./tokens/colors.css";
@import "./tokens/typography.css";
@import "./tokens/spacing.css";
@import "./tokens/radii.css";
@import "./tokens/elevation.css";
@import "./tokens/motion.css";
@import "./tokens/base.css";

/* Badge unlock reveal (Milestone 2B) — slight overshoot on reveal. */
@keyframes badge-pop {
  from { transform: scale(0.6); opacity: 0; }
  to   { transform: scale(1); opacity: 1; }
}
.badge-unlock { animation: badge-pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
@media (prefers-reduced-motion: reduce) { .badge-unlock { animation: none; } }
```

(`base.css` импортируется последним — его reset/`.reading-prose`/focus-ring перекрывают дефолты. Старые ручные reset-правила из прежнего `globals.css` удаляются — их даёт `base.css`.)

- [ ] **Step 4: Verify — typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: оба зелёные; build не ругается на `@import` токенов.

- [ ] **Step 5: Commit**

```bash
git add app/tokens app/globals.css
git commit -m "feat(design): add bando design tokens + globals entry"
```

---

## Task 2: Шрифты через next/font + ребренд metadata

**Files:**
- Modify: `app/layout.tsx`

- [ ] **Step 1: Подключить next/font и навесить переменные на `<html>`**

Заменить `app/layout.tsx` (сохранив PostHog-обвязку и `import "./globals.css"`):

```tsx
import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Literata, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { posthogConfig } from "@/env";
import { PostHogProvider } from "@/lib/analytics/provider";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-jakarta", display: "swap",
});
const literata = Literata({
  subsets: ["latin"], weight: ["400", "500", "600"], style: ["normal", "italic"], variable: "--font-literata", display: "swap",
});
const jbMono = JetBrains_Mono({
  subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-jbmono", display: "swap",
});

export const metadata: Metadata = {
  title: "bando — Get your band",
  description: "Premium IELTS Reading & Listening prep: real exam mode, per-type analytics, and a clear path to your target band.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const analytics = posthogConfig();
  return (
    <html lang="en" className={`${jakarta.variable} ${literata.variable} ${jbMono.variable}`}>
      <body>
        {analytics ? <PostHogProvider config={analytics}>{children}</PostHogProvider> : children}
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Verify — шрифт применился, CDN не дёргается**

Run: `npx tsc --noEmit && npm run build`
Expected: зелёные. Запустить `npm run dev`, открыть `/`, в DevTools у `body` `font-family` резолвится в хэш-имя next/font (`__Plus_Jakarta_Sans_*`), сетевых запросов к `fonts.googleapis.com` нет.

- [ ] **Step 3: Commit**

```bash
git add app/layout.tsx
git commit -m "feat(design): self-host fonts via next/font + rebrand metadata to bando"
```

---

## Task 3: core/util.tsx + core/icons.tsx

**Files:**
- Create: `src/components/core/util.tsx`, `src/components/core/icons.tsx`

- [ ] **Step 1: Создать `util.tsx`** (порт `design-drop/components/core/util.jsx` + типы)

```tsx
import { useState } from "react";

/** Hover/focus/press для инлайн-стилизации через токены (псевдоклассы недоступны инлайн). */
export function useInteractive() {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [active, setActive] = useState(false);
  return {
    hover, focus, active,
    handlers: {
      onMouseEnter: () => setHover(true),
      onMouseLeave: () => { setHover(false); setActive(false); },
      onFocus: () => setFocus(true),
      onBlur: () => setFocus(false),
      onMouseDown: () => setActive(true),
      onMouseUp: () => setActive(false),
    },
  };
}

/** Слить style-объекты, отбросив falsy. */
export function sx(...objs: Array<React.CSSProperties | false | null | undefined>): React.CSSProperties {
  return Object.assign({}, ...objs.filter(Boolean));
}

/** Брендовый focus-ring как inline boxShadow (клавиатурный фокус). */
export const RING = "0 0 0 3px color-mix(in oklab, var(--focus-ring) 55%, transparent)";
```

- [ ] **Step 2: Создать `icons.tsx`** (порт `design-drop/components/core/icons.jsx`, типизировать имена)

Скопировать карту `PATHS` из `icons.jsx` дословно (все ~30 записей: `clock`, `flag`, `check`, `chevron-down/-right/-up`, `arrow-right/-left`, `lock`, `search`, `x`, `filter`, `play`, `pause`, `trophy`, `flame`, `graduation-cap`, `headphones`, `book-open`, `highlighter`, `pen-line`, `circle-check`, `circle-x`, `minus`, `crown`, `bar-chart`). Обернуть в типизированный компонент:

```tsx
import type { ReactNode, SVGProps } from "react";

const PATHS: Record<string, ReactNode> = {
  // … дословно из design-drop/components/core/icons.jsx (JSX-фрагменты path/circle/line) …
};

export type IconName = keyof typeof PATHS;

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
  strokeWidth?: number;
}

export function Icon({ name, size = 18, strokeWidth = 2, style, ...rest }: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true"
      style={{ display: "block", flex: "none", ...style }} {...rest}>
      {PATHS[name]}
    </svg>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: PASS (оба файла компилируются, экспорты на месте).

- [ ] **Step 4: Commit**

```bash
git add src/components/core/util.tsx src/components/core/icons.tsx
git commit -m "feat(ui): port bando interaction util + icon set (zero-dependency SVG)"
```

---

## Task 4: core/Button.tsx

**Files:**
- Create: `src/components/core/Button.tsx`

- [ ] **Step 1: Создать `Button.tsx`** (порт `design-drop/components/core/Button.jsx`, типы из `Button.d.ts`)

`'use client'` в первой строке. Перенести дословно: карту `SIZES` (sm/md/lg), функцию `variant(v)`, компонент `Button` и `Spinner`. Заменить импорты на `./util` и `./icons`. Применить типы:

```tsx
"use client";
import { useInteractive, sx, RING } from "./util";
import { Icon, type IconName } from "./icons";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "style"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  trailingIcon?: IconName;
  loading?: boolean;
  fullWidth?: boolean;
  style?: React.CSSProperties;
}

// … тело SIZES / variant() / Button() / Spinner() — дословно из Button.jsx,
//    с аннотациями типов на сигнатурах (variant(v: ButtonVariant), size: ButtonSize) …
```

Ключевая механика (сохранить 1:1): слоёный `boxShadow` = inset hairline + `0 {depth}px 0 0 var(--*-edge)`; при `pressed` — `transform: translateY({depth}px)` и `marginBottom` схлопывается; focus добавляет `RING`.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/core/Button.tsx
git commit -m "feat(ui): port bando 3D push Button"
```

---

## Task 5: core/Card.tsx

**Files:**
- Create: `src/components/core/Card.tsx`

- [ ] **Step 1: Создать `Card.tsx`** (порт `design-drop/components/core/Card.jsx`, типы из `Card.d.ts`)

```tsx
"use client";
import { useInteractive, sx } from "./util";

interface CardProps extends Omit<React.HTMLAttributes<HTMLElement>, "style"> {
  interactive?: boolean;
  padding?: string;
  as?: keyof React.JSX.IntrinsicElements;
  elevated?: boolean;
  style?: React.CSSProperties;
}

export function Card({
  children, interactive = false, padding = "var(--space-5)",
  as: Tag = "div", elevated = false, style, ...rest
}: React.PropsWithChildren<CardProps>) {
  const { hover, handlers } = useInteractive();
  return (
    <Tag
      style={sx({
        display: "block", background: "var(--surface)", border: "2px solid var(--border)",
        borderRadius: "var(--radius-lg)", padding, color: "inherit",
        boxShadow: elevated ? "var(--shadow-md)" : "var(--shadow-solid)",
        transition: "transform var(--duration-base) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard), background-color var(--duration-fast) var(--ease-standard)",
        ...(interactive ? {
          cursor: "pointer",
          borderColor: hover ? "var(--brand-border)" : "var(--border)",
          boxShadow: hover ? "var(--shadow-solid-lg)" : "var(--shadow-solid)",
          transform: hover ? "translateY(-2px)" : "none",
        } : {}),
      }, style)}
      {...(interactive ? handlers : {})}
      {...rest}
    >
      {children}
    </Tag>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/core/Card.tsx
git commit -m "feat(ui): port bando Card surface primitive"
```

---

## Task 6: marketing/FeatureGrid.tsx

**Files:**
- Create: `src/components/marketing/FeatureGrid.tsx`

- [ ] **Step 1: Создать `FeatureGrid.tsx`** (порт `design-drop/components/marketing/FeatureGrid.jsx`, типы из `FeatureGrid.d.ts`)

`'use client'`. Перенести дословно `tile(tone)`, `FeatureCard`, `FeatureGrid`. Заменить импорт на `../core/icons`. Применить типы:

```tsx
"use client";
import { useState } from "react";
import { Icon, type IconName } from "../core/icons";

export interface Feature {
  icon?: IconName;
  tone?: "brand" | "success" | "warn" | "error" | "info";
  image?: string;
  imageAlt?: string;
  title: string;
  description: string;
  href?: string;
}
interface FeatureGridProps {
  features: Feature[];
  columns?: number;
  variant?: "plain" | "tactile";
  onSelect?: (feature: Feature) => void;
  style?: React.CSSProperties;
}

// … tile() / FeatureCard({feature, variant, onSelect}) / FeatureGrid({...}) — дословно из .jsx,
//    с типами на сигнатурах; tone в tile() : Feature["tone"] …
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/marketing/FeatureGrid.tsx
git commit -m "feat(ui): port bando FeatureGrid marketing block"
```

---

## Task 7: Logo + asset (адаптация под light)

**Files:**
- Create: `public/bando-mark.svg`, `src/components/core/Logo.tsx`

- [ ] **Step 1: Положить `public/bando-mark.svg`** — нейтральные бары на `currentColor` (на светлом фоне белые исчезают)

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" role="img" aria-label="bando">
  <rect x="9" y="18" width="34" height="9" rx="4.5" fill="#8B5CF6"></rect>
  <rect x="9" y="31" width="46" height="9" rx="4.5" fill="currentColor" opacity="0.92"></rect>
  <rect x="9" y="44" width="22" height="9" rx="4.5" fill="currentColor" opacity="0.5"></rect>
</svg>
```

- [ ] **Step 2: Создать `Logo.tsx`** — встроенный SVG (чтобы `currentColor` брал цвет текста) + wordmark

```tsx
"use client";

interface LogoProps {
  size?: number;       // высота знака, px. @default 30
  showWordmark?: boolean; // @default true
  style?: React.CSSProperties;
}

export function Logo({ size = 30, showWordmark = true, style }: LogoProps) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, color: "var(--text-primary)", ...style }}>
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" role="img" aria-label="bando" style={{ display: "block", flex: "none" }}>
        <rect x="9" y="18" width="34" height="9" rx="4.5" fill="var(--brand)" />
        <rect x="9" y="31" width="46" height="9" rx="4.5" fill="currentColor" opacity="0.92" />
        <rect x="9" y="44" width="22" height="9" rx="4.5" fill="currentColor" opacity="0.5" />
      </svg>
      {showWordmark && (
        <span style={{ fontFamily: "var(--font-ui)", fontWeight: 800, fontSize: "1.25rem", letterSpacing: "var(--tracking-tight)" }}>
          band<span style={{ color: "var(--brand)" }}>o</span>
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add public/bando-mark.svg src/components/core/Logo.tsx
git commit -m "feat(ui): add bando logo (light-safe neutral bars)"
```

---

## Task 8: Переверстать лендинг `app/page.tsx`

**Files:**
- Modify (rewrite): `app/page.tsx`

Серверный компонент. Секции по `design-drop/ui_kits/nine/home.html`. Точные пиксельные значения (паддинги секций, размеры hero) сверять с `home.html`; ниже — каркас, копирайт и состав компонентов.

- [ ] **Step 1: Заголовок файла, данные FeatureGrid и pricing**

```tsx
import Link from "next/link";
import { Logo } from "@/components/core/Logo";
import { Button } from "@/components/core/Button";
import { Card } from "@/components/core/Card";
import { FeatureGrid, type Feature } from "@/components/marketing/FeatureGrid";

const IMG = "https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji@main/assets/";
const FEATURES: Feature[] = [
  { image: IMG + "Stopwatch/3D/stopwatch_3d.png",   title: "Real exam mode",     description: "Computer-delivered IELTS: timer, navigator, mark-for-review." },
  { image: IMG + "Bar%20chart/3D/bar_chart_3d.png", title: "Per-type breakdown", description: "Every question type ranked worst-first, so you fix the right thing." },
  { image: IMG + "Memo/3D/memo_3d.png",             title: "Targeted drills",    description: "Practise only the type that's costing you band." },
  { image: IMG + "Books/3D/books_3d.png",           title: "Full mock tests",    description: "Complete 40-question papers with a projected band." },
];
const TIERS: { name: string; line: string; highlight?: boolean }[] = [
  { name: "Basic",   line: "Free. A daily test limit and the core breakdown." },
  { name: "Premium", line: "Unlimited tests, full breakdown with evidence, analytics and history.", highlight: true },
  { name: "Ultra",   line: "Everything in Premium plus AI Writing/Speaking scoring (coming soon)." },
];
```

- [ ] **Step 2: Разметка — nav / hero / difference / features / pricing / footer**

```tsx
export default function Home() {
  return (
    <main style={{ minHeight: "100dvh", background: "var(--bg-base)", color: "var(--text-primary)" }}>
      {/* Nav */}
      <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between", maxWidth: 1120, margin: "0 auto", padding: "20px 24px" }}>
        <Logo />
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Link href="/auth" style={{ color: "var(--text-secondary)", fontWeight: 600, fontSize: "var(--text-sm)" }}>Log in</Link>
          <Link href="/auth"><Button>Start free</Button></Link>
        </div>
      </nav>

      {/* Hero */}
      <header style={{ maxWidth: 880, margin: "0 auto", padding: "72px 24px 56px", textAlign: "center" }}>
        <h1 style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-5xl)", fontWeight: 800, lineHeight: "var(--leading-tight)", letterSpacing: "var(--tracking-tighter)", margin: 0 }}>
          Stop guessing your <span style={{ color: "var(--brand)" }}>band.</span>
        </h1>
        <p style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-lg)", color: "var(--text-muted)", maxWidth: 560, margin: "20px auto 0", lineHeight: "var(--leading-relaxed)" }}>
          See exactly where you lose points across every IELTS Reading and Listening question type — then drill that weakness until it's gone.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 32 }}>
          <Link href="/auth"><Button size="lg" trailingIcon="arrow-right">Get your band</Button></Link>
          <Link href="#pricing"><Button size="lg" variant="secondary">See pricing</Button></Link>
        </div>
      </header>

      {/* The bando difference */}
      <section style={{ maxWidth: 720, margin: "0 auto", padding: "8px 24px 64px", textAlign: "center" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--brand)" }}>The bando difference</span>
        <h2 style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", margin: "12px 0 0" }}>
          More tests won't fix it. Knowing your type will.
        </h2>
        <p style={{ color: "var(--text-muted)", marginTop: 12, lineHeight: "var(--leading-relaxed)" }}>
          You don't have a stamina problem — you have a blind spot, and we name it.
        </p>
      </section>

      {/* How it works */}
      <section id="how" style={{ maxWidth: 980, margin: "0 auto", padding: "0 24px 72px" }}>
        <FeatureGrid features={FEATURES} columns={2} variant="tactile" />
      </section>

      {/* Pricing teaser */}
      <section id="pricing" style={{ maxWidth: 980, margin: "0 auto", padding: "0 24px 88px" }}>
        <h2 style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", textAlign: "center", margin: "0 0 28px" }}>Pricing</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
          {TIERS.map((t) => (
            <Card key={t.name} style={t.highlight ? { borderColor: "var(--brand-border)" } : undefined}>
              <div style={{ fontFamily: "var(--font-ui)", fontWeight: 800, color: "var(--brand)" }}>{t.name}</div>
              <p style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)", margin: "8px 0 0", lineHeight: "var(--leading-relaxed)" }}>{t.line}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: "1px solid var(--border-subtle)", padding: "28px 24px", textAlign: "center", color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
        <Logo size={22} /> <span style={{ marginLeft: 8 }}>· Get your band.</span>
      </footer>
    </main>
  );
}
```

(`hero-canvas` из эталона в спеке 1 опускаем — добавим отдельной задачей. Декоративных градиентов не вводим — фон плоский токен `--bg-base`.)

- [ ] **Step 2: Verify — typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: оба зелёные.

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat(landing): rebuild homepage with bando design system"
```

---

## Task 9: Финальный verify-gate

**Files:**
- Create (temp): `scripts/_verify-landing.ts`

- [ ] **Step 1: Запустить dev-сервер**

Run: `npm run dev` (фоном). Дождаться `Ready` на `http://localhost:3000`.

- [ ] **Step 2: DOM-проба лендинга**

Создать `scripts/_verify-landing.ts` — фетчит `/`, проверяет ребренд и отсутствие старого хардкода (быстрый smoke без браузера):

```ts
const res = await fetch("http://localhost:3000/");
const html = await res.text();
const checks: [string, boolean][] = [
  ["status 200", res.status === 200],
  ["wordmark bando present", /band<span[^>]*>o<\/span>|>band<|bando/i.test(html)],
  ["hero copy present", html.includes("Stop guessing your")],
  ["no legacy NINE title", !html.includes("NINE — IELTS Platform")],
  ["no hardcoded #6C5CE7", !html.includes("#6C5CE7")],
];
let ok = true;
for (const [name, pass] of checks) { console.log(`${pass ? "[OK]" : "[FAIL]"} ${name}`); ok &&= pass; }
process.exit(ok ? 0 : 1);
```

Run: `npx tsx scripts/_verify-landing.ts`
Expected: все `[OK]`, exit 0.

- [ ] **Step 3: Визуальная проверка (браузер)**

Открыть `http://localhost:3000/`: hero с violet «band.», 4 фичи-карточки (3D-иллюстрации с CDN), 3 pricing-карточки, фирменная 3D-кнопка «Get your band» вдавливается при нажатии, focus-ring виден при Tab. В DevTools: у primary-кнопки computed `box-shadow` содержит цвет `--brand-edge`; `--brand` резолвится в violet (oklch), не `#6C5CE7`. Снять скриншот.

- [ ] **Step 4: Удалить пробу**

Run: `rm scripts/_verify-landing.ts` (вне scope коммита — throwaway).

- [ ] **Step 5: Финальный gate**

Run: `npx tsc --noEmit && npm run build`
Expected: зелёные. (`npm run verify` не нужен — БД/RLS не затронуты.)

---

## Self-Review

**1. Spec coverage:**
- Токены в `app/tokens/` + entry → Task 1 ✓
- Шрифты `next/font` → Task 2 ✓; ребренд metadata → Task 2 ✓
- `util`/`icons` (zero-dep, без lucide) → Task 3 ✓
- `Button`/`Card` → Tasks 4–5 ✓; `FeatureGrid` → Task 6 ✓; `Logo` + asset → Task 7 ✓
- Лендинг (nav/hero/difference/features/pricing/footer, English, токены) → Task 8 ✓
- Verify (tsc/build/DOM-проба/визуал/скриншот) → Task 9 ✓
- Out-of-scope (прочие экраны, CDN-свап, i18n, hero-canvas, package.json name) — не запланированы намеренно ✓

**2. Placeholder scan:** Порты помечены «дословно из <файл>» — исходники в репозитории (`design-drop/`), это не «implement later», а точная инструкция копирования + перечисленные трансформации (типы, `'use client'`, импорты). Полный код дан для нового/изменённого (util, Card, Logo, layout, page, проба). ✓

**3. Type consistency:** `IconName` (Task 3) используется в `Button.icon`/`trailingIcon` (Task 4) и `Feature.icon` (Task 6). `Feature` экспортируется из `FeatureGrid.tsx` (Task 6) и импортируется в `page.tsx` (Task 8). Токены `--shadow-solid`/`--shadow-solid-lg`/`--brand-edge`/`--radius-lg` присутствуют в скопированных `elevation.css`/`radii.css`/`colors.css` (Task 1). `@/` алиас работает в Next-коде (`page.tsx`/компоненты); проба — `scripts/`, использует `fetch`, без `@/`. ✓
