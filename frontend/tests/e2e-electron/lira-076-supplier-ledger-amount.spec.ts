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

test.describe("LIRA-076 (primary cash drawer model) — supplier ledger = GROSS owed, both directions", () => {
  test("SEND split-pay: ledger delta is the GROSS obligation (x+f−c), never a tender leg", async ({
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
    //   ledger delta = grossOwedDelta(SEND) = x + f − c = 80 + 5 − 0.5 = 84.5
    // The principal is BACK in the ledger, and that is the model change: with
    // no provider-side float to hold it, the 80 the shop owes OMT has nowhere
    // else to live. It is not the old double-count — the drawer holds that 80
    // as the shop's own banknotes (a different fact), which is why
    // Σ drawer − Δ owed still lands on the commission.
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
    // TOP_UP is positive (shop owes OMT): exactly +84.5 = x + f − c.
    // Read 4.5 under the superseded fee-only float model.
    expect(after.usd - before.usd).toBeCloseTo(84.5, 2);
    expect(after.lbp - before.lbp).toBeCloseTo(0, 2);
  });

  test("RECEIVE: ledger delta is the gross obligation NEGATED — the provider owes the shop, not the other way round", async ({
    appPage,
  }) => {
    const before = await omtBalance(appPage);

    // $40 transfer (x) + an EXPLICIT $2 OMT fee (f) — explicit, not
    // auto-looked-up, because `resolvedProviderFee` (the `f` that feeds this
    // booking) reads ONLY `data.omtFee`, never the fee-table lookup (see
    // file header). With f=2 explicit:
    //   c = calculateCommission("INTRA", f=2) = 2 × 0.10 = 0.2
    //   ledger delta = grossOwedDelta(RECEIVE) = −(x − f + c)
    //                = −(40 − 2 + 0.2) = −38.2
    // The SIGN is the point: on a RECEIVE the shop paid the customer out of
    // its own drawer, so the PROVIDER now owes the shop. Booked as a signed
    // TOP_UP (never "PAYMENT", which force-negates and would silently flip
    // this back). A settlement batch mixing SENDs and RECEIVEs nets these
    // against each other — that netting is what lira-059/settlement guard.
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
    // −38.2: the provider owes the shop. Read +1.8 (fee-only) under the
    // superseded float model and −40.4 under the pre-float model before that.
    expect(after.usd - before.usd).toBeCloseTo(-38.2, 2);
    expect(after.lbp - before.lbp).toBeCloseTo(0, 2);
  });
});
