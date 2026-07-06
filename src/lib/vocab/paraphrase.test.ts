// Юнит-тесты Paraphrase Sprint (чистая логика, без IO). Проверяем детерминизм,
// отсутствие дублей, обязательное присутствие правильного слова и корректный отбор
// синонима-промпта.
import { describe, it, expect } from "vitest";
import { hashString, buildParaphraseQuestion, type ParaphraseCard } from "./paraphrase";

/** Пул из n карт word-1..word-n с одним синонимом у каждой (для отбора дистракторов). */
function makePool(n: number): ParaphraseCard[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `id-${i}`,
    word: `word-${i}`,
    synonyms: [`syn-${i}`],
  }));
}

describe("hashString", () => {
  it("детерминирован для одного входа", () => {
    expect(hashString("id-1")).toBe(hashString("id-1"));
  });

  it("беззнаковое 32-битное целое", () => {
    const h = hashString("любая строка ★");
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });

  it("разные входы дают (как правило) разные хэши", () => {
    expect(hashString("alpha")).not.toBe(hashString("beta"));
  });
});

describe("buildParaphraseQuestion", () => {
  it("null, если у карты нет synonyms", () => {
    const card: ParaphraseCard = { id: "a", word: "mitigate", synonyms: null };
    expect(buildParaphraseQuestion(card, makePool(5))).toBeNull();
  });

  it("null, если synonyms только из пустых строк", () => {
    const card: ParaphraseCard = { id: "a", word: "mitigate", synonyms: ["  ", ""] };
    expect(buildParaphraseQuestion(card, makePool(5))).toBeNull();
  });

  it("null, если в пуле нет других карт (нельзя собрать 2 опции)", () => {
    const card: ParaphraseCard = { id: "solo", word: "mitigate", synonyms: ["reduce"] };
    expect(buildParaphraseQuestion(card, [card])).toBeNull();
  });

  it("правильное слово всегда среди опций", () => {
    const card: ParaphraseCard = { id: "a", word: "mitigate", synonyms: ["reduce", "lessen"] };
    const q = buildParaphraseQuestion(card, makePool(6));
    expect(q).not.toBeNull();
    expect(q!.options).toContain("mitigate");
  });

  it("синоним-промпт — один из (очищенных) synonyms карты", () => {
    const card: ParaphraseCard = { id: "a", word: "mitigate", synonyms: ["reduce", "lessen", "alleviate"] };
    const q = buildParaphraseQuestion(card, makePool(6));
    expect(["reduce", "lessen", "alleviate"]).toContain(q!.synonym);
  });

  it("нет дублей среди опций", () => {
    const card: ParaphraseCard = { id: "a", word: "mitigate", synonyms: ["reduce"] };
    const q = buildParaphraseQuestion(card, makePool(8));
    expect(new Set(q!.options).size).toBe(q!.options.length);
  });

  it("детерминизм: два вызова с теми же входами дают идентичный результат", () => {
    const card: ParaphraseCard = { id: "deadbeef", word: "mitigate", synonyms: ["reduce", "lessen"] };
    const pool = makePool(10);
    expect(buildParaphraseQuestion(card, pool)).toEqual(buildParaphraseQuestion(card, pool));
  });

  it("4 опции при достаточном пуле (слово + 3 дистрактора)", () => {
    const card: ParaphraseCard = { id: "a", word: "mitigate", synonyms: ["reduce"] };
    expect(buildParaphraseQuestion(card, makePool(10))!.options).toHaveLength(4);
  });

  it("2 опции при единственном другом слове в пуле", () => {
    const card: ParaphraseCard = { id: "a", word: "mitigate", synonyms: ["reduce"] };
    const pool: ParaphraseCard[] = [card, { id: "b", word: "expand", synonyms: null }];
    const q = buildParaphraseQuestion(card, pool);
    expect(q!.options).toHaveLength(2);
    expect(q!.options).toContain("mitigate");
    expect(q!.options).toContain("expand");
  });

  it("3 опции при двух других словах в пуле", () => {
    const card: ParaphraseCard = { id: "a", word: "mitigate", synonyms: ["reduce"] };
    const pool: ParaphraseCard[] = [
      card,
      { id: "b", word: "expand", synonyms: null },
      { id: "c", word: "persist", synonyms: null },
    ];
    expect(buildParaphraseQuestion(card, pool)!.options).toHaveLength(3);
  });

  it("дистрактор не совпадает со словом карты (дедуп по регистру)", () => {
    const card: ParaphraseCard = { id: "a", word: "Mitigate", synonyms: ["reduce"] };
    const pool: ParaphraseCard[] = [
      card,
      { id: "b", word: "mitigate", synonyms: null }, // тот же токен в другом регистре
      { id: "c", word: "expand", synonyms: null },
    ];
    const q = buildParaphraseQuestion(card, pool)!;
    // "mitigate"/"Mitigate" схлопнулись в одно → остаётся только "expand" как дистрактор.
    expect(q.options).toHaveLength(2);
    expect(q.options).toContain("Mitigate");
    expect(q.options).toContain("expand");
  });

  it("слово пула, совпадающее с синонимом карты, не попадает в дистракторы", () => {
    // Коллизия контента: headword другой карты = синоним текущей. Такая опция была бы
    // семантически верной, но сервер эталоном держит только card.word — исключаем.
    const card: ParaphraseCard = { id: "a", word: "mitigate", synonyms: ["alleviate", "reduce"] };
    const pool: ParaphraseCard[] = [
      card,
      { id: "b", word: "Alleviate", synonyms: null },
      { id: "c", word: "Reduce", synonyms: null },
      { id: "d", word: "expand", synonyms: null },
    ];
    const q = buildParaphraseQuestion(card, pool)!;
    expect(q.options).toContain("mitigate");
    expect(q.options).toContain("expand");
    expect(q.options.map((w) => w.toLowerCase())).not.toContain("alleviate");
    expect(q.options.map((w) => w.toLowerCase())).not.toContain("reduce");
  });

  it("разные карты (как правило) выбирают разные наборы дистракторов", () => {
    const pool = makePool(12);
    const cardA: ParaphraseCard = { id: "id-a", word: "mitigate", synonyms: ["reduce"] };
    const cardB: ParaphraseCard = { id: "id-b", word: "mitigate", synonyms: ["reduce"] };
    const a = buildParaphraseQuestion(cardA, pool)!;
    const b = buildParaphraseQuestion(cardB, pool)!;
    // Наборы дистракторов (без правильного слова) не обязаны, но должны различаться
    // на этих id — доказывает, что отбор зависит от card.id, а не фиксирован.
    expect(a.options).not.toEqual(b.options);
  });
});
