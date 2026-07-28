import Link from "next/link";
import { getProfile, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getHeaderData } from "@/lib/notifications/header-data";
import { getPublishedTests } from "@/lib/content/published";
import { effectiveTier, meetsTier, type Tier } from "@/lib/tiers";
import { qtypeLabel, LISTENING_CATEGORIES } from "@/lib/labels";
import { AppShell } from "../_AppShell";
import { Card } from "@/components/core/Card";
import { Button } from "@/components/core/Button";
import { Badge } from "@/components/core/Badge";
import { Icon, type IconName } from "@/components/core/icons";

export const dynamic = "force-dynamic";

/**
 * Practice Hub (`/app/practice`) — продуктовый дом практики для всех 4 IELTS-skills.
 * Reading и Listening — живые входы в существующие каталоги; Writing и Speaking —
 * честные «in development» с Ultra-hook (Phase 3 AI НЕ размораживается). Сверху —
 * continuation/recommended, чтобы прямой путь в практику не ощущался лишним кликом.
 *
 * Read-only: только читает per_type_breakdown попыток + published-списки (owner-путь,
 * кэш каталога). Grading/submit/rating/tier-логику не трогает — рекомендованный тест
 * лишь уважает meetsTier (locked → /app/upgrade), как и каталог.
 */

type Breakdown = Record<string, { correct: number; total: number }> | null;
type Test = Awaited<ReturnType<typeof getPublishedTests>>[number];

interface AttemptRow {
  per_type_breakdown: Breakdown;
  content_item: { category: string } | null;
}

/** Тесты с очищенным runner_html идут в iframe-обёртку, legacy — в React-раннер. */
const examHref = (t: Test) => (t.has_runner ? `/app/exam/${t.id}` : `/app/reading/${t.id}`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const distinctTypes = (tests: Test[]) => new Set(tests.flatMap((t) => t.question_types)).size;

export default async function PracticeHub() {
  await requireUser();
  const supabase = await createClient();

  // Профиль (тир) / попытки (continuation+рекомендация) / оба published-списка —
  // параллельно. Списки кэшированы (unstable_cache), попытки строго по своему RLS.
  const [profile, attemptsRes, readingTests, listeningTests] = await Promise.all([
    getProfile(),
    supabase
      .from("attempt")
      .select("per_type_breakdown,content_item:content_item_id(category)")
      .eq("status", "submitted")
      .order("submitted_at", { ascending: false })
      .limit(20),
    getPublishedTests("reading"),
    getPublishedTests("listening"),
    // Пре-варм данных шапки конкурентно (cache()'d; AppShell reuses).
    getHeaderData(),
  ]);

  const userTier: Tier = profile
    ? effectiveTier(profile as { tier: Tier; premium_until: string | Date | null })
    : "basic";
  const attempts = (attemptsRes.data ?? []) as unknown as AttemptRow[];
  const hasAttempts = attempts.length > 0;

  // Слабые типы — агрегируем per_type_breakdown по всем попыткам, помня, в какой
  // секции теряются очки (как на дашборде), чтобы рекомендация вела в правильный
  // каталог. listening-only типы (map_labelling) в reading-пуле пусты.
  const listeningCats = new Set<string>(LISTENING_CATEGORIES);
  const agg: Record<string, { correct: number; total: number; rLost: number; lLost: number }> = {};
  for (const a of attempts) {
    const b = a.per_type_breakdown;
    if (!b) continue;
    const listening = listeningCats.has(a.content_item?.category ?? "");
    for (const [type, v] of Object.entries(b)) {
      const cur = agg[type] ?? { correct: 0, total: 0, rLost: 0, lLost: 0 };
      cur.correct += v.correct;
      cur.total += v.total;
      const lost = v.total - v.correct;
      if (listening) cur.lLost += lost;
      else cur.rLost += lost;
      agg[type] = cur;
    }
  }
  const weak = Object.entries(agg)
    .filter(([, v]) => v.total > 0)
    .map(([type, v]) => ({
      type,
      correct: v.correct,
      total: v.total,
      section: (v.lLost > v.rLost ? "listening" : "reading") as "reading" | "listening",
    }))
    .sort((x, y) => x.correct / x.total - y.correct / y.total);

  // Рекомендованный тест — первый слабый тип, под который есть тест в его секции
  // (предпочитаем доступный по тиру). Никаких выдуманных рекомендаций без данных.
  let rec: { test: Test; type: string } | null = null;
  for (const w of weak) {
    const pool = w.section === "listening" ? listeningTests : readingTests;
    const matches = pool.filter((t) => t.question_types.includes(w.type));
    if (!matches.length) continue;
    rec = { test: matches.find((t) => meetsTier(userTier, t.tier_required)) ?? matches[0], type: w.type };
    break;
  }

  // Секция последней попытки — fallback-continuation, когда чёткой слабости нет.
  const lastSection: "reading" | "listening" = hasAttempts
    ? listeningCats.has(attempts[0].content_item?.category ?? "")
      ? "listening"
      : "reading"
    : "reading";

  // Континуация-герой: 3 честных состояния (рекомендация → возврат → первый тест).
  let hero: { icon: IconName; eyebrow: string; title: string; sub: React.ReactNode; cta: string; href: string; meta?: string };
  if (rec) {
    const locked = !meetsTier(userTier, rec.test.tier_required);
    const mins = rec.test.duration_seconds ? Math.round(rec.test.duration_seconds / 60) : null;
    hero = {
      icon: "target",
      eyebrow: "Recommended next",
      title: rec.test.title,
      sub: (
        <>
          Targets your weakest type:{" "}
          <strong style={{ fontWeight: 800 }}>{qtypeLabel(rec.type)}</strong>
        </>
      ),
      cta: locked ? "Unlock" : "Start",
      href: locked ? "/app/upgrade" : examHref(rec.test),
      meta:
        rec.test.question_count > 0
          ? `${rec.test.question_count} Q${mins ? ` · ${mins}m` : ""}`
          : mins
            ? `${mins}m`
            : undefined,
    };
  } else if (hasAttempts) {
    hero = {
      icon: "flame",
      eyebrow: "Keep going",
      title: `Jump back into ${cap(lastSection)}`,
      sub: "Pick up where you left off and keep your streak alive.",
      cta: `Open ${cap(lastSection)}`,
      href: `/app/${lastSection}`,
    };
  } else {
    hero = {
      icon: "play",
      eyebrow: "Start here",
      title: "Sit your first test",
      sub: "Take a Reading or Listening test to surface your weakest question type — then we point your practice straight at it.",
      cta: "Browse Reading",
      href: "/app/reading",
    };
  }

  const skills: SkillProps[] = [
    {
      id: "reading",
      name: "Reading",
      icon: "book-open",
      live: true,
      href: "/app/reading",
      blurb: "Skim, scan and pin the exact answer — across every IELTS question type.",
      meta: skillMeta(readingTests),
    },
    {
      id: "listening",
      name: "Listening",
      icon: "headphones",
      live: true,
      href: "/app/listening",
      blurb: "Catch detail, spelling and signposting in real exam audio, part by part.",
      meta: skillMeta(listeningTests),
    },
    {
      id: "writing",
      name: "Writing",
      icon: "pen-line",
      live: false,
      blurb: "Structured feedback on all four marking criteria — Task Achievement, Coherence, Lexical Resource and Grammar.",
      hook: "AI + human review, in development. Ultra members get access first.",
    },
    {
      id: "speaking",
      name: "Speaking",
      icon: "users",
      live: false,
      blurb: "Rehearse Parts 1–3 and get scored on Fluency, Lexical Resource, Grammar and Pronunciation.",
      hook: "AI + human review, in development. Ultra members get access first.",
    },
  ];

  return (
    <AppShell active="practice">
      <style>{PRACTICE_CSS}</style>
      <div className="ph-wrap" style={S.wrap}>
        <header style={S.head}>
          <div style={S.eyebrow}>
            <Icon name="dumbbell" size={14} strokeWidth={2.6} /> Practice
          </div>
          <h1 className="ph-h1" style={S.h1}>Build the band you need</h1>
          <p style={S.sub}>Four IELTS skills, one place. Practice and review free — pick a skill or jump straight back in.</p>
        </header>

        <ContinueHero {...hero} />

        <div style={S.sectionLabel}>Choose a skill</div>
        <div className="ph-grid" style={S.grid}>
          {skills.map((sk) => (
            <SkillCard key={sk.id} {...sk} />
          ))}
        </div>
      </div>
    </AppShell>
  );
}

/** «N tests · M question types» — честная сводка живой skill из published-списка. */
function skillMeta(tests: Test[]): string {
  const n = tests.length;
  const t = distinctTypes(tests);
  const base = `${n} ${n === 1 ? "test" : "tests"}`;
  return t > 0 ? `${base} · ${t} question ${t === 1 ? "type" : "types"}` : base;
}

/* Континуация-герой — фирменный violet-градиент (как RecommendedBanner каталога).
   Прямой CTA в конкретный тест/каталог: главный «no extra click»-винт хаба. */
function ContinueHero({
  icon,
  eyebrow,
  title,
  sub,
  cta,
  href,
  meta,
}: {
  icon: IconName;
  eyebrow: string;
  title: string;
  sub: React.ReactNode;
  cta: string;
  href: string;
  meta?: string;
}) {
  return (
    <div className="ph-hero" style={S.hero}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={S.heroEyebrow}>
          <Icon name={icon} size={14} strokeWidth={2.6} /> {eyebrow}
        </div>
        <div style={S.heroTitle}>{title}</div>
        <div style={S.heroText}>{sub}</div>
      </div>
      <div style={S.heroSide}>
        {meta && <div style={S.heroMeta}>{meta}</div>}
        <Button variant="secondary" trailingIcon="arrow-right" href={href} style={{ color: "var(--brand-active)", marginTop: meta ? 10 : 0 }}>
          {cta}
        </Button>
      </div>
    </div>
  );
}

interface SkillProps {
  id: string;
  name: string;
  icon: IconName;
  live: boolean;
  href?: string;
  blurb: string;
  meta?: string;
  hook?: string;
}

/* Skill-карта. Live (Reading/Listening) — вся карта кликабельна в каталог, решительный
   Start. Coming (Writing/Speaking) — НЕ серый плейсхолдер: brand-иконка, «Coming soon»,
   ценность + Ultra-hook CTA. Обе держат одну высоту в сетке. */
function SkillCard(sk: SkillProps) {
  if (sk.live && sk.href) {
    return (
      <Link href={sk.href} style={{ textDecoration: "none", color: "inherit", height: "100%" }}>
        <Card interactive padding="22px 22px" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <div style={S.skillTop}>
            <span style={S.skillIcon}>
              <Icon name={sk.icon} size={22} strokeWidth={2.3} />
            </span>
            <Badge tone="success">Live</Badge>
          </div>
          <div style={S.skillName}>{sk.name}</div>
          <p style={S.skillBlurb}>{sk.blurb}</p>
          {sk.meta && <div style={S.skillMeta}>{sk.meta}</div>}
          <div style={S.skillFoot}>
            <span style={S.skillStart}>
              Start <Icon name="arrow-right" size={16} strokeWidth={2.6} />
            </span>
          </div>
        </Card>
      </Link>
    );
  }

  // Coming — аспирационная карта будущего направления (Ultra-hook, не disabled).
  return (
    <Card padding="22px 22px" style={{ ...S.skillComing, display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={S.skillTop}>
        <span style={{ ...S.skillIcon, ...S.skillIconComing }}>
          <Icon name={sk.icon} size={22} strokeWidth={2.3} />
        </span>
        <Badge tone="brand">Coming soon</Badge>
      </div>
      <div style={S.skillName}>{sk.name}</div>
      <p style={S.skillBlurb}>{sk.blurb}</p>
      {sk.hook && (
        <div style={S.hook}>
          <Icon name="sparkles" size={14} strokeWidth={2.4} style={{ color: "var(--brand)", flex: "none", marginTop: 2 }} />
          <span>{sk.hook}</span>
        </div>
      )}
      <div style={S.skillFoot}>
        <Button variant="secondary" size="sm" trailingIcon="arrow-right" href="/app/upgrade" style={{ color: "var(--brand-active)" }}>
          Explore Ultra
        </Button>
      </div>
    </Card>
  );
}

// Адаптив хаба. База = мобильный (1 колонка, hero-стек); ≥640px = десктоп
// (2-up grid, hero в ряд). Переключаемое — в классах, не inline (иначе inline
// перебьёт media-query). DOM-порядок = визуальный → без order/display:contents.
const PRACTICE_CSS = `
.ph-wrap{padding:24px 16px 44px}
.ph-h1{font-size:34px}
.ph-hero{display:flex;flex-direction:column;align-items:flex-start;gap:16px}
.ph-grid{display:grid;grid-template-columns:1fr;gap:16px}
@media (min-width:640px){
  .ph-wrap{padding:var(--space-8) var(--space-6) var(--space-12)}
  .ph-h1{font-size:46px}
  .ph-hero{flex-direction:row;align-items:center;gap:26px}
  .ph-grid{grid-template-columns:1fr 1fr}
}
`;

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 980, margin: "0 auto" },
  head: { marginBottom: 20 },
  eyebrow: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-xs)",
    fontWeight: 800,
    letterSpacing: "var(--tracking-caps)",
    textTransform: "uppercase",
    color: "var(--brand)",
    marginBottom: 10,
  },
  // fontSize → .ph-h1 (адаптив 34→46px), задаёт display-ритм страницы.
  h1: { fontFamily: "var(--font-ui)", fontWeight: 800, lineHeight: 1.04, letterSpacing: "-0.03em", margin: "0 0 8px", color: "var(--text-primary)", textWrap: "balance" },
  sub: { fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", color: "var(--text-secondary)", margin: 0, maxWidth: "54ch", lineHeight: 1.5 },

  // Hero — иерархия на весе/размере, весь ink solid (#fff) для WCAG AA на violet.
  hero: {
    position: "relative",
    overflow: "hidden",
    borderRadius: "var(--radius-xl)",
    background: "linear-gradient(150deg, var(--brand), var(--brand-active))",
    color: "var(--surface-premium-ink)",
    padding: "26px 28px",
    margin: "0 0 26px",
    boxShadow: "var(--shadow-md)",
  },
  heroEyebrow: { display: "inline-flex", alignItems: "center", gap: 7, fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--surface-premium-ink)", fontWeight: 800, letterSpacing: "var(--tracking-wide)" },
  heroTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", margin: "10px 0 6px", color: "var(--surface-premium-ink)", textWrap: "balance" },
  heroText: { fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", fontWeight: 600, lineHeight: 1.45, color: "var(--surface-premium-ink)", maxWidth: "48ch" },
  heroSide: { flex: "none", textAlign: "center" },
  heroMeta: { fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--surface-premium-ink)" },

  sectionLabel: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 800, letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--text-muted)", margin: "0 0 14px" },
  grid: { alignItems: "stretch" },

  /* Skill card */
  skillTop: { display: "flex", alignItems: "center", gap: 10, marginBottom: 16 },
  skillIcon: { width: 46, height: 46, flex: "none", borderRadius: 14, display: "grid", placeItems: "center", background: "var(--brand-subtle)", color: "var(--brand)" },
  skillName: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xl)", fontWeight: 800, color: "var(--text-primary)", letterSpacing: "var(--tracking-tight)" },
  skillBlurb: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.55, margin: "8px 0 0" },
  skillMeta: { fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-muted)", marginTop: 14 },
  skillFoot: { marginTop: "auto", paddingTop: 18, display: "flex", alignItems: "center" },
  skillStart: { display: "inline-flex", alignItems: "center", gap: 7, color: "var(--text-link)", fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", fontWeight: 800, letterSpacing: "var(--tracking-snug)" },

  // Coming-карта: тёплый brand-тинт-фон вместо серого — направление, не заглушка.
  skillComing: { background: "linear-gradient(165deg, var(--brand-subtle), var(--surface) 70%)", borderColor: "var(--brand-border)" },
  skillIconComing: { background: "var(--surface)", color: "var(--brand)", border: "1px solid var(--brand-border)" },
  hook: { display: "flex", alignItems: "flex-start", gap: 8, marginTop: 14, fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-link)", lineHeight: 1.5 },
};
