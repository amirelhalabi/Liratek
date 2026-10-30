/**
 * LIRA-364 — months are Beirut calendar months, whatever the host's own time
 * zone (rule 27). RULE 17 — written before `kpiMonth.ts` existed.
 */
import {
  beirutMonth,
  beirutMonthStartUtc,
  previousMonth,
} from "../kpiMonth.js";

describe("kpiMonth (LIRA-364)", () => {
  it("01:30 on 1 November in Beirut is already November", () => {
    expect(beirutMonth(new Date("2026-10-31T23:30:00Z"))).toBe("2026-11");
  });

  it("21:59 UTC on 31 October is still October in Beirut", () => {
    expect(beirutMonth(new Date("2026-10-31T21:59:00Z"))).toBe("2026-10");
  });

  it("previous month crosses the year", () => {
    expect(previousMonth("2026-01")).toBe("2025-12");
    expect(previousMonth("2026-11")).toBe("2026-10");
  });

  it("month start in UTC follows Beirut winter (UTC+2) and summer (UTC+3)", () => {
    expect(beirutMonthStartUtc("2026-11")).toBe("2026-10-31 22:00:00");
    expect(beirutMonthStartUtc("2026-07")).toBe("2026-06-30 21:00:00");
  });
});
