// Публичная share-карточка (G1-5): что попадает на картинку. Тексты и выбор
// слабейшего типа — чистые функции, проверяются без БД и без рендера.
import { describe, it, expect } from "vitest";
import {
  shareDescription,
  shareScoreCaption,
  shareScoreLabel,
  shareTitle,
  weakestType,
} from "./share-card";

describe("weakestType", () => {
  it("минимальная доля правильных, а не минимальное число ошибок", () => {
    const breakdown = {
      tfng: { correct: 8, total: 10 }, // 0.8, ошибок 2
      matching_headings: { correct: 1, total: 3 }, // 0.33, ошибка 2 — но доля хуже
    };
    expect(weakestType(breakdown)).toBe("matching_headings");
  });

  it("полностью верная попытка не имеет слабого типа (не выдумываем слабость)", () => {
    expect(weakestType({ tfng: { correct: 5, total: 5 }, mcq_single: { correct: 3, total: 3 } })).toBeNull();
  });

  it("пустой/отсутствующий breakdown → null", () => {
    expect(weakestType(null)).toBeNull();
    expect(weakestType({})).toBeNull();
  });

  it("битые листья пропускаются, а не роняют рендер", () => {
    const breakdown = {
      broken: null as unknown as { correct: number; total: number },
      zero: { correct: 0, total: 0 }, // деление на ноль не должно победить
      tfng: { correct: 2, total: 4 },
    };
    expect(weakestType(breakdown)).toBe("tfng");
  });
});

describe("тексты карточки", () => {
  it("band показывается как есть, без округлений вверх", () => {
    expect(shareScoreLabel(6.5, 72)).toBe("6.5");
    expect(shareScoreCaption(6.5)).toBe("IELTS band");
    expect(shareTitle(shareScoreLabel(6.5, 72), 6.5)).toBe("IELTS band 6.5 on bando");
  });

  it("без band-шкалы (не 40Q) карточка честно показывает процент", () => {
    expect(shareScoreLabel(null, 72)).toBe("72%");
    expect(shareScoreCaption(null)).toBe("correct answers");
    expect(shareTitle(shareScoreLabel(null, 72), null)).toBe("72% correct on bando");
  });

  it("описание называет слабый тип, а без него — хвалит чистую попытку", () => {
    expect(shareDescription("Volume 8 Test 6", "Matching Headings")).toContain("Matching Headings");
    expect(shareDescription("Volume 8 Test 6", null)).toContain("every question type clean");
  });
});
