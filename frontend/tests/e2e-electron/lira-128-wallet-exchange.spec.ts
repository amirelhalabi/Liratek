/**
 * E2E: Internal Wallet Exchange (owner req 2026-07-28)
 *
 * Convert a provider wallet's (OMT App / Whish App) OWN USD balance to LBP,
 * or vice versa, at an operator-entered rate (default 89000) — never touches
 * General, never a customer. Driven through the real UI (Recharge → OMT App
 * → Exchange tab): amount + rate inputs, computed result preview, confirm.
 *
 * Assertions are drawer-balance DELTAS snapshotted immediately around each
 * action (CLAUDE.md rule 15) — never absolute totals.
 *
 * Failing-first procedure (rule 17, for the verifier): this spec cannot pass
 * without the WalletExchangePanel/WalletExchangeRepository feature. Stash
 * `frontend/src/features/recharge/components/OmtWhishAppTransferForm.tsx`
 * back to its pre-feature state (no Exchange tab) and re-run — the "Exchange"
 * tab button never appears, so every test here times out. Restore and
 * confirm all pass again.
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

type DrawerBalance = { name: string; usdBalance: number; lbpBalance: number };

type Api = {
  api: {
    recharge: { getDrawerBalances: () => Promise<DrawerBalance[]> };
    omt: {
      addTransaction: (data: {
        provider: string;
        serviceType: "SEND" | "RECEIVE";
        amount: number;
        currency?: string;
        commission?: number;
        cashoutMethod?: string;
      }) => Promise<{ success?: boolean; id?: number; error?: string }>;
    };
    walletExchange: {
      create: (data: {
        drawerName: "OMT_App" | "Whish_App";
        fromCurrency: "USD" | "LBP";
        toCurrency: "USD" | "LBP";
        amountIn: number;
        rate: number;
      }) => Promise<{
        success: boolean;
        id?: number;
        amountOut?: number;
        error?: string;
      }>;
    };
  };
};

async function drawers(page: Page) {
  return page.evaluate(async () => {
    const w = window as unknown as Api;
    const all = await w.api.recharge.getDrawerBalances();
    const get = (name: string) => all.find((d) => d.name === name);
    return {
      omtAppUsd: get("OMT_App")?.usdBalance ?? 0,
      omtAppLbp: get("OMT_App")?.lbpBalance ?? 0,
      generalUsd: get("General")?.usdBalance ?? 0,
      generalLbp: get("General")?.lbpBalance ?? 0,
    };
  });
}

/**
 * Top the OMT App wallet's USD balance up to AT LEAST `minimum` via a
 * RECEIVE (mirrors lira-077's app-drawer-movement funding pattern).
 *
 * A fixed top-up amount is NOT safe here: this is the shared, accumulating
 * per-worker DB (CLAUDE.md rule 15) — dozens of other specs run OMT_APP
 * SEND/RECEIVE scenarios before this file in a full-suite run, and can leave
 * the wallet's own USD balance arbitrarily negative by the time this spec
 * runs (found 2026-07-28: a full-suite run left OMT_App at roughly -227
 * USD, so a flat "+200" top-up here landed at -27 — still short of the $50
 * this test converts, so the exchange correctly hit the insufficient-funds
 * guard and never moved). Reading the CURRENT balance first and topping up
 * only the shortfall (+ buffer) guarantees the floor regardless of prior
 * spec history.
 */
async function ensureOmtAppUsdBalance(page: Page, minimum: number) {
  const current = (await drawers(page)).omtAppUsd;
  const shortfall = minimum - current;
  if (shortfall <= 0) return;
  // +50 buffer beyond the requested floor so a concurrent/later top-up in
  // this same test still has headroom.
  const topUp = shortfall + 50;
  const res = await page.evaluate(
    (amount) =>
      (window as unknown as Api).api.omt.addTransaction({
        provider: "OMT_APP",
        serviceType: "RECEIVE",
        amount,
        currency: "USD",
        commission: 0,
        cashoutMethod: "CASH",
      }),
    topUp,
  );
  expect(res.error ?? null).toBeNull();
  expect(res.success).toBe(true);
}

async function openOmtAppExchangeTab(page: Page) {
  const omtTab = page
    .locator("button")
    .filter({ hasText: /^OMT App$/ })
    .first();
  await expect(omtTab).toBeVisible({ timeout: 8_000 });
  await omtTab.click();

  const exchangeTab = page
    .locator("button")
    .filter({ hasText: /^Exchange$/ })
    .first();
  await expect(exchangeTab).toBeVisible({ timeout: 8_000 });
  await exchangeTab.click();

  await expect(page.getByTestId("wallet-exchange-confirm")).toBeVisible({
    timeout: 8_000,
  });
}

test.describe("Wallet Exchange — OMT App / Whish App internal USD<->LBP", () => {
  test("USD -> LBP: converts at the entered rate, wallet USD down / LBP up by exactly that amount, General untouched", async ({
    appPage,
  }) => {
    await ensureOmtAppUsdBalance(appPage, 300);

    await navigateTo(appPage, "/recharge");
    await openOmtAppExchangeTab(appPage);

    const before = await drawers(appPage);

    // Default rate is pre-filled at 89000.
    const rateInput = appPage.getByTestId("wallet-exchange-rate");
    await expect(rateInput).toHaveValue("89000");

    const amountInput = appPage.getByTestId("wallet-exchange-amount");
    await amountInput.fill("50");

    // Result preview: 50 * 89000 = 4,450,000 LBP.
    await expect(appPage.getByTestId("wallet-exchange-result")).toHaveText(
      "4,450,000 LBP",
    );

    await appPage.getByTestId("wallet-exchange-confirm").click();

    await expect
      .poll(async () => (await drawers(appPage)).omtAppUsd, { timeout: 8_000 })
      .toBeCloseTo(before.omtAppUsd - 50, 2);

    const after = await drawers(appPage);
    expect(after.omtAppLbp - before.omtAppLbp).toBeCloseTo(4_450_000, 0);
    // Never touches General.
    expect(after.generalUsd - before.generalUsd).toBeCloseTo(0, 2);
    expect(after.generalLbp - before.generalLbp).toBeCloseTo(0, 0);
  });

  test("swap direction (LBP -> USD): divides by the rate, wallet LBP down / USD up", async ({
    appPage,
  }) => {
    await ensureOmtAppUsdBalance(appPage, 300);

    await navigateTo(appPage, "/recharge");
    await openOmtAppExchangeTab(appPage);

    // Seed some LBP in the wallet first via a USD->LBP exchange (100 USD @ 89000).
    const seeded = await appPage.evaluate(() =>
      (window as unknown as Api).api.walletExchange.create({
        drawerName: "OMT_App",
        fromCurrency: "USD",
        toCurrency: "LBP",
        amountIn: 100,
        rate: 89_000,
      }),
    );
    expect(seeded.success).toBe(true);

    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/recharge");
    await openOmtAppExchangeTab(appPage);

    const before = await drawers(appPage);

    await appPage.getByTestId("wallet-exchange-swap").click();
    const amountInput = appPage.getByTestId("wallet-exchange-amount");
    await amountInput.fill("8900000");

    // 8,900,000 / 89000 = 100.00 USD.
    await expect(appPage.getByTestId("wallet-exchange-result")).toHaveText(
      "$100.00",
    );

    await appPage.getByTestId("wallet-exchange-confirm").click();

    await expect
      .poll(async () => (await drawers(appPage)).omtAppLbp, {
        timeout: 8_000,
      })
      .toBeCloseTo(before.omtAppLbp - 8_900_000, 0);

    const after = await drawers(appPage);
    expect(after.omtAppUsd - before.omtAppUsd).toBeCloseTo(100, 2);
  });

  test("rejects converting more than the wallet's available balance — shows an error, balances unchanged", async ({
    appPage,
  }) => {
    // Fresh mount so this test doesn't inherit a prior test's swapped
    // from/to direction (the panel's local state persists across a
    // same-route navigateTo) — bounce through "/" first, same as the swap
    // test above.
    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/recharge");
    await openOmtAppExchangeTab(appPage);

    const before = await drawers(appPage);

    const amountInput = appPage.getByTestId("wallet-exchange-amount");
    await amountInput.fill("999999999");

    await appPage.getByTestId("wallet-exchange-confirm").click();

    // Currency-agnostic: this test only cares that SOME insufficient-funds
    // error surfaces, not which currency the panel happened to default to.
    await expect(
      appPage.getByText(/Insufficient (USD|LBP) balance/i),
    ).toBeVisible({
      timeout: 5_000,
    });

    const after = await drawers(appPage);
    expect(after.omtAppUsd).toBeCloseTo(before.omtAppUsd, 2);
    expect(after.omtAppLbp).toBeCloseTo(before.omtAppLbp, 0);
  });
});
