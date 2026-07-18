/**
 * E2E: LIRA-077 (C4) — OMT_APP / WHISH_APP transfers move the app drawer
 *
 * App-wallet transfers must move money like Binance (the reference):
 *   SEND $20:    app drawer −20, General +20 (customer pays cash in)
 *   RECEIVE $20: app drawer +20, General −20 (shop pays customer out)
 *
 * Pre-C4 they fell through to the generic single-drawer path — SEND never
 * moved the app drawer and RECEIVE credited the wrong side.
 *
 * IPC-driven; shared accumulating DB → all assertions are DELTAS on drawer
 * balances snapshotted immediately around each action.
 *
 * Extended (PAYMENT_LEGS_INTEGRITY_PLAN wave 6, S1/S3/S4): a cross-currency
 * single-leg case below proves the fix for the owner-reported bug — a
 * SINGLE (non-split) payment line on a Whish App SEND used to be dropped by
 * the frontend's `isSplitPayment` gate, so a customer paying in LBP on a
 * USD-denominated send silently booked as if they'd paid USD. With the gate
 * removed (OmtWhishAppTransferForm.tsx), the leg reaches this repository's
 * ALREADY-correct per-leg-currency crediting (this same C4 fix): General
 * books the REAL tender currency, the wallet still moves in the service
 * currency, and the stored summary surfaces the paid-in currency whenever it
 * differs from the service currency (`FinancialServiceRepository`'s
 * `(paid …)` suffix). Written per rule 17/plan wave 6 — NOT run here; run at
 * the suite's next full e2e gate.
 */

import { test, expect } from "./fixtures";

test.describe.configure({ retries: 0 });

type DrawerBalance = {
  name: string;
  usdBalance: number;
  lbpBalance: number;
  usdtBalance: number;
};

type Api = {
  api: {
    recharge: {
      getDrawerBalances: () => Promise<DrawerBalance[]>;
    };
    omt: {
      addTransaction: (data: {
        provider: string;
        serviceType: "SEND" | "RECEIVE";
        amount: number;
        currency?: string;
        commission?: number;
        paidByMethod?: string;
        cashoutMethod?: string;
        clientName?: string;
        payments?: Array<{
          method: string;
          currencyCode: string;
          amount: number;
          direction?: "IN" | "OUT";
        }>;
      }) => Promise<{ success?: boolean; id?: number; error?: string }>;
    };
    transactions: {
      getRecent: (
        limit: number,
      ) => Promise<
        Array<{ source_id: number; type: string; summary: string | null }>
      >;
    };
  };
};

/** Snapshot USD/LBP (or USDT) balances for the drawers we assert on. */
async function drawers(appPage: import("@playwright/test").Page) {
  return appPage.evaluate(async () => {
    const w = window as unknown as Api;
    const all = await w.api.recharge.getDrawerBalances();
    const get = (name: string) => all.find((d) => d.name === name);
    return {
      general: get("General")?.usdBalance ?? 0,
      generalLbp: get("General")?.lbpBalance ?? 0,
      omtApp: get("OMT_App")?.usdBalance ?? 0,
      whishApp: get("Whish_App")?.usdBalance ?? 0,
      binanceUsdt: get("Binance")?.usdtBalance ?? 0,
    };
  });
}

async function addTxn(
  appPage: import("@playwright/test").Page,
  data: Parameters<Api["api"]["omt"]["addTransaction"]>[0],
) {
  const res = await appPage.evaluate(
    (d) => (window as unknown as Api).api.omt.addTransaction(d),
    data,
  );
  expect(res.error ?? null).toBeNull();
  expect(res.success).toBe(true);
}

test.describe("LIRA-077 (C4) — app drawer movement", () => {
  test("OMT_APP SEND $20: OMT_App −20, General +20", async ({ appPage }) => {
    const before = await drawers(appPage);
    await addTxn(appPage, {
      provider: "OMT_APP",
      serviceType: "SEND",
      amount: 20,
      currency: "USD",
      commission: 0,
      paidByMethod: "CASH",
    });
    const after = await drawers(appPage);

    expect(after.omtApp - before.omtApp).toBeCloseTo(-20, 2);
    expect(after.general - before.general).toBeCloseTo(20, 2);
  });

  test("OMT_APP RECEIVE $20: OMT_App +20, General −20", async ({ appPage }) => {
    const before = await drawers(appPage);
    await addTxn(appPage, {
      provider: "OMT_APP",
      serviceType: "RECEIVE",
      amount: 20,
      currency: "USD",
      commission: 0,
      cashoutMethod: "CASH",
    });
    const after = await drawers(appPage);

    expect(after.omtApp - before.omtApp).toBeCloseTo(20, 2);
    expect(after.general - before.general).toBeCloseTo(-20, 2);
  });

  test("WHISH_APP SEND $20: Whish_App −20, General +20", async ({
    appPage,
  }) => {
    const before = await drawers(appPage);
    await addTxn(appPage, {
      provider: "WHISH_APP",
      serviceType: "SEND",
      amount: 20,
      currency: "USD",
      commission: 0,
      paidByMethod: "CASH",
    });
    const after = await drawers(appPage);

    expect(after.whishApp - before.whishApp).toBeCloseTo(-20, 2);
    expect(after.general - before.general).toBeCloseTo(20, 2);
  });

  test("BINANCE control: SEND $20 behaves identically (Binance USDT −20, General +20)", async ({
    appPage,
  }) => {
    const before = await drawers(appPage);
    await addTxn(appPage, {
      provider: "BINANCE",
      serviceType: "SEND",
      amount: 20,
      currency: "USDT",
      commission: 0,
      paidByMethod: "CASH",
    });
    const after = await drawers(appPage);

    expect(after.binanceUsdt - before.binanceUsdt).toBeCloseTo(-20, 2);
    expect(after.general - before.general).toBeCloseTo(20, 2);
  });
});

test.describe("LIRA-077 ext (PAYMENT_LEGS_INTEGRITY_PLAN wave 6) — cross-currency single leg", () => {
  test("Whish App SEND $10 paid with a SINGLE LBP cash leg: General books LBP only (zero USD delta), wallet still moves in USD, summary carries the paid currency", async ({
    appPage,
  }) => {
    const clientName = `LBP-XCUR ${Date.now()}`;
    const before = await drawers(appPage);

    const res = await appPage.evaluate(async (name: string) => {
      const w = window as unknown as Api;
      return w.api.omt.addTransaction({
        provider: "WHISH_APP",
        serviceType: "SEND",
        amount: 10,
        currency: "USD",
        commission: 0,
        clientName: name,
        // A SINGLE (non-split) payment line — the common case the S1 gate
        // used to drop. The tender is LBP; the service is denominated USD.
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 900000 }],
      });
    }, clientName);

    expect(res.error ?? null).toBeNull();
    expect(res.success).toBe(true);

    const after = await drawers(appPage);

    // S4 — book physical reality: General receives the REAL tender (LBP),
    // never a phantom USD conversion. Zero USD movement on General — pre-fix
    // (no leg forwarded), the repository's fallback would have assumed the
    // tender was $10 and booked General USD instead of LBP.
    expect(after.generalLbp - before.generalLbp).toBeCloseTo(900000, 2);
    expect(after.general - before.general).toBeCloseTo(0, 2);

    // The wallet side is unaffected by the tender's currency — it still
    // tracks the SERVICE currency (USD), same as every other SEND in C4.
    expect(after.whishApp - before.whishApp).toBeCloseTo(-10, 2);

    // S3 — tender-first display: the stored summary surfaces the real paid
    // currency whenever it differs from the service currency. Row located by
    // IDENTITY (unique client name + source_id from the create call), never
    // by position (shared accumulating DB, rule 15).
    const recent = await appPage.evaluate(() =>
      (window as unknown as Api).api.transactions.getRecent(50),
    );
    const row = recent.find(
      (t) => t.type === "FINANCIAL_SERVICE" && t.source_id === res.id,
    );
    expect(row).toBeTruthy();
    expect(row?.summary ?? "").toContain("(paid 900,000 LBP)");
  });
});
