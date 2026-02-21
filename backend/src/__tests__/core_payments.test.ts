import {
  isDrawerAffectingMethod,
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
});
