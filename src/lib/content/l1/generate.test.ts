import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted: the vi.mock factory is hoisted above this line, so the mock fn it
// references must be hoisted too (mirrors src/lib/writing/evaluator/gemini.test.ts).
const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(function () {
    return { models: { generateContent } };
  }),
}));
// env exposes l1GenConfig() (getter style), not a bare env object — see src/env.ts.
vi.mock("@/env", () => ({ l1GenConfig: () => ({ apiKey: "test-key", model: "gemini-2.5-flash-lite" }) }));

import { buildL1Prompt, generateL1ForPassage, withTransientRetry, L1_PROMPT_VERSION, type L1PassageInput } from "./generate";

const passageInput: L1PassageInput = {
  passageBodyHtml: "<p>Mining began in the region in <b>1850</b>.</p>",
  questions: [
    {
      number: 1,
      qtype: "tfng",
      promptHtml: "<span>Mining started before 1900.</span>",
      options: null,
      accept: ["TRUE"],
      explanationEn: null,
      evidenceSnippet: "Mining began in the region in 1850",
    },
    {
      number: 2,
      qtype: "mcq_single",
      promptHtml: "<span>What year did mining begin?</span>",
      options: ["1820", "1850", "1900"],
      accept: ["B"],
      explanationEn: "The passage states 1850.",
      evidenceSnippet: null,
    },
  ],
};

describe("buildL1Prompt", () => {
  it("strips HTML and embeds passage text in a delimited block", () => {
    const p = buildL1Prompt(passageInput);
    expect(p).toContain("Mining began in the region in 1850.");
    expect(p).not.toContain("<b>");
    expect(p).toContain("<passage>");
    expect(p).toContain("</passage>");
  });

  it("embeds each question with number, type, options, evidence and accept", () => {
    const p = buildL1Prompt(passageInput);
    expect(p).toContain('<question number="1" type="tfng">');
    expect(p).toContain("Mining started before 1900.");
    expect(p).toContain('Evidence in text: "Mining began in the region in 1850"');
    expect(p).toContain("Correct answer: TRUE");
    expect(p).toContain('<question number="2" type="mcq_single">');
    expect(p).toContain("Options: 1820 | 1850 | 1900");
    expect(p).toContain("English hint (do not translate literally): The passage states 1850.");
  });

  it("instructs Russian-only output aimed at a B1-B2 student", () => {
    const p = buildL1Prompt(passageInput);
    expect(p).toContain("ПО-РУССКИ");
    expect(p).toContain("B1-B2");
  });

  it("carries an injection guard for passage/question content", () => {
    const p = buildL1Prompt(passageInput).toLowerCase();
    expect(p).toContain("injection guard");
    expect(p).toContain("данные для анализа");
  });

  it("falls back to a no-transcript note when the passage has no text (listening)", () => {
    const p = buildL1Prompt({ ...passageInput, passageBodyHtml: "" });
    expect(p).toContain("(no transcript — listening question)");
    expect(p).toContain("Evidence in text");
  });

  it("has a stable prompt version", () => {
    expect(L1_PROMPT_VERSION).toBe("l1-v1");
  });
});

const validResponse = {
  items: [
    { number: 1, explanation: "В тексте сказано, что добыча началась в 1850 году, это раньше 1900." },
    { number: 2, explanation: "В тексте прямо указан 1850 год, остальные варианты не упоминаются." },
  ],
};

beforeEach(() => generateContent.mockReset());

describe("generateL1ForPassage", () => {
  it("returns validated items on a valid response", async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify(validResponse) });
    const items = await generateL1ForPassage(passageInput);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual(validResponse.items[0]);
  });

  it("throws on a schema-invalid response (caller handles per-passage)", async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify({ items: [{ number: 1 }] }) });
    await expect(generateL1ForPassage(passageInput)).rejects.toThrow();
  });

  it("throws when the model returns non-JSON", async () => {
    generateContent.mockResolvedValue({ text: "I cannot help with that." });
    await expect(generateL1ForPassage(passageInput)).rejects.toThrow();
  });

  it("не ретраит не-JSON ответ, даже если его текст выглядит транзиентом", async () => {
    // SyntaxError от JSON.parse цитирует вход — «UNAVAILABLE» в тексте модели не
    // должен уводить детерминированный сбой в ретрай (парсинг живёт вне ретрая).
    generateContent.mockResolvedValue({ text: "UNAVAILABLE" });
    await expect(generateL1ForPassage(passageInput)).rejects.toThrow();
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("requests JSON with a responseSchema and a maxOutputTokens cap", async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify(validResponse) });
    await generateL1ForPassage(passageInput);
    const { config } = generateContent.mock.calls[0][0];
    expect(config.responseMimeType).toBe("application/json");
    expect(config.responseSchema).toBeTruthy();
    expect(config.maxOutputTokens).toBeGreaterThan(0);
    // thinking выключен явно: его токены входят в maxOutputTokens и обрезали JSON.
    expect(config.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });

});

// Ретрай тестируется на чистых замыканиях, НЕ через vi.fn-мок SDK: трекинг результатов
// vi.fn вешает на реджект мока собственный промис и ложно валит соседний тест
// unhandled-rejection детектором vitest. Нулевые задержки — чтобы не спать 2s/6s.
describe("withTransientRetry", () => {
  // Формат message — фактический из прод-error_log (SDK кладёт JSON-тело в message).
  const transient503 = () =>
    new Error('{"error":{"code":503,"message":"high demand","status":"UNAVAILABLE"}}');
  const NO_DELAYS = [0, 0] as const;

  it("ретраит транзиентный 503 и возвращает результат со второй попытки", async () => {
    let calls = 0;
    const result = await withTransientRetry(async () => {
      calls++;
      if (calls === 1) throw transient503();
      return "ok";
    }, NO_DELAYS);
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("после исчерпания повторов транзиент всё же пробрасывается", async () => {
    let calls = 0;
    await expect(
      withTransientRetry(async () => {
        calls++;
        throw transient503();
      }, NO_DELAYS),
    ).rejects.toThrow(/503/);
    expect(calls).toBe(3); // 1 + 2 ретрая
  });

  it("числовой ApiError.status (408) — транзиент, ретраится", async () => {
    class FakeApiError extends Error {
      status = 408;
    }
    let calls = 0;
    const result = await withTransientRetry(async () => {
      calls++;
      if (calls === 1) throw new FakeApiError("Request Timeout");
      return "ok";
    }, NO_DELAYS);
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("числовой status 400 — НЕ транзиент, не ретраится", async () => {
    class FakeApiError extends Error {
      status = 400;
    }
    let calls = 0;
    await expect(
      withTransientRetry(async () => {
        calls++;
        // message с «UNAVAILABLE» не должен перебивать числовой не-транзиентный статус
        throw new FakeApiError("thinkingBudget invalid; UNAVAILABLE mentioned in body");
      }, NO_DELAYS),
    ).rejects.toThrow(/thinkingBudget/);
    expect(calls).toBe(1);
  });

  it("сетевой fetch failed — тоже транзиент", async () => {
    let calls = 0;
    const result = await withTransientRetry(async () => {
      calls++;
      if (calls === 1) throw new TypeError("fetch failed");
      return "ok";
    }, NO_DELAYS);
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("детерминированный сбой (parse/schema) НЕ ретраится", async () => {
    let calls = 0;
    await expect(
      withTransientRetry(async () => {
        calls++;
        JSON.parse("not json"); // тот же класс ошибки, что обрезанный ответ модели
        return "unreachable";
      }, NO_DELAYS),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
