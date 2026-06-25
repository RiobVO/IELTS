import { getProfile, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getHeaderData } from "@/lib/notifications/header-data";
import { getPublishedTests } from "@/lib/content/published";
import { effectiveTier, meetsTier, type Tier } from "@/lib/tiers";
import { qtypeLabel, categoryLabel, READING_CATEGORIES, LISTENING_CATEGORIES } from "@/lib/labels";
import { AppShell } from "../_AppShell";
import { PracticeCatalog, type HeroData, type PracticeTest, type FilterOption, type DrillWeakest } from "./_PracticeCatalog";

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

export default async function PracticePage() {
  await requireUser();
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

  const skillMeta = (section: Section, list: Test[]): string => {
    const n = list.length;
    const base = `${n} ${n === 1 ? "test" : "tests"}`;
    return bestBand[section] > 0 ? `${base} · best ${bestBand[section]}` : base;
  };

  return (
    <AppShell active="practice">
      <PracticeCatalog
        tests={tests}
        filterCategories={filterCategories}
        filterTypes={filterTypes}
        drillWeakest={drillWeakest}
        hero={hero}
        readingMeta={skillMeta("reading", readingTests)}
        listeningMeta={skillMeta("listening", listeningTests)}
      />
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
    title: "Sit your first test",
    sub: "Take a Reading test to surface your weakest question type — then we point your practice straight at it.",
    cta: "Browse Reading",
    href: first ? (first.has_runner ? `/app/exam/${first.id}` : `/app/reading/${first.id}`) : "/app/reading",
    progress: null,
    meta: null,
  };
}
