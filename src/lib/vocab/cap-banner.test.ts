import { describe, expect, it } from "vitest";
import { shouldShowCapBanner } from "./cap-banner";

const newCard = { isNew: true };
const startedCard = { isNew: false };

describe("shouldShowCapBanner", () => {
  it("null (безлимитный тир) → false даже при новых картах впереди", () => {
    expect(shouldShowCapBanner(null, [newCard])).toBe(false);
  });

  it("остаток 0 + впереди только начатые карты → false (чистый повтор не капится)", () => {
    expect(shouldShowCapBanner(0, [startedCard, startedCard])).toBe(false);
  });

  it("остаток 0 + пустая очередь → false (перезаход после исчерпания)", () => {
    expect(shouldShowCapBanner(0, [])).toBe(false);
  });

  it("остаток 0 + впереди есть новая карта → true (кап реально отобьёт её)", () => {
    expect(shouldShowCapBanner(0, [startedCard, newCard])).toBe(true);
  });

  it("остаток > 0 → false независимо от состава очереди", () => {
    expect(shouldShowCapBanner(3, [newCard, startedCard])).toBe(false);
  });
});
