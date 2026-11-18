/**
 * LIRA-400 — the ONE fee-eligibility / caps rule shared by the payment
 * screen and the server (rule 14), and the refund "price part" helper.
 */
import {
  isLegFeeEligibleMethod,
  legFeeError,
  legFeeShapeError,
  priceOnlyLegRow,
  LEG_FEE_METHOD_MESSAGE,
  LEG_FEE_OUT_MESSAGE,
  LEG_FEE_RANGE_MESSAGE,
} from "../legFee";

describe("legFee", () => {
  it.each([
    [{ code: "WHISH", drawerName: "Whish_App", affectsDrawer: true }, true],
    [{ code: "BINANCE", drawerName: "Binance", affectsDrawer: true }, true],
    [{ code: "OMT", drawerName: null, affectsDrawer: null }, true],
    [{ code: "CASH", drawerName: "General", affectsDrawer: true }, false],
    [{ code: "CASH_SAFE", drawerName: "General", affectsDrawer: true }, false],
    [{ code: "CUSTOMER_ACCOUNT", drawerName: "General", affectsDrawer: false }, false],
    [{ code: "GIFT_CARD", drawerName: "General", affectsDrawer: false }, false],
    [{ code: "NOTE", drawerName: "Notes", affectsDrawer: false }, false],
  ])("eligible(%o) = %s", (info, expected) => {
    expect(isLegFeeEligibleMethod(info)).toBe(expected);
  });

  it("shape: range, OUT, never-fee methods; a zero fee is always fine", () => {
    const base = { method: "WHISH", amount: 10 };
    expect(legFeeShapeError({ ...base, fee: 0, direction: "OUT" })).toBeNull();
    expect(legFeeShapeError({ ...base, fee: 10 })).toBeNull();
    expect(legFeeShapeError({ ...base, fee: 10.01 })).toBe(LEG_FEE_RANGE_MESSAGE);
    expect(legFeeShapeError({ ...base, fee: -1 })).toBe(LEG_FEE_RANGE_MESSAGE);
    expect(legFeeShapeError({ ...base, fee: 1, direction: "OUT" })).toBe(LEG_FEE_OUT_MESSAGE);
    expect(legFeeShapeError({ method: "CASH", amount: 10, fee: 1 })).toBe(LEG_FEE_METHOD_MESSAGE);
  });

  it("full check adds the drawer rule", () => {
    expect(
      legFeeError(
        { method: "CASH_SAFE", amount: 10, fee: 1 },
        { code: "CASH_SAFE", drawerName: "General", affectsDrawer: true },
      ),
    ).toBe(LEG_FEE_METHOD_MESSAGE);
  });

  it("priceOnlyLegRow is the price part and idempotent", () => {
    const once = priceOnlyLegRow({ amount: 11, fee_amount: 1, method: "WHISH" });
    expect(once).toEqual({ amount: 10, fee_amount: 0, method: "WHISH" });
    expect(priceOnlyLegRow(once)).toEqual(once);
    expect(priceOnlyLegRow({ amount: -5 })).toEqual({ amount: -5, fee_amount: 0 });
  });
});
