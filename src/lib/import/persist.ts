import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  answerKey,
  attempt,
  contentItem,
  passage as passageT,
  profile,
  question as questionT,
} from "../../db/schema";
import { testFingerprint } from "./fingerprint";
import type { ParsedTest } from "./types";

type ContentInsert = typeof contentItem.$inferInsert;
type QuestionInsert = typeof questionT.$inferInsert;

/**
 * Повторный импорт того же файла делает DELETE content_item -> FK cascade сносит
 * passage/question/answer_key И attempt (BRIEF §5 — onDelete cascade). Если по
 * тесту уже есть попытки студентов, destructive re-import уничтожил бы их
 * историю. Бросаем — правка пройденного теста требует Re-grade (отдельный путь,
 * BRIEF §11), а не повторного импорта. Re-import draft без попыток разрешён.
 */
export class RegradeRequiredError extends Error {
  constructor(public readonly attemptCount: number) {
    super(
      `Refusing destructive re-import: the test has ${attemptCount} attempt(s) ` +
        `that a re-import would delete. Editing a sat test needs Re-grade.`,
    );
    this.name = "RegradeRequiredError";
  }
}

/**
 * F4 "Sit as student": true, если КАЖДАЯ строка — попытка админа. Пустой список
 * тоже true (некого блокировать). Fail-safe: `role == null` (dangling attempt без
 * строки profile из LEFT JOIN, или NULL-роль) трактуется как НЕ-admin — при любой
 * неоднозначности провенанса попытки деструктивный re-import отклоняется.
 * Чистая функция — юнит-тестируется без мока транзакции; persistTest ниже
 * использует её, чтобы решить, можно ли считать существующие попытки безопасным
 * QA-мусором (снести и продолжить re-import) вместо отказа RegradeRequiredError.
 */
export function allAttemptsAdminOnly(rows: { role: string | null }[]): boolean {
  return rows.every((r) => r.role === "admin");
}

/**
 * Дубль по СОДЕРЖИМОМУ: тот же тест пришёл под другим именем файла — replace по
 * sourceFilePath его не поймает, легла бы вторая строка (QA 2026-07-02: Vol7 T3).
 * Переимпорт того же теста обязан идти под тем же именем файла.
 */
export class DuplicateTestError extends Error {
  constructor(
    public readonly existing: { id: string; title: string; status: string; sourceFilePath: string | null },
  ) {
    super(
      `Duplicate test content: matches "${existing.title}" (${existing.status}` +
        (existing.sourceFilePath ? `, file ${existing.sourceFilePath}` : "") +
        `). Re-import the same test under the SAME file name, or check the new file.`,
    );
    this.name = "DuplicateTestError";
  }
}

/**
 * Ищет уже сохранённый тест с тем же отпечатком ключа ответов под ДРУГИМ именем
 * файла. Кандидаты сужены секцией и числом вопросов (их единицы), ключи читаются
 * owner-путём. Совпадение имени файла — легальный replace, не дубль.
 */
export async function findDuplicateTest(
  parsed: ParsedTest,
  sourceFilePath?: string,
): Promise<{ id: string; title: string; status: string; sourceFilePath: string | null } | null> {
  const target = testFingerprint(
    parsed.questions.map((q) => ({ number: q.number, accept: q.answer.accept })),
  );
  const candidates = await db
    .select({
      id: contentItem.id,
      title: contentItem.title,
      status: contentItem.status,
      sourceFilePath: contentItem.sourceFilePath,
    })
    .from(contentItem)
    .where(
      and(
        eq(contentItem.section, parsed.section),
        // Внешняя ссылка текстом (content_item.id): drizzle рендерит колонку в
        // raw-sql неквалифицированно — внутри подзапроса она била бы в question.
        sql`(SELECT count(*) FROM question q WHERE q.content_item_id = content_item.id) = ${parsed.questions.length}`,
      ),
    );
  for (const c of candidates) {
    if (sourceFilePath && c.sourceFilePath === sourceFilePath) continue;
    const keys = await db
      .select({ number: questionT.number, accept: answerKey.accept })
      .from(answerKey)
      .innerJoin(questionT, eq(questionT.id, answerKey.questionId))
      .where(eq(questionT.contentItemId, c.id));
    if (keys.length !== parsed.questions.length) continue;
    if (testFingerprint(keys) === target) return { ...c, status: String(c.status) };
  }
  return null;
}

/**
 * Persists a ParsedTest into content_item / passage / question / answer_key in
 * one transaction (server-side, service-role — answer_key writes need it).
 * Idempotent per sourceFilePath: re-importing the same file replaces the prior
 * rows (cascade). Content starts as `draft` (BRIEF §4.2.1 — admin confirms key
 * before publishing).
 */
export async function persistTest(
  parsed: ParsedTest,
  opts: { sourceFilePath?: string; createdBy?: string; runnerHtml?: string; id?: string } = {},
): Promise<string> {
  return db.transaction(async (tx) => {
    if (opts.sourceFilePath) {
      // Guard: не уничтожать историю попыток. Если прежняя версия теста уже
      // проходилась, отказываем в destructive re-import (см. RegradeRequiredError).
      const existing = await tx
        .select({ id: contentItem.id })
        .from(contentItem)
        .where(eq(contentItem.sourceFilePath, opts.sourceFilePath));
      if (existing.length > 0) {
        // F4 "Sit as student": кто держит существующие попытки решает, безопасен ли
        // re-import. Студент хоть один → отказ, как раньше. ТОЛЬКО admin (QA-прогоны
        // черновика через «Sit as student») → безопасно продолжить: явного DELETE
        // попыток здесь не нужно — обычный delete(content_item) чуть ниже и так
        // каскадит на attempt (FK onDelete cascade, migration 0000_init) →
        // attempt_review_snapshot (cascade от attempt, migration 0021), а
        // mistake_resolution/mistake_review каскадят от content_item НАПРЯМУЮ
        // (migrations 0040/0044) — тот же путь, что и у обычного чистого re-import.
        //
        // LEFT JOIN (не INNER): dangling attempt без строки profile НЕ должен
        // выпадать из выборки — иначе оставшиеся выглядели бы admin-only и
        // деструктивный re-import прошёл бы ложно. role=null у такой строки →
        // allAttemptsAdminOnly fail-safe даёт отказ.
        const existingAttempts = await tx
          .select({ role: profile.role })
          .from(attempt)
          .leftJoin(profile, eq(profile.id, attempt.userId))
          .where(
            inArray(
              attempt.contentItemId,
              existing.map((r) => r.id),
            ),
          );
        if (existingAttempts.length > 0 && !allAttemptsAdminOnly(existingAttempts)) {
          throw new RegradeRequiredError(existingAttempts.length);
        }
      }
      await tx
        .delete(contentItem)
        .where(eq(contentItem.sourceFilePath, opts.sourceFilePath));
    }

    const [ci] = await tx
      .insert(contentItem)
      .values({
        // Optional pre-generated id: importRunner mints it up front so audio upload +
        // sanitize run before this atomic write (no half-draft on failure — #12).
        // undefined → column default (defaultRandom) for callers that don't pass one.
        id: opts.id,
        section: parsed.section,
        category: parsed.category as ContentInsert["category"],
        title: parsed.title,
        sourceFilePath: opts.sourceFilePath ?? null,
        durationSeconds: parsed.durationSeconds,
        // Full mock tests (Reading/Listening) are a Premium feature; single
        // passages/parts stay Basic. Gating at the source means the catalog lock
        // (meetsTier) and the server tier-gates apply to every new import without
        // a manual step. Already-imported tests are backfilled separately.
        tierRequired:
          parsed.category === "full_reading" || parsed.category === "full_listening"
            ? "premium"
            : "basic",
        bandType: parsed.bandType as ContentInsert["bandType"],
        questionTypes: parsed.questionTypes,
        bandScale: parsed.bandScale, // raw->band table for Full tests; null otherwise
        runnerHtml: opts.runnerHtml ?? null,
        status: "draft",
        // Review gate: a fresh import is always unreviewed (reviewed_at NULL).
        // The detailed parser warnings ride along for the admin review screen.
        importWarnings: parsed.warnings,
        createdBy: opts.createdBy ?? null,
      })
      .returning({ id: contentItem.id });

    const contentItemId = ci!.id;

    // Insert passages; map order -> id. Single-passage tests use order 1.
    const passageIdByOrder = new Map<number, string>();
    for (const p of parsed.passages) {
      const [row] = await tx
        .insert(passageT)
        .values({
          contentItemId,
          order: p.order,
          title: p.title,
          bodyHtml: p.bodyHtml,
          audioPath: p.audioPath,
          questionsHtml: p.questionsHtml ?? null,
        })
        .returning({ id: passageT.id });
      passageIdByOrder.set(p.order, row!.id);
    }
    // Map each question to its passage/part via passageOrder (Listening: 4 parts;
    // single Reading: order 1). Falls back to the first passage if the order is
    // somehow missing, so a question is never orphaned.
    const fallbackPassageId =
      passageIdByOrder.get(1) ?? [...passageIdByOrder.values()][0]!;

    for (const q of parsed.questions) {
      const [qrow] = await tx
        .insert(questionT)
        .values({
          contentItemId,
          passageId: passageIdByOrder.get(q.passageOrder) ?? fallbackPassageId,
          number: q.number,
          qtype: q.qtype as QuestionInsert["qtype"],
          promptHtml: q.promptHtml,
          options: q.options,
          groupKey: q.groupKey,
          evidenceRef: q.evidenceRef,
          order: q.number,
        })
        .returning({ id: questionT.id });

      await tx.insert(answerKey).values({
        questionId: qrow!.id,
        mode: q.answer.mode,
        accept: q.answer.accept,
        explanation: q.answer.explanation,
        evidence: q.answer.evidence,
      });
    }

    return contentItemId;
  });
}
