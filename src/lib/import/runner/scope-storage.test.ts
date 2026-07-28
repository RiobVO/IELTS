import { describe, it, expect } from "vitest";
import { scopeRunnerStorage } from "./scope-storage";

// Мок нативного Web-Storage (Map-backed) — то, что шим захватывает как `real`.
function makeStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => {
      m.set(k, String(v));
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
    clear: () => {
      m.clear();
    },
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    get length() {
      return m.size;
    },
  };
}

type Mock = ReturnType<typeof makeStore>;
type Reals = { local: Mock; session: Mock };
type Win = { localStorage: unknown; sessionStorage: unknown };

function extractShim(html: string): string {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("шим-скрипт не найден");
  return m[1];
}

// Симулирует одну загрузку iframe: свежий window, нативные хранилища = общие real (переживают
// «загрузки»), затем выполняет настоящую строку шима. Возвращает window с обёрнутыми сторами.
function load(real: Reals, userId: string): Win {
  const win: Win = { localStorage: real.local, sessionStorage: real.session };
  new Function("window", extractShim(scopeRunnerStorage("<head></head>", userId)!))(win);
  return win;
}

describe("scopeRunnerStorage — инжект", () => {
  it("инжектит шим сразу после <head>, ДО любого скрипта раннера", () => {
    const html = scopeRunnerStorage("<html><head><script>first()</script></head>", "u1");
    expect(html).not.toBeNull();
    const headIdx = html!.indexOf("<head>");
    const shimIdx = html!.indexOf("__ieltsScoped");
    const firstScriptIdx = html!.indexOf("first()");
    expect(shimIdx).toBeGreaterThan(headIdx);
    expect(shimIdx).toBeLessThan(firstScriptIdx);
  });

  it("оборачивает и localStorage, и sessionStorage", () => {
    const html = scopeRunnerStorage("<head></head>", "u1");
    expect(html).toContain("wrap('localStorage')");
    expect(html).toContain("wrap('sessionStorage')");
  });

  it("неймспейс содержит userId", () => {
    expect(scopeRunnerStorage("<head></head>", "abc-123")).toContain("bando:u:abc-123:");
  });

  it("userId экранируется и не разрывает JS-литерал", () => {
    expect(scopeRunnerStorage("<head></head>", 'a"b')).toContain('bando:u:a\\"b:');
  });

  it("fail-closed: нет <head> → null", () => {
    expect(scopeRunnerStorage("<html><body>no head</body></html>", "u1")).toBeNull();
  });

  it("пустой userId → null", () => {
    expect(scopeRunnerStorage("<head></head>", "")).toBeNull();
  });
});

// Рантайм-семантика зеркалится на оба хранилища: localStorage (ответы/выделения) и
// sessionStorage (режим). pickShim — какую обёртку дёргаем, pickReal — соответствующий
// нативный стор для проверки фактических ключей.
const CASES: Array<[string, (w: Win) => Storage, (r: Reals) => Mock]> = [
  ["localStorage", (w) => w.localStorage as Storage, (r) => r.local],
  ["sessionStorage", (w) => w.sessionStorage as Storage, (r) => r.session],
];

describe.each(CASES)("scopeRunnerStorage — рантайм-семантика (%s)", (_label, pickShim, pickReal) => {
  it("B не видит черновик A; A после возврата видит свой", () => {
    const real: Reals = { local: makeStore(), session: makeStore() };

    // A отмечает состояние (autosave)
    const a1 = pickShim(load(real, "user-A"));
    a1.setItem("ielts_state", "A-answers");
    a1.setItem("ielts_state_highlights", "A-marks");
    // в реальном хранилище ключи неймспейснуты, не-префиксного нет
    expect(pickReal(real).getItem("bando:u:user-A:ielts_state")).toBe("A-answers");
    expect(pickReal(real).getItem("ielts_state")).toBeNull();

    // B открывает тот же тест в ТОМ ЖЕ браузере → пусто
    const b = pickShim(load(real, "user-B"));
    expect(b.getItem("ielts_state")).toBeNull();
    expect(b.getItem("ielts_state_highlights")).toBeNull();
    b.setItem("ielts_state", "B-answers");

    // A снова заходит → своё состояние цело, чужое не видно
    const a2 = pickShim(load(real, "user-A"));
    expect(a2.getItem("ielts_state")).toBe("A-answers");
    expect(a2.getItem("ielts_state_highlights")).toBe("A-marks");
  });

  it("key/length/clear работают только над неймспейсом текущего юзера", () => {
    const real: Reals = { local: makeStore(), session: makeStore() };
    pickReal(real).setItem("bando:u:user-B:foo", "x"); // чужой неймспейс
    pickReal(real).setItem("app-theme", "dark"); // ключ приложения

    const a = pickShim(load(real, "user-A"));
    a.setItem("k1", "1");
    a.setItem("k2", "2");

    expect(a.length).toBe(2);
    expect([a.key(0), a.key(1)].sort()).toEqual(["k1", "k2"]); // без префикса
    expect(a.key(2)).toBeNull();

    a.clear();
    expect(a.length).toBe(0);
    expect(pickReal(real).getItem("bando:u:user-B:foo")).toBe("x"); // чужое цело
    expect(pickReal(real).getItem("app-theme")).toBe("dark");
  });

  it("идемпотентность: повторный инжект в тот же документ не оборачивает дважды", () => {
    const real: Reals = { local: makeStore(), session: makeStore() };
    const win: Win = { localStorage: real.local, sessionStorage: real.session };
    const body = new Function(
      "window",
      extractShim(scopeRunnerStorage("<head></head>", "user-A")!),
    );
    body(win); // 1-й инжект
    pickShim(win).setItem("ielts_state", "A");
    body(win); // 2-й инжект в тот же документ (стор уже шим)
    expect(pickShim(win).getItem("ielts_state")).toBe("A");
    expect(pickReal(real).getItem("bando:u:user-A:ielts_state")).toBe("A");
    // двойного префикса нет
    expect(pickReal(real).getItem("bando:u:user-A:bando:u:user-A:ielts_state")).toBeNull();
  });
});
