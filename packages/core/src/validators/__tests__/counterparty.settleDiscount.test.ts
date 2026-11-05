/**
 * LIRA-372 — one settle-discount cap, defined once (rule 14): $5 for USD,
 * 450,000 LBP for LBP, per currency, up to and including the cap. Reused by
 * every settle screen's wire key; the admin Write off schemas stay uncapped
 * (FR-009).
 */
import {
  settleDiscountInputSchema,
  settleForgiveAmountSchema,
} from "../counterparty.js";
import { addRepaymentSchema, debtWriteOffSchema } from "../debt.js";
import {
  partnerSettleSchema,
  partnerSettleDaysSchema,
  partnerWriteOffSchema,
} from "../partner.js";
import {
  supplierCashflowSchema,
  supplierSettleSchema,
  supplierSettleAccountSchema,
} from "../supplier.js";

const firstMessage = (r: {
  success: boolean;
  error?: { issues: { message: string }[] };
}): string => (r.success ? "" : (r.error?.issues[0]?.message ?? ""));

describe("settleDiscountInputSchema (LIRA-372)", () => {
  it("accepts $5.00 and 450,000 LBP", () => {
    expect(
      settleDiscountInputSchema.safeParse({ amount_usd: 5, amount_lbp: 0 })
        .success,
    ).toBe(true);
    expect(
      settleDiscountInputSchema.safeParse({
        amount_usd: 0,
        amount_lbp: 450_000,
      }).success,
    ).toBe(true);
  });

  it("refuses $5.01 with the discount wording", () => {
    const r = settleDiscountInputSchema.safeParse({
      amount_usd: 5.01,
      amount_lbp: 0,
    });
    expect(r.success).toBe(false);
    expect(firstMessage(r)).toBe("The discount is more than $5.");
  });

  it("refuses 450,001 LBP", () => {
    const r = settleDiscountInputSchema.safeParse({
      amount_usd: 0,
      amount_lbp: 450_001,
    });
    expect(r.success).toBe(false);
    expect(firstMessage(r)).toBe("The discount is more than 450,000 LBP.");
  });

  it("refuses both zero and a negative amount", () => {
    expect(
      settleDiscountInputSchema.safeParse({ amount_usd: 0, amount_lbp: 0 })
        .success,
    ).toBe(false);
    expect(
      settleDiscountInputSchema.safeParse({ amount_usd: -1, amount_lbp: 0 })
        .success,
    ).toBe(false);
  });
});

describe("settleForgiveAmountSchema (LIRA-372)", () => {
  it.each([
    ["USD", 5, true],
    ["USD", 5.01, false],
    ["LBP", 450_000, true],
    ["LBP", 450_001, false],
    ["USD", -1, false],
  ] as const)("%s %p → %p", (currency, amount, ok) => {
    expect(settleForgiveAmountSchema(currency).safeParse(amount).success).toBe(
      ok,
    );
  });
});

describe("every settle wire key takes the cap (LIRA-372 T007)", () => {
  const legUsd = { method: "CASH", currency_code: "USD", amount: 95 };

  it("addRepaymentSchema.discount", () => {
    const base = {
      clientId: 1,
      amountUSD: 95,
      amountLBP: 0,
    };
    expect(
      addRepaymentSchema.safeParse({
        ...base,
        discount: { amount_usd: 5, amount_lbp: 0 },
      }).success,
    ).toBe(true);
    expect(
      addRepaymentSchema.safeParse({
        ...base,
        discount: { amount_usd: 5.01, amount_lbp: 0 },
      }).success,
    ).toBe(false);
    expect(
      addRepaymentSchema.safeParse({
        ...base,
        discount: { amount_usd: 0, amount_lbp: 450_001 },
      }).success,
    ).toBe(false);
  });

  it("partnerSettleSchema.discount", () => {
    const base = {
      partnerId: 1,
      amount: 95,
      currency: "USD",
      settlementMethod: "CASH",
    };
    expect(
      partnerSettleSchema.safeParse({
        ...base,
        discount: { amount_usd: 5, amount_lbp: 0 },
      }).success,
    ).toBe(true);
    expect(
      partnerSettleSchema.safeParse({
        ...base,
        discount: { amount_usd: 5.01, amount_lbp: 0 },
      }).success,
    ).toBe(false);
  });

  it("partnerSettleDaysSchema per_currency.<C>.forgive.amount", () => {
    const make = (c: "USD" | "LBP", amount: number) => ({
      partnerId: 1,
      selections: [1],
      expected_owed: { usd: 100, lbp: 0 },
      per_currency: {
        [c]: {
          payer: "PARTNER",
          payments: [
            { method: "CASH", currency_code: c, amount: c === "USD" ? 95 : 1 },
          ],
          forgive: { amount },
        },
      },
    });
    expect(partnerSettleDaysSchema.safeParse(make("USD", 5)).success).toBe(
      true,
    );
    expect(partnerSettleDaysSchema.safeParse(make("USD", 5.01)).success).toBe(
      false,
    );
    expect(
      partnerSettleDaysSchema.safeParse(make("LBP", 450_000)).success,
    ).toBe(true);
    expect(
      partnerSettleDaysSchema.safeParse(make("LBP", 450_001)).success,
    ).toBe(false);
  });

  it("supplierSettleAccountSchema per_currency.<C>.waive", () => {
    const make = (c: "USD" | "LBP", waive: number) => ({
      account_supplier_id: 1,
      expected_owed: { usd: 100, lbp: 0 },
      per_currency: {
        [c]: {
          direction: "PAY",
          payments: [
            { method: "CASH", currency_code: c, amount: c === "USD" ? 95 : 1 },
          ],
          waive,
        },
      },
    });
    expect(supplierSettleAccountSchema.safeParse(make("USD", 5)).success).toBe(
      true,
    );
    expect(
      supplierSettleAccountSchema.safeParse(make("USD", 5.01)).success,
    ).toBe(false);
    expect(
      supplierSettleAccountSchema.safeParse(make("LBP", 450_000)).success,
    ).toBe(true);
    expect(
      supplierSettleAccountSchema.safeParse(make("LBP", 450_001)).success,
    ).toBe(false);
  });

  it("supplierSettleSchema.discount keeps the cap", () => {
    const base = {
      supplier_id: 1,
      financial_service_ids: [1],
      amount_usd: 95,
      amount_lbp: 0,
    };
    expect(
      supplierSettleSchema.safeParse({
        ...base,
        discount: { amount_usd: 5.01, amount_lbp: 0 },
      }).success,
    ).toBe(false);
  });

  it("supplierCashflowSchema.discount is capped", () => {
    const base = {
      supplier_id: 1,
      direction: "PAY",
      payments: [legUsd],
    };
    expect(
      supplierCashflowSchema.safeParse({
        ...base,
        discount: { amount_usd: 5, amount_lbp: 0 },
      }).success,
    ).toBe(true);
    expect(
      supplierCashflowSchema.safeParse({
        ...base,
        discount: { amount_usd: 5.01, amount_lbp: 0 },
      }).success,
    ).toBe(false);
  });

  it("admin Write off stays uncapped (FR-009)", () => {
    const debtShape = debtWriteOffSchema.safeParse({
      clientId: 1,
      amountUSD: 50,
      amountLBP: 0,
      reason: "old debt",
    });
    const partnerShape = partnerWriteOffSchema.safeParse({
      partnerId: 1,
      amount_usd: 50,
      amount_lbp: 0,
      reason: "old debt",
    });
    expect(debtShape.success).toBe(true);
    expect(partnerShape.success).toBe(true);
  });
});
