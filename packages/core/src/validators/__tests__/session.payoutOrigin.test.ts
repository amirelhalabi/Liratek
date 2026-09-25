/**
 * NOT RUN — proven at the end-of-batch gate (owner process rule, 2026-09-24
 * batch: build first, verify once at the end).
 *
 * Owner decision #11-A (netted session checkout, 2026-09-24) wire contract:
 * `sessionCheckoutPaymentSchema` gains an optional
 * `payoutOrigin?: "SYSTEM" | "GENERAL"` field, meaningful only on a
 * `kind: "PAYOUT"` leg. Absent = legacy blended-ratio behavior (see
 * `SessionPaymentService.ratioForCurrency`) — every pre-#11-A payload must
 * still parse unchanged. Mirrors `session.kind.test.ts`'s coverage shape for
 * the sibling `kind` field.
 *
 * Rule 23 (schema-in-front-of-handler key-set diff): `payoutOrigin` must be
 * present in the schema BEFORE `SessionCheckoutService`/`SessionPaymentService`
 * read it off the wire payload — otherwise Zod silently strips it and the
 * mixed-basket PCD/General split reverts to the blended ratio with no error.
 * This file is that check for the schema layer.
 */

import {
  sessionCheckoutPaymentSchema,
  sessionCheckoutSchema,
} from "../session";

describe("sessionCheckoutPaymentSchema — payoutOrigin (owner decision #11-A)", () => {
  it("accepts payoutOrigin: 'SYSTEM' on a kind:PAYOUT OUT leg", () => {
    const result = sessionCheckoutPaymentSchema.safeParse({
      method: "CASH",
      currency_code: "USD",
      amount: 100,
      direction: "OUT",
      kind: "PAYOUT",
      payoutOrigin: "SYSTEM",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payoutOrigin).toBe("SYSTEM");
    }
  });

  it("accepts payoutOrigin: 'GENERAL' on a kind:PAYOUT OUT leg", () => {
    const result = sessionCheckoutPaymentSchema.safeParse({
      method: "CASH",
      currency_code: "LBP",
      amount: 20_000,
      direction: "OUT",
      kind: "PAYOUT",
      payoutOrigin: "GENERAL",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payoutOrigin).toBe("GENERAL");
    }
  });

  it("rejects an unrecognized payoutOrigin value", () => {
    const result = sessionCheckoutPaymentSchema.safeParse({
      method: "CASH",
      currency_code: "USD",
      amount: 100,
      direction: "OUT",
      kind: "PAYOUT",
      payoutOrigin: "OTHER",
    });
    expect(result.success).toBe(false);
  });

  it("tolerates payoutOrigin absent on a kind:PAYOUT leg (byte-identical to pre-#11-A payloads)", () => {
    const result = sessionCheckoutPaymentSchema.safeParse({
      method: "CASH",
      currency_code: "USD",
      amount: 100,
      direction: "OUT",
      kind: "PAYOUT",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payoutOrigin).toBeUndefined();
    }
  });

  it("a full legacy sessionCheckoutSchema payload (no payoutOrigin anywhere) still parses unchanged", () => {
    const result = sessionCheckoutSchema.safeParse({
      sessionId: 1,
      cartItems: [{ any: "opaque item" }],
      payments: [
        { method: "CASH", currency_code: "USD", amount: 100 },
        {
          method: "CASH",
          currency_code: "USD",
          amount: 20,
          direction: "OUT",
          kind: "PAYOUT",
        },
      ],
      userId: 1,
    });
    expect(result.success).toBe(true);
  });

  it("a mixed-origin basket (SYSTEM + GENERAL payout legs alongside a charge) parses end to end", () => {
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
          payoutOrigin: "SYSTEM",
        },
        {
          method: "CASH",
          currency_code: "USD",
          amount: 20,
          direction: "OUT",
          kind: "PAYOUT",
          payoutOrigin: "GENERAL",
        },
      ],
      userId: 1,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payments?.[1].payoutOrigin).toBe("SYSTEM");
      expect(result.data.payments?.[2].payoutOrigin).toBe("GENERAL");
      expect(result.data.payments?.[0].payoutOrigin).toBeUndefined();
    }
  });
});
