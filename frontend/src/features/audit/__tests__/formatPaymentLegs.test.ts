/**
 * formatPaymentLegs — the transactions viewer's "in: … · out: …" Summary line
 * (Payment-Legs Integrity plan, S3 — "tender-first display, value-model
 * internals").
 *
 * Extracted from TransactionsViewer.tsx into cashFlow.ts (same rationale as
 * getCashFlowDirection/saleTenderTotals: pure logic unit-testable without
 * rendering the page).
 *
 * The specific case this guards: a USD-denominated service (e.g. a Whish App
 * SEND) paid with a SINGLE non-USD (LBP) leg. Before wave 6 removed the four
 * forms' isSplitPayment gate, a single-line LBP payment on a USD send was
 * dropped entirely — only the method survived, never the tender amount or
 * currency — so this line either didn't render or (via a backend fallback)
 * mislabeled the tender as USD. `formatPaymentLegs` itself never reads the
 * row's own service currency (amount_usd/amount_lbp) — only `leg.currency_code`
 * — so once the leg reaches the row at all, rendering it correctly is
 * structural, not incidental. This test pins that: given the real leg the
 * backend now returns for that scenario, the line reads "in: 900,000 LBP",
 * never "in: $10" or a blend of the two.
 *
 * lira-077's cross-currency e2e case (frontend/tests/e2e-electron/
 * lira-077-app-drawer-movement.spec.ts, "LIRA-077 ext") proves the same
 * scenario end-to-end at the drawer + stored-`summary`-string level (via
 * `transactions.getRecent` over IPC) but does NOT open the Transactions page
 * / render this Summary cell — this unit test is the missing render-level
 * proof, not a duplicate.
 */
import { formatPaymentLegs, type TransactionPaymentLeg } from "../cashFlow";

const leg = (
  direction: "in" | "out",
  amount: number,
  currency_code: string,
  method = "CASH",
): TransactionPaymentLeg => ({
  direction,
  amount,
  signed_amount: direction === "out" ? -amount : amount,
  currency_code,
  method,
});

describe("formatPaymentLegs — tender-first display (S3)", () => {
  it("USD-denominated service paid with a single LBP leg renders the LBP tender, not a USD figure (the owner-reported bug)", () => {
    // Whish App SEND $10, paid with ONE LBP cash leg — the exact
    // lira-077-ext scenario. The row's own value is USD; the tender is LBP.
    expect(formatPaymentLegs([leg("in", 900_000, "LBP")])).toBe(
      "in: 900,000 LBP",
    );
  });

  it("is currency-agnostic: a USD leg on the same kind of row renders as USD", () => {
    expect(formatPaymentLegs([leg("in", 10, "USD")])).toBe("in: $10");
  });

  it("mixed-currency split legs sum per currency, joined with '+'", () => {
    expect(
      formatPaymentLegs([leg("in", 5, "USD"), leg("in", 100_000, "LBP")]),
    ).toBe("in: $5 + 100,000 LBP");
  });

  it("IN and OUT (change) legs render as separate segments joined with '·'", () => {
    expect(
      formatPaymentLegs([leg("in", 900_000, "LBP"), leg("out", 50_000, "LBP")]),
    ).toBe("in: 900,000 LBP · out: 50,000 LBP");
  });

  it("same-currency same-side legs collapse into one summed figure", () => {
    expect(
      formatPaymentLegs([leg("in", 2, "USD"), leg("in", 3, "USD")]),
    ).toBe("in: $5");
  });

  it("no legs → null (caller skips rendering)", () => {
    expect(formatPaymentLegs(undefined)).toBeNull();
    expect(formatPaymentLegs([])).toBeNull();
  });
});
