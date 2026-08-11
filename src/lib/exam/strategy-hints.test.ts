// Юнит-тесты strategy-hints (P2b): справочный контент зависит ТОЛЬКО от qtype и
// покрывает все 17 слагов canon-enum. Относительный импорт (как в format-guard.test).
import { describe, it, expect } from "vitest";
import { STRATEGY_HINTS, strategyHints } from "./strategy-hints";

// Зеркалит questionType pgEnum (src/db/schema.ts). Держим локально, чтобы тест ловил
// расхождение «новый тип в enum — забыли подсказку» без импорта drizzle-схемы.
const CANON_QTYPES = [
  "tfng",
  "ynng",
  "mcq_single",
  "mcq_multi",
  "matching_headings",
  "matching_info",
  "matching_features",
  "matching_sentence_endings",
  "sentence_completion",
  "summary_completion",
  "note_completion",
  "flowchart_completion",
  "table_completion",
  "diagram_label",
  "map_labelling",
  "form_completion",
  "short_answer",
] as const;

describe("strategyHints", () => {
  it("покрывает все 17 canon-типов, по 2–4 непустых буллета", () => {
    for (const q of CANON_QTYPES) {
      const bullets = strategyHints(q);
      expect(bullets.length, `нет подсказок для ${q}`).toBeGreaterThanOrEqual(2);
      expect(bullets.length, `слишком много подсказок для ${q}`).toBeLessThanOrEqual(4);
      for (const b of bullets) {
        expect(typeof b).toBe("string");
        expect(b.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("не содержит лишних ключей сверх canon-enum", () => {
    expect(Object.keys(STRATEGY_HINTS).sort()).toEqual([...CANON_QTYPES].sort());
  });

  it("возвращает пустой массив для неизвестного типа (best-effort)", () => {
    expect(strategyHints("nonexistent_type")).toEqual([]);
    expect(strategyHints("")).toEqual([]);
  });
});
