import type { ParsedTest, ParsedPassage } from "../types";

export interface MergeResult {
  /** Слитый ParsedTest, либо исходный runner (тот же объект), если мерж не применён. */
  parsed: ParsedTest;
  /** Применена ли атомизация. */
  atomized: boolean;
  /** Причина пропуска — оседает в import_warnings (review-экран). */
  reason?: string;
}

/**
 * Прищепляет атомизацию (реальный текст пассажей + prompt/options) из parseTest к
 * базовому ParsedTest из parseRunner. Runner остаётся source of truth для answer_key
 * (грейдинг-путь) и для meta уровня content_item (number, duration, tierRequired) —
 * это НИКОГДА не берётся из atom, для обеих секций.
 *
 * Исключение — category/bandScale, и ТОЛЬКО для listening (review 2026-07-17,
 * BRIEF §4.8): runner-парсер listening (parse-runner.ts) не видит реальные
 * .part[data-part] границы вообще — он лишь угадывает full/не-full по числу
 * вопросов/наличию band(), и ЛЮБОЙ не-full импорт хардкодит как part_1, вне
 * зависимости от того, какая часть в файле на самом деле. Atom (parse-listening.ts)
 * читает настоящую разметку частей, а строгий гейт по номерам вопросов ниже уже
 * ДОКАЗАЛ, что atom распарсил ТОТ ЖЕ набор вопросов из этой самой разметки —
 * это и есть основание доверять его category/bandScale больше, чем runner-догадке.
 * Без этого проброса detectListeningCategory (parse-listening.ts) вообще не
 * доходил до persist — единственный реальный листенинг-импорт путь (Telegram/
 * admin, importRunner) молча оставался на старой runner-эвристике.
 * Reading category остаётся runner (см. тест "meta уровня content_item — из
 * runner, НЕ из atom" ниже) — успешная атомизация вопросов reading не доказывает
 * ничего про НЕСВЯЗАННЫЙ rubric-текст, на который опирается atom's passage_N/
 * full_reading детекция, так что то же доверие сюда не переносится.
 *
 * Ещё одно исключение — questionTypes: для listening пересчитывается из итоговых
 * qtype (после promotion, см. ниже), для reading остаётся runner как есть.
 *
 * audioPath пассажей — ТОЛЬКО от runner: atom-пассажи parse-listening несут исходный
 * внешний <audio src> (хотлинк), который не должен утечь в persist; Storage-URL
 * присваивает import-runner после мержа.
 *
 * Презентационные поля (promptHtml/options/passageOrder) — всегда из atom, для
 * reading и listening одинаково.
 *
 * qtype/groupKey расходятся по секции:
 *  - reading: оба поля из runner, без изменений (runner mcqGroups уже даёт и
 *    groupKey, и однозначный qtype для choose-TWO/THREE — atom тут ничего не
 *    добавляет).
 *  - listening: groupKey ВСЕГДА из atom — runner-парсер listening (parse-runner.ts)
 *    не строит группировку вообще (groupKey у него голый null для каждого вопроса).
 *    qtype — из atom ТОЛЬКО когда runner дал mcq_single, а atom — mcq_multi (это
 *    член choose-TWO/THREE группы: runner видит его как одиночный radio/text,
 *    потому что не парсит .mcq.multi[data-qs]; без promotion атомизированный
 *    рендер даёт radio вместо checkbox, и валидный двухбуквенный ответ
 *    невозможен). Любое другое расхождение qtype (map_labelling vs mcq_single,
 *    matching_features vs mcq_single и т.п.) остаётся runner qtype — источник
 *    (.q-instruction) семантически точнее структурного HTML-парса atom.
 *
 * answer — ВСЕГДА из runner, для reading и listening без исключений: это единственный
 * путь к ключу, который видит грейдинг (mock choose-TWO для listening в проде лежит
 * как text_accept с обеими буквами per-member — трогать нельзя).
 *
 * Гейт: множества номеров вопросов должны совпасть 1:1 (без пропусков, лишних и
 * дублей в atom) — иначе доверять частичной атомизации нельзя, возвращаем runner
 * как есть (Practice остаётся practice-lite, mock не тронут). Тот же жёсткий гейт,
 * что в scripts/backfill-atomize.ts. Применяется к обеим секциям одинаково.
 */
export function mergeAtomization(runner: ParsedTest, atom: ParsedTest): MergeResult {
  const runnerNums = runner.questions.map((q) => q.number);
  const atomNums = atom.questions.map((q) => q.number);

  const seen = new Set<number>();
  const dupes = new Set<number>();
  for (const n of atomNums) {
    if (seen.has(n)) dupes.add(n);
    seen.add(n);
  }
  const runnerSet = new Set(runnerNums);
  const missing = runnerNums.filter((n) => !seen.has(n)); // есть в runner, нет в atom
  const extra = [...seen].filter((n) => !runnerSet.has(n)); // есть в atom, нет в runner

  if (dupes.size > 0 || missing.length > 0 || extra.length > 0) {
    const reason =
      `atomization skipped — question-number set mismatch ` +
      `(missing-in-atom=[${missing.sort((a, b) => a - b).join(",")}], ` +
      `extra-in-atom=[${extra.sort((a, b) => a - b).join(",")}], ` +
      `duplicates=[${[...dupes].sort((a, b) => a - b).join(",")}])`;
    return { parsed: runner, atomized: false, reason };
  }

  // Структурная целостность: каждый вопрос обязан ссылаться на реальный пассаж
  // atom, иначе persist смапит его на fallback (чужой пассаж) или уронит NOT NULL
  // passage_id при пустом наборе — регрессия против runner-only (1 fallback-пассаж).
  const atomOrders = new Set(atom.passages.map((p) => p.order));
  const orphanOrders = [
    ...new Set(atom.questions.map((q) => q.passageOrder).filter((o) => !atomOrders.has(o))),
  ].sort((a, b) => a - b);
  if (atom.passages.length === 0 || orphanOrders.length > 0) {
    const reason =
      `atomization skipped — question(s) reference missing passage order(s) ` +
      `[${orphanOrders.join(",")}] (atom passages: [${[...atomOrders].sort((a, b) => a - b).join(",")}])`;
    return { parsed: runner, atomized: false, reason };
  }

  // passages: берём атомизированные (order/title/bodyHtml/questionsHtml), но
  // audioPath — ТОЛЬКО от runner, atom не источник аудио вообще: parse-listening
  // пишет в свои пассажи исходный внешний <audio src> (хотлинк), а раздача обязана
  // идти из нашего Storage — URL первому пассажу присваивает import-runner ПОСЛЕ
  // мержа (сбой fetch/превышение капа = честный null, не внешний линк).
  const runnerAudioByOrder = new Map<number, string | null>(
    runner.passages.map((p) => [p.order, p.audioPath]),
  );
  const passages: ParsedPassage[] = atom.passages.map((p) => ({
    ...p,
    audioPath: runnerAudioByOrder.get(p.order) ?? null,
  }));

  // questions: базовый ряд из runner (answer/number/evidenceRef — неприкосновенны),
  // поверх — презентация из atom, сматченная по номеру. groupKey/qtype: reading
  // остаётся runner как есть; listening — см. doc-комментарий функции.
  const isListening = runner.section === "listening";
  const atomByNum = new Map(atom.questions.map((q) => [q.number, q]));
  const questions = runner.questions.map((rq) => {
    const aq = atomByNum.get(rq.number);
    if (!aq) return rq;
    // choose-TWO/THREE promotion (listening only): runner видит группового члена
    // как одиночный mcq_single (не парсит .mcq.multi[data-qs]) — без этого атом
    // рендерит radio вместо checkbox.
    const promoteMcqMulti = isListening && rq.qtype === "mcq_single" && aq.qtype === "mcq_multi";
    return {
      ...rq,
      promptHtml: aq.promptHtml,
      options: aq.options,
      passageOrder: aq.passageOrder,
      groupKey: isListening ? aq.groupKey : rq.groupKey,
      qtype: promoteMcqMulti ? aq.qtype : rq.qtype,
    };
  });

  // questionTypes персистится в content_item (каталог-фильтр) и у runner собран из
  // ЕГО qtype — после listening-promotion (mcq_single→mcq_multi) он устаревает.
  // Пересчёт из итоговых вопросов; reading — от runner как есть (байт-идентичность).
  const questionTypes = isListening
    ? [...new Set(questions.map((q) => q.qtype))]
    : runner.questionTypes;

  // Listening only — see the doc-comment above for why: atom's part-count
  // detection is trustworthy here specifically because the question-set gate
  // above already proved it read the same real markup runner can't see.
  const listeningMeta = isListening ? { category: atom.category, bandScale: atom.bandScale } : {};

  return {
    parsed: { ...runner, passages, questions, questionTypes, ...listeningMeta },
    atomized: true,
  };
}
