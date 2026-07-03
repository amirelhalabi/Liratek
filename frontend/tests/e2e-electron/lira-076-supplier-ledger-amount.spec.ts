/**
 * E2E: LIRA-076 (C3) — supplier ledger books the TRANSACTION amount
 *
 * The auto supplier_ledger entry for an OMT/WHISH system transaction must equal
 * the transfer amount — never the customer-paid total. Pre-C3 it booked
 * amount + omtFee on SEND (exactly what the customer paid) and
 * amount + commission on RECEIVE, leaving a phantom fee/commission residue on
 * the supplier balance after settlement.
 *
 * IPC-driven; shared accumulating DB → all assertions are DELTAS on the OMT
 * supplier balance (snapshot immediately before each action), never absolutes.
 */

import { test, expect } from "./fixtures";

test.describe.configure({ retries: 0 });

type SupplierBalance = {
  supplier_id: number;
  total_usd: number;
  total_lbp: number;
};

type Api = {
  api: {
    suppliers: {
      list: (
        search: string,
        includeInactive: boolean,
      ) => Promise<Array<{ id: number; provider: string | null }>>;
      getBalances: (includeInactive?: boolean) => Promise<SupplierBalance[]>;
    };
    omt: {
      addTransaction: (data: {
        provider: string;
        serviceType: "SEND" | "RECEIVE" | "BILL";
        amount: number;
        currency?: string;
        commission?: number;
        omtServiceType?: string;
        omtFee?: number;
        cashoutMethod?: string;
        paidByMethod?: string;
        payments?: Array<{
          method: string;
          currencyCode: string;
          amount: number;
          direction?: "IN" | "OUT";
        }>;
      }) => Promise<{ success?: boolean; id?: number; error?: string }>;
    };
  };
};

async function omtBalance(
  appPage: import("@playwright/test").Page,
): Promise<{ id: number; usd: number; lbp: number }> {
  return appPage.evaluate(async () => {
    const w = window as unknown as Api;
    const omt = (await w.api.suppliers.list("", true)).find(
      (s) => s.provider === "OMT",
    );
    if (!omt) throw new Error("OMT supplier not found");
    const bal = (await w.api.suppliers.getBalances(true)).find(
      (b) => b.supplier_id === omt.id,
    );
    return {
      id: omt.id,
      usd: bal?.total_usd ?? 0,
      lbp: bal?.total_lbp ?? 0,
    };
  });
}

test.describe("LIRA-076 (C3) — supplier ledger = transaction amount", () => {
  test("SEND split-pay: ledger delta is the transfer amount, not the paid total or amount+fee", async ({
    appPage,
  }) => {
    const before = await omtBalance(appPage);

    // $80 transfer + $5 fee; customer split-pays $30 cash + an LBP leg.
    // Neither 30, nor the LBP-converted total, nor 85 may reach the ledger.
    const res = await appPage.evaluate(async () => {
      const w = window as unknown as Api;
      return w.api.omt.addTransaction({
        provider: "OMT",
        serviceType: "SEND",
        amount: 80,
        currency: "USD",
        commission: 0,
        omtServiceType: "INTRA",
        omtFee: 5,
        payments: [
          { method: "CASH", currencyCode: "USD", amount: 30 },
          { method: "CASH", currencyCode: "LBP", amount: 4_950_000 },
        ],
      });
    });
    expect(res.error ?? null).toBeNull();
    expect(res.success).toBe(true);

    const after = await omtBalance(appPage);
    // TOP_UP is positive (shop owes OMT): exactly +80 — pre-C3 this was +85.
    expect(after.usd - before.usd).toBeCloseTo(80, 2);
    expect(after.lbp - before.lbp).toBeCloseTo(0, 2);
  });

  test("RECEIVE: ledger delta is the transfer amount, not amount+commission", async ({
    appPage,
  }) => {
    const before = await omtBalance(appPage);

    const res = await appPage.evaluate(async () => {
      const w = window as unknown as Api;
      return w.api.omt.addTransaction({
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 40,
        currency: "USD",
        commission: 0.4,
        omtServiceType: "INTRA",
        cashoutMethod: "CASH",
      });
    });
    expect(res.error ?? null).toBeNull();
    expect(res.success).toBe(true);

    const after = await omtBalance(appPage);
    // PAYMENT is stored negative: exactly −40 — pre-C3 this was −40.40
    // (−(amount + commission)).
    expect(after.usd - before.usd).toBeCloseTo(-40, 2);
    expect(after.lbp - before.lbp).toBeCloseTo(0, 2);
  });
});
