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
    expect(paymentMethodToDrawerName("CUSTOMER_ACCOUNT")).toBe("General");
  });

  it("flags CUSTOMER_ACCOUNT as non drawer-affecting (fallback)", () => {
    const all: PaymentMethod[] = ["CASH", "CUSTOMER_ACCOUNT", "OMT", "WHISH", "BINANCE"];
    const affecting = all.filter(isDrawerAffectingMethod);

    expect(affecting).toEqual(["CASH", "OMT", "WHISH", "BINANCE"]);
    expect(isDrawerAffectingMethod("CUSTOMER_ACCOUNT")).toBe(false);
  });

  it("isNonCashDrawerMethod correctly identifies wallet methods (fallback)", () => {
    // Wallet methods — these trigger the non-cash drawer reserve path
    expect(isNonCashDrawerMethod("OMT")).toBe(true);
    expect(isNonCashDrawerMethod("WHISH")).toBe(true);
    expect(isNonCashDrawerMethod("BINANCE")).toBe(true);

    // Cash and Customer Account — should NOT trigger the non-cash path
    expect(isNonCashDrawerMethod("CASH")).toBe(false);
    expect(isNonCashDrawerMethod("CUSTOMER_ACCOUNT")).toBe(false);
  });
});
