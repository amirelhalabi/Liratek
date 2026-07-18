/**
 * E2E: LIRA-122 — single-mode underpayment auto-splits into a CUSTOMER_ACCOUNT
 * remainder leg (owner incident 2026-07-15 / re-test 2026-07-17).
 *
 * Incident: a $315 WHISH_APP SEND with "$300 cash + $15 debt" intended was
 * booked ENTIRELY to the client's account — in single-payment mode the typed
 * amount was cosmetic; only the method + full total were submitted. The fix
 * (MultiPaymentInput auto-debt remainder): editing the amount below the total
 * with a chargeable client + CUSTOMER_ACCOUNT enabled synthesizes a live
 * CUSTOMER_ACCOUNT leg for the shortfall (data instantly, split-mode reveal
 * ~500ms after typing stops).
 *
 * This spec drives the owner's re-test verbatim through the real UI: WHISH
 * App SEND $140, new client, method switched to CASH, amount edited to 100 —
 * then asserts the sheet flips to split mode with a $40 CUSTOMER_ACCOUNT
 * line, and that submitting books General +100, Whish_App −140, client debt
 * +$40 (deltas + identity, rule 15). Failing-first proof for the underlying
 * component change ran at jest level (MultiPaymentInput.test.tsx, "auto-debt
 * remainder" suite) — on pre-fix code the sheet never leaves single mode, so
 * the split assertions here fail too.
 */

import { test, expect, navigateTo } from "./fixtures";
import { closeAllActiveSessions } from "./helpers/nav";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

type DrawerBalance = { name: string; usdBalance: number; lbpBalance: number };
type DebtorRow = {
  full_name: string;
  total_debt_usd: number;
  total_debt_lbp: number;
};

type Api = {
  api: {
    recharge: { getDrawerBalances: () => Promise<DrawerBalance[]> };
    debt: { getDebtors: () => Promise<DebtorRow[]> };
  };
};

async function drawers(page: Page) {
  return page.evaluate(async () => {
    const w = window as unknown as Api;
    const all = await w.api.recharge.getDrawerBalances();
    const get = (name: string) => all.find((d) => d.name === name);
    return {
      general: get("General")?.usdBalance ?? 0,
      whishApp: get("Whish_App")?.usdBalance ?? 0,
    };
  });
}

async function debtOf(page: Page, name: string) {
  return page.evaluate(async (n) => {
    const w = window as unknown as Api;
    const row = (await w.api.debt.getDebtors()).find((d) => d.full_name === n);
    return { usd: row?.total_debt_usd ?? 0, lbp: row?.total_debt_lbp ?? 0 };
  }, name);
}

test("WHISH App SEND $140, CASH amount edited to 100 → auto CUSTOMER_ACCOUNT $40 leg; books cash 100 + debt 40", async ({
  appPage,
}) => {
  const ts = Date.now();
  const CLIENT = `L120 AutoSplit ${ts}`;
  const PHONE = `81${String(ts).slice(-6)}`;

  await closeAllActiveSessions(appPage).catch(() => {});
  await navigateTo(appPage, "/recharge");

  // Whish App tab → force the Transfer sub-tab (parent state may be on Bills).
  const tab = appPage
    .locator("button")
    .filter({ hasText: /^Whish App$/ })
    .first();
  await expect(tab).toBeVisible({ timeout: 8_000 });
  await tab.click();
  const transferTab = appPage
    .locator("button")
    .filter({ hasText: /^Transfer$/ })
    .first();
  await expect(transferTab).toBeVisible({ timeout: 10_000 });
  await transferTab.click();
  await expect(appPage.locator("#transfer-amount")).toBeVisible({
    timeout: 5_000,
  });

  // SEND is the default tab. $140, new client (name+phone = chargeable).
  await appPage.locator("#transfer-amount").fill("140");
  await appPage.locator("#sender-name").fill(CLIENT);
  await appPage.keyboard.press("Escape"); // dismiss autocomplete dropdown
  await appPage.locator("#sender-phone").fill(PHONE);

  const before = await drawers(appPage);
  const debtBefore = await debtOf(appPage, CLIENT);

  await appPage.getByRole("button", { name: /Proceed to Pay/i }).click();

  // The sheet's single line auto-promotes to CUSTOMER_ACCOUNT for a new
  // client — switch to CASH, exactly like the owner's re-test.
  const sheet = appPage.locator('[data-testid="multi-payment-input"]').last();
  const methodSelect = sheet
    .locator('[data-testid^="payment-method-"]')
    .first();
  await expect(methodSelect).toBeVisible({ timeout: 5_000 });
  await methodSelect.selectOption("CASH");

  const amountInput = sheet.locator('[data-testid^="payment-amount-"]').first();
  await expect(amountInput).toHaveValue("140");
  await amountInput.fill("100");

  // THE assertion (failing-first at jest level): the sheet flips to split
  // mode on its own — a second, auto-added CUSTOMER_ACCOUNT line carrying
  // the $40 shortfall. 500ms reveal + slack.
  const allAmounts = sheet.locator('[data-testid^="payment-amount-"]');
  await expect(allAmounts).toHaveCount(2, { timeout: 4_000 });
  await expect(
    sheet.locator('[data-testid^="payment-method-"]').nth(1),
  ).toHaveValue("CUSTOMER_ACCOUNT");
  await expect(allAmounts.nth(1)).toHaveValue("40");

  // Submit and verify the money actually books split (the incident's gap:
  // the cash never reached any drawer, the FULL amount became debt).
  const payBtn = appPage.locator("button").filter({ hasText: /^Pay / }).last();
  await payBtn.click();
  await expect(payBtn).toBeHidden({ timeout: 8_000 });

  const after = await drawers(appPage);
  const debtAfter = await debtOf(appPage, CLIENT);

  expect(after.general - before.general).toBeCloseTo(100, 2); // cash leg
  expect(after.whishApp - before.whishApp).toBeCloseTo(-140, 2); // wallet send
  expect(debtAfter.usd - debtBefore.usd).toBeCloseTo(40, 2); // debt = shortfall ONLY
  expect(debtAfter.lbp - debtBefore.lbp).toBeCloseTo(0, 2);
});
