/**
 * Today's plan (BRIEF §12, W2-?) — дневной чек-лист дашборда. computeDailyPlan —
 * ЧИСТОЕ ядро (без `now`/IO, как computeBandPlan в band-plan.ts): всё время-
 * зависимое (день недели, done-флаги, доступность каталога) редуцировано вызывающей
 * стороной (app/app/page.tsx) в скаляры ДО вызова, чтобы список пунктов был
 * детерминирован и тестируем без мока часов.
 *
 * Owner-путь загрузчики (getMistakesDueSummary/getCatalogAvailability) живут в этом
 * же файле — оба тонкие однострочные агрегаты под конкретно эту карточку, отдельный
 * модуль под них не нужен.
 */
import "server-only";
import { unstable_cache } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { contentItem, mistakeReview, profile } from "@/db/schema";
import type { BandPlanDrill, BandPlanWeakType } from "@/lib/progress/band-plan";

export type DailyPlanIntensity = "generic" | "base" | "ramp" | "final";
export type DailyPlanItemKind = "mistakes" | "vocab" | "drill" | "drill2" | "mock";

// Нормы плана (решение владельца 2026-07-16): 2 практики в день, 2 полных мока
// в неделю. Пункт закрывается по достижении нормы, прогресс виден парой N/M.
export const DAILY_DRILL_TARGET = 2;
export const WEEKLY_MOCK_TARGET = 2;

export interface DailyPlanInput {
  /** Дни до экзамена (уже посчитано getExamCountdown); null — дата не задана. */
  daysUntilExam: number | null;
  drill: BandPlanDrill | null;
  /** Второй по слабости тип (bandPlan.weakTypes[1]) — доп. дрилл в финальном режиме. */
  secondDrill: BandPlanWeakType | null;
  mistakes: { due: number; reviewedToday: number };
  vocab: { dueToday: number; reviewedToday: number; goal: number };
  /** Сданных попыток сегодня (любых) — прогресс дневной нормы практики. */
  drillsToday: number;
  /** Сданных full-моков в текущей неделе — прогресс недельной нормы мока. */
  mocksThisWeek: number;
  hasAttempts: boolean;
  catalog: {
    hasPublishedTests: boolean;
    /** Категория доступного full-mock (приоритет reading) — href строится по ней;
     *  null = full-моков в каталоге нет, mock-пункт выпадает. */
    fullMockCategory: "full_reading" | "full_listening" | null;
  };
}

export interface DailyPlanItem {
  id: DailyPlanItemKind;
  kind: DailyPlanItemKind;
  label: string;
  sublabel: string | null;
  href: string;
  target: number | null;
  progress: number | null;
  done: boolean;
}

export interface DailyPlan {
  items: DailyPlanItem[];
  intensity: DailyPlanIntensity;
  daysUntilExam: number | null;
  examDateSet: boolean;
  examPassed: boolean;
  doneCount: number;
  totalCount: number;
  allDone: boolean;
}

/** Режим по дням до экзамена: null/просрочено → generic, дальше по возрастающей срочности. */
function intensityFor(daysUntilExam: number | null): DailyPlanIntensity {
  if (daysUntilExam == null || daysUntilExam < 0) return "generic";
  if (daysUntilExam > 28) return "base";
  if (daysUntilExam >= 8) return "ramp";
  return "final"; // 0..7
}

/**
 * Чистая сборка чек-листа. Порядок пунктов ФИКСИРОВАН (mistakes → vocab → drill →
 * drill2 → mock) независимо от done — done меняет только визуальный вес на стороне
 * рендера (WCAG 2.4.3: клавиатурный/визуальный порядок не пляшет от состояния).
 */
export function computeDailyPlan(input: DailyPlanInput): DailyPlan {
  const { daysUntilExam, drill, secondDrill, mistakes, vocab, drillsToday, mocksThisWeek, hasAttempts, catalog } = input;
  const drillDone = drillsToday >= DAILY_DRILL_TARGET;

  const examDateSet = daysUntilExam != null;
  const examPassed = daysUntilExam != null && daysUntilExam < 0;
  const intensity = intensityFor(daysUntilExam);
  const includeMock = intensity === "ramp" || intensity === "final";
  const includeDrill2 = intensity === "final" && secondDrill != null;

  const items: DailyPlanItem[] = [];

  // Ошибки к повтору — прячем целиком, если ошибок в принципе не может быть (нет
  // ни одной сданной попытки), а не показываем «Review your mistakes» в пустоту.
  if (hasAttempts) {
    items.push({
      id: "mistakes",
      kind: "mistakes",
      // "+" обязателен: due — нижняя граница (count, не полный getOpenMistakes-скан).
      label: mistakes.due > 0 ? `Review ${mistakes.due}+ due mistakes` : "Review your mistakes",
      sublabel: null,
      href: "/app/practice/mistakes",
      target: null,
      progress: null,
      done: mistakes.due === 0,
    });
  }

  // Vocabulary всегда в плане — даже пустой вход даёт минимум этот пункт. sublabel —
  // сколько слов due осталось сегодня (нужно на дашборде рядом с N/M-парой); при
  // dueToday=0 показывать нечего (пункт уже done через vocab.dueToday === 0 ниже).
  items.push({
    id: "vocab",
    kind: "vocab",
    label: "Review your vocabulary",
    sublabel: vocab.dueToday > 0 ? `${vocab.dueToday} due today` : null,
    href: "/app/vocabulary",
    target: vocab.goal,
    progress: vocab.reviewedToday,
    done: vocab.dueToday === 0 || vocab.reviewedToday >= vocab.goal,
  });

  if (catalog.hasPublishedTests) {
    const drillLabel = drill ? `Drill ${drill.label}` : hasAttempts ? "Practice a test" : "Take your first test";
    const drillHref = drill ? `/app/practice?q_type=${encodeURIComponent(drill.qtype)}` : "/app/practice";
    items.push({
      id: "drill",
      kind: "drill",
      label: drillLabel,
      sublabel: null,
      href: drillHref,
      target: DAILY_DRILL_TARGET,
      progress: drillsToday,
      done: drillDone,
    });

    // drill2 гейтится тем же catalog.hasPublishedTests, что и drill: он ведёт по
    // тому же /app/practice?q_type= контракту — без каталога это была бы мёртвая
    // ссылка, как и у drill (спека явно оговаривает только drill/mock, но drill2
    // структурно идентичен drill, а не отдельный от каталога кейс).
    //
    // target/progress = null НАМЕРЕННО (не забыто): дневная норма — ОДНА (2 практики
    // в день), не по одной на drill и на drill2. Квоту несёт drillsToday, а drill2 —
    // это доп-фокус финального режима (второй слабый тип) поверх той же нормы, не
    // отдельная цель со своим счётом. Поэтому done делит drillDone с drill — оба
    // пункта закрываются ОДНИМ переходом через DAILY_DRILL_TARGET, как и было до
    // введения numeric-прогресса. Пара N/2 у drill2 читалась бы как вторая
    // независимая норма и была бы обманом (см. code-review 2026-07-16).
    if (includeDrill2 && secondDrill) {
      items.push({
        id: "drill2",
        kind: "drill2",
        label: `Drill ${secondDrill.label}`,
        sublabel: null,
        href: `/app/practice?q_type=${encodeURIComponent(secondDrill.qtype)}`,
        target: null,
        progress: null,
        done: drillDone,
      });
    }

    if (includeMock && catalog.fullMockCategory) {
      items.push({
        id: "mock",
        kind: "mock",
        label: `Take ${WEEKLY_MOCK_TARGET} full mocks this week`,
        sublabel: null,
        // Категория из каталога, не хардкод full_reading: при каталоге только с
        // full-listening хардкод вёл бы в пустую выдачу фильтра.
        href: `/app/practice?category=${catalog.fullMockCategory}`,
        target: WEEKLY_MOCK_TARGET,
        progress: mocksThisWeek,
        done: mocksThisWeek >= WEEKLY_MOCK_TARGET,
      });
    }
  }

  const doneCount = items.filter((i) => i.done).length;
  const totalCount = items.length;

  return {
    items,
    intensity,
    daysUntilExam,
    examDateSet,
    examPassed,
    doneCount,
    totalCount,
    allDone: totalCount > 0 && doneCount === totalCount,
  };
}

/**
 * Owner-путь: due/reviewedToday одним FILTER-агрегатом (НЕ getOpenMistakes — тот
 * 300-попыточный скан + деривация нужен только странице разбора ошибок, не дашборду).
 * «Сегодня» — начало суток в таймзоне юзера, целиком через now() на стороне SQL
 * (join profile ради timezone) — Date-параметр в raw sql`` роняет прод-клиент
 * (pgbouncer, prepare:false), поэтому JS-времени тут вообще нет.
 */
export async function getMistakesDueSummary(
  userId: string,
): Promise<{ due: number; reviewedToday: number }> {
  // Anti-join mistake_resolution: закрытая ошибка (Mark learned / SR-graduation)
  // оставляет SR-строку в mistake_review жить — без вычета её due_at рано или
  // поздно наступает и счётчик показывает фантомные «due», которых нет на экране
  // разбора. Занижение в другую сторону (свежие ошибки без SR-строки) осознанно
  // остаётся — лейбл несёт «+» как нижняя граница.
  const notResolved = sql`not exists (
    select 1 from mistake_resolution mr
    where mr.user_id = ${mistakeReview.userId}
      and mr.content_item_id = ${mistakeReview.contentItemId}
      and mr.question_number = ${mistakeReview.questionNumber}
  )`;
  const [row] = await db
    .select({
      due: sql<number>`(count(*) filter (where ${mistakeReview.dueAt} <= now() and ${notResolved}))::int`,
      reviewedToday: sql<number>`(count(*) filter (where ${mistakeReview.lastReviewedAt} >= (date_trunc('day', now() at time zone ${profile.timezone}) at time zone ${profile.timezone})))::int`,
    })
    .from(mistakeReview)
    .innerJoin(profile, eq(profile.id, mistakeReview.userId))
    .where(eq(mistakeReview.userId, userId));

  return { due: row?.due ?? 0, reviewedToday: row?.reviewedToday ?? 0 };
}

/**
 * Публикованный каталог непуст / содержит full-mock хотя бы одной из секций —
 * гейт для drill/mock пунктов плана. Тот же TTL+тег, что getPublishedTests
 * (src/lib/content/published.ts): publish/unpublish ревалидирует тег "content_item",
 * 300с — фолбэк. Дашборд рендерится динамически (force-dynamic), кэш нужен только
 * этому агрегату.
 */
export const getCatalogAvailability = unstable_cache(
  async (): Promise<DailyPlanInput["catalog"]> => {
    const [row] = await db
      .select({
        total: sql<number>`count(*)::int`,
        fullReading: sql<number>`(count(*) filter (where ${contentItem.category} = 'full_reading'))::int`,
        fullListening: sql<number>`(count(*) filter (where ${contentItem.category} = 'full_listening'))::int`,
      })
      .from(contentItem)
      .where(eq(contentItem.status, "published"));

    // Приоритет reading при обеих доступных категориях — произвольный, но стабильный.
    const fullMockCategory =
      (row?.fullReading ?? 0) > 0 ? ("full_reading" as const)
      : (row?.fullListening ?? 0) > 0 ? ("full_listening" as const)
      : null;
    return { hasPublishedTests: (row?.total ?? 0) > 0, fullMockCategory };
  },
  ["daily-plan-catalog-availability"],
  { tags: ["content_item"], revalidate: 300 },
);
