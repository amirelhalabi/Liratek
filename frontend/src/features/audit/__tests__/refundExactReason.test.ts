/**
 * Cornertech 2026-11-06: a sale paid with Binance (a USDT leg in the Binance
 * drawer) opens the refund window read-only, like a settlement (LIRA-373).
 */
import { refundExactReason } from "../refundLegOverride";

const leg = (currency_code: string, method = "BINANCE") => ({
  direction: "in" as const,
  amount: 49,
  signed_amount: 49,
  currency_code,
  method,
});

describe("refundExactReason", () => {
  it("a settlement is exact (settlement wording)", () => {
    expect(refundExactReason("SUPPLIER_SETTLEMENT", [leg("USD", "CASH")])).toBe(
      "settlement",
    );
  });

  it("a sale with a Binance USDT line is exact (Binance wording)", () => {
    expect(refundExactReason("SALE", [leg("USDT")])).toBe("binance");
  });

  it("a cash sale lets the cashier choose return methods", () => {
    expect(refundExactReason("SALE", [leg("USD", "CASH")])).toBeNull();
    expect(refundExactReason("SALE", undefined)).toBeNull();
  });
});
