import { describe, expect, it } from "vitest";
import { isoWeekKey } from "./iso-week";

// Референсные значения — из канонических примеров ISO-8601 week date (Wikipedia),
// плюс середина года. Проверяют границу года (ISO week-numbering year != календарный)
// и нулевой пэддинг номера недели.
describe("isoWeekKey", () => {
  it("середина года", () => {
    expect(isoWeekKey(new Date(Date.UTC(2020, 5, 15)))).toBe("2020-W25");
  });

  it("1 января попадает в W53 прошлого года", () => {
    // 2005-01-01 (суббота) относится к неделе, чей четверг — 2004-12-30.
    expect(isoWeekKey(new Date(Date.UTC(2005, 0, 1)))).toBe("2004-W53");
  });

  it("31 декабря попадает в W01 следующего года", () => {
    // 2007-12-31 (понедельник) относится к неделе, чей четверг — 2008-01-03.
    expect(isoWeekKey(new Date(Date.UTC(2007, 11, 31)))).toBe("2008-W01");
  });

  it("номер недели дополняется нулём до двух цифр", () => {
    expect(isoWeekKey(new Date(Date.UTC(2010, 0, 4)))).toBe("2010-W01");
  });
});
