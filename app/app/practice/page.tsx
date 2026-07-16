import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { getProfile, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { attempt as attemptTable, contentItem } from "@/db/schema";
import { FULL_CATEGORIES, isFullCategory, trialConsumedBy, type TrialAttemptRow } from "@/lib/exam/trial";
import { getHeaderData } from "@/lib/notifications/header-data";
import { getPublishedTests } from "@/lib/content/published";
import { effectiveTier, meetsTier, type Tier } from "@/lib/tiers";
import { writingFeatureEnabled, speakingFeatureEnabled } from "@/env";
import { qtypeLabel, categoryLabel, QTYPE_LABELS, CATEGORY_LABELS, READING_CATEGORIES, LISTENING_CATEGORIES } from "@/lib/labels";
import { aggregateWeakness, type PerTypeBreakdown, type WeaknessRow } from "@/lib/practice/weakness";
import { computeSectionProgress } from "@/lib/practice/section-progress";
import { Icon } from "@/components/core/icons";
import { Badge } from "@/components/core/Badge";
import { AppShell } from "../_AppShell";
import { PracticeCatalog, type HeroData, type PracticeTest, type FilterOption, type DrillWeakest, type InitialFilter } from "./_PracticeCatalog";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Practice | bando" };

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
  const user = await requireUser();
  const sp = await searchParams;
  const initialFilter = buildInitialFilter(sp);
  // Почему отбросило в практику: дневной лимит Basic (access.ts) или throttle сабмита
  // (reading/[id]/actions.ts). URL-driven, как раньше в каталоге.
  const notice = sp.limit === "1" ? "limit" : sp.throttled === "1" ? "throttled" : null;
  const supabase = await createClient();

  // Профиль (тир) / submitted-попытки (weak-spots + слабый тип + best band + best
  // raw score) / in_progress (resume + прогресс строк) / оба published-списка /
  // trial-лейн / lifetime attempted-ids — параллельно, одной волной. Прогрев шапки
  // конкурентно (cache()'d, AppShell переиспользует).
  const [profile, submittedRows, inProgressRes, readingTests, listeningTests, trialRows, attemptedRows] =
    await Promise.all([
      getProfile(),
      // Единое owner-чтение submitted-попыток (Drizzle обходит RLS — скоуп по user.id
      // ставим сами, как в mistakes.ts/дашборде). Раньше было ДВА пересекающихся
      // запроса: Supabase (50, hero/drill/bestBand) + Drizzle (300, weak-spots).
      // Теперь одно чтение: первые 50 строк (slice ниже) сохраняют старое окно
      // hero/drill, все 300 кормят weak-spots статистику за историю.
      db
        .select({
          contentItemId: attemptTable.contentItemId,
          perTypeBreakdown: attemptTable.perTypeBreakdown,
          bandScore: attemptTable.bandScore,
          rawScore: attemptTable.rawScore,
          section: contentItem.section,
        })
        .from(attemptTable)
        .innerJoin(contentItem, eq(contentItem.id, attemptTable.contentItemId))
        .where(and(eq(attemptTable.userId, user.id), eq(attemptTable.status, "submitted")))
        .orderBy(desc(attemptTable.submittedAt))
        .limit(300),
      supabase
        .from("attempt")
        .select("content_item_id,answers,started_at,content_item:content_item_id(title,category,section)")
        .eq("status", "in_progress")
        .order("started_at", { ascending: false })
        // Страховка от неограниченного чтения answers-jsonb: живых in_progress больше
        // сотни не бывает (по одной на тест), но unbounded-скан здесь ни к чему.
        .limit(100),
      getPublishedTests("reading"),
      getPublishedTests("listening"),
      // Trial-лейн (§4.8): (content_item_id, status) попыток на полных gated-тестах.
      // Раньше шёл серийным хопом ПОСЛЕ батча (ждал userTier), теперь в общей волне —
      // запрос дешёвый, для non-basic результат просто отбрасывается ниже.
      db
        .selectDistinct({ id: attemptTable.contentItemId, status: attemptTable.status })
        .from(attemptTable)
        .innerJoin(contentItem, eq(contentItem.id, attemptTable.contentItemId))
        .where(
          and(
            eq(attemptTable.userId, user.id),
            ne(contentItem.tierRequired, "basic"),
            inArray(contentItem.category, [...FULL_CATEGORIES]),
          ),
        ),
      // Lifetime attempted content_item_id (для секционного счётчика "Done N of M" —
      // НЕ bestRawById: тот зависит от submitted-окна (300 строк выше → slice(0,50)
      // под hero/bestBand) и несёт best raw_score для дисплея на карточке ("Done ·
      // X/Y", осознанно оконный best-score показ). Счётчик — lifetime-факт «тест
      // пройден хоть раз», окно исказило бы его: старый тест, вытесненный полусотней
      // более свежих попыток по другим тестам, ложно вернулся бы в "left". distinct
      // растёт с размером каталога (десятки id), не с числом попыток — дёшево.
      db
        .selectDistinct({ contentItemId: attemptTable.contentItemId })
        .from(attemptTable)
        .where(and(eq(attemptTable.userId, user.id), eq(attemptTable.status, "submitted"))),
      getHeaderData(),
    ]);

  const userTier: Tier = profile
    ? effectiveTier(profile as { tier: Tier; premium_until: string | Date | null })
    : "basic";
  // Target band (set at onboarding, numeric → may arrive as string). Editable
  // inline on the hub via setTargetBand. null only defends the unset edge.
  const rawTarget = (profile as { target_band: string | number | null } | null)?.target_band;
  const targetBand = rawTarget != null ? Number(rawTarget) : null;
  const inProgress = (inProgressRes.data ?? []) as unknown as InProgressRow[];
  // Hero/drill/bestBand считаются по старому 50-окну недавних попыток: набор
  // отсортирован desc, slice эквивалентен прежнему limit(50) отдельного запроса.
  const submitted = submittedRows.slice(0, 50);

  // Trial-лейн (§4.8): Basic получает ОДИН бесплатный полный gated-тест; правило
  // расхода per-card считает trialConsumedBy (единый источник с hasConsumedTrial).
  // Premium/ultra проходят обычным tier-гейтом — им набор не нужен, отбрасываем.
  const trialAttempts: TrialAttemptRow[] =
    userTier === "basic" ? trialRows.map((r) => ({ contentItemId: r.id, status: r.status })) : [];

  // Weak-spots виджет (P-OwnC) — 3–5 слабейших типов по всей истории (300-окно) с
  // min-порогом надёжности (total >= 4, дефолт aggregateWeakness). Ниже порога /
  // нет попыток → пустой массив, виджет не рендерится (не пустая коробка).
  const weakSpots: WeaknessRow[] = aggregateWeakness(
    submittedRows.map((r) => r.perTypeBreakdown as PerTypeBreakdown),
  );
  // Тот же (reliability-filtered) набор типов даёт бейдж «weak spot» на карточке
  // каталога — переиспользуем weakSpots, не считаем заново (шире `weak` ниже,
  // который без порога надёжности годится только для hero/drill).
  const weakTypeSet = new Set(weakSpots.map((w) => w.qtype));

  // Слабые типы — агрегируем per_type_breakdown, помня секцию потери очков (как на
  // дашборде/каталоге), чтобы рекомендация и drill-чип вели в правильную секцию.
  const agg: Record<string, { correct: number; total: number; rLost: number; lLost: number }> = {};
  const bestBand: Record<Section, number> = { reading: 0, listening: 0 };
  // Лучший raw_score по тесту (для карточки «Done · X/Y») — тот же submitted-набор.
  const bestRawById = new Map<string, number>();
  for (const a of submitted) {
    const sec: Section = a.section;
    if (a.bandScore != null) bestBand[sec] = Math.max(bestBand[sec], Number(a.bandScore));
    if (a.rawScore != null) {
      bestRawById.set(a.contentItemId, Math.max(bestRawById.get(a.contentItemId) ?? 0, a.rawScore));
    }
    const b = a.perTypeBreakdown as Breakdown;
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

  // Бейдж «New» (F15) — свежесть считаем здесь, вне unstable_cache-обёртки
  // getPublishedTests (created_at там только сырое поле, кэш тегирован content_item
  // и живёт до publish/revalidate — «now» внутри него протухал бы).
  const NEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
  const newCutoff = Date.now() - NEW_WINDOW_MS;

  const tests: PracticeTest[] = all.map(({ t, section }) => {
    const gated = !meetsTier(userTier, t.tier_required);
    // Trial-лейн (§4.8): Basic видит ОДИН полный gated-тест как бесплатный. Карта
    // кликабельна, только если единственные попытки юзера на ней — in_progress (свой
    // недосданный trial); submitted этого item или попытка на другом full → 🔒/upgrade.
    const trialEligible =
      gated &&
      userTier === "basic" &&
      isFullCategory(t.category) &&
      !trialConsumedBy(trialAttempts, t.id);
    const locked = gated && !trialEligible;
    const answered = answeredById.get(t.id);
    const bestRaw = bestRawById.get(t.id);
    return {
      id: t.id,
      title: t.title,
      section,
      category: t.category,
      questionTypes: t.question_types,
      questionCount: t.question_count,
      durationMin: t.duration_seconds ? Math.round(t.duration_seconds / 60) : null,
      locked,
      trial: trialEligible,
      href: locked ? "/app/upgrade" : examHref(t),
      progress: answered != null && t.question_count > 0 ? `Resume · ${answered} / ${t.question_count}` : null,
      done: bestRaw != null && t.question_count > 0 ? `Done · ${bestRaw} / ${t.question_count}` : null,
      isWeakType: t.question_types.some((qt) => weakTypeSet.has(qt)),
      // created_at — ISO-строка (сериализована в getPublishedTests под кэш), не Date.
      isNew: Date.parse(t.created_at) > newCutoff,
    };
  });

  // Section progress ("Done N of M · K left" на skill-картах) — startable ЗДЕСЬ то
  // же самое, что рисует Start/Unlock ниже (t.locked уже посчитан выше с trial-лейн).
  // attempted — из lifetime attemptedRows (см. Promise.all выше), НЕ из bestRawById
  // (то оконное, best-score display).
  const attemptedIds = new Set(attemptedRows.map((r) => r.contentItemId));
  const readingProgress = computeSectionProgress(
    tests.filter((t) => t.section === "reading").map((t) => ({ id: t.id, startable: !t.locked })),
    attemptedIds,
  );
  const listeningProgress = computeSectionProgress(
    tests.filter((t) => t.section === "listening").map((t) => ({ id: t.id, startable: !t.locked })),
    attemptedIds,
  );

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

  // Empty-catalog funnel CTA (BRIEF §12.3 content-wipe) — server-only env, never
  // NEXT_PUBLIC_*. Absent/blank => prop is null, PracticeCatalog skips the CTA.
  const telegramChannelUrlRaw = process.env.TELEGRAM_CHANNEL_URL?.trim();
  const telegramChannelUrl = telegramChannelUrlRaw ? telegramChannelUrlRaw : null;

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
        readingProgress={readingProgress}
        listeningProgress={listeningProgress}
        readingBand={bestBand.reading > 0 ? bestBand.reading : null}
        listeningBand={bestBand.listening > 0 ? bestBand.listening : null}
        targetBand={targetBand}
        bestBand={bestOverall > 0 ? bestOverall : null}
        writingEnabled={writingFeatureEnabled()}
        speakingEnabled={speakingFeatureEnabled()}
        initialFilter={initialFilter}
        notice={notice}
        telegramChannelUrl={telegramChannelUrl}
      />
      {/* Weak spots (OwnC) — над ссылкой mistakes: чипы слабейших типов, тап ведёт
          в существующий фильтр каталога (?q_type=). Нет данных выше порога → секция
          отсутствует целиком (не пустая коробка). Free для всех тиров. */}
      {weakSpots.length > 0 && (
        <div style={{ maxWidth: 1120, margin: "0 auto", padding: "0 24px 24px" }}>
          <WeakSpotsWidget rows={weakSpots} />
        </div>
      )}
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
    // Переиспользуем уже посчитанные locked/href из tests (учитывают trial-лейн),
    // а не считаем tier-гейт заново — иначе hero звал бы на upgrade для доступного
    // по trial теста. Fallback на прямой расчёт защищает от отсутствия строки.
    const row = tests.find((t) => t.id === pick.id);
    const locked = row ? row.locked : !meetsTier(userTier, pick.tier_required);
    const mins = pick.duration_seconds ? Math.round(pick.duration_seconds / 60) : null;
    return {
      kind: "recommended",
      eyebrow: "Recommended next",
      title: pick.title,
      sub: `Targets your weakest type: ${qtypeLabel(w.type)}`,
      cta: locked ? "Unlock" : "Start",
      href: row ? row.href : (pick.has_runner ? `/app/exam/${pick.id}` : `/app/reading/${pick.id}`),
      progress: null,
      meta: pick.question_count > 0 ? `${pick.question_count} Q${mins ? ` · ${mins}m` : ""}` : mins ? `${mins}m` : null,
    };
  }

  // 3) First — новичок без попыток: ведём в первый доступный Reading-тест.
  const first = readingTests.find((t) => meetsTier(userTier, t.tier_required)) ?? readingTests[0];
  if (!first) {
    // Каталог пуст (контент-вайп, §12.3) — раньше CTA слал на /app/reading, который
    // сам редиректит обратно на /app/practice (петля). Ведём на живую фичу вместо тупика.
    return {
      kind: "first",
      eyebrow: "Library refreshing",
      title: "New tests are on the way",
      sub: "The Reading and Listening library is being refreshed — meanwhile, keep building your vocabulary.",
      cta: "Practice vocabulary",
      href: "/app/vocabulary",
      progress: null,
      meta: null,
    };
  }
  return {
    kind: "first",
    eyebrow: "Start here",
    title: "Take your first test",
    sub: "Take a Reading test to surface your weakest question type — then we point your practice straight at it.",
    cta: "Browse Reading",
    href: first.has_runner ? `/app/exam/${first.id}` : `/app/reading/${first.id}`,
    progress: null,
    meta: null,
  };
}

/**
 * Weak spots — компактный ряд чипов, слабейшие типы первыми. Тап открывает тот же
 * каталог с предвыбранным фильтром типа (buildInitialFilter читает ?q_type). Цвет
 * чипа — по надёжности, не по алармизму: <50% warn (жёлто-золотой), 50%+ нейтрально.
 */
function WeakSpotsWidget({ rows }: { rows: WeaknessRow[] }) {
  return (
    <div style={WS.card}>
      <div style={WS.header}>
        <Icon name="bar-chart" size={15} strokeWidth={2.4} style={{ color: "var(--text-muted)" }} />
        <span style={WS.title}>Weak spots</span>
      </div>
      <div style={WS.chips}>
        {rows.map((row) => (
          <Link
            key={row.qtype}
            href={`/app/practice?q_type=${encodeURIComponent(row.qtype)}`}
            style={WS.chip}
          >
            <span style={WS.chipLabel}>{qtypeLabel(row.qtype)}</span>
            <Badge tone={row.pct < 50 ? "warn" : "neutral"} mono>{row.pct}%</Badge>
          </Link>
        ))}
      </div>
    </div>
  );
}

const WS: Record<string, React.CSSProperties> = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-lg)",
    background: "var(--surface-raised)",
    padding: "16px 18px",
  },
  header: { display: "flex", alignItems: "center", gap: 7, marginBottom: 12 },
  title: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-sm)",
    fontWeight: 700,
    color: "var(--text-primary)",
  },
  chips: { display: "flex", flexWrap: "wrap", gap: 10 },
  chipLabel: { whiteSpace: "nowrap" },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    padding: "0 14px",
    borderRadius: "var(--radius-full)",
    border: "1px solid var(--border)",
    background: "var(--surface-inset, transparent)",
    color: "var(--text-primary)",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-sm)",
    fontWeight: 700,
    textDecoration: "none",
  },
};
