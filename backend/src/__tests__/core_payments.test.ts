import {
  isDrawerAffectingMethod,
  isNonCashDrawerMethod,
  paymentMethodToDrawerName,
  type PaymentMethod,
} from "@liratek/core";

describe("@liratek/core payments utils", () => {
  it("maps payment methods to canonical drawer names (fallback)", () => {
    expect(paymentMethodToDrawerName("CASH")).toBe("General");
    expect(paymentMethodToDrawerName("OMT")).toBe("OMT_App");
    expect(paymentMethodToDrawerName("WHISH")).toBe("Whish_App");
    expect(paymentMethodToDrawerName("BINANCE")).toBe("Binance");
    expect(paymentMethodToDrawerName("DEBT")).toBe("General");
  });

  it("flags DEBT as non drawer-affecting (fallback)", () => {
    const all: PaymentMethod[] = ["CASH", "DEBT", "OMT", "WHISH", "BINANCE"];
    const affecting = all.filter(isDrawerAffectingMethod);

    expect(affecting).toEqual(["CASH", "OMT", "WHISH", "BINANCE"]);
    expect(isDrawerAffectingMethod("DEBT")).toBe(false);
  });

  it("isNonCashDrawerMethod correctly identifies wallet methods (fallback)", () => {
    // Wallet methods — these trigger the non-cash drawer reserve path
    expect(isNonCashDrawerMethod("OMT")).toBe(true);
    expect(isNonCashDrawerMethod("WHISH")).toBe(true);
    expect(isNonCashDrawerMethod("BINANCE")).toBe(true);

    // Cash and Debt — should NOT trigger the non-cash path
    expect(isNonCashDrawerMethod("CASH")).toBe(false);
    expect(isNonCashDrawerMethod("DEBT")).toBe(false);
  });
});
