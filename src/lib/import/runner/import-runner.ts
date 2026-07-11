import { randomUUID } from "node:crypto";
import { uploadAudio } from "@/lib/telegram/storage";
import { withinAudioCap, MAX_IMPORT_AUDIO_MB } from "../audio-cap";
import { audioObjectKey } from "../audio-key";
import { parseRunner, diagnoseEmptyRunnerParse } from "./parse-runner";
import { parseTest } from "../parse-test";
import { mergeAtomization } from "./atomize-merge";
import { fetchExternalAudio } from "./safe-audio-fetch";
import { sanitizeRunner, assertNoKeyLeak } from "./sanitize-runner";
import { runnerBrandResidue } from "./skin-runner";
import { persistTest, findDuplicateTest, DuplicateTestError } from "../persist";
import { uploadSourceHtml } from "../source-html-storage";

export interface ImportRunnerResult {
  id: string;
  title: string;
  questions: number;
  warnings: number;
  /** Полный текст парсер-warnings (тот же массив, что уходит в content_item.import_warnings) —
   *  нужен вызывающей стороне для preflight-фильтрации (напр. бот показывает qtype-класс отдельно
   *  от общего счётчика, см. isUnresolvedQuestionTypeWarning). */
  warningTexts: string[];
  /** Чужой бренд/ссылки, НЕ вычищенные read-time ребрендом (новый источник). */
  brandWarnings: string[];
  /** Аудио (listening) перезалито из HTML в наш Storage. false → нужен отдельный mp3. */
  hasAudio: boolean;
  /**
   * Аудио в HTML нашлось, но НЕ прикреплено — превысило кап импорта (MAX_IMPORT_AUDIO_MB, см. audio-cap.ts).
   * Отличается от «аудио не было»: бот громко просит пережать mp3, а не молчит.
   */
  audioTooLarge: boolean;
}

/** Полный импорт обёртки: parse → persist → (audio) → sanitize → runner_html. */
export async function importRunner(
  html: string,
  opts: { sourceFilePath?: string; createdBy?: string },
): Promise<ImportRunnerResult> {
  const { parsed: runnerParsed, externalAudioSrc } = parseRunner(html);
  let parsed = runnerParsed;
  // Пустой парс = источник не распознан. Отказ честнее молчаливого 0-вопросного драфта.
  // P4: сообщение различает «контейнер ключа не найден» от «найден, но номера не распознаны»
  // — бот/админ видит, это неподдерживаемый генератор или сломанная разметка ключа.
  if (parsed.questions.length === 0) {
    throw new Error(diagnoseEmptyRunnerParse(html));
  }

  // Дубль-гвард по содержимому (QA 2026-07-02): тот же тест под другим именем файла
  // ложился второй строкой. Проверка ДО аудио-фетча — минуты скачивания не тратятся.
  const dup = await findDuplicateTest(parsed, opts.sourceFilePath);
  if (dup) throw new DuplicateTestError(dup);

  // Атомизация reading (стратегия A, PRACTICE_PLAN): тот же HTML прогоняется вторым
  // парсером (parseTest) ради текста пассажей + prompt/options, которые прищепляются
  // к runner-набору по номеру вопроса. Runner остаётся SoT для answer_key/qtype/
  // категории — mock (runner_html ниже) не меняется. Best-effort: сбой atom-парса
  // или несовпадение номеров → warning + fallback на runner-набор (Practice
  // остаётся practice-lite, импорт успешен). Listening — вне scope: у него нет
  // текста пассажа и типизация расходится (отдельная задача).
  if (parsed.section === "reading") {
    try {
      const merge = mergeAtomization(parsed, parseTest(html));
      if (merge.atomized) {
        parsed = merge.parsed;
      } else if (merge.reason) {
        parsed.warnings.push(merge.reason);
      }
    } catch (e) {
      parsed.warnings.push(
        `atomization skipped — parseTest failed (${String((e as Error)?.message ?? e).slice(0, 120)})`,
      );
    }
  }

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
  let audioTooLarge = false;
  if (parsed.section === "listening" && externalAudioSrc) {
    try {
      const bytes = await fetchExternalAudio(externalAudioSrc);
      // Кап на фактически скачанные байты (бюджет Storage 1 GB, см. audio-cap.ts).
      // Превышение — ГРОМКИЙ отказ attach'а, НЕ тихий skip: тест сохраняется без аудио,
      // но флаг audioTooLarge заставляет бота отдельной строкой требовать пережать mp3
      // (иначе listening молча уходит без звука). Атомарность #12 не тронута: аплоада нет.
      if (!withinAudioCap(bytes.byteLength)) {
        audioTooLarge = true;
        const mb = (bytes.byteLength / (1024 * 1024)).toFixed(1);
        parsed.warnings.push(
          `embedded audio ${mb} MB exceeds ${MAX_IMPORT_AUDIO_MB} MB cap — not attached; ` +
            `send a compressed mp3 (mono, 48 kbps, 32 kHz) as a separate file`,
        );
      } else {
        audioUrl = await uploadAudio(audioObjectKey(contentItemId, bytes), bytes, "audio/mpeg");
        const p1 = parsed.passages.find((p) => p.order === 1) ?? parsed.passages[0];
        if (p1) p1.audioPath = audioUrl; // persisted below, not in a separate post-write
      }
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

  // 4. Бэкап необрезанного оригинала (с ключами) в приватный Storage — воспроизводимость
  // (без него исходник восстановить неоткуда). После persist, т.к. нужен готовый id.
  // Best-effort: сбой бэкапа не должен ронять уже успешный импорт.
  try {
    await uploadSourceHtml(contentItemId, html);
  } catch (e) {
    console.error(`[import] source HTML backup failed for content_item ${contentItemId}`, e);
  }

  return {
    id: contentItemId,
    title: parsed.title,
    questions: parsed.questions.length,
    warnings: parsed.warnings.length,
    warningTexts: parsed.warnings,
    brandWarnings,
    hasAudio: !!audioUrl,
    audioTooLarge,
  };
}
