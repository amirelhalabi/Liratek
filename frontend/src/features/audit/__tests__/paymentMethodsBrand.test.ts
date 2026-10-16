import { paymentMethodsBrand } from "@/features/audit/transactionDisplay";
import type { TransactionPaymentLeg } from "@/features/audit/cashFlow";

const leg = (
  method: string,
  direction: "in" | "out" = "in",
): TransactionPaymentLeg => ({
  method,
  direction,
  currency_code: "USD",
  amount: 1,
  signed_amount: direction === "in" ? 1 : -1,
});

describe("paymentMethodsBrand (Method column icon)", () => {
  it("is the brand when every named leg is that one wallet", () => {
    expect(paymentMethodsBrand([leg("OMT_WALLET")])).toBe("OMT");
    expect(paymentMethodsBrand([leg("WHISH"), leg("WHISH")])).toBe("WHISH");
    expect(paymentMethodsBrand([leg("BINANCE")])).toBe("BINANCE");
  });

  it("is null for a mixed split or a non-wallet method", () => {
    expect(paymentMethodsBrand([leg("CASH"), leg("WHISH")])).toBeNull();
    expect(paymentMethodsBrand([leg("OMT"), leg("WHISH")])).toBeNull();
    expect(paymentMethodsBrand([leg("BINANCE"), leg("CASH")])).toBeNull();
    expect(paymentMethodsBrand([leg("CASH")])).toBeNull();
    expect(paymentMethodsBrand([])).toBeNull();
    expect(paymentMethodsBrand(undefined)).toBeNull();
  });

  it("ignores change (out) legs when an in leg exists, like the text does", () => {
    expect(paymentMethodsBrand([leg("WHISH"), leg("CASH", "out")])).toBe(
      "WHISH",
    );
  });
});
