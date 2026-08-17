// Юнит-тесты сборщика review-snapshot (D3). Контракт: строки ключа (загружены на
// submit) → стабильная форма {questions:[{number,qtype,mode,accept,explanation,
// explanationRu,evidence}]}; не-массив accept → [], отсутствующие
// explanation/explanationRu/evidence → null.
import { describe, it, expect } from "vitest";
import { buildReviewSnapshot, normalizeEvidence } from "./review-snapshot";

describe("buildReviewSnapshot", () => {
  it("маппит строки ключа в snapshot (accept/explanation/explanationRu/evidence)", () => {
    const snap = buildReviewSnapshot([
      {
        number: 1,
        qtype: "tfng",
        mode: "exact",
        accept: ["TRUE"],
        explanation: "why",
        explanationRu: "почему",
        evidence: { para: "p1", snippet: "s" },
      },
      {
        number: 2,
        qtype: "sentence_completion",
        mode: "text_accept",
        accept: ["journal", "journals"],
        explanation: null,
        explanationRu: null,
        evidence: null,
      },
    ]);
    expect(snap.questions).toHaveLength(2);
    expect(snap.questions[0]).toEqual({
      number: 1,
      qtype: "tfng",
      mode: "exact",
      accept: ["TRUE"],
      explanation: "why",
      explanationRu: "почему",
      evidence: { para: "p1", snippet: "s" },
    });
    expect(snap.questions[1].evidence).toBeNull();
  });

  it("нормализует не-массив accept → [] и отсутствующие explanation/explanationRu/evidence → null", () => {
    const snap = buildReviewSnapshot([
      {
        number: 1,
        qtype: "short_answer",
        mode: "exact",
        accept: null,
        explanation: undefined,
        explanationRu: undefined,
        evidence: undefined,
      },
    ]);
    expect(snap.questions[0].accept).toEqual([]);
    expect(snap.questions[0].explanation).toBeNull();
    expect(snap.questions[0].explanationRu).toBeNull();
    expect(snap.questions[0].evidence).toBeNull();
  });
});

describe("normalizeEvidence — {part, text} alias (импорт кладёт evidence несогласованно)", () => {
  it("канон {para, snippet} проходит как есть", () => {
    expect(normalizeEvidence({ para: "p1", snippet: "s" })).toEqual({ para: "p1", snippet: "s" });
  });

  it("{part, text} нормализуется в {para, snippet} (part — число)", () => {
    expect(normalizeEvidence({ part: 1, text: "It had to be playable" })).toEqual({
      para: "1",
      snippet: "It had to be playable",
    });
  });

  it("нет snippet/text ни в каком виде → null (реально пусто)", () => {
    expect(normalizeEvidence({ para: "p1" })).toBeNull();
    expect(normalizeEvidence({})).toBeNull();
    expect(normalizeEvidence(null)).toBeNull();
    expect(normalizeEvidence("garbage")).toBeNull();
  });
});
