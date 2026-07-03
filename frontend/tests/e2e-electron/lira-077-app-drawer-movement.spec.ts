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
      }) => Promise<{ success?: boolean; id?: number; error?: string }>;
    };
  };
};

/** Snapshot USD (or USDT) balances for the drawers we assert on. */
async function drawers(appPage: import("@playwright/test").Page) {
  return appPage.evaluate(async () => {
    const w = window as unknown as Api;
    const all = await w.api.recharge.getDrawerBalances();
    const get = (name: string) => all.find((d) => d.name === name);
    return {
      general: get("General")?.usdBalance ?? 0,
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
