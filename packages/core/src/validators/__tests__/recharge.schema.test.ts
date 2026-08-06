/**
 * createRechargeSchema — THE single recharge contract, shared by the desktop
 * IPC handler (`recharge:process` via electron-app/schemas/index.ts's
 * `RechargeSchema` re-export) and REST `POST /api/recharge/process`.
 *
 * CARRIER_LINES_VALIDITY_PLAN.md Phase 6a (rules 14 + 19b). Before the
 * consolidation this schema had no `payments`, `clientName`,
 * `default_price_to_client` or `ALFA_GIFT` — and because
 * `backend/src/middleware/validation.ts` reassigns
 * `req.body = schema.parse(req.body)`, Zod dropped all four on every REST
 * recharge. The end-to-end money proof (both drawer deltas over HTTP) lives in
 * `backend/src/api/__tests__/recharge.api.test.ts`; this file pins the
 * contract itself so a future edit cannot quietly narrow it again.
 */

import { describe, it, expect } from "@jest/globals";
import { createRechargeSchema } from "../recharge.js";

const base = {
  provider: "MTC" as const,
  type: "CREDIT_TRANSFER" as const,
  amount: 6,
  cost: 5,
  price: 6,
  currency: "USD",
};

describe("createRechargeSchema — fields the old REST copy silently stripped", () => {
  it("keeps split payment legs, including the OUT change discriminator", () => {
    const parsed = createRechargeSchema.parse({
      ...base,
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 10 },
        {
          method: "CASH",
          currencyCode: "LBP",
          amount: 360_000,
          direction: "OUT",
        },
        {
          method: "GIFT_CARD",
          currencyCode: "USD",
          amount: 2,
          voucherCode: "GC-1",
        },
      ],
    });

    expect(parsed.payments).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 10 },
      {
        method: "CASH",
        currencyCode: "LBP",
        amount: 360_000,
        direction: "OUT",
      },
      {
        method: "GIFT_CARD",
        currencyCode: "USD",
        amount: 2,
        voucherCode: "GC-1",
      },
    ]);
  });

  it("keeps a legs-only payload with NO OUT leg — the shape a money-OUT payout will use (plan Phase 6)", () => {
    // D7: a buy-back payout is carried by ordinary IN legs with the
    // TRANSACTION-level direction flipped, never by `direction: "OUT"` legs
    // (rule 16). So this shape already carries the future payout unchanged.
    const parsed = createRechargeSchema.parse({
      ...base,
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 4 },
        { method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 180_000 },
      ],
    });

    expect(parsed.payments).toHaveLength(2);
    expect(parsed.payments?.every((p) => p.direction === undefined)).toBe(true);
  });

  it("keeps clientName and default_price_to_client (rule 11 client propagation)", () => {
    const parsed = createRechargeSchema.parse({
      ...base,
      clientId: 7,
      clientName: "Walk-in Rita",
      default_price_to_client: 5.5,
    });

    expect(parsed.clientId).toBe(7);
    expect(parsed.clientName).toBe("Walk-in Rita");
    expect(parsed.default_price_to_client).toBe(5.5);
  });

  it("accepts ALFA_GIFT", () => {
    expect(
      createRechargeSchema.parse({ ...base, type: "ALFA_GIFT" }).type,
    ).toBe("ALFA_GIFT");
  });

  it("still carries every field the old core copy had", () => {
    const parsed = createRechargeSchema.parse({
      ...base,
      note: "backdated",
      kept_change_usd: 0.25,
      kept_change_lbp: 5000,
      transaction_time: "2026-08-01T10:00:00.000Z",
      partnerId: 3,
      partnerMode: "FOR",
      tender_exchange_rate: 89_000,
    });

    expect(parsed).toMatchObject({
      note: "backdated",
      kept_change_usd: 0.25,
      kept_change_lbp: 5000,
      transaction_time: "2026-08-01T10:00:00.000Z",
      partnerId: 3,
      partnerMode: "FOR",
      tender_exchange_rate: 89_000,
    });
  });
});

describe("createRechargeSchema — defaults and rejections", () => {
  it("defaults currency, paid_by_method and cost when omitted", () => {
    const parsed = createRechargeSchema.parse({
      provider: "Alfa",
      type: "DAYS",
      amount: 30,
      price: 3,
    });

    expect(parsed.currency).toBe("USD");
    expect(parsed.paid_by_method).toBe("CASH");
    expect(parsed.cost).toBe(0);
  });

  it("rejects a zero amount (the IPC constraint, now enforced on both transports)", () => {
    expect(createRechargeSchema.safeParse({ ...base, amount: 0 }).success).toBe(
      false,
    );
  });

  it("rejects an unknown type", () => {
    expect(
      createRechargeSchema.safeParse({ ...base, type: "TOP_UP" }).success,
    ).toBe(false);
  });

  it("does NOT accept deferPayment over the wire — it is injected server-side by SessionCheckoutService", () => {
    const parsed = createRechargeSchema.parse({
      ...base,
      deferPayment: true,
    }) as Record<string, unknown>;

    expect(parsed.deferPayment).toBeUndefined();
  });
});
