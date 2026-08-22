"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { contentItem, savedWord } from "@/db/schema";
import { getUser } from "@/lib/auth";
import { logError } from "@/lib/monitoring/log-error";
import { isUuid } from "@/lib/uuid";
import { MAX_CONTEXT_LEN, normalizeWord } from "@/lib/vocab/saved-words";
import { reviewCard, type Grade } from "@/lib/vocab/srs";

/**
 * P11 «Saved words» — server actions личного словаря. Все три — owner-path (user_id
 * из сессии, WHERE user_id ∧ id): grant на INSERT/UPDATE/DELETE у клиентских ролей
 * отозван (миграция 0041), поэтому это единственный путь записи. Best-effort: на
 * невалидном входе — мягкий no-op-результат (без redirect, чтобы не рвать экзамен),
 * реальный сбой БД — logError в catch. Vocab ВНЕ rating/leaderboard-контура:
 * рейтинг/бейджи/стрик экзаменов не трогаются.
 */

export type SaveWordResult =
  | { ok: true; created: boolean }
  | { ok: false; reason: "invalid" | "error" };

/**
 * Закладка слова из пассажа. word нормализуется (trim/схлоп/1..64/только буквы-дефис-
 * апостроф — мусор/HTML/фразы отсекаются), context схлопывается и режется до
 * MAX_CONTEXT_LEN, sourceContentItemId берётся только валидным uuid (иначе null).
 * ON CONFLICT DO NOTHING по (user_id, lower(word)) — повторная закладка того же слова
 * идемпотентна (created=false). vocab_card НЕ синтезируется — published-контент неприкосновенен.
 */
export async function saveWord(
  word: string,
  context: string,
  sourceContentItemId?: string | null,
): Promise<SaveWordResult> {
  const user = await getUser();
  if (!user) return { ok: false, reason: "invalid" };

  const normWord = normalizeWord(word);
  if (!normWord) return { ok: false, reason: "invalid" };

  const ctx =
    typeof context === "string"
      ? context.replace(/\s+/g, " ").trim().slice(0, MAX_CONTEXT_LEN)
      : "";

  try {
    // source принимаем только существующим published-тестом (клиентскому uuid не
    // доверяем — зеркало qtype-лукапа в resolveMistake); иначе null: слово сохраняем,
    // просто без обратной ссылки. Заодно исключает FK-error путь на битом uuid.
    let src: string | null = null;
    if (isUuid(sourceContentItemId)) {
      const [ci] = await db
        .select({ id: contentItem.id })
        .from(contentItem)
        .where(and(eq(contentItem.id, sourceContentItemId), eq(contentItem.status, "published")))
        .limit(1);
      src = ci?.id ?? null;
    }

    const inserted = await db
      .insert(savedWord)
      .values({ userId: user.id, word: normWord, context: ctx, sourceContentItemId: src })
      // Без target: единственный unique — выражение lower(word), «ON CONFLICT DO NOTHING»
      // ловит любой конфликт. returning пуст при конфликте → created=false.
      .onConflictDoNothing()
      .returning({ id: savedWord.id });
    if (inserted.length > 0) {
      // Новое слово видно в «My words» и счётчике карты на /app/vocabulary. Капсула
      // сохранения — practice-only (canSaveWords в PassagePane), mock этот экшен не
      // зовёт; ре-рендер practice-страницы от ревалидации идемпотентен (startAttempt
      // → resume-ветка, test_start не перефейрится). Дубль (created=false) данных не
      // меняет — без ревалидации.
      revalidatePath("/app/vocabulary/my-words");
      revalidatePath("/app/vocabulary");
    }
    return { ok: true, created: inserted.length > 0 };
  } catch (e) {
    await logError({
      source: "server",
      message: "saveWord failed",
      stack: e instanceof Error ? e.stack : null,
      context: { op: "saveWord", userId: user.id },
    });
    return { ok: false, reason: "error" };
  }
}

export type SavedWordReviewResult =
  | { ok: true; dueAt: string; intervalDays: number }
  | { ok: false; reason: "not_found" | "invalid" | "error" };

/**
 * Повтор одного слова личного словаря. Сервер — единственный судья SM-2: читает стейт
 * owner-path, гонит общий reviewCard (не дублируя формулу), пишет результат owner-path.
 * grade валидируется по канону сессии («again»|«good»|«easy»); easy валиден ТОЛЬКО для
 * ещё не повторённой карты (зеркало applyReview в deck-сессии) — иначе тихо → good.
 */
export async function reviewSavedWord(
  id: string,
  grade: string,
): Promise<SavedWordReviewResult> {
  const user = await getUser();
  if (!user) return { ok: false, reason: "invalid" };
  if (!isUuid(id)) return { ok: false, reason: "not_found" };
  if (grade !== "again" && grade !== "good" && grade !== "easy") {
    return { ok: false, reason: "invalid" };
  }
  // grade сужен до "again" | "good" | "easy" (= Grade).

  try {
    const [row] = await db
      .select({
        ease: savedWord.ease,
        intervalDays: savedWord.intervalDays,
        repetitions: savedWord.repetitions,
        lapses: savedWord.lapses,
        lastReviewedAt: savedWord.lastReviewedAt,
      })
      .from(savedWord)
      .where(and(eq(savedWord.id, id), eq(savedWord.userId, user.id)))
      .limit(1);
    if (!row) return { ok: false, reason: "not_found" };

    const isNew = row.lastReviewedAt == null;
    const effectiveGrade: Grade = grade === "easy" && !isNew ? "good" : grade;
    const now = new Date();
    const { state, dueAt } = reviewCard(
      {
        ease: row.ease,
        intervalDays: row.intervalDays,
        repetitions: row.repetitions,
        lapses: row.lapses,
      },
      effectiveGrade,
      now,
    );

    await db
      .update(savedWord)
      .set({
        ease: state.ease,
        intervalDays: state.intervalDays,
        repetitions: state.repetitions,
        lapses: state.lapses,
        dueAt,
        lastReviewedAt: now,
      })
      .where(and(eq(savedWord.id, id), eq(savedWord.userId, user.id)));

    return { ok: true, dueAt: dueAt.toISOString(), intervalDays: state.intervalDays };
  } catch (e) {
    await logError({
      source: "server",
      message: "reviewSavedWord failed",
      stack: e instanceof Error ? e.stack : null,
      context: { op: "reviewSavedWord", userId: user.id, savedWordId: id },
    });
    return { ok: false, reason: "error" };
  }
}

/** Удаление слова из личного словаря (owner-path). ok — только если строка реально удалена. */
export async function deleteSavedWord(id: string): Promise<{ ok: boolean }> {
  const user = await getUser();
  if (!user) return { ok: false };
  if (!isUuid(id)) return { ok: false };
  try {
    const deleted = await db
      .delete(savedWord)
      .where(and(eq(savedWord.id, id), eq(savedWord.userId, user.id)))
      .returning({ id: savedWord.id });
    if (deleted.length > 0) {
      // Единственный одношотный экшен файла с ревалидацией: saveWord зовётся
      // мид-экзамена (ревалидация ре-рендерила бы exam-страницу — её свежесть
      // закрывает submitAttempt), reviewSavedWord — per-card поток (граница —
      // router.refresh() в MyWords при finished). Delete же вызывается из
      // list-view my-words — чистим счётчики «My words» и сам список.
      revalidatePath("/app/vocabulary/my-words");
      revalidatePath("/app/vocabulary");
    }
    return { ok: deleted.length > 0 };
  } catch (e) {
    await logError({
      source: "server",
      message: "deleteSavedWord failed",
      stack: e instanceof Error ? e.stack : null,
      context: { op: "deleteSavedWord", userId: user.id, savedWordId: id },
    });
    return { ok: false };
  }
}
