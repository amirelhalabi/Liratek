/**
 * LIRA-339 (T005) — voucher sell/cancel contracts. Written before the
 * schema keys exist (rule 17): Zod strips unknown keys, so today `payments`
 * silently vanishes from a create payload.
 */
import {
  voucherCreateSchema,
  voucherCancelSchema,
  voucherPaymentLegSchema,
} from "../voucher";
import { transactionTypeFilterSchema } from "../transaction";

describe("LIRA-339 voucher schemas", () => {
  it("create keeps payment legs, the tender rate and the back-time", () => {
    const parsed = voucherCreateSchema.parse({
      clientId: 3,
      amount: 50,
      payments: [
        { method: "CASH", currency_code: "USD", amount: 20 },
        { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 30 },
        { method: "CASH", currency_code: "USD", amount: 0, direction: "OUT" },
      ],
      exchange_rate: 89500,
      transaction_time: "2026-10-24 09:00:00",
    });
    expect(parsed.payments).toHaveLength(3);
    expect(parsed.exchange_rate).toBe(89500);
    expect(parsed.transaction_time).toBe("2026-10-24 09:00:00");
  });

  it("create refuses a GIFT_CARD leg (a voucher cannot buy a voucher)", () => {
    expect(
      voucherCreateSchema.safeParse({
        clientId: 3,
        amount: 50,
        payments: [{ method: "GIFT_CARD", currency_code: "USD", amount: 50 }],
      }).success,
    ).toBe(false);
  });

  it("cancel accepts drawer payout legs and the client's day; refuses account and gift-card legs", () => {
    const ok = voucherCancelSchema.parse({
      payments: [{ method: "WHISH", currency_code: "USD", amount: 20 }],
      exchange_rate: 89500,
      client_day: "2026-10-24",
    });
    expect(ok.client_day).toBe("2026-10-24");
    for (const method of ["CUSTOMER_ACCOUNT", "GIFT_CARD"]) {
      expect(
        voucherCancelSchema.safeParse({
          payments: [{ method, currency_code: "USD", amount: 20 }],
        }).success,
      ).toBe(false);
    }
    expect(voucherCancelSchema.safeParse({ client_day: "24/10/2026" }).success).toBe(false);
    expect(voucherCancelSchema.parse({})).toEqual({});
  });

  it("the leg schema allows the account on a sale", () => {
    expect(
      voucherPaymentLegSchema.safeParse({
        method: "CUSTOMER_ACCOUNT",
        currency_code: "LBP",
        amount: 1,
      }).success,
    ).toBe(true);
  });

  it("a type-filter tuple keeps paid_via_voucher", () => {
    expect(
      transactionTypeFilterSchema.parse({
        type: "VOUCHER_SALE",
        paid_via_voucher: true,
      }),
    ).toEqual({ type: "VOUCHER_SALE", paid_via_voucher: true });
  });
});
