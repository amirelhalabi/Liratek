/**
 * LIRA-319 T051 — the session receipt prints the basket extra on its own
 * "Extra" line, after the item charges, in the basket's currency. Not proven
 * failing-first (rule 17): written after the receipt change.
 */
import { buildSessionCheckoutReceiptText } from "../sessionReceipt";

const base = {
  shop: { name: "Corner Tech" },
  sessionId: 9,
  items: [{ label: "Screen fix", amount: 10, currency: "USD" }],
  legs: [
    {
      method: "CASH",
      currency_code: "USD",
      amount: 12,
      direction: "IN" as const,
    },
  ],
  createdAt: "2026-10-14T12:00:00.000Z",
};

describe("buildSessionCheckoutReceiptText — extra (LIRA-319)", () => {
  it("prints an Extra line after the charges", () => {
    const text = buildSessionCheckoutReceiptText({
      ...base,
      extra: { usd: 2, lbp: 0 },
    });
    const lines = text.split("\n");
    const charges = lines.findIndex((l) => l.startsWith("Charges:"));
    const extra = lines.findIndex((l) => l.startsWith("Extra:"));
    expect(extra).toBeGreaterThan(charges);
    expect(lines[extra]).toMatch(/\+\$2\.00$/);
    expect(text).not.toMatch(/Extra:.*LBP/);
  });

  it("prints an LBP extra in LBP", () => {
    const text = buildSessionCheckoutReceiptText({
      ...base,
      extra: { usd: 0, lbp: 50_000 },
    });
    expect(text).toMatch(/Extra:\s+\+50,000 LBP/);
  });

  it("no extra → no Extra line", () => {
    expect(buildSessionCheckoutReceiptText(base)).not.toContain("Extra:");
  });
});
