// Инвариант приватности публичного предиктора (G1-6): в браузер уходит проекция
// БЕЗ ключей. Модуль банка ещё и `server-only` — попытка импортировать его из
// клиентского компонента ломает сборку; этот тест закрывает вторую половину: сама
// проекция не должна протаскивать ответ ни в каком поле.
import { describe, it, expect } from "vitest";
import { PREDICTOR_QUESTIONS, PUBLIC_QUESTIONS, toPublic } from "./bank";

describe("публичная проекция вопросов", () => {
  it("ни в одном публичном вопросе нет поля с ответами", () => {
    for (const q of PUBLIC_QUESTIONS) {
      expect(Object.keys(q)).not.toContain("accept");
      expect(JSON.stringify(q)).not.toContain("accept");
    }
  });

  it("проекция сохраняет всё, что нужно для рендера", () => {
    const src = PREDICTOR_QUESTIONS[0]!;
    const pub = toPublic(src);
    expect(pub.number).toBe(src.number);
    expect(pub.prompt).toBe(src.prompt);
    expect(pub.qtype).toBe(src.qtype);
    expect(pub.options).toEqual(src.options);
  });

  it("банк консистентен: номера уникальны и подряд, у каждого вопроса есть ключ", () => {
    const numbers = PREDICTOR_QUESTIONS.map((q) => q.number);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    for (const q of PREDICTOR_QUESTIONS) {
      expect(q.accept.length).toBeGreaterThan(0);
      expect(q.accept.every((a) => a.trim() !== "")).toBe(true);
      // У вопросов с вариантами правильный обязан быть СРЕДИ них — иначе вопрос
      // нерешаем, и это не поймал бы ни один другой тест.
      if (q.options) expect(q.options.some((o) => q.accept.includes(o))).toBe(true);
    }
  });
});
