// Разбор вариантов ответа (G2-1). Живая проверка на проде поймала здесь настоящий
// баг: `question.options` хранит объекты `{label, value}`, а разбор знал только
// строки — вопрос с выбором молча превращался в «угадай, что напечатать», причём
// для matching_headings угадывать надо было римскую цифру. Тест пиннит обе формы.
import { describe, it, expect, vi } from "vitest";
vi.mock("@/db", () => ({ db: {} }));
vi.mock("server-only", () => ({}));
// deliver.ts тянет @/env (publicSiteUrl) — чистым функциям он не нужен, а на импорте
// env валидирует боевые переменные, которых у юнита нет.
vi.mock("@/env", () => ({ publicSiteUrl: () => null }));
import { parseOptions, rotateByDay } from "./daily-question";
import { buttonLabel } from "./deliver";

describe("parseOptions", () => {
  it("объекты {label, value} — боевой формат импорта", () => {
    expect(
      parseOptions([
        { label: "The need for skill and care", value: "i" },
        { label: "Choosing the richest asteroid", value: "ii" },
      ]),
    ).toEqual([
      { label: "The need for skill and care", value: "i" },
      { label: "Choosing the richest asteroid", value: "ii" },
    ]);
  });

  it("простые строки тоже принимаются — label совпадает со значением", () => {
    expect(parseOptions(["TRUE", "FALSE", "NOT GIVEN"])).toEqual([
      { label: "TRUE", value: "TRUE" },
      { label: "FALSE", value: "FALSE" },
      { label: "NOT GIVEN", value: "NOT GIVEN" },
    ]);
  });

  it("вариант без value бесполезен — его нельзя сверить с ключом", () => {
    expect(parseOptions([{ label: "no value here" }])).toBeNull();
  });

  it("без подписи показываем само значение", () => {
    expect(parseOptions([{ value: "A" }])).toEqual([{ label: "A", value: "A" }]);
  });

  it("пустое/чужое → null, вопрос уйдёт как свободный ввод", () => {
    expect(parseOptions(null)).toBeNull();
    expect(parseOptions([])).toBeNull();
    expect(parseOptions("TRUE,FALSE")).toBeNull();
    expect(parseOptions([""])).toBeNull();
    expect(parseOptions([{ label: "x", value: "  " }])).toBeNull();
  });

  it("мусор среди валидных вариантов отбрасывается поштучно", () => {
    expect(parseOptions([{ value: "A" }, 42, null, "B"])).toEqual([
      { label: "A", value: "A" },
      { label: "B", value: "B" },
    ]);
  });
});

describe("buttonLabel", () => {
  it("совпадающие значение и подпись не дублируются", () => {
    expect(buttonLabel("TRUE", "TRUE")).toBe("TRUE");
  });

  it("разные — показываем метку экзамена и текст", () => {
    expect(buttonLabel("iii", "The safest way")).toBe("iii — The safest way");
  });

  it("длинная подпись усечена и влезает в кнопку", () => {
    const label = buttonLabel("iv", "x".repeat(200));
    expect(label.length).toBeLessThanOrEqual(60);
    expect(label.endsWith("…")).toBe(true);
  });
});

// Ротация очереди по дню. Ответ в чате не двигает SM-2, а порядок кандидатов
// детерминирован — без сдвига самая просроченная ошибка приходила бы каждый вечер
// одна и та же (ревью 2026-08-07).
describe("rotateByDay", () => {
  const day = (iso: string) => new Date(iso);
  const items = ["a", "b", "c", "d"];

  it("соседние дни дают разные первые вопросы", () => {
    const first = (d: string) => rotateByDay(items, day(d))[0];
    expect(first("2026-08-07T14:00:00Z")).not.toBe(first("2026-08-08T14:00:00Z"));
  });

  it("в пределах одних суток порядок один и тот же", () => {
    expect(rotateByDay(items, day("2026-08-07T00:05:00Z"))).toEqual(
      rotateByDay(items, day("2026-08-07T23:55:00Z")),
    );
  });

  it("ничего не теряет и не дублирует", () => {
    const out = rotateByDay(items, day("2026-08-09T12:00:00Z"));
    expect([...out].sort()).toEqual([...items].sort());
    expect(out).toHaveLength(items.length);
  });

  it("за цикл длиной в список каждый элемент побывает первым", () => {
    const firsts = new Set(
      ["07", "08", "09", "10"].map((d) => rotateByDay(items, day(`2026-08-${d}T12:00:00Z`))[0]),
    );
    expect(firsts.size).toBe(items.length);
  });

  it("пустой список и один элемент не ломаются", () => {
    expect(rotateByDay([], day("2026-08-07T12:00:00Z"))).toEqual([]);
    expect(rotateByDay(["only"], day("2026-08-07T12:00:00Z"))).toEqual(["only"]);
  });
});
