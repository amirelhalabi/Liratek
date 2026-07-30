/**
 * E2E: LIRA-076 (C3, superseded by the float model) — supplier ledger books
 * the FEE-ONLY amount owed to the provider, on both SEND and RECEIVE.
 *
 * UPDATED (float model, 2026-07-29, docs/FEATURE_GUIDE.md §8/§8.1): the
 * principal `x` no longer appears in `supplier_ledger` at all — it moved
 * through the OMT_System float drawer instead (lira-074). The ledger now
 * tracks ONLY the fee split: the provider charges a per-transfer fee `f`, the
 * shop keeps a commission cut `c` of it, and owes the provider the rest,
 * `f − c` — booked via `entry_type: TOP_UP` on BOTH directions (SEND and
 * RECEIVE book the SAME shape now, per `feeOwedDelta()` in
 * FinancialServiceRepository.ts). The original C3 (superseded) booked SEND at
 * `amount + fee` (gross) and RECEIVE at the bare `amount` — both wrong under
 * the float model, since `x` is now the float's job, not the ledger's.
 *
 * The RECEIVE case below now passes an EXPLICIT `omtFee` (it didn't before).
 * Reason: `FinancialServiceRepository`'s `resolvedProviderFee` (the `f` that
 * feeds this exact booking) reads ONLY `data.omtFee ?? 0` — it does NOT fall
 * back to the `lookupOmtFee(omtServiceType, amount, currency)` auto-lookup
 * the commission calc uses. A RECEIVE fixture that sets `omtServiceType`
 * without an explicit `omtFee` would auto-resolve a nonzero commission `c`
 * from the fee table while `f` stayed 0, producing `feeOwedDelta = 0 − c`, a
 * negative number with no real fee behind it (flagged as "Bug A" in the
 * float-model assess report). Sending `omtFee` explicitly sidesteps that
 * ambiguity entirely and exercises the real formula with a fee that
 * actually exists.
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

test.describe("LIRA-076 (float model) — supplier ledger = fee-only owed, both directions", () => {
  test("SEND split-pay: ledger delta is the fee net of commission (f−c), never the principal or a tender leg", async ({
    appPage,
  }) => {
    const before = await omtBalance(appPage);

    // $80 transfer (x) + $5 OMT fee (f); customer split-pays $30 cash + an
    // LBP leg covering the rest of x+f=85 (unchanged — the customer-facing
    // legs still collect the full x+f, only the SUPPLIER ledger's booking
    // changes). omtServiceType "INTRA" + a nonzero resolved fee makes
    // FinancialServiceRepository auto-compute the commission from the fee
    // table regardless of the `commission` field sent — so this test does
    // NOT pass `commission` at all; it lets the real auto-calc run:
    //   c = calculateCommission("INTRA", f=5) = 5 × OMT_COMMISSION_RATES.INTRA
    //     = 5 × 0.10 = 0.5
    //   ledger delta = feeOwedDelta = |f| − |c| = 5 − 0.5 = 4.5
    // (Hand-derived from omtFees.ts + FinancialServiceRepository.ts's
    // feeOwedDelta; unexecuted. The principal 80 never reaches the ledger —
    // it moved through the OMT_System float instead, per lira-074.)
    const res = await appPage.evaluate(async () => {
      const w = window as unknown as Api;
      return w.api.omt.addTransaction({
        provider: "OMT",
        serviceType: "SEND",
        amount: 80,
        currency: "USD",
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
    // TOP_UP is positive (shop owes OMT): exactly +4.5 (f−c) — was +85
    // (x+f, gross) under the superseded C3 model.
    expect(after.usd - before.usd).toBeCloseTo(4.5, 2);
    expect(after.lbp - before.lbp).toBeCloseTo(0, 2);
  });

  test("RECEIVE: ledger delta is ALSO the fee net of commission (f−c), same shape as SEND, not the bare transfer amount", async ({
    appPage,
  }) => {
    const before = await omtBalance(appPage);

    // $40 transfer (x) + an EXPLICIT $2 OMT fee (f) — explicit, not
    // auto-looked-up, because `resolvedProviderFee` (the `f` that feeds this
    // booking) reads ONLY `data.omtFee`, never the fee-table lookup (see
    // file header). With f=2 explicit:
    //   c = calculateCommission("INTRA", f=2) = 2 × 0.10 = 0.2
    //   ledger delta = feeOwedDelta = |f| − |c| = 2 − 0.2 = 1.8
    // entry_type is TOP_UP (unsigned, stored as-is) — RECEIVE no longer uses
    // "PAYMENT" (which force-negates), because under the float model a
    // RECEIVE's fee obligation INCREASES what's owed exactly like a SEND's
    // does. Hand-derived from omtFees.ts + FinancialServiceRepository.ts;
    // unexecuted. (This RECEIVE also now books a real $2 customer-paid fee
    // leg into General — asserted by the new web spec, not duplicated here
    // since this file only snapshots the supplier ledger.)
    const res = await appPage.evaluate(async () => {
      const w = window as unknown as Api;
      return w.api.omt.addTransaction({
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 40,
        currency: "USD",
        omtServiceType: "INTRA",
        omtFee: 2,
        cashoutMethod: "CASH",
      });
    });
    expect(res.error ?? null).toBeNull();
    expect(res.success).toBe(true);

    const after = await omtBalance(appPage);
    // Was −40.4 (−(amount+commission), PAYMENT force-negated) under the
    // superseded pre-float model; now +1.8 (f−c, TOP_UP, same sign/shape as
    // SEND).
    expect(after.usd - before.usd).toBeCloseTo(1.8, 2);
    expect(after.lbp - before.lbp).toBeCloseTo(0, 2);
  });
});
