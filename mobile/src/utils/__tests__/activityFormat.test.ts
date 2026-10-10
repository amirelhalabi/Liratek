import { dayHeader, txnDayKey, txnMainAmount } from "../format";
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
  it("shows USD when set, else LBP, else a dash", () => {
    expect(txnMainAmount({ amount_usd: 50, amount_lbp: 4500000 })).toMatch(/50/);
    expect(txnMainAmount({ amount_usd: 50, amount_lbp: 4500000 })).not.toMatch(/4,500,000|4500000/);
    expect(txnMainAmount({ amount_usd: 0, amount_lbp: 90000 })).toMatch(/90,000|90000/);
    expect(txnMainAmount({ amount_usd: 0, amount_lbp: 0 })).toBe("—");
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
