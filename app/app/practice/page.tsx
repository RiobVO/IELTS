import Link from "next/link";
import { getProfile, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getHeaderData } from "@/lib/notifications/header-data";
import { getPublishedTests } from "@/lib/content/published";
import { effectiveTier, meetsTier, type Tier } from "@/lib/tiers";
import { writingFeatureEnabled, speakingFeatureEnabled } from "@/env";
import { qtypeLabel, categoryLabel, QTYPE_LABELS, CATEGORY_LABELS, READING_CATEGORIES, LISTENING_CATEGORIES } from "@/lib/labels";
import { AppShell } from "../_AppShell";
import { PracticeCatalog, type HeroData, type PracticeTest, type FilterOption, type DrillWeakest, type InitialFilter } from "./_PracticeCatalog";

export const dynamic = "force-dynamic";

/**
 * Practice (`/app/practice`) — единый каталог практики (редизайн «bando»): шапка +
 * resume/recommended-карта, ряд из 4 skill-карт (Reading/Listening — фильтры по
 * секции, Writing/Speaking — locked-панель Ultra) и инлайн фильтр + список тестов.
 *
 * Сервер грузит реальные данные (а не плейсхолдеры макета): слабейший тип из
 * per_type_breakdown, resume из живой in_progress-попытки + счёт ответов, прогресс
 * по строкам, best-band в мете скилла, tier-локи. Дальше всё интерактивное держит
 * клиентский PracticeCatalog. Read-only: ничего из grading/submit/tier-grant не трогает.
 */

type Breakdown = Record<string, { correct: number; total: number }> | null;
type Section = "reading" | "listening";
type Test = Awaited<ReturnType<typeof getPublishedTests>>[number];

interface SubmittedRow {
  per_type_breakdown: Breakdown;
  band_score: string | null;
  content_item: { section: Section } | null;
}
interface InProgressRow {
  content_item_id: string;
  answers: Record<string, unknown> | null;
  started_at: string;
  content_item: { title: string; category: string; section: Section } | null;
}

/** Тесты с очищенным runner_html идут в iframe-обёртку, legacy — в React-раннер. */
const examHref = (t: Test) => (t.has_runner ? `/app/exam/${t.id}` : `/app/reading/${t.id}`);

/** Сколько вопросов реально отвечено в attempt.answers (непустые значения). */
function countAnswers(answers: Record<string, unknown> | null): number {
  if (!answers || typeof answers !== "object") return 0;
  return Object.values(answers).filter(
    (v) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0),
  ).length;
}

/**
 * Предвыбор фильтра из query. Источников два: (1) клиент пишет своё состояние в URL
 * (types/cats — списки через запятую, sort) для share/bookmark/refresh; (2) старые
 * каталоги /app/reading|listening слали единичные q_type/category — оставлены как
 * fallback. Невалидные значения отбрасываются по каноничным enum'ам (@/lib/labels),
 * own-property check защищает от наследованных ключей (`?q_type=toString`).
 */
function buildInitialFilter(sp: {
  skill?: string;
  types?: string;
  cats?: string;
  sort?: string;
  q_type?: string;
  category?: string;
}): InitialFilter {
  const has = (m: Record<string, string>, v?: string) =>
    !!v && Object.prototype.hasOwnProperty.call(m, v);
  const parseList = (m: Record<string, string>, raw?: string): string[] =>
    (raw ?? "").split(",").map((s) => s.trim()).filter((v) => has(m, v));
  const skill: Section | null =
    sp.skill === "reading" || sp.skill === "listening" ? sp.skill : null;
  const types = parseList(QTYPE_LABELS, sp.types);
  const cats = parseList(CATEGORY_LABELS, sp.cats);
  const sort: InitialFilter["sort"] =
    sp.sort === "short" || sp.sort === "questions" ? sp.sort : "default";
  return {
    skill,
    types: types.length ? types : has(QTYPE_LABELS, sp.q_type) ? [sp.q_type!] : [],
    cats: cats.length ? cats : has(CATEGORY_LABELS, sp.category) ? [sp.category!] : [],
    sort,
  };
}

export default async function PracticePage({
  searchParams,
}: {
  searchParams: Promise<{
    skill?: string;
    types?: string;
    cats?: string;
    sort?: string;
    q_type?: string;
    category?: string;
    limit?: string;
    throttled?: string;
  }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const initialFilter = buildInitialFilter(sp);
  // Почему отбросило в практику: дневной лимит Basic (access.ts) или throttle сабмита
  // (reading/[id]/actions.ts). URL-driven, как раньше в каталоге.
  const notice = sp.limit === "1" ? "limit" : sp.throttled === "1" ? "throttled" : null;
  const supabase = await createClient();

  // Профиль (тир) / submitted-попытки (слабый тип + best band) / in_progress
  // (resume + прогресс строк) / оба published-списка — параллельно. Прогрев шапки
  // конкурентно (cache()'d, AppShell переиспользует).
  const [profile, submittedRes, inProgressRes, readingTests, listeningTests] = await Promise.all([
    getProfile(),
    supabase
      .from("attempt")
      .select("per_type_breakdown,band_score,content_item:content_item_id(section)")
      .eq("status", "submitted")
      .order("submitted_at", { ascending: false })
      .limit(50),
    supabase
      .from("attempt")
      .select("content_item_id,answers,started_at,content_item:content_item_id(title,category,section)")
      .eq("status", "in_progress")
      .order("started_at", { ascending: false }),
    getPublishedTests("reading"),
    getPublishedTests("listening"),
    getHeaderData(),
  ]);

  const userTier: Tier = profile
    ? effectiveTier(profile as { tier: Tier; premium_until: string | Date | null })
    : "basic";
  // Target band (set at onboarding, numeric → may arrive as string). Editable
  // inline on the hub via setTargetBand. null only defends the unset edge.
  const rawTarget = (profile as { target_band: string | number | null } | null)?.target_band;
  const targetBand = rawTarget != null ? Number(rawTarget) : null;
  const submitted = (submittedRes.data ?? []) as unknown as SubmittedRow[];
  const inProgress = (inProgressRes.data ?? []) as unknown as InProgressRow[];

  // Слабые типы — агрегируем per_type_breakdown, помня секцию потери очков (как на
  // дашборде/каталоге), чтобы рекомендация и drill-чип вели в правильную секцию.
  const agg: Record<string, { correct: number; total: number; rLost: number; lLost: number }> = {};
  const bestBand: Record<Section, number> = { reading: 0, listening: 0 };
  for (const a of submitted) {
    const sec: Section = a.content_item?.section ?? "reading";
    if (a.band_score != null) bestBand[sec] = Math.max(bestBand[sec], Number(a.band_score));
    const b = a.per_type_breakdown;
    if (!b) continue;
    for (const [type, v] of Object.entries(b)) {
      const cur = agg[type] ?? { correct: 0, total: 0, rLost: 0, lLost: 0 };
      cur.correct += v.correct;
      cur.total += v.total;
      const lost = v.total - v.correct;
      if (sec === "listening") cur.lLost += lost;
      else cur.rLost += lost;
      agg[type] = cur;
    }
  }
  const weak = Object.entries(agg)
    .filter(([, v]) => v.total > 0)
    .map(([type, v]) => ({ type, section: (v.lLost > v.rLost ? "listening" : "reading") as Section }))
    .sort((x, y) => {
      const ax = agg[x.type], ay = agg[y.type];
      return ax.correct / ax.total - ay.correct / ay.total;
    });

  // Объединённый каталог: reading-блок, затем listening. Секция-пилюля различает их.
  const all: { t: Test; section: Section }[] = [
    ...readingTests.map((t) => ({ t, section: "reading" as Section })),
    ...listeningTests.map((t) => ({ t, section: "listening" as Section })),
  ];
  const findById = (id: string) => all.find((x) => x.t.id === id);

  // Прогресс по строкам — из живых in_progress-попыток (answered / total).
  const answeredById = new Map<string, number>();
  for (const ip of inProgress) answeredById.set(ip.content_item_id, countAnswers(ip.answers));

  const tests: PracticeTest[] = all.map(({ t, section }) => {
    const locked = !meetsTier(userTier, t.tier_required);
    const answered = answeredById.get(t.id);
    return {
      id: t.id,
      title: t.title,
      section,
      category: t.category,
      questionTypes: t.question_types,
      questionCount: t.question_count,
      durationMin: t.duration_seconds ? Math.round(t.duration_seconds / 60) : null,
      locked,
      href: locked ? "/app/upgrade" : examHref(t),
      progress: answered != null && t.question_count > 0 ? `${answered} / ${t.question_count}` : null,
    };
  });

  // Фильтр-опции — только реально присутствующие категории/типы, с counts по всему
  // каталогу (как в прототипе макета). Категории в каноничном порядке секций.
  const catCounts: Record<string, number> = {};
  const typeCounts: Record<string, number> = {};
  for (const { t } of all) {
    catCounts[t.category] = (catCounts[t.category] ?? 0) + 1;
    for (const qt of t.question_types) typeCounts[qt] = (typeCounts[qt] ?? 0) + 1;
  }
  const catOrder = [...READING_CATEGORIES, ...LISTENING_CATEGORIES] as readonly string[];
  const filterCategories: FilterOption[] = catOrder
    .filter((c) => catCounts[c])
    .map((c) => ({ value: c, label: categoryLabel(c), count: catCounts[c] }));
  const filterTypes: FilterOption[] = Object.keys(typeCounts)
    .sort()
    .map((qt) => ({ value: qt, label: qtypeLabel(qt), count: typeCounts[qt] }));

  // Drill-weakest чип — реальный слабейший тип, под который есть тест в его секции.
  let drillWeakest: DrillWeakest = null;
  for (const w of weak) {
    const has = tests.some((t) => t.section === w.section && t.questionTypes.includes(w.type));
    if (!has) continue;
    drillWeakest = { type: w.type, label: qtypeLabel(w.type), section: w.section };
    break;
  }

  // Hero-карта (правая violet-колонка) — 3 честных состояния по приоритету:
  // resume (живая in_progress) → recommended (слабый тип) → first (новичок).
  const hero = buildHero({ inProgress, findById, tests, weak, readingTests, listeningTests, userTier });

  // Count line per skill (band now lives in the card's BAND block, not the count).
  const skillCount = (list: Test[]): string => `${list.length} ${list.length === 1 ? "test" : "tests"}`;

  // Best single-test band so far (max over R/L). Motivational proxy vs the target
  // — not an official overall band (that needs all four skills). null = no tests yet.
  const bestOverall = Math.max(bestBand.reading, bestBand.listening);

  return (
    <AppShell active="practice">
      <PracticeCatalog
        tests={tests}
        filterCategories={filterCategories}
        filterTypes={filterTypes}
        drillWeakest={drillWeakest}
        hero={hero}
        readingCount={skillCount(readingTests)}
        listeningCount={skillCount(listeningTests)}
        readingBand={bestBand.reading > 0 ? bestBand.reading : null}
        listeningBand={bestBand.listening > 0 ? bestBand.listening : null}
        targetBand={targetBand}
        bestBand={bestOverall > 0 ? bestOverall : null}
        writingEnabled={writingFeatureEnabled()}
        speakingEnabled={speakingFeatureEnabled()}
        initialFilter={initialFilter}
        notice={notice}
      />
      {/* P9 — ненавязчивая точка входа в очередь ошибок (не count-запрос: пустое
          состояние обслуживает экран сам). */}
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "0 24px 40px", textAlign: "center" }}>
        <Link
          href="/app/practice/mistakes"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            color: "var(--text-muted)",
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-sm)",
            fontWeight: 700,
            textDecoration: "none",
          }}
        >
          Review your mistakes
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </AppShell>
  );
}

/** Сборка hero-карты: resume → recommended → first. Возвращает сериализуемый объект. */
function buildHero({
  inProgress,
  findById,
  tests,
  weak,
  readingTests,
  listeningTests,
  userTier,
}: {
  inProgress: InProgressRow[];
  findById: (id: string) => { t: Test; section: Section } | undefined;
  tests: PracticeTest[];
  weak: { type: string; section: Section }[];
  readingTests: Test[];
  listeningTests: Test[];
  userTier: Tier;
}): HeroData {
  // 1) Resume — самая свежая in_progress-попытка по опубликованному тесту.
  for (const ip of inProgress) {
    const found = findById(ip.content_item_id);
    if (!found) continue;
    const row = tests.find((t) => t.id === ip.content_item_id)!;
    const total = found.t.question_count;
    const answered = countAnswers(ip.answers);
    return {
      kind: "resume",
      eyebrow: "Continue where you left off",
      title: ip.content_item?.title ?? found.t.title,
      sub: `${categoryLabel(found.t.category)} · ${answered} of ${total} answered`,
      cta: "Resume test",
      href: row.locked ? "/app/upgrade" : row.href,
      progress: total > 0 ? { answered, total } : null,
      meta: null,
    };
  }

  // 2) Recommended — слабейший тип → тест в его секции (предпочитаем доступный).
  for (const w of weak) {
    const pool = w.section === "listening" ? listeningTests : readingTests;
    const matches = pool.filter((t) => t.question_types.includes(w.type));
    if (!matches.length) continue;
    const pick = matches.find((t) => meetsTier(userTier, t.tier_required)) ?? matches[0];
    const locked = !meetsTier(userTier, pick.tier_required);
    const mins = pick.duration_seconds ? Math.round(pick.duration_seconds / 60) : null;
    return {
      kind: "recommended",
      eyebrow: "Recommended next",
      title: pick.title,
      sub: `Targets your weakest type: ${qtypeLabel(w.type)}`,
      cta: locked ? "Unlock" : "Start",
      href: locked ? "/app/upgrade" : (pick.has_runner ? `/app/exam/${pick.id}` : `/app/reading/${pick.id}`),
      progress: null,
      meta: pick.question_count > 0 ? `${pick.question_count} Q${mins ? ` · ${mins}m` : ""}` : mins ? `${mins}m` : null,
    };
  }

  // 3) First — новичок без попыток: ведём в первый доступный Reading-тест.
  const first = readingTests.find((t) => meetsTier(userTier, t.tier_required)) ?? readingTests[0];
  return {
    kind: "first",
    eyebrow: "Start here",
    title: "Take your first test",
    sub: "Take a Reading test to surface your weakest question type — then we point your practice straight at it.",
    cta: "Browse Reading",
    href: first ? (first.has_runner ? `/app/exam/${first.id}` : `/app/reading/${first.id}`) : "/app/reading",
    progress: null,
    meta: null,
  };
}
