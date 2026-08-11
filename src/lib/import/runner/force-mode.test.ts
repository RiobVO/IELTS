// Юнит-тесты синхронизации внутреннего Practice/Mock раннера с attempt.mode (P0).
// Контракт: авто-старт — через НАТИВНЫЙ pendingMode-механизм шаблона; обе
// инъекции best-effort и независимы; незнакомый шаблон — no-op; идемпотентность
// по маркерам; серверная семантика от инъекции не зависит.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { forceRunnerMode } from "./force-mode";

const FIXTURE = readFileSync(new URL("./fixtures/reading.html", import.meta.url), "utf8");

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
