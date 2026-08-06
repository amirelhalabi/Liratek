/**
 * BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase F wire contract:
 * `sessionCheckoutPaymentSchema` gains an optional `kind?: "PAYOUT" | "CHANGE"`
 * field, meaningful only on a `direction: "OUT"` leg. Absent on an OUT leg
 * (or on an IN leg, where it's never meaningful) must parse unchanged
 * (legacy payloads are byte-identical) — nothing here rejects `kind` on an
 * IN leg either; the contract calls it "never carries it", not "rejected if
 * present", so tolerance (not enforcement) is the correct default (rule 8 —
 * don't invent enforcement the frozen contract didn't ask for).
 */

import {
  sessionCheckoutPaymentSchema,
  sessionCheckoutSchema,
} from "../session";

describe("sessionCheckoutPaymentSchema — kind (Phase F)", () => {
  it("accepts kind: 'PAYOUT' on a direction: OUT leg", () => {
    const result = sessionCheckoutPaymentSchema.safeParse({
      method: "CASH",
      currency_code: "USD",
      amount: 100,
      direction: "OUT",
      kind: "PAYOUT",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe("PAYOUT");
    }
  });

  it("accepts kind: 'CHANGE' on a direction: OUT leg", () => {
    const result = sessionCheckoutPaymentSchema.safeParse({
      method: "CASH",
      currency_code: "USD",
      amount: 25,
      direction: "OUT",
      kind: "CHANGE",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe("CHANGE");
    }
  });

  it("rejects an unrecognized kind value", () => {
    const result = sessionCheckoutPaymentSchema.safeParse({
      method: "CASH",
      currency_code: "USD",
      amount: 25,
      direction: "OUT",
      kind: "REFUND",
    });
    expect(result.success).toBe(false);
  });

  it("tolerates kind absent on a legacy OUT leg (byte-identical to pre-Phase-F payloads)", () => {
    const result = sessionCheckoutPaymentSchema.safeParse({
      method: "CASH",
      currency_code: "USD",
      amount: 25,
      direction: "OUT",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBeUndefined();
    }
  });

  it("tolerates kind absent on an IN leg and on a legacy payload with no direction at all", () => {
    const withDirection = sessionCheckoutPaymentSchema.safeParse({
      method: "CASH",
      currency_code: "USD",
      amount: 100,
      direction: "IN",
    });
    expect(withDirection.success).toBe(true);

    const noDirectionAtAll = sessionCheckoutPaymentSchema.safeParse({
      method: "CASH",
      currency_code: "USD",
      amount: 100,
    });
    expect(noDirectionAtAll.success).toBe(true);
    if (noDirectionAtAll.success) {
      expect(noDirectionAtAll.data.direction).toBeUndefined();
      expect(noDirectionAtAll.data.kind).toBeUndefined();
    }
  });

  it("a full legacy sessionCheckoutSchema payload (no kind anywhere) still parses unchanged", () => {
    const result = sessionCheckoutSchema.safeParse({
      sessionId: 1,
      cartItems: [{ any: "opaque item" }],
      payments: [
        { method: "CASH", currency_code: "USD", amount: 100 },
        { method: "CASH", currency_code: "USD", amount: 20, direction: "OUT" },
      ],
      userId: 1,
    });
    expect(result.success).toBe(true);
  });

  it("a Phase F payload with a kind:PAYOUT OUT leg alongside plain IN charge legs parses end to end", () => {
    const result = sessionCheckoutSchema.safeParse({
      sessionId: 1,
      cartItems: [{ any: "opaque item" }],
      payments: [
        { method: "CASH", currency_code: "USD", amount: 5, direction: "IN" },
        {
          method: "CASH",
          currency_code: "USD",
          amount: 100,
          direction: "OUT",
          kind: "PAYOUT",
        },
      ],
      userId: 1,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payments?.[1].kind).toBe("PAYOUT");
      expect(result.data.payments?.[0].kind).toBeUndefined();
    }
  });
});
