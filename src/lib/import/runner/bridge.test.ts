import { describe, it, expect } from "vitest";
import { READING_BRIDGE, LISTENING_BRIDGE, retargetBridgeOrigin } from "./bridge";

// Форма SEND, запечённая в runner_html, импортированные ДО P0-изоляции (legacy-ряды БД).
const LEGACY_SEND =
  "function __send(ans){ try{ parent.postMessage({ type: 'ielts-submit', answers: ans || __collect() }, window.location.origin); }catch(e){} }";

describe("retargetBridgeOrigin", () => {
  it("переписывает legacy targetOrigin window.location.origin → '*'", () => {
    const out = retargetBridgeOrigin(LEGACY_SEND);
    expect(out).toContain("}, '*');");
    expect(out).not.toContain("window.location.origin");
  });

  it("no-op для новых рядов — SEND уже эмитит '*' (идемпотентно)", () => {
    expect(retargetBridgeOrigin(READING_BRIDGE)).toBe(READING_BRIDGE);
    expect(retargetBridgeOrigin(LISTENING_BRIDGE)).toBe(LISTENING_BRIDGE);
  });

  it("трогает только postMessage ielts-submit, не любой window.location.origin", () => {
    const unrelated = "var u = window.location.origin + '/cb';";
    expect(retargetBridgeOrigin(unrelated)).toBe(unrelated);
  });

  it("переписывает SEND даже в окружении прочего кода с window.location.origin", () => {
    const mixed = `var base = window.location.origin;\n${LEGACY_SEND}`;
    const out = retargetBridgeOrigin(mixed);
    expect(out).toContain("var base = window.location.origin;"); // прочий код цел
    expect(out).toContain("}, '*');"); // SEND переписан
    expect(out.match(/window\.location\.origin/g)?.length).toBe(1);
  });
});

// #7: reading bridge собирает чекбокс-группы (choose TWO/THREE) по [data-mcq-group].
// DOM-логику без jsdom не гоняем — структурно подтверждаем, что коллектор вшит.
describe("READING_BRIDGE — checkbox-group collector (#7)", () => {
  it("несёт __readingMultiFor и селектор data-mcq-group", () => {
    expect(READING_BRIDGE).toContain("__readingMultiFor");
    expect(READING_BRIDGE).toContain("data-mcq-group");
    expect(READING_BRIDGE).toContain('input[type="checkbox"]');
  });
});
