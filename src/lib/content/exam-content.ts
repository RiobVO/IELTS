import { unstable_cache } from "next/cache";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { contentItem, passage, question } from "@/db/schema";

/**
 * Per-test cache tag (W2-6 load insurance). Кэши контента одного теста несут ЭТОТ
 * тег + широкий `content_item`, поэтому их можно инвалидировать гранулярно (один
 * тест) ИЛИ разом (весь каталог). `content_item` уже фаерится во всех местах записи
 * контента (admin upload/publish/unpublish, Telegram, persist re-import), значит
 * кэши сбрасываются там БЕЗ нового кода; per-id тег добавляет точечный сброс на
 * publish/unpublish (см. publish.ts / app/admin/actions.ts).
 */
export const contentTag = (id: string) => `content-${id}`;

/** Пассаж в форме, которую рендерит exam-страница (snake_case, как anon-клиент). */
export interface CachedPassage {
  title: string | null;
  body_html: string;
  order: number;
  audio_path: string | null;
  questions_html: string | null;
}

/** Вопрос в форме, которую потребляет ExamRunner (snake_case, как anon-клиент). */
export interface CachedQuestion {
  id: string;
  number: number;
  qtype: string;
  prompt_html: string;
  options: unknown;
  group_key: string | null;
  passage_id: string;
}

export interface ExamContent {
  test: {
    id: string;
    title: string;
    category: string;
    duration_seconds: number | null;
    tier_required: string;
  };
  passages: CachedPassage[];
  questions: CachedQuestion[];
}

/**
 * Кэш статичного PUBLISHED-контента теста для экрана старта экзамена: метаданные
 * теста + тела пассажей + атомизированные вопросы. Меняется только при
 * (ре)импорте/публикации/депубликации (те фаерят тег `content_item`), поэтому
 * рендер экзамена не должен бить БД за ним на КАЖДЫЙ старт — страница остаётся
 * динамической, per-request решения (profile/tier-гейт/attempt/аннотации) считаются
 * ВНЕ кэша, на каждый запрос.
 *
 * ПОЧЕМУ БЕЗОПАСНО КЭШИРОВАТЬ (границы W2-6):
 *  - Только published, не-user-scoped данные. `status = 'published'` гейтит явно:
 *    owner-путь (Drizzle) обходит RLS, поэтому published-гейт, который раньше давал
 *    anon-клиент, воспроизводится здесь (draft → null → страница делает notFound()).
 *  - answer_key НЕ читается и НЕ джойнится — ключ не попадает в кэш ни при каких
 *    условиях (тот же инвариант, что у getPublishedTests).
 *  - runner_html (~200КБ, sanitized, attempt-scoped рендер) НЕ кэшируется здесь —
 *    это иной путь (/app/exam iframe), его не трогаем.
 *  - Никакого request-scoped клиента в замыкании: `db` — module-level owner-клиент,
 *    `id` — обычная строка (зеркалит published.ts / badges.ts).
 * `revalidate` — фолбэк; теги — основная, немедленная инвалидация.
 */
export function getExamContent(id: string): Promise<ExamContent | null> {
  return unstable_cache(
    async (): Promise<ExamContent | null> => {
      // Published-гейт ПЕРВЫМ: draft/несуществующий тест → null (страница 404-ит),
      // и мы не тащим тела draft-контента в кэш. Только после гейта читаем пассажи +
      // вопросы одним параллельным слоем (на cold-miss; на hit БД не бьётся вовсе).
      const [test] = await db
        .select({
          id: contentItem.id,
          title: contentItem.title,
          category: sql<string>`${contentItem.category}::text`,
          duration_seconds: contentItem.durationSeconds,
          tier_required: sql<string>`${contentItem.tierRequired}::text`,
        })
        .from(contentItem)
        .where(and(eq(contentItem.id, id), eq(contentItem.status, "published")))
        .limit(1);
      if (!test) return null;

      const [passages, questions] = await Promise.all([
        db
          .select({
            title: passage.title,
            body_html: passage.bodyHtml,
            order: passage.order,
            audio_path: passage.audioPath,
            questions_html: passage.questionsHtml,
          })
          .from(passage)
          .where(eq(passage.contentItemId, id))
          .orderBy(asc(passage.order)),
        db
          .select({
            id: question.id,
            number: question.number,
            qtype: sql<string>`${question.qtype}::text`,
            prompt_html: question.promptHtml,
            options: question.options,
            group_key: question.groupKey,
            passage_id: question.passageId,
          })
          .from(question)
          .where(eq(question.contentItemId, id))
          .orderBy(asc(question.number)),
      ]);

      return { test, passages, questions } as ExamContent;
    },
    ["exam-content", id],
    { tags: ["content_item", contentTag(id)], revalidate: 600 },
  )();
}

export interface ContentMeta {
  title: string;
  category: string;
  section: string;
  durationSeconds: number | null;
  hasRunner: boolean;
  bandScale: Record<string, number> | null;
}

/**
 * Кэш статичных МЕТАДАННЫХ теста для /result: заголовок/секция/категория,
 * длительность (для sanity-гейта времени), флаг наличия раннера (маршрут «Try
 * again») и band-шкала (raw→band, §11 — задача W2-6 п.3: band-шкала лежит per-test
 * в content_item.band_scale, отдельной «таблицы шкал» нет, кэшируется вместе с
 * метаданными).
 *
 * ПОЧЕМУ БЕЗОПАСНО:
 *  - Не-user-scoped, несекретные метаданные (title/category/section/duration/
 *    band_scale/has_runner). answer_key НЕ читается. runner_html НЕ тащим — только
 *    булев флаг наличия (как в каталоге).
 *  - БЕЗ `status = 'published'`-гейта СПЕЦИАЛЬНО: /result показывает разбор уже
 *    сданной попытки, даже если тест позже депубликовали; доступ гейтит владение
 *    попыткой (проверка в result/page.tsx), а не публикация. Метаданные несекретны,
 *    поэтому чтение по id без гейта статуса безопасно.
 * Тот же тег `content_item` + per-id → инвалидируется вместе с exam-контентом.
 */
export function getContentMeta(id: string): Promise<ContentMeta | null> {
  return unstable_cache(
    async (): Promise<ContentMeta | null> => {
      const [row] = await db
        .select({
          title: contentItem.title,
          category: sql<string>`${contentItem.category}::text`,
          section: sql<string>`${contentItem.section}::text`,
          durationSeconds: contentItem.durationSeconds,
          // Только флаг наличия раннера для маршрутизации «Try again» — НЕ сам
          // runner_html (~200КБ); как в каталоге (getPublishedTests).
          hasRunner: sql<boolean>`${contentItem.runnerHtml} IS NOT NULL`,
          bandScale: contentItem.bandScale,
        })
        .from(contentItem)
        .where(eq(contentItem.id, id))
        .limit(1);
      if (!row) return null;
      return {
        ...row,
        bandScale: (row.bandScale as Record<string, number> | null) ?? null,
      };
    },
    ["content-meta", id],
    { tags: ["content_item", contentTag(id)], revalidate: 600 },
  )();
}
