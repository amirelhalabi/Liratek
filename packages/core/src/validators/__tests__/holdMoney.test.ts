/**
 * NOT RUN — proven at the end-of-batch gate (owner process rule for this
 * batch). LIRA-214 (OWNER_NOTES_REMAINING_BUILD.md #24, migration v183):
 * this file is entirely new, guarding the Hold Money payment-form contract.
 * Rule 17's failing-first proof is structural — none of these schemas
 * existed before this ticket, so every assertion below fails-to-compile/
 * fails-to-import against pre-fix code, not merely against a value that was
 * already true.
 */

import {
  HOLD_MONEY_METHODS,
  holdMoneyPaymentLegSchema,
  holdMoneyCreateSchema,
  holdMoneyCollectSchema,
  holdMoneyVoidPickupSchema,
} from "../holdMoney.js";

describe("HOLD_MONEY_METHODS (owner answer #24)", () => {
  it("allows cash + the shop's wallets only", () => {
    expect([...HOLD_MONEY_METHODS].sort()).toEqual(
      ["BINANCE", "CASH", "OMT", "WHISH"].sort(),
    );
  });

  it("excludes CUSTOMER_ACCOUNT and GIFT_CARD", () => {
    expect(HOLD_MONEY_METHODS).not.toContain("CUSTOMER_ACCOUNT");
    expect(HOLD_MONEY_METHODS).not.toContain("GIFT_CARD");
  });
});

describe("holdMoneyPaymentLegSchema", () => {
  it("accepts a canonical leg", () => {
    const r = holdMoneyPaymentLegSchema.safeParse({
      method: "CASH",
      currency_code: "USD",
      amount: 10,
    });
    expect(r.success).toBe(true);
  });

  it("rejects CUSTOMER_ACCOUNT (owner answer #24: excluded on Hold Money)", () => {
    const r = holdMoneyPaymentLegSchema.safeParse({
      method: "CUSTOMER_ACCOUNT",
      currency_code: "USD",
      amount: 10,
    });
    expect(r.success).toBe(false);
  });

  it("rejects GIFT_CARD (owner answer #24: excluded on Hold Money)", () => {
    const r = holdMoneyPaymentLegSchema.safeParse({
      method: "GIFT_CARD",
      currency_code: "USD",
      amount: 10,
    });
    expect(r.success).toBe(false);
  });

  it("rejects a currency other than USD/LBP", () => {
    const r = holdMoneyPaymentLegSchema.safeParse({
      method: "CASH",
      currency_code: "EUR",
      amount: 10,
    });
    expect(r.success).toBe(false);
  });

  it("accepts an OUT (change) leg", () => {
    const r = holdMoneyPaymentLegSchema.safeParse({
      method: "CASH",
      currency_code: "USD",
      amount: 10,
      direction: "OUT",
    });
    expect(r.success).toBe(true);
  });
});

describe("holdMoneyCreateSchema", () => {
  it("accepts client_id, payments[] and exchange_rate", () => {
    const r = holdMoneyCreateSchema.safeParse({
      client_name: "Sami",
      client_id: 7,
      usd_amount: 40,
      payments: [{ method: "CASH", currency_code: "USD", amount: 40 }],
      exchange_rate: 89000,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.client_id).toBe(7);
      expect(r.data.payments).toHaveLength(1);
    }
  });

  it("still requires at least one of usd_amount/lbp_amount", () => {
    const r = holdMoneyCreateSchema.safeParse({ client_name: "Sami" });
    expect(r.success).toBe(false);
  });

  it("still requires a client_name", () => {
    const r = holdMoneyCreateSchema.safeParse({ usd_amount: 10 });
    expect(r.success).toBe(false);
  });

  it("payments is optional (backward compatible with a legacy caller)", () => {
    const r = holdMoneyCreateSchema.safeParse({
      client_name: "Sami",
      usd_amount: 10,
    });
    expect(r.success).toBe(true);
  });
});

describe("holdMoneyCollectSchema (LIRA-214, migration v183)", () => {
  it("accepts a full-pickup payload (amounts omitted)", () => {
    const r = holdMoneyCollectSchema.safeParse({ id: 5 });
    expect(r.success).toBe(true);
  });

  it("accepts a partial-pickup payload", () => {
    const r = holdMoneyCollectSchema.safeParse({
      id: 5,
      usd_amount: 20,
      payments: [{ method: "WHISH", currency_code: "USD", amount: 20 }],
      exchange_rate: 89000,
    });
    expect(r.success).toBe(true);
  });

  it("requires an id", () => {
    const r = holdMoneyCollectSchema.safeParse({ usd_amount: 20 });
    expect(r.success).toBe(false);
  });

  it("rejects a negative amount", () => {
    const r = holdMoneyCollectSchema.safeParse({ id: 5, usd_amount: -1 });
    expect(r.success).toBe(false);
  });
});

describe("holdMoneyVoidPickupSchema", () => {
  it("requires a positive pickup_id", () => {
    expect(holdMoneyVoidPickupSchema.safeParse({ pickup_id: 1 }).success).toBe(
      true,
    );
    expect(holdMoneyVoidPickupSchema.safeParse({ pickup_id: -1 }).success).toBe(
      false,
    );
    expect(holdMoneyVoidPickupSchema.safeParse({}).success).toBe(false);
  });
});
