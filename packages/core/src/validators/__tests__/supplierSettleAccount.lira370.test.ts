/**
 * LIRA-370 T008 — supplierSettleAccountSchema keeps the SMS-settlement
 * keys: `per_currency.*.sms_amount` (OMT's sign: + we pay, − OMT pays us)
 * and the root `owed_shares_only`. Zod strips unknown keys silently
 * (rule 23), so each key must survive a parse. `owed_shares_only` is
 * amount-first only, like the other LIRA-343 keys.
 *
 * Rule 17: run against the unchanged schema first (both "keeps" tests
 * failed: the keys were stripped).
 */
import { supplierSettleAccountSchema } from "../supplier.js";

const amountFirst = {
  account_supplier_id: 1,
  per_currency: {
    USD: {
      direction: "PAY" as const,
      payments: [{ method: "CASH", currency_code: "USD", amount: 762.3 }],
      commission: 14.2,
      sms_amount: 762.3,
    },
  },
  expected_owed: { usd: 776.5, lbp: 0 },
};

describe("supplierSettleAccountSchema — LIRA-370 SMS keys", () => {
  it("keeps per_currency.*.sms_amount, negative included (OMT pays us)", () => {
    const r = supplierSettleAccountSchema.safeParse(amountFirst);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.per_currency?.USD?.sms_amount).toBe(762.3);

    const collect = supplierSettleAccountSchema.safeParse({
      ...amountFirst,
      per_currency: {
        USD: { ...amountFirst.per_currency.USD, direction: "COLLECT", sms_amount: -249.7 },
      },
    });
    expect(collect.success).toBe(true);
    if (collect.success) expect(collect.data.per_currency?.USD?.sms_amount).toBe(-249.7);
  });

  it("keeps owed_shares_only on the amount-first path", () => {
    const r = supplierSettleAccountSchema.safeParse({ ...amountFirst, owed_shares_only: true });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.owed_shares_only).toBe(true);
  });

  it("refuses owed_shares_only on the legacy whole-row path", () => {
    const r = supplierSettleAccountSchema.safeParse({
      account_supplier_id: 1,
      direction: "PAY",
      selections: [{ kind: "FINANCIAL_SERVICE", id: 1 }],
      amount_usd: 10,
      amount_lbp: 0,
      commission_usd: 0,
      commission_lbp: 0,
      payments: [{ method: "CASH", currency_code: "USD", amount: 10 }],
      owed_shares_only: true,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.map((i) => i.path.join("."))).toContain("owed_shares_only");
    }
  });

  it("exposes both keys on .shape for the transport key tests", () => {
    expect(Object.keys(supplierSettleAccountSchema.shape)).toContain("owed_shares_only");
  });
});
