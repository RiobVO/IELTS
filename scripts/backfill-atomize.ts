/**
 * Backfill: полная атомизация уже published тестов (runner_html IS NOT NULL) —
 * заполняет passage.body_html/title/questions_html и question.prompt_html/
 * options/group_key/passage_id из недавно расширенных parse-test/parse-reading-full/
 * parse-listening (S1-спайк scripts/_spike_atomize.ts подтвердил: все 23 published
 * теперь полностью атомизируются, число распарсенных вопросов совпадает с БД).
 *
 * Зачем: текущие published-строки пришли через runner-пайплайн
 * (src/lib/import/runner/parse-runner.ts), который атомизацию НЕ делает
 * (promptHtml: "", options: null, один passage order=1 всегда) — рендер идёт из
 * verbatim runner_html в iframe (BRIEF, exam/[id]). Этот бэкфилл даёт атомизированные
 * данные (легаси /app/reading, будущие нужды) БЕЗ изменения exam/practice-кода и
 * БЕЗ прикосновения к answer_key.
 *
 * Источник HTML на вход парсера: приватный bucket `source-html` по id (см.
 * scripts/backfill-source-html.ts), фолбэк — локальный файл по source_file_path
 * (resolveSourceFile оттуда же).
 *
 * Инварианты:
 *  - ЖЁСТКИЙ гейт перед любой записью: множество номеров распарсенных вопросов
 *    ДОЛЖНО совпасть 1:1 с множеством номеров question-строк этого item в БД.
 *    Не совпало -> SKIP item целиком (никаких частичных записей), причина в отчёте.
 *  - passage: UPDATE по order ТОЛЬКО если текущий body_html пуст/NULL (защита от
 *    затирания вручную правленного); отсутствующий order -> INSERT; DELETE
 *    никогда; audio_path НИКОГДА не трогаем (у listening уже может быть привязан).
 *  - question: UPDATE по (content_item_id, number): prompt_html/options/
 *    group_key/passage_id. qtype-политика различается по секции (тот же контракт,
 *    что живой импорт — см. src/lib/import/runner/atomize-merge.ts):
 *      - reading: qtype по умолчанию НЕ пишем — расхождение только в отчёт; флаг
 *        --fix-qtype дополнительно выравнивает ВСЕ расхождения по распарсенному
 *        (runner-импорт типизировал хуже парсера: choose-TWO лежал как mcq_single и
 *        атомизированный рендер давал radio вместо checkbox — валидный двухбуквенный
 *        ответ невозможно ввести).
 *      - listening: --fix-qtype не участвует — ВСЕГДА применяется ТОЛЬКО promotion
 *        db mcq_single -> parsed mcq_multi (choose-TWO/THREE член группы); прочие
 *        расхождения (напр. map_labelling vs mcq_single, matching_info vs
 *        matching_features) остаются runner qtype — только в отчёт. См.
 *        selectQtypeFixes. content_item.question_types для listening
 *        пересчитывается из ИТОГОВЫХ qtype строк после этого апдейта.
 *    Исторические per_type_breakdown — снапшоты в attempt, их это не переписывает;
 *    будущие попытки типизируются точнее.
 *  - listening map-гейт: item с хотя бы одним вопросом qtype='map_labelling' в БД
 *    пропускается целиком (карта — inline-SVG раннера, атомизированный рендер без
 *    неё делает вопрос нерешаемым) — см. hasMapLabelling.
 *  - answer_key НЕ читается и НЕ пишется вообще.
 *  - Повторный прогон стабилен: passages с непустым body_html пропускаются
 *    (skip-has-content), question-поля перезаписываются ТЕМИ ЖЕ распарсенными
 *    значениями (источник детерминирован) — итоговое состояние не меняется.
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/backfill-atomize.ts --dry
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/backfill-atomize.ts
 */
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveSourceFile } from "./backfill-source-html";

const HERE = dirname(fileURLToPath(import.meta.url));

/* ------------------------------ чистая логика ---------------------------- */

export interface GateResult {
  ok: boolean;
  /** распарсено, но нет в БД */
  missing: number[];
  /** есть в БД, но не распарсено */
  extra: number[];
  /** номера, распарсенные больше одного раза (гейт валит: update по number перезаписал бы строку многократно) */
  duplicates: number[];
}

/** Жёсткий гейт: номера вопросов должны совпасть 1:1 И без дубликатов в parsed, иначе весь item — SKIP. */
export function checkQuestionNumberGate(
  parsedNumbers: number[],
  dbNumbers: number[],
): GateResult {
  const seen = new Set<number>();
  const dupSet = new Set<number>();
  for (const n of parsedNumbers) {
    if (seen.has(n)) dupSet.add(n);
    seen.add(n);
  }
  const duplicates = [...dupSet].sort((a, b) => a - b);
  const dbSet = new Set(dbNumbers);
  const missing = [...seen].filter((n) => !dbSet.has(n)).sort((a, b) => a - b);
  const extra = [...dbSet].filter((n) => !seen.has(n)).sort((a, b) => a - b);
  return {
    ok: missing.length === 0 && extra.length === 0 && duplicates.length === 0,
    missing,
    extra,
    duplicates,
  };
}

export type PassagePlanAction =
  | { order: number; action: "insert" }
  | { order: number; action: "update"; passageId: string }
  | { order: number; action: "skip-has-content"; passageId: string };

/**
 * По каждому распарсенному passage.order решает: INSERT (order отсутствует в БД),
 * UPDATE (order есть, но body_html пуст/NULL — безопасно перезаписать) или
 * skip-has-content (order есть И body_html уже непуст — не трогаем, защита от
 * затирания ручной правки). DELETE не рассматривается вообще — только эти три исхода.
 */
export function planPassages(
  parsedOrders: number[],
  dbPassages: { id: string; order: number; bodyHtml: string | null }[],
): PassagePlanAction[] {
  const dbByOrder = new Map(dbPassages.map((p) => [p.order, p]));
  return parsedOrders.map((order) => {
    const existing = dbByOrder.get(order);
    if (!existing) return { order, action: "insert" };
    const empty = !existing.bodyHtml || existing.bodyHtml.trim() === "";
    return empty
      ? { order, action: "update", passageId: existing.id }
      : { order, action: "skip-has-content", passageId: existing.id };
  });
}

export interface QtypeMismatch {
  number: number;
  dbQtype: string;
  parsedQtype: string;
}

/**
 * Собирает qtype-расхождения parsed vs БД — сами по себе это только отчёт.
 * Запись происходит отдельно и только через selectQtypeFixes: reading — по флагу
 * --fix-qtype, listening — строго promotion mcq_single -> mcq_multi.
 */
export function findQtypeMismatches(
  parsedQuestions: { number: number; qtype: string }[],
  dbQuestions: { number: number; qtype: string }[],
): QtypeMismatch[] {
  const dbByNumber = new Map(dbQuestions.map((q) => [q.number, q.qtype]));
  const out: QtypeMismatch[] = [];
  for (const pq of parsedQuestions) {
    const dbQtype = dbByNumber.get(pq.number);
    if (dbQtype !== undefined && dbQtype !== pq.qtype) {
      out.push({ number: pq.number, dbQtype, parsedQtype: pq.qtype });
    }
  }
  return out.sort((a, b) => a.number - b.number);
}

/**
 * Listening map-гейт: qtype='map_labelling' в БД рендерится раннером как inline-SVG
 * карта — атомизированный рендер вопроса без карты делает его нерешаемым. Пока нет
 * map-фичи в атомизированном UI, весь item пропускаем целиком (владелец: ждать
 * фичу, не публиковать частично сломанный тест). Reading этой проблемы не имеет.
 */
export function hasMapLabelling(dbQuestions: { qtype: string }[]): boolean {
  return dbQuestions.some((q) => q.qtype === "map_labelling");
}

/**
 * Какие qtype-расхождения реально применять (номера вопросов) — политика различается
 * по секции, тот же контракт, что живой импорт (src/lib/import/runner/atomize-merge.ts):
 *  - reading: без --fix-qtype ничего не применяется (только отчёт); с флагом —
 *    применяются ВСЕ расхождения.
 *  - listening: флаг --fix-qtype не участвует — ВСЕГДА применяется ТОЛЬКО promotion
 *    db mcq_single -> parsed mcq_multi (член choose-TWO/THREE группы, без которой
 *    атомизированный рендер даёт radio вместо checkbox). Любое другое расхождение
 *    (map_labelling vs mcq_single, matching_info vs matching_features и т.п.)
 *    остаётся runner qtype — источник (.q-instruction) семантически точнее
 *    структурного HTML-парса atom.
 */
export function selectQtypeFixes(
  section: "reading" | "listening",
  mismatches: QtypeMismatch[],
  fixQtypeFlag: boolean,
): number[] {
  if (section === "listening") {
    return mismatches
      .filter((m) => m.dbQtype === "mcq_single" && m.parsedQtype === "mcq_multi")
      .map((m) => m.number);
  }
  return fixQtypeFlag ? mismatches.map((m) => m.number) : [];
}

/** Метка для отчёта — какой парсер реально сработал (по итогу parseTest, не по DB-полям). */
export function parserLabel(parsed: { section: string; category: string }): string {
  if (parsed.section === "listening") return "parse-listening (via parseTest)";
  if (parsed.category === "full_reading") return "parse-reading-full (via parseTest)";
  return "parse-test (single passage)";
}

/* --------------------------------- CLI ----------------------------------- */
const invokedDirectly =
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const { config } = await import("dotenv");
  config({ path: join(HERE, "..", ".env.local") });

  const dry = process.argv.includes("--dry");
  const fixQtype = process.argv.includes("--fix-qtype");

  const { db } = await import("../src/db/index.ts");
  const { eq, and, sql } = await import("drizzle-orm");
  const {
    passage: passageT,
    question: questionT,
    contentItem: contentItemT,
  } = await import("../src/db/schema.ts");
  const { parseTest } = await import("../src/lib/import/parse-test.ts");
  const { createServiceClient } = await import("../src/lib/supabase/service.ts");

  interface DbRow {
    id: string;
    title: string;
    source_file_path: string | null;
    section: "reading" | "listening";
  }

  // Reading: только published (как было). Listening: published + draft — "Day 6
  // Full Test 6" и published в целом можно бэкфиллить сразу, а draft "Cambridge 21
  // Test 3" атомизируем заранее, аудио владелец привяжет позже (публикация решается
  // отдельно от атомизации). Оба section идут через один и тот же 1:1-гейт и
  // planPassages; qtype/question_types-политика для listening — см. selectQtypeFixes
  // и hasMapLabelling ниже.
  const rows = (await db.execute(sql`
    SELECT id, title, source_file_path, section
    FROM content_item
    WHERE runner_html IS NOT NULL
      AND (
        (section = 'reading' AND status = 'published') OR
        (section = 'listening' AND status IN ('published', 'draft'))
      )
    ORDER BY title
  `)) as unknown as DbRow[];

  const supabase = createServiceClient();

  async function loadSourceHtml(row: DbRow): Promise<string | null> {
    const { data, error } = await supabase.storage.from("source-html").download(`${row.id}.html`);
    if (!error && data) return await data.text();
    const local = resolveSourceFile(row.source_file_path);
    if (local) return readFileSync(local, "utf8");
    return null;
  }

  let processed = 0;
  let skippedNoSource = 0;
  let skippedParseError = 0;
  let skippedGate = 0;
  let skippedMapLabelling = 0;

  for (const row of rows) {
    const html = await loadSourceHtml(row);
    if (!html) {
      skippedNoSource++;
      console.log(`SKIP ${row.id} "${row.title}" — no source HTML (bucket + local fallback both missed)`);
      continue;
    }

    let parsed: ReturnType<typeof parseTest>;
    try {
      parsed = parseTest(html);
    } catch (e) {
      skippedParseError++;
      console.log(`SKIP ${row.id} "${row.title}" — parse error: ${String((e as Error)?.message ?? e)}`);
      continue;
    }

    const dbPassages = await db
      .select({ id: passageT.id, order: passageT.order, bodyHtml: passageT.bodyHtml })
      .from(passageT)
      .where(eq(passageT.contentItemId, row.id));
    const dbQuestions = await db
      .select({ id: questionT.id, number: questionT.number, qtype: questionT.qtype })
      .from(questionT)
      .where(eq(questionT.contentItemId, row.id));

    if (row.section === "listening" && hasMapLabelling(dbQuestions)) {
      skippedMapLabelling++;
      console.log(
        `SKIP ${row.id} "${row.title}" — map_labelling questions need the map image (deferred)`,
      );
      continue;
    }

    const gate = checkQuestionNumberGate(
      parsed.questions.map((q) => q.number),
      dbQuestions.map((q) => q.number),
    );
    if (!gate.ok) {
      skippedGate++;
      console.log(
        `SKIP ${row.id} "${row.title}" — question-number gate failed ` +
          `(parsed-not-in-db: [${gate.missing.join(",")}], db-not-in-parsed: [${gate.extra.join(",")}], ` +
          `parsed-duplicates: [${gate.duplicates.join(",")}])`,
      );
      continue;
    }

    const passagePlan = planPassages(
      parsed.passages.map((p) => p.order),
      dbPassages,
    );
    const qtypeMismatches = findQtypeMismatches(
      parsed.questions.map((q) => ({ number: q.number, qtype: q.qtype })),
      dbQuestions.map((q) => ({ number: q.number, qtype: q.qtype })),
    );
    // listening: --fix-qtype игнорируется, только mcq_single -> mcq_multi promotion.
    // reading: поведение --fix-qtype не изменилось (см. selectQtypeFixes).
    const selectedFixNumbers = new Set(selectQtypeFixes(row.section, qtypeMismatches, fixQtype));

    const inserts = passagePlan.filter((p) => p.action === "insert").length;
    const updates = passagePlan.filter((p) => p.action === "update").length;
    const skips = passagePlan.filter((p) => p.action === "skip-has-content").length;

    console.log(
      `${dry ? "[dry] " : ""}OK ${row.id} "${row.title}" via ${parserLabel(parsed)}: ` +
        `passages insert=${inserts} update=${updates} skip-has-content=${skips}; ` +
        `questions update=${parsed.questions.length}` +
        (qtypeMismatches.length ? `; qtype mismatches=${qtypeMismatches.length}` : ""),
    );
    for (const m of qtypeMismatches) {
      const applying = selectedFixNumbers.has(m.number) ? " (applying)" : "";
      console.log(`    Q${m.number}: db=${m.dbQtype} -> parsed=${m.parsedQtype}${applying}`);
    }

    // content_item.question_types (каталог-фильтр) для listening пересчитывается
    // из ИТОГОВЫХ qtype строк БД после апдейта (та же логика, что atomize-merge.ts:
    // [...new Set(...)]) — не изменённые qtype остаются db-значением, применённые
    // фиксы (selectedFixNumbers) берутся из parsed. Reading не трогаем.
    let listeningQuestionTypes: string[] | null = null;
    if (row.section === "listening") {
      const dbQtypeByNumber = new Map(dbQuestions.map((q) => [q.number, q.qtype]));
      const finalQtypes = parsed.questions.map((q) =>
        selectedFixNumbers.has(q.number) ? q.qtype : dbQtypeByNumber.get(q.number)!,
      );
      listeningQuestionTypes = [...new Set(finalQtypes)];
      console.log(
        `    ${dry ? "[dry] would set" : "question_types ->"} [${listeningQuestionTypes.join(", ")}]`,
      );
    }

    if (!dry) {
      await db.transaction(async (tx) => {
        const passageIdByOrder = new Map(dbPassages.map((p) => [p.order, p.id]));
        for (const p of parsed.passages) {
          const action = passagePlan.find((a) => a.order === p.order)!;
          if (action.action === "insert") {
            const [inserted] = await tx
              .insert(passageT)
              .values({
                contentItemId: row.id,
                order: p.order,
                title: p.title,
                bodyHtml: p.bodyHtml,
                // Никогда не изобретаем audio_path: null у новых частей — плеер берёт
                // первый непустой path среди passages теста (см. parse-listening.ts).
                audioPath: null,
                questionsHtml: p.questionsHtml ?? null,
              })
              .returning({ id: passageT.id });
            passageIdByOrder.set(p.order, inserted!.id);
          } else if (action.action === "update") {
            await tx
              .update(passageT)
              .set({ title: p.title, bodyHtml: p.bodyHtml, questionsHtml: p.questionsHtml ?? null })
              .where(and(eq(passageT.contentItemId, row.id), eq(passageT.order, p.order)));
          }
          // skip-has-content: строку не трогаем вообще.
        }

        const fallbackPassageId = passageIdByOrder.get(1) ?? [...passageIdByOrder.values()][0]!;
        for (const q of parsed.questions) {
          await tx
            .update(questionT)
            .set({
              promptHtml: q.promptHtml,
              options: q.options,
              groupKey: q.groupKey,
              passageId: passageIdByOrder.get(q.passageOrder) ?? fallbackPassageId,
              // Применяем ТОЛЬКО выбранные selectQtypeFixes (см. шапку файла): reading
              // — все расхождения под --fix-qtype, listening — только mcq_single ->
              // mcq_multi promotion. Каст безопасен: parsed qtype прошёл канон-маппинг
              // question-types.ts, просто ParsedQuestion типизирует поле как string.
              ...(selectedFixNumbers.has(q.number)
                ? { qtype: q.qtype as NonNullable<(typeof questionT.$inferInsert)["qtype"]> }
                : {}),
            })
            .where(and(eq(questionT.contentItemId, row.id), eq(questionT.number, q.number)));
        }

        if (listeningQuestionTypes) {
          await tx
            .update(contentItemT)
            .set({ questionTypes: listeningQuestionTypes })
            .where(eq(contentItemT.id, row.id));
        }
      });
    }

    processed++;
  }

  console.log(`\n--- summary ---`);
  console.log(
    `candidates (runner_html IS NOT NULL; reading published, listening published+draft): ${rows.length}`,
  );
  console.log(`${dry ? "would process" : "processed"}: ${processed}`);
  console.log(`skipped — no source: ${skippedNoSource}`);
  console.log(`skipped — parse error: ${skippedParseError}`);
  console.log(`skipped — question-number gate mismatch: ${skippedGate}`);
  console.log(`skipped — map_labelling (deferred, listening only): ${skippedMapLabelling}`);

  process.exit(0);
}
