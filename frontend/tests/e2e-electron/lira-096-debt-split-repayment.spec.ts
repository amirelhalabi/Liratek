/**
 * LIRA-096 — Debts: split repayment (USD + LBP) through the Process Repayment
 * modal.
 *
 * Owner-reported (2026-07-05): settling a debt with a split CASH payment in
 * two currencies failed with "Validation failed: amountUSD: Expected number,
 * received nan". Root cause: `useExchangeRate` still computed the rate from
 * the long-gone `delta` column (`market_rate + is_stronger * (action *
 * undefined)` = NaN) — the moment a real `exchange_rates` row exists (seeded
 * by create_db.sql on EVERY fresh install, including this harness), every
 * consumer got NaN. MultiPaymentInput masked it in the UI via its
 * `exchangeRate || 89000` fallback, while the Debts page divided the LBP legs
 * by the raw NaN.
 *
 * Why no spec caught it: existing debt-settlement coverage (app.spec
 * lifecycle) settles via the "Full debt" quick-fill — a single USD line, so
 * `paidLBP === 0` and the NaN division never ran. This spec sends a real LBP
 * leg through the modal.
 *
 * Fix under guard: useExchangeRate reads sell_rate/buy_rate (current schema),
 * and the Debts page converts LBP legs at the rate the MODAL actually used
 * (onExchangeRateChange), with finite-guards. Rule 17: reverting those fixes
 * makes this spec fail (pre-fix: the validation-error dialog fires and no
 * repayment books). Rule 15: delta + identity assertions only.
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

// This spec asserts on toast visibility — opt out of the harness's 2ms
// notification-duration override and keep the real dismiss timing.
test.use({ notificationDurationMs: null });

type Api = {
  api: {
    maintenance: {
      save: (d: Record<string, unknown>) => Promise<{
        success?: boolean;
        error?: string;
      }>;
    };
    debt: {
      getDebtors: () => Promise<
        Array<{
          client_id: number;
          full_name?: string;
          client_name?: string;
          total_debt_usd: number;
          total_debt_lbp: number;
        }>
      >;
    };
    rates: {
      list: () => Promise<{
        success?: boolean;
        data?: Array<{
          to_code: string;
          sell_rate?: number;
          buy_rate?: number;
        }>;
      }>;
    };
    dashboard: {
      getDrawerBalances: () => Promise<{
        generalDrawer: { usd: number; lbp: number };
      }>;
    };
  };
};

let dialogs: string[] = [];

async function generalBalances(page: Page) {
  return page.evaluate(async () => {
    const w = window as unknown as Api;
    const b = await w.api.dashboard.getDrawerBalances();
    return { usd: b.generalDrawer.usd, lbp: b.generalDrawer.lbp };
  });
}

async function debtorTotals(page: Page, name: string) {
  return page.evaluate(async (n) => {
    const w = window as unknown as Api;
    const rows = await w.api.debt.getDebtors();
    const row = rows.find((r) => (r.full_name ?? r.client_name) === n);
    return row
      ? { usd: row.total_debt_usd, lbp: row.total_debt_lbp }
      : { usd: 0, lbp: 0 };
  }, name);
}

test.describe("LIRA-096 — debt split repayment (USD + LBP)", () => {
  test.beforeEach(({ appPage }) => {
    dialogs = [];
    appPage.on("dialog", (d) => dialogs.push(d.message()));
  });

  test("split CASH USD + LBP settles the debt at the modal's rate", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const CLIENT = `L096 Split ${ts}`;
    const PHONE = `76${String(ts).slice(-6)}`;
    const DEBT = 30; // USD
    const USD_LEG = 10;

    // Precondition: the harness DB carries the create_db.sql-seeded LBP rate
    // row — buy_rate 89,000. Debt repayment is a Money-IN flow that converts
    // LBP↔USD at the BUY rate (owner decision 2026-07-06), so the modal values
    // LBP at 89,000 and full settlement of the remaining $20 is exactly
    // 1,780,000 LBP.
    const lbpRow = await appPage.evaluate(async () => {
      const w = window as unknown as Api;
      const res = await w.api.rates.list();
      const rows = Array.isArray(res) ? res : (res.data ?? []);
      return rows.find((r: { to_code: string }) => r.to_code === "LBP") ?? null;
    });
    expect(lbpRow, "seeded LBP exchange_rates row missing").not.toBeNull();
    const BUY_RATE = (lbpRow as { buy_rate?: number }).buy_rate ?? 0;
    expect(BUY_RATE).toBeGreaterThan(0);
    const LBP_LEG = (DEBT - USD_LEG) * BUY_RATE;

    // Seed a $30 CUSTOMER_ACCOUNT debt (maintenance path, per lira-081).
    const seeded = await appPage.evaluate(
      async ({ name, phone, debt }) => {
        const w = window as unknown as Api;
        return w.api.maintenance.save({
          device_name: "L096 phone",
          issue_description: "split repayment seed",
          client_name: name,
          client_phone: phone,
          cost_usd: 5,
          price_usd: debt,
          final_amount_usd: debt,
          currency: "USD",
          exchange_rate: 90000,
          status: "Delivered_Paid",
          paid_usd: 0,
          paid_lbp: 0,
          payments: [
            { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: debt },
          ],
        });
      },
      { name: CLIENT, phone: PHONE, debt: DEBT },
    );
    expect(seeded?.success, seeded?.error).toBe(true);
    expect((await debtorTotals(appPage, CLIENT)).usd).toBeCloseTo(DEBT, 2);

    const before = await generalBalances(appPage);

    // Open the debtor in the Debts page UI and start a repayment.
    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/debts");
    await appPage.getByPlaceholder(/Search client/i).fill(CLIENT);
    await appPage.locator("button").filter({ hasText: CLIENT }).first().click();
    await appPage
      .locator("button")
      .filter({ hasText: /Settle Debt|Cash Out/i })
      .first()
      .click();
    await expect(appPage.getByText("Process Repayment")).toBeVisible();

    // Split payment: line 1 CASH USD 10, line 2 CASH LBP for the remainder.
    await appPage.getByTestId("split-toggle").click();
    const amount = (i: number) =>
      appPage.locator('[data-testid^="payment-amount-"]').nth(i);
    await amount(0).fill(String(USD_LEG));
    await appPage.getByRole("button", { name: /Add Payment Line/i }).click();
    const line2 = appPage.locator('[data-testid^="payment-line-"]').nth(1);
    await line2.locator("select").nth(1).selectOption("LBP");
    await amount(1).fill(String(LBP_LEG));
    await appPage.getByRole("button", { name: /^Confirm Payment$/ }).click();

    // Pre-fix this fired "Error: Validation failed: amountUSD: Expected
    // number, received nan" — the success toast is the guard.
    await expect(
      appPage
        .locator('[role="alert"]', { hasText: /Repayment processed/i })
        .first(),
    ).toBeVisible({ timeout: 15_000 });
    expect(
      dialogs.filter((d) => /error|validation|nan/i.test(d)),
      "repayment raised an error dialog",
    ).toEqual([]);

    // Money: both legs hit General in their own currency, booked once.
    const after = await generalBalances(appPage);
    expect(after.usd - before.usd).toBeCloseTo(USD_LEG, 2);
    expect(after.lbp - before.lbp).toBeCloseTo(LBP_LEG, 0);

    // Debt: fully settled at the modal's rate (10 + 1,780,000/89,000 = 30).
    const remaining = await debtorTotals(appPage, CLIENT);
    expect(Math.abs(remaining.usd)).toBeLessThan(0.05);
    expect(Math.abs(remaining.lbp)).toBeLessThan(1000);
  });
});
