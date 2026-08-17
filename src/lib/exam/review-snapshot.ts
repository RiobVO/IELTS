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

/**
 * Нормализует сырой evidence-jsonb в канон-форму {para, snippet}. Источники
 * несогласованы (как ярлыки question_type, BRIEF §4.2): часть импортированных
 * файлов кладёт {para, snippet}, часть — {part, text} (part может прийти числом).
 * Без этой нормализации наивный `as`-каст типизировал бы объект как {para,snippet},
 * но на рантайме .snippet был бы undefined — evidence «терялся» молча (найдено на
 * реальном тесте: with_evidence=40/40 в БД, но UI показывал заглушку «нет evidence»
 * у каждого вопроса). Нет ни одного узнаваемого поля → null (реально пусто).
 */
export function normalizeEvidence(raw: unknown): SnapshotEvidence | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const snippetRaw = o.snippet ?? o.text;
  const snippet = typeof snippetRaw === "string" ? snippetRaw.trim() : "";
  if (!snippet) return null; // без цитаты evidence бесполезен для UI
  const paraRaw = o.para ?? o.part;
  const para = typeof paraRaw === "string" ? paraRaw : typeof paraRaw === "number" ? String(paraRaw) : "";
  return { para, snippet };
}

export interface SnapshotQuestion {
  number: number;
  qtype: string;
  mode: AnswerMode;
  /** правильные/принимаемые значения (как в answer_key.accept) */
  accept: string[];
  explanation: string | null;
  /** RU-объяснение (L1-слой, 0050) — тот же гейт/путь, что explanation. */
  explanationRu: string | null;
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
  explanationRu: string | null | undefined;
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
      explanationRu: r.explanationRu ?? null,
      evidence: normalizeEvidence(r.evidence),
    })),
  };
}
