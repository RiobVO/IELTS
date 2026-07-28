import { describe, it, expect } from "vitest";
import { polyfillRunnerStorage } from "./runner-storage";

function extractShim(html: string): string {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("шим-скрипт не найден");
  return m[1];
}

// Симулирует загрузку iframe в OPAQUE origin: window, у которого нативный доступ к
// localStorage/sessionStorage БРОСАЕТ (как в sandbox без allow-same-origin). Геттеры
// configurable — ровно как нативные в браузере, чтобы defineProperty в шиме их перекрыл.
function opaqueWindow(): Record<string, unknown> {
  const win: Record<string, unknown> = {};
  for (const prop of ["localStorage", "sessionStorage"]) {
    Object.defineProperty(win, prop, {
      configurable: true,
      get() {
        throw new Error("SecurityError: access denied for opaque origin");
      },
    });
  }
  return win;
}

// Прогоняет настоящую строку шима поверх opaque-window и возвращает его.
function run(): Record<string, Storage> {
  const win = opaqueWindow();
  new Function("window", extractShim(polyfillRunnerStorage("<head></head>")!))(win);
  return win as unknown as Record<string, Storage>;
}

describe("polyfillRunnerStorage — инжект", () => {
  it("инжектит полифил сразу после <head>, ДО любого скрипта раннера", () => {
    const html = polyfillRunnerStorage(
      "<html><head><script>first()</script></head>",
    );
    expect(html).not.toBeNull();
    const headIdx = html!.indexOf("<head>");
    const shimIdx = html!.indexOf("Object.defineProperty(window,'localStorage'");
    const firstScriptIdx = html!.indexOf("first()");
    expect(shimIdx).toBeGreaterThan(headIdx);
    expect(shimIdx).toBeLessThan(firstScriptIdx);
  });

  it("подменяет и localStorage, и sessionStorage", () => {
    const html = polyfillRunnerStorage("<head></head>")!;
    expect(html).toContain("Object.defineProperty(window,'localStorage'");
    expect(html).toContain("Object.defineProperty(window,'sessionStorage'");
  });

  it("fail-closed: нет <head> → null", () => {
    expect(
      polyfillRunnerStorage("<html><body>no head</body></html>"),
    ).toBeNull();
  });
});

const CASES: Array<[string, (w: Record<string, Storage>) => Storage]> = [
  ["localStorage", (w) => w.localStorage],
  ["sessionStorage", (w) => w.sessionStorage],
];

describe.each(CASES)("polyfillRunnerStorage — рантайм-семантика (%s)", (_label, pick) => {
  it("не бросает в opaque origin и работает как in-memory Storage", () => {
    const s = pick(run());
    expect(s.getItem("ielts_state")).toBeNull(); // пусто → null (loadState рано выходит)
    s.setItem("ielts_state", "answers");
    expect(s.getItem("ielts_state")).toBe("answers");
    s.removeItem("ielts_state");
    expect(s.getItem("ielts_state")).toBeNull();
  });

  it("key/length/clear отражают только записанное", () => {
    const s = pick(run());
    s.setItem("k1", "1");
    s.setItem("k2", "2");
    expect(s.length).toBe(2);
    expect([s.key(0), s.key(1)].sort()).toEqual(["k1", "k2"]);
    expect(s.key(2)).toBeNull();
    s.clear();
    expect(s.length).toBe(0);
    expect(s.getItem("k1")).toBeNull();
  });

  it("приводит ключ и значение к строке", () => {
    const s = pick(run());
    s.setItem(1 as unknown as string, 2 as unknown as string);
    expect(s.getItem("1")).toBe("2");
  });
});

it("localStorage и sessionStorage — независимые сторы", () => {
  const w = run();
  w.localStorage.setItem("k", "local");
  w.sessionStorage.setItem("k", "session");
  expect(w.localStorage.getItem("k")).toBe("local");
  expect(w.sessionStorage.getItem("k")).toBe("session");
});
