/**
 * E2E: LIRA-110 (T7) — expenses can be paid out of any drawer, including the
 * Binance USDT wallet.
 *
 * An expense is the shop paying OUT, so the payment method picks WHICH drawer
 * the money leaves. The Expenses form now offers every drawer-affecting DB
 * method (Cash, OMT Wallet, Whish Wallet, Binance) instead of the old
 * hardcoded Cash / Credit-Card pair.
 *
 * The money-path change is Binance: its drawer is USDT-denominated. USDT is
 * 1:1 USD across the app, so the dollar value is stored in amount_usd and the
 * drawer leg moves that many USDT (never a phantom Binance/USD row). Void
 * restores by the leg's currency_code, so the USDT balance nets back.
 *
 * Rule 17: with the pre-fix ExpenseRepository a Binance expense deducted
 * Binance/USD and left USDT untouched — the USDT-delta assertion fails
 * (received 0). Rule 15: identity + per-currency drawer deltas only.
 */

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

type DrawerRow = {
  name: string;
  usdBalance: number;
  lbpBalance: number;
  usdtBalance: number;
};

type Api = {
  api: {
    recharge: { getDrawerBalances: () => Promise<DrawerRow[]> };
    expenses: {
      add: (d: {
        description: string;
        category: string;
        paid_by_method?: string;
        amount_usd: number;
        amount_lbp: number;
        expense_date: string;
      }) => Promise<{ success: boolean; id?: number; error?: string }>;
      delete: (id: number) => Promise<{ success: boolean; error?: string }>;
    };
  };
};

async function drawer(page: Page, name: string): Promise<DrawerRow> {
  return page.evaluate(async (n) => {
    const w = window as unknown as Api;
    const rows = await w.api.recharge.getDrawerBalances();
    return (
      rows.find((d) => d.name === n) ?? {
        name: n,
        usdBalance: 0,
        lbpBalance: 0,
        usdtBalance: 0,
      }
    );
  }, name);
}

test.describe("LIRA-110 — expense payment methods (all drawers, Binance USDT)", () => {
  test("Binance expense debits the USDT wallet (not USD), and void restores it", async ({
    appPage,
  }) => {
    const AMT = 30;
    const binanceBefore = await drawer(appPage, "Binance");

    const added = await appPage.evaluate(async (amt) => {
      const w = window as unknown as Api;
      const res = await w.api.expenses.add({
        description: `L110 binance ${Date.now()}`,
        category: "Shop_Supply",
        paid_by_method: "BINANCE",
        amount_usd: amt, // dollar value == USDT (1:1)
        amount_lbp: 0,
        expense_date: new Date().toISOString(),
      });
      return { ok: res.success, id: res.id ?? null, error: res.error ?? null };
    }, AMT);
    expect(added.error).toBeNull();
    expect(added.ok).toBe(true);
    expect(added.id).not.toBeNull();

    const binanceAfter = await drawer(appPage, "Binance");
    // The wallet the owner watches (USDT) drops by exactly the amount; the
    // phantom USD row must NOT move (pre-fix it moved USD and left USDT at 0).
    expect(binanceAfter.usdtBalance - binanceBefore.usdtBalance).toBeCloseTo(
      -AMT,
      2,
    );
    expect(binanceAfter.usdBalance - binanceBefore.usdBalance).toBeCloseTo(
      0,
      2,
    );

    // Void (rule 20): the generic reversal restores by the leg's currency_code,
    // so the Binance USDT balance nets back to the starting point.
    const voided = await appPage.evaluate(async (id) => {
      const w = window as unknown as Api;
      const res = await w.api.expenses.delete(id);
      return { ok: res.success, error: res.error ?? null };
    }, added.id as number);
    expect(voided.error).toBeNull();
    expect(voided.ok).toBe(true);

    const binanceRestored = await drawer(appPage, "Binance");
    expect(binanceRestored.usdtBalance - binanceBefore.usdtBalance).toBeCloseTo(
      0,
      2,
    );
  });

  test("Cash expense still debits General USD (DB-driven method list regression)", async ({
    appPage,
  }) => {
    const AMT = 20;
    const before = await drawer(appPage, "General");

    const added = await appPage.evaluate(async (amt) => {
      const w = window as unknown as Api;
      const res = await w.api.expenses.add({
        description: `L110 cash ${Date.now()}`,
        category: "Shop_Supply",
        paid_by_method: "CASH",
        amount_usd: amt,
        amount_lbp: 0,
        expense_date: new Date().toISOString(),
      });
      return { ok: res.success, id: res.id ?? null, error: res.error ?? null };
    }, AMT);
    expect(added.error).toBeNull();
    expect(added.ok).toBe(true);

    const after = await drawer(appPage, "General");
    expect(after.usdBalance - before.usdBalance).toBeCloseTo(-AMT, 2);

    // Clean up so the shared-DB balance is unchanged for later specs.
    await appPage.evaluate(async (id) => {
      const w = window as unknown as Api;
      await w.api.expenses.delete(id);
    }, added.id as number);
  });
});
