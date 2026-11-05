import { addRepaymentSchema } from "../debt.js";
import {
  supplierCashflowSchema,
  supplierSettleAccountSchema,
  supplierSettleSchema,
} from "../supplier.js";
import { partnerSettleSchema } from "../partner.js";

// LIRA-371 — the optional cash-drawer choice key on every settle / repay
// schema (contracts/cash-drawer-choice.md). `.optional()` only, never
// `.default()` (rule 22): an absent key stays absent.

const repay = { clientId: 1, amountUSD: 200, amountLBP: 0 };
const batchSettle = {
  supplier_id: 1,
  financial_service_ids: [1],
  amount_usd: 0,
  amount_lbp: 0,
  commission_usd: 0,
  commission_lbp: 0,
};
const legacyAccount = {
  account_supplier_id: 1,
  direction: "PAY" as const,
  selections: [{ kind: "FINANCIAL_SERVICE" as const, id: 1 }],
  amount_usd: 10,
  amount_lbp: 0,
  commission_usd: 0,
  commission_lbp: 0,
};
const amountFirstAccount = {
  account_supplier_id: 1,
  per_currency: {
    USD: {
      direction: "PAY" as const,
      payments: [{ method: "CASH", currency_code: "USD", amount: 772.3 }],
    },
  },
  expected_owed: { usd: 772.3, lbp: 0 },
};
const cashflow = {
  supplier_id: 1,
  direction: "PAY" as const,
  payments: [{ method: "CASH", currency_code: "USD", amount: 10 }],
};

describe("LIRA-371 cash drawer choice schema keys", () => {
  it("addRepaymentSchema keeps cashDrawer", () => {
    const r = addRepaymentSchema.safeParse({ ...repay, cashDrawer: "GENERAL" });
    expect(r.success && r.data.cashDrawer).toBe("GENERAL");
  });

  it("supplierSettleSchema keeps cash_drawer", () => {
    const r = supplierSettleSchema.safeParse({
      ...batchSettle,
      cash_drawer: "GENERAL",
    });
    expect(r.success && r.data.cash_drawer).toBe("GENERAL");
  });

  it("supplierSettleAccountSchema keeps cash_drawer on both shapes", () => {
    for (const base of [legacyAccount, amountFirstAccount]) {
      const r = supplierSettleAccountSchema.safeParse({
        ...base,
        cash_drawer: "GENERAL",
      });
      expect(r.success).toBe(true);
      expect(r.success && r.data.cash_drawer).toBe("GENERAL");
    }
    expect(Object.keys(supplierSettleAccountSchema.shape)).toContain(
      "cash_drawer",
    );
  });

  it("supplierCashflowSchema keeps cash_drawer", () => {
    const r = supplierCashflowSchema.safeParse({
      ...cashflow,
      cash_drawer: "GENERAL",
    });
    expect(r.success && r.data.cash_drawer).toBe("GENERAL");
  });

  it("refuses other values", () => {
    for (const bad of ["OMT_System", "general", "OMT"]) {
      expect(
        addRepaymentSchema.safeParse({ ...repay, cashDrawer: bad }).success,
      ).toBe(false);
      expect(
        supplierSettleSchema.safeParse({ ...batchSettle, cash_drawer: bad })
          .success,
      ).toBe(false);
      expect(
        supplierSettleAccountSchema.safeParse({
          ...amountFirstAccount,
          cash_drawer: bad,
        }).success,
      ).toBe(false);
      expect(
        supplierCashflowSchema.safeParse({ ...cashflow, cash_drawer: bad })
          .success,
      ).toBe(false);
    }
  });

  it("an absent key stays undefined (no .default())", () => {
    const a = addRepaymentSchema.parse(repay);
    expect(a.cashDrawer).toBeUndefined();
    expect("cashDrawer" in a).toBe(false);
    const s = supplierSettleAccountSchema.parse(amountFirstAccount);
    expect("cash_drawer" in s).toBe(false);
  });

  it("partnerSettleSchema has no cash drawer key (FR-006)", () => {
    const r = partnerSettleSchema.safeParse({
      partnerId: 1,
      amount: 10,
      currency: "USD",
      settlementMethod: "CASH",
      cash_drawer: "GENERAL",
    });
    expect(r.success).toBe(true);
    expect(r.success && "cash_drawer" in r.data).toBe(false);
  });
});
