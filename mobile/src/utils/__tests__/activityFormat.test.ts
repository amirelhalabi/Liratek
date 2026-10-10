import { compactLbp, dayHeader, txnDayKey } from "../format";
import { typeColor } from "../typeColors";

describe("Activity day grouping", () => {
  it("groups by the phone's calendar day, not the stored UTC date", () => {
    // Build a UTC timestamp for local 00:30 on 13 Sep, then store it the way the DB does.
    const local = new Date(2026, 8, 13, 0, 30);
    const stored = local.toISOString().slice(0, 19).replace("T", " ");
    expect(txnDayKey(stored)).toBe("2026-09-13");
    expect(txnDayKey(local.toISOString())).toBe("2026-09-13");
  });

  it("labels today, yesterday and older days", () => {
    const now = new Date(2026, 9, 10, 12, 0);
    expect(dayHeader("2026-10-10", now)).toBe("Today");
    expect(dayHeader("2026-10-09", now)).toBe("Yesterday");
    const older = dayHeader("2026-10-08", now);
    expect(older).not.toBe("Yesterday");
    expect(older).toMatch(/8/);
    expect(older).not.toMatch(/2026/);
    expect(dayHeader("2025-12-31", now)).toMatch(/2025/);
  });
});

describe("Activity row amount", () => {
  it("shortens LBP to k under a million and M above", () => {
    expect(compactLbp(200000)).toBe("200k LBP");
    expect(compactLbp(205184)).toBe("205.2k LBP");
    expect(compactLbp(1450000)).toBe("1.45M LBP");
    expect(compactLbp(26500000)).toBe("26.5M LBP");
    expect(compactLbp(-50000)).toBe("-50k LBP");
    expect(compactLbp(500)).toBe("500 LBP");
  });
});

describe("typeColor", () => {
  it("gives distinct families for sales, money transfers and expenses", () => {
    const set = new Set([typeColor("SALE"), typeColor("FINANCIAL_SERVICE"), typeColor("EXPENSE")]);
    expect(set.size).toBe(3);
  });

  it("falls back to neutral for an unknown type", () => {
    expect(typeColor("SOMETHING_OLD")).toBe(typeColor("CHECKPOINT"));
  });
});
