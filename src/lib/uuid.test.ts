// Юнит-тесты UUID-гарда (защита owner-path запросов от malformed id → 500).
// Контракт: пропускает только корректный формат 8-4-4-4-12 hex; всё прочее — false.
import { describe, it, expect } from "vitest";
import { isUuid } from "./uuid";

describe("isUuid", () => {
  it("true для корректного UUID (нижний/верхний регистр)", () => {
    expect(isUuid("b910fd84-6a30-4e9c-9383-c25d8cecbdbb")).toBe(true);
    expect(isUuid("B910FD84-6A30-4E9C-9383-C25D8CECBDBB")).toBe(true);
    expect(isUuid("00000000-0000-0000-0000-000000000000")).toBe(true);
  });

  it("false для явного мусора из URL", () => {
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("garbage")).toBe(false);
    expect(isUuid("x")).toBe(false);
    expect(isUuid("")).toBe(false);
  });

  it("false для почти-UUID (без дефисов, неполный, лишние символы, не-hex)", () => {
    expect(isUuid("b910fd846a304e9c9383c25d8cecbdbb")).toBe(false); // без дефисов
    expect(isUuid("b910fd84-6a30-4e9c-9383-c25d8cecbd")).toBe(false); // короче
    expect(isUuid("b910fd84-6a30-4e9c-9383-c25d8cecbdbb-extra")).toBe(false); // хвост
    expect(isUuid("g910fd84-6a30-4e9c-9383-c25d8cecbdbb")).toBe(false); // 'g' не hex
    expect(isUuid(" b910fd84-6a30-4e9c-9383-c25d8cecbdbb ")).toBe(false); // пробелы
  });

  it("false для undefined/null (тип-гард)", () => {
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});
