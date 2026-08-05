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
import { parseOptions } from "./daily-question";
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
