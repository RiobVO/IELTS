// Юнит-тесты синхронизации внутреннего Practice/Mock раннера с attempt.mode (P0).
// Контракт: авто-старт — через НАТИВНЫЙ pendingMode-механизм шаблона; обе
// инъекции best-effort и независимы; незнакомый шаблон — no-op; идемпотентность
// по маркерам; серверная семантика от инъекции не зависит.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { forceRunnerMode } from "./force-mode";

const FIXTURE = readFileSync(new URL("./fixtures/reading.html", import.meta.url), "utf8");
const FIXTURE_B = readFileSync(
  new URL("./fixtures/reading-native-mode.html", import.meta.url),
  "utf8",
);

describe("forceRunnerMode", () => {
  it("practice: кладёт pendingMode и прячет mid-test переключатель", () => {
    const out = forceRunnerMode(FIXTURE, "practice");
    expect(out).toContain('id="bando-mode-autostart"');
    expect(out).toContain("sessionStorage.setItem('pendingMode','practice')");
    expect(out).toContain('id="bando-mode-force-css"');
    expect(out).toContain(".mode-switcher{display:none!important}");
  });

  it("mock: кладёт pendingMode='mock'", () => {
    const out = forceRunnerMode(FIXTURE, "mock");
    expect(out).toContain("sessionStorage.setItem('pendingMode','mock')");
  });

  it("setItem выполняется РАНЬШЕ pendingMode-читателя шаблона (порядок в документе)", () => {
    const out = forceRunnerMode(FIXTURE, "practice");
    const writeAt = out.indexOf("sessionStorage.setItem('pendingMode'");
    const readAt = out.indexOf("sessionStorage.getItem('pendingMode'");
    expect(writeAt).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(-1);
    expect(writeAt).toBeLessThan(readAt);
  });

  it("идемпотентно: повторный вызов не дублирует инъекции", () => {
    const once = forceRunnerMode(FIXTURE, "mock");
    const twice = forceRunnerMode(once, "mock");
    expect(twice).toBe(once);
  });

  it("незнакомый шаблон (нет pendingMode-читателя и переключателя) — no-op байт-в-байт", () => {
    const html = '<html><head></head><body><div id="other"></div></body></html>';
    expect(forceRunnerMode(html, "practice")).toBe(html);
  });

  it("переключатель прячется и без pendingMode-читателя (части независимы)", () => {
    const html =
      '<html><head></head><body><div class="mode-switcher"></div></body></html>';
    const out = forceRunnerMode(html, "practice");
    expect(out).toContain("bando-mode-force-css");
    expect(out).not.toContain("pendingMode"); // авто-старта нет — читателя нет
  });

  it("нет </head> → авто-старт не инжектится (нет безопасной точки)", () => {
    const html = "<html><body>sessionStorage.getItem('pendingMode')</body></html>";
    expect(forceRunnerMode(html, "practice")).toBe(html);
  });
});

// Семейство B «native mode-card» (Day 17+): pendingMode нет, есть top-level
// function beginTest() + карточные кнопки .mode-card-btn. Авто-старт — прямой
// вызов beginTest(mode) скриптом ПОСЛЕ главного скрипта шаблона (перед последним
// </body>), плюс анти-flash скрытие #startScreen в <head>. mockMinutes → только mock.
describe("forceRunnerMode — native mode-card runners (family B)", () => {
  it("B+practice: beginTest('practice') без лимита, CSS-hide, инъекция после главного скрипта", () => {
    const out = forceRunnerMode(FIXTURE_B, "practice");
    expect(out).toContain('id="bando-mode-begintest"');
    expect(out).toContain("beginTest('practice')");
    expect(out).not.toContain("pendingMockLimit="); // practice лимит не трогает
    expect(out).toContain('id="bando-start-hide"');
    expect(out).toContain("#startScreen{display:none!important}");
    // Инъекция стоит ПОСЛЕ главного скрипта шаблона (beginTest уже объявлен).
    expect(out.indexOf('id="bando-mode-begintest"')).toBeGreaterThan(
      out.indexOf("function beginTest("),
    );
    // Старое семейство A не активируется на шаблоне B.
    expect(out).not.toContain('id="bando-mode-autostart"');
    expect(out).not.toContain("pendingMode");
  });

  it("B+mock+min=60: pendingMockLimit=3600 и beginTest('mock')", () => {
    const out = forceRunnerMode(FIXTURE_B, "mock", 60);
    expect(out).toContain("pendingMockLimit=3600;beginTest('mock')");
    expect(out).toContain('id="bando-mode-begintest"');
  });

  it.each([undefined, null, 0, -5, 2.5, 999])(
    "B+mock невалидные минуты (%s): beginTest('mock') без присваивания лимита",
    (mins) => {
      const out = forceRunnerMode(
        FIXTURE_B,
        "mock",
        mins as number | null | undefined,
      );
      expect(out).toContain("beginTest('mock')");
      expect(out).not.toContain("pendingMockLimit=");
    },
  );

  it("mockMinutes игнорируется для practice (лимит только для mock)", () => {
    const out = forceRunnerMode(FIXTURE_B, "practice", 60);
    expect(out).not.toContain("pendingMockLimit=");
    expect(out).toContain("beginTest('practice')");
  });

  it("идемпотентно: повторный вызов не дублирует инъекции", () => {
    const once = forceRunnerMode(FIXTURE_B, "mock", 60);
    const twice = forceRunnerMode(once, "mock", 60);
    expect(twice).toBe(once);
  });

  it("гибрид (pendingMode-ридер + mode-card-btn + beginTest) → строго семейство A", () => {
    const html =
      "<html><head></head><body>" +
      '<div class="mode-card"><button class="mode-card-btn" data-mode="mock">x</button></div>' +
      "<script>function beginTest(mode){} sessionStorage.getItem('pendingMode');</script>" +
      "</body></html>";
    const out = forceRunnerMode(html, "mock", 60);
    expect(out).toContain('id="bando-mode-autostart"');
    expect(out).toContain("sessionStorage.setItem('pendingMode','mock')");
    expect(out).not.toContain('id="bando-mode-begintest"');
    expect(out).not.toContain('id="bando-start-hide"');
  });

  it("старая фикстура reading.html: новые B-маркеры не появляются", () => {
    const out = forceRunnerMode(FIXTURE, "mock", 60);
    expect(out).not.toContain('id="bando-mode-begintest"');
    expect(out).not.toContain('id="bando-start-hide"');
  });

  it("семейство A: 3-й аргумент (mock minutes) не влияет на вывод", () => {
    // mockMinutes — только для семейства B. Пиним, что на A вывод идентичен
    // 2-аргументному вызову: регрессия, меняющая A от третьего аргумента (без
    // добавления B-маркеров), иначе прошла бы незамеченной.
    expect(forceRunnerMode(FIXTURE, "mock", 60)).toBe(
      forceRunnerMode(FIXTURE, "mock"),
    );
    expect(forceRunnerMode(FIXTURE, "practice", 60)).toBe(
      forceRunnerMode(FIXTURE, "practice"),
    );
  });

  it("незнакомый шаблон: байт-в-байт no-op (даже с 3-м аргументом)", () => {
    const html = '<html><head></head><body><div id="other"></div></body></html>';
    expect(forceRunnerMode(html, "mock", 60)).toBe(html);
  });

  it("B-маркеры без </body>: байт-в-байт (soft-brick guard — ни JS, ни CSS)", () => {
    // Намеренно без закрывающего </body>: авто-старту некуда, значит и CSS не льём.
    const html =
      "<html><head></head><body>" +
      '<button class="mode-card-btn" data-mode="mock">x</button>' +
      "<script>function beginTest(mode){}</script>";
    expect(forceRunnerMode(html, "mock", 60)).toBe(html);
  });

  it("B-маркеры с </body> но без <head>: JS есть, CSS нет", () => {
    const html =
      "<body>" +
      '<button class="mode-card-btn" data-mode="mock">x</button>' +
      "<script>function beginTest(mode){}</script>" +
      "</body>";
    const out = forceRunnerMode(html, "mock", 60);
    expect(out).toContain('id="bando-mode-begintest"');
    expect(out).not.toContain('id="bando-start-hide"');
  });
});
