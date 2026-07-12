/**
 * Sale Details modal amount display (Debts page).
 *
 * Pre-fix the modal rendered "$0.00 + 360,000 LBP" for an LBP-only payment
 * (zero USD part always shown) and computed Outstanding Debt from paid_usd
 * alone — an LBP-paid sale showed its full amount as still owed.
 */
import {
  formatPaidAmount,
  saleOutstandingUsd,
} from "../salePaidFormat";

describe("formatPaidAmount — zero parts are hidden", () => {
  it("LBP-only payment shows just the LBP part (the reported bug)", () => {
    expect(formatPaidAmount(0, 360_000)).toBe("360,000 LBP");
  });

  it("USD-only payment shows just the USD part", () => {
    expect(formatPaidAmount(4, 0)).toBe("$4.00");
  });

  it("mixed payment shows both parts", () => {
    expect(formatPaidAmount(2, 180_000)).toBe("$2.00 + 180,000 LBP");
  });

  it("nothing paid shows $0.00", () => {
    expect(formatPaidAmount(0, 0)).toBe("$0.00");
  });
});

describe("saleOutstandingUsd — LBP payments count at the snapshot rate", () => {
  it("fully LBP-paid sale owes nothing (pre-fix: showed the full amount)", () => {
    expect(
      saleOutstandingUsd({
        final_amount_usd: 4,
        paid_usd: 0,
        paid_lbp: 360_000,
        exchange_rate_snapshot: 90_000,
      }),
    ).toBe(0);
  });

  it("partially paid sale owes the remainder", () => {
    expect(
      saleOutstandingUsd({
        final_amount_usd: 8,
        paid_usd: 4,
        paid_lbp: 0,
        exchange_rate_snapshot: 90_000,
      }),
    ).toBe(4);
  });

  it("unpaid on-account sale owes the full amount", () => {
    expect(
      saleOutstandingUsd({
        final_amount_usd: 4,
        paid_usd: 0,
        paid_lbp: 0,
        exchange_rate_snapshot: 90_000,
      }),
    ).toBe(4);
  });

  it("missing snapshot rate ignores LBP instead of dividing by zero", () => {
    expect(
      saleOutstandingUsd({
        final_amount_usd: 4,
        paid_usd: 1,
        paid_lbp: 270_000,
        exchange_rate_snapshot: 0,
      }),
    ).toBe(3);
  });

  it("overpayment clamps at zero, never negative", () => {
    expect(
      saleOutstandingUsd({
        final_amount_usd: 4,
        paid_usd: 5,
        paid_lbp: 0,
        exchange_rate_snapshot: 90_000,
      }),
    ).toBe(0);
  });
});
