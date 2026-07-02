import { randomUUID } from "node:crypto";
import { uploadAudio } from "@/lib/telegram/storage";
import { parseRunner } from "./parse-runner";
import { fetchExternalAudio } from "./safe-audio-fetch";
import { sanitizeRunner, assertNoKeyLeak } from "./sanitize-runner";
import { runnerBrandResidue } from "./skin-runner";
import { persistTest, findDuplicateTest, DuplicateTestError } from "../persist";

export interface ImportRunnerResult {
  id: string;
  title: string;
  questions: number;
  warnings: number;
  /** Чужой бренд/ссылки, НЕ вычищенные read-time ребрендом (новый источник). */
  brandWarnings: string[];
  /** Аудио (listening) перезалито из HTML в наш Storage. false → нужен отдельный mp3. */
  hasAudio: boolean;
}

/** Полный импорт обёртки: parse → persist → (audio) → sanitize → runner_html. */
export async function importRunner(
  html: string,
  opts: { sourceFilePath?: string; createdBy?: string },
): Promise<ImportRunnerResult> {
  const { parsed, externalAudioSrc } = parseRunner(html);
  // Пустой парс = ключ-контейнеры этого источника не распознаны. Отказ честнее
  // молчаливого 0-вопросного драфта (бот покажет причину админу).
  if (parsed.questions.length === 0) {
    throw new Error("no questions parsed — unrecognized key container(s) in this source; extend the parser");
  }

  // Дубль-гвард по содержимому (QA 2026-07-02): тот же тест под другим именем файла
  // ложился второй строкой. Проверка ДО аудио-фетча — минуты скачивания не тратятся.
  const dup = await findDuplicateTest(parsed, opts.sourceFilePath);
  if (dup) throw new DuplicateTestError(dup);

  // Mint the id up front so the fallible work (audio fetch/upload + sanitize + anti-leak)
  // runs BEFORE the DB write. persistTest is then a single all-or-nothing commit — a
  // mid-import failure leaves NO half-draft (previously it committed content_item with
  // runner_html=null, then could throw on audio/anti-leak) (#12).
  const contentItemId = randomUUID();

  // 1. Аудио (listening): SSRF-guarded fetch внешнего mp3 → наш Storage → src.
  // Деградация вместо фейла (handoff 2026-07-02): сбой фетча/аплоада НЕ роняет
  // импорт — тест сохраняется draft'ом БЕЗ аудио, warning оседает в import_warnings
  // (review-экран), а mp3 привязывается отдельным файлом (handleAudioUpload).
  // Атомарность #12 не тронута: persist по-прежнему один, после anti-leak.
  let audioUrl: string | undefined;
  if (parsed.section === "listening" && externalAudioSrc) {
    try {
      const bytes = await fetchExternalAudio(externalAudioSrc);
      audioUrl = await uploadAudio(`${contentItemId}.mp3`, bytes, "audio/mpeg");
      const p1 = parsed.passages.find((p) => p.order === 1) ?? parsed.passages[0];
      if (p1) p1.audioPath = audioUrl; // persisted below, not in a separate post-write
    } catch (e) {
      const reason = String((e as Error)?.message ?? e).slice(0, 160);
      parsed.warnings.push(
        `external audio fetch failed (${reason}) — imported without audio; send the mp3 as a separate file`,
      );
    }
  }

  // 2. Очистить файл и проверить анти-утечку (до persist — валидируем перед записью).
  const runnerHtml = sanitizeRunner(html, {
    contentItemId,
    section: parsed.section,
    audioUrl,
  });
  assertNoKeyLeak(runnerHtml, parsed);

  // 2b. Бренд-гейт: read-time ребренд опознаёт шапку по якорям текущего источника.
  // Файл из НОВОГО источника может их не иметь → чужой логотип/канал просочится
  // молча. Считаем остаток и возвращаем как предупреждение (импорт не валим — тест
  // валиден, бренд правится отдельно расширением skinRunnerBrand).
  const brandWarnings = runnerBrandResidue(runnerHtml);
  if (brandWarnings.length) {
    console.warn(`[import] brand residue in "${parsed.title}":`, brandWarnings);
  }

  // 3. Единственная атомарная запись: content + passages (incl audioPath) + questions
  //    + answer_key + runner_html за одну транзакцию.
  await persistTest(parsed, { ...opts, id: contentItemId, runnerHtml });

  return {
    id: contentItemId,
    title: parsed.title,
    questions: parsed.questions.length,
    warnings: parsed.warnings.length,
    brandWarnings,
    hasAudio: !!audioUrl,
  };
}
