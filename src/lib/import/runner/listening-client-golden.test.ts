// Golden-фикстура клиентского listening-канона (Задача A/B, 2026-07-22): реальный
// Cambridge 21 Listening Test 2 файл, committed байт-в-байт (fixtures/listening-client.html).
// Зеркалит структуру golden-тестов reading-inspera (parse-runner.test.ts / parse-reading-
// full.test.ts) — интегральная проверка ВСЕГО файла через оба пути (runner + atom) и мержа,
// а не точечные inline-фикстуры.
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseRunner } from "./parse-runner";
import { parseTest } from "../parse-test";
import { mergeAtomization } from "./atomize-merge";
import { questionsHtmlCoversAll } from "../../exam/question-html-coverage";

const GOLDEN = readFileSync(
  fileURLToPath(new URL("./fixtures/listening-client.html", import.meta.url)),
  "utf8",
);

// Номера вопросов по частям — из q-instruction/data-part разметки файла (Part 1: 1-10,
// Part 2: 11-20, Part 3: 21-30, Part 4: 31-40).
const PART_QUESTION_NUMBERS: Record<number, number[]> = {
  1: Array.from({ length: 10 }, (_, i) => i + 1),
  2: Array.from({ length: 10 }, (_, i) => i + 11),
  3: Array.from({ length: 10 }, (_, i) => i + 21),
  4: Array.from({ length: 10 }, (_, i) => i + 31),
};

describe("listening-client golden fixture — parseRunner", () => {
  let r: Awaited<ReturnType<typeof parseRunner>>;
  beforeAll(async () => {
    r = await parseRunner(GOLDEN);
  });

  it("section listening, 40 вопросов, 0 warnings", () => {
    expect(r.parsed.section).toBe("listening");
    expect(r.parsed.questions).toHaveLength(40);
    expect(r.parsed.warnings).toHaveLength(0);
  });

  it("externalAudioSrc — archive.org ссылка из файла", () => {
    expect(r.externalAudioSrc).toBe(
      "https://archive.org/download/c-21-t-2-full/C21T2_full.mp3",
    );
  });

  it("bandScale материализуется 0..40 (41 строка) из band(r)", () => {
    expect(r.parsed.bandScale).not.toBeNull();
    expect(Object.keys(r.parsed.bandScale!)).toHaveLength(41);
    expect(r.parsed.bandScale!["40"]).toBe(9);
    expect(r.parsed.bandScale!["0"]).toBe(2); // band(r) файла не проваливается до 0
  });

  // QTYPE — range-builder IIFE (set(a,b,t) в цикле), не статичный литерал; парсер
  // восстанавливает его через extractRangeBuilderTable (см. parse-runner.ts).
  it("qtype-распределение зафиксировано точно (QTYPE range-builder)", () => {
    const dist: Record<string, number> = {};
    for (const q of r.parsed.questions) dist[q.qtype] = (dist[q.qtype] ?? 0) + 1;
    expect(dist).toEqual({
      table_completion: 10,
      mcq_single: 10,
      map_labelling: 6,
      flowchart_completion: 4,
      note_completion: 10,
    });
  });
});

describe("listening-client golden fixture — parseTest (atom-путь)", () => {
  let t: Awaited<ReturnType<typeof parseTest>>;
  beforeAll(async () => {
    t = await parseTest(GOLDEN);
  });

  it("4 части, 40 вопросов, 0 warnings", () => {
    expect(t.section).toBe("listening");
    expect(t.passages).toHaveLength(4);
    expect(t.questions).toHaveLength(40);
    expect(t.warnings).toHaveLength(0);
  });

  it("у каждой из 4 частей непустой questionsHtml (verbatim-панель захвачена)", () => {
    for (const p of t.passages) {
      expect(p.questionsHtml).toBeTruthy();
      expect(p.questionsHtml!.length).toBeGreaterThan(0);
    }
  });

  it("questionsHtmlCoversAll — каждая часть покрывает ВСЕ свои номера вопросов", () => {
    for (const p of t.passages) {
      const nums = PART_QUESTION_NUMBERS[p.order];
      expect(nums).toBeDefined();
      expect(questionsHtmlCoversAll(p.questionsHtml ?? "", nums)).toBe(true);
    }
  });

  // Анти-утечка (BRIEF §6.1): verbatim-захват не должен нести исполняемый код, base64/
  // внешние data-URI, инлайн-обработчики или следы ключа/транскрипта/answer-reveal.
  it("captured questionsHtml — leak-скан всех 4 частей чист", () => {
    const captured = t.passages
      .map((p) => p.questionsHtml)
      .filter((h): h is string => h != null)
      .join("\n");
    expect(captured.length).toBeGreaterThan(0);
    expect(captured).not.toMatch(/<script/i);
    expect(captured).not.toMatch(/data:/i);
    expect(captured).not.toMatch(/\son\w+\s*=/i);
    expect(captured).not.toMatch(/\bKEY\b/);
    expect(captured).not.toMatch(/transcript/i);
    expect(captured).not.toMatch(/class="analysis"/i);
    expect(captured).not.toMatch(/data-analysis/i);
    // Общий паттерн answer-reveal атрибутов (data-correct="…"/data-answer="…"/…), а не
    // только конкретные имена выше — ловит любой источник с иным неймингом.
    expect(captured).not.toMatch(/[\w-]*(correct|answer|solution)[\w-]*\s*=\s*"/i);
    // Конкретные ответы из KEY (Part 4 gap-заполнение), которых НЕТ в легитимном тексте
    // вопросов — в отличие, например, от "cost" (легитимный заголовок колонки в Part 1,
    // KEY[32] тоже содержит "tax", но "cost" как слово в разметке — не answer-leak).
    for (const word of ["pollution", "diving", "vegan"]) {
      expect(captured.toLowerCase()).not.toContain(word);
    }
  });
});

describe("listening-client golden fixture — mergeAtomization", () => {
  it("atomized=true; choose-TWO промотирован в mcq_multi; все 40 номеров на месте; questionsHtml сохранён", async () => {
    const runner = (await parseRunner(GOLDEN)).parsed;
    const atom = await parseTest(GOLDEN);
    const merged = mergeAtomization(runner, atom);

    expect(merged.atomized).toBe(true);

    const numbers = merged.parsed.questions.map((q) => q.number).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));

    const dist = new Set(merged.parsed.questions.map((q) => q.qtype));
    expect(dist.has("mcq_multi")).toBe(true);
    // Top-level questionTypes (персистится в content_item, каталог-фильтр) пересчитан из
    // итоговых qtype после промоции — точный отсортированный набор, без mcq_single.
    expect([...merged.parsed.questionTypes].sort()).toEqual(
      ["flowchart_completion", "map_labelling", "mcq_multi", "note_completion", "table_completion"].sort(),
    );
    // Все runner-mcq_single (Q11-14, Q21-26 — choose-TWO по разметке .mcq.multi) промотированы;
    // остальные типы (table/note/flowchart/map) остаются runner-семантикой.
    const byType: Record<string, number> = {};
    for (const q of merged.parsed.questions) byType[q.qtype] = (byType[q.qtype] ?? 0) + 1;
    expect(byType).toEqual({
      table_completion: 10,
      mcq_multi: 10,
      map_labelling: 6,
      flowchart_completion: 4,
      note_completion: 10,
    });

    for (const p of merged.parsed.passages) {
      expect(p.questionsHtml).toBeTruthy();
    }
  });
});
