// «Серия под угрозой» решает, писать ли человеку вечером. Живой прогноз рассылки
// поймал здесь вранье: у пропавшего на 11 дней в профиле всё ещё висел streak=1,
// и бот собирался сообщить, что серия «закончится сегодня».
import { describe, it, expect } from "vitest";
import { isStreakAtRisk } from "./schedule";

const TODAY = "2026-08-06";

describe("isStreakAtRisk", () => {
  it("занимался вчера и не сегодня → серия жива и под угрозой", () => {
    expect(isStreakAtRisk(5, "2026-08-05", TODAY)).toBe(true);
  });

  it("уже занимался сегодня → угрозы нет", () => {
    expect(isStreakAtRisk(5, TODAY, TODAY)).toBe(false);
  });

  it("давно пропал → серия оборвана, писать про неё нельзя", () => {
    expect(isStreakAtRisk(1, "2026-07-26", TODAY)).toBe(false);
    expect(isStreakAtRisk(9, "2026-08-04", TODAY)).toBe(false);
  });

  it("нулевая серия и отсутствие активности не дают повода", () => {
    expect(isStreakAtRisk(0, "2026-08-05", TODAY)).toBe(false);
    expect(isStreakAtRisk(3, null, TODAY)).toBe(false);
  });

  it("работает через границу месяца", () => {
    expect(isStreakAtRisk(2, "2026-07-31", "2026-08-01")).toBe(true);
  });
});
