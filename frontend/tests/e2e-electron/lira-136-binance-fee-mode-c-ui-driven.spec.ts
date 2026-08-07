/**
 * E2E: LIRA-136 — Binance "customer pays separately" (mode C), driven
 * through the REAL Recharge/CryptoForm UI.
 *
 * NOT in the original BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md test plan — added
 * because a same-day adversarial review (2026-08-07, commits `5d35983` /
 * `7556876` / `346cb20`) found ZERO end-to-end coverage of this mode
 * anywhere: `CryptoForm.feeCollectedSeparately.test.tsx` proves the gating
 * and the counter-flow wiring in jsdom only, and no desktop e2e spec drives
 * the Binance Cash Out tab's 3-way fee-mode radio at all.
 *
 * Mode C mirrors the app-wallet Phase D contract (§10.2): the wallet leg
 * receives the BARE amount (never netted), the payout leg pays out the FULL
 * amount (never `amount − fee`), and the fee is collected back from the
 * customer via a SEPARATE counter-flow leg, on any method the operator
 * picks — proven here by routing it through the OMT wallet (`OMT_App`)
 * instead of the auto-seeded CASH default, so the fee lands somewhere
 * OBSERVABLY DIFFERENT from the payout drawer (`General`).
 *
 * Rule 15: every money assertion is a DELTA snapshotted immediately before
 * the sheet's Confirm click, compared immediately after — never an
 * absolute drawer total (this suite shares one accumulating DB).
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";
import { closeAllActiveSessions } from "./helpers/nav";

test.describe.configure({ retries: 0 });

type Api = {
  api: {
    recharge: {
      getDrawerBalances: () => Promise<
        Array<{
          name: string;
          usdBalance: number;
          lbpBalance: number;
          usdtBalance: number;
        }>
      >;
    };
    session: {
      start: (d: {
        customer_name: string;
        started_by: string;
      }) => Promise<{ success?: boolean; sessionId?: number }>;
      getActive: () => Promise<{ session?: { id: number } | null }>;
    };
  };
};

async function drawers(
  page: Page,
): Promise<{ general: number; binanceUsdt: number; omtApp: number }> {
  return page.evaluate(async () => {
    const w = window as unknown as Api;
    const rows = await w.api.recharge.getDrawerBalances();
    const pickUsd = (n: string) =>
      rows.find((d) => d.name === n)?.usdBalance ?? 0;
    const pickUsdt = (n: string) =>
      rows.find((d) => d.name === n)?.usdtBalance ?? 0;
    return {
      general: pickUsd("General"),
      binanceUsdt: pickUsdt("Binance"),
      omtApp: pickUsd("OMT_App"),
    };
  });
}

/** Navigate to Recharge, select the Binance provider, then its Cash Out
 *  (RECEIVE) tab. Shared setup for every test below. */
async function openBinanceCashOut(page: Page) {
  await navigateTo(page, "/recharge");
  await page
    .locator("button")
    .filter({ hasText: /^Binance$/ })
    .first()
    .click({ force: true });
  await expect(page.locator("#crypto-amount")).toBeVisible({
    timeout: 20_000,
  });
  await page
    .locator("button")
    .filter({ hasText: /^Cash Out$/ })
    .first()
    .click();
}

test.describe("LIRA-136 — Binance mode C (customer pays separately), UI-driven", () => {
  test.beforeEach(async ({ appPage }) => {
    await closeAllActiveSessions(appPage);
  });

  test.afterEach(async ({ appPage }) => {
    await closeAllActiveSessions(appPage).catch(() => {});
  });

  test("wallet receives the bare amount, payout drawer pays the FULL amount, fee routes via the chosen counter-flow method", async ({
    appPage,
  }) => {
    await openBinanceCashOut(appPage);

    await appPage.locator("#crypto-amount").fill("100");
    await appPage.locator("#crypto-fee").fill("5");

    const modeCRadio = appPage.getByTestId("crypto-fee-mode-separate");
    await expect(modeCRadio).toBeVisible({ timeout: 10_000 });
    await modeCRadio.click();
    await expect(modeCRadio).toBeChecked();

    // Outer trigger (exact text, no $ suffix) — opens the PaymentSheet.
    // `exact: true` disambiguates it from the sheet's OWN confirm button,
    // whose label includes the payout amount ("Confirm Cash Out $100.00").
    await appPage
      .getByRole("button", { name: "Confirm Cash Out", exact: true })
      .click();

    // The counter-flow card ("Customer pays — Binance fee") renders inside
    // the sheet the instant mode C + fee>0 + !forPartner — auto-seeded with
    // ONE CASH line at the fee. Switch it to the OMT wallet so the fee lands
    // somewhere observably different from the CASH payout drawer.
    const counterFlowSection = appPage.getByTestId("counter-flow-section");
    await expect(counterFlowSection).toBeVisible({ timeout: 10_000 });
    await expect(
      appPage.getByText("Customer pays — Binance fee"),
    ).toBeVisible();
    const feeMethodSelect = counterFlowSection.locator(
      '[data-testid^="counter-flow-method-"]',
    );
    await expect(feeMethodSelect).toBeVisible();
    await feeMethodSelect.selectOption("OMT");

    const before = await drawers(appPage);

    // Sheet's own confirm button — payout is the FULL $100 (mode C never
    // nets the fee out of the payout), matching `payout.toFixed(2)`.
    await appPage
      .getByRole("button", { name: /^Confirm Cash Out \$100\.00$/ })
      .click();
    await expect(appPage.locator("#crypto-amount")).toHaveValue("", {
      timeout: 15_000,
    });

    const after = await drawers(appPage);

    // Binance/USDT drawer: the bare amount, never netted.
    expect(after.binanceUsdt - before.binanceUsdt).toBeCloseTo(100, 2);
    // Payout drawer (CASH → General, off the primary system): the FULL
    // amount, not amount-minus-fee.
    expect(after.general - before.general).toBeCloseTo(-100, 2);
    // The fee landed exactly where the counter-flow leg specified — the OMT
    // wallet, not General and not Binance.
    expect(after.omtApp - before.omtApp).toBeCloseTo(5, 2);
  });

  test("'Customer pays separately' is absent while a session is active", async ({
    appPage,
  }) => {
    const ts = Date.now();
    await appPage.evaluate(async (name: string) => {
      const w = window as unknown as Api;
      const started = await w.api.session.start({
        customer_name: name,
        started_by: "admin",
      });
      if (!started.sessionId) await w.api.session.getActive();
    }, `L136 Session Guard ${ts}`);

    await navigateTo(appPage, "/recharge");
    // Wait for the session context to actually pick up the active session
    // before driving CryptoForm — otherwise the gating check below could
    // false-pass on a form that briefly rendered with no session yet.
    await expect(
      appPage
        .locator("button")
        .filter({ hasText: /Session - / })
        .first(),
    ).toBeVisible({ timeout: 20_000 });

    await appPage
      .locator("button")
      .filter({ hasText: /^Binance$/ })
      .first()
      .click({ force: true });
    await expect(appPage.locator("#crypto-amount")).toBeVisible({
      timeout: 20_000,
    });
    await appPage
      .locator("button")
      .filter({ hasText: /^Cash Out$/ })
      .first()
      .click();

    await expect(
      appPage.getByTestId("crypto-fee-mode-separate"),
    ).not.toBeVisible();
    // The other two modes stay available — only mode C is session-gated.
    await expect(appPage.getByTestId("crypto-fee-mode-sender")).toBeVisible();
    await expect(
      appPage.getByTestId("crypto-fee-mode-deducted"),
    ).toBeVisible();
  });

  test("'Customer pays separately' is absent once For Partner is checked", async ({
    appPage,
  }) => {
    await openBinanceCashOut(appPage);

    await expect(
      appPage.getByTestId("crypto-fee-mode-separate"),
    ).toBeVisible({ timeout: 10_000 });

    await appPage.getByTestId("crypto-for-partner-toggle").click();

    await expect(
      appPage.getByTestId("crypto-fee-mode-separate"),
    ).not.toBeVisible();
  });
});
