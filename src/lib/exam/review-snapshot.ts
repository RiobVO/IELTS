/**
 * Review-snapshot (D3): стабильный разбор попытки. На submit сохраняем ключи +
 * explanation/evidence по каждому вопросу в server-only locked-таблицу
 * (attempt_review_snapshot), и /result читает их вместо ЖИВОГО answer_key —
 * иначе при правке контента разбор у уже сдавших «плывёт». SERVER-ONLY данные:
 * таблица залочена как answer_key (BRIEF §6.1), клиент их не достаёт.
 *
 * Чистая функция-сборщик (без I/O) — форма snapshot тестируется без БД и едина
 * для submit (запись) и /result (чтение).
 */
import type { AnswerMode } from "@/lib/grading/grade";

export interface SnapshotEvidence {
  para: string;
  snippet: string;
}

export interface SnapshotQuestion {
  number: number;
  qtype: string;
  mode: AnswerMode;
  /** правильные/принимаемые значения (как в answer_key.accept) */
  accept: string[];
  explanation: string | null;
  evidence: SnapshotEvidence | null;
}

export interface ReviewSnapshot {
  questions: SnapshotQuestion[];
}

/** Сырая строка ключа (как грузит submit: question ⋈ answer_key). */
export interface KeyRow {
  number: number;
  qtype: string;
  mode: AnswerMode;
  accept: unknown;
  explanation: string | null | undefined;
  evidence: unknown;
}

/** Собрать snapshot из строк ключа. Нормализует accept→[] и пустые поля→null. */
export function buildReviewSnapshot(rows: KeyRow[]): ReviewSnapshot {
  return {
    questions: rows.map((r) => ({
      number: r.number,
      qtype: r.qtype,
      mode: r.mode,
      accept: Array.isArray(r.accept) ? (r.accept as string[]) : [],
      explanation: r.explanation ?? null,
      evidence: (r.evidence as SnapshotEvidence | null) ?? null,
    })),
  };
}
