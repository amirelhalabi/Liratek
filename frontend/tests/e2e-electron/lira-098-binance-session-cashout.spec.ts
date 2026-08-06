/**
 * LIRA-098 — Binance cash out inside a customer session: honest two-sided
 * display + explicit cash payout instruction at checkout.
 *
 * Owner-reported (2026-07-05): the basket line for a $50 Binance cash out
 * read "-50.00 USDT". The stored amount is the CASH side (shop pays $50) and
 * the "USDT" currency only marks the wallet bucket — the wallet actually
 * GAINS 50 USDT. Worse: the checkout modal's "Payout to customer (cash)"
 * panel keyed only on the USD/LBP buckets, so a Binance cash out never told
 * the operator to hand over the $50 — while the books debit General at
 * replay (guarded by lira-session-payout).
 *
 * Money movement is untouched here (repository self-posts the payout; the
 * usdt bucket stays excluded from the pooled payment — including it would
 * double-pay). This spec guards the PRESENTATION rule: the session basket is
 * CUSTOMER-perspective only — the amount column shows the cash the customer
 * pays or is paid ("-$50.00"); the USDT is the service (label text) and the
 * shop wallet's +50 USDT belongs to the transactions view, never the basket.
 * The one cash instruction at checkout is the amber payout panel. Also
 * asserts the end-to-end drawer deltas through the real UI.
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";
import { closeAllActiveSessions } from "./helpers/nav";

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
    session: {
      start: (d: {
        customer_name: string;
        customer_phone?: string;
        started_by: string;
      }) => Promise<{ success?: boolean; sessionId?: number }>;
      getActive: () => Promise<{ session?: { id: number } }>;
      cartGet: (sessionId: number) => Promise<{ items: Array<{ id: number }> }>;
    };
  };
};

let dialogs: string[] = [];

async function drawerUsd(page: Page, name: string): Promise<number> {
  return page.evaluate(async (n) => {
    const w = window as unknown as Api;
    const rows = await w.api.recharge.getDrawerBalances();
    return rows.find((d) => d.name === n)?.usdBalance ?? 0;
  }, name);
}

/** The Binance drawer is denominated in USDT (its own balance column). */
async function drawerUsdt(page: Page, name: string): Promise<number> {
  return page.evaluate(async (n) => {
    const w = window as unknown as Api;
    const rows = await w.api.recharge.getDrawerBalances();
    return rows.find((d) => d.name === n)?.usdtBalance ?? 0;
  }, name);
}

test.describe("LIRA-098 — Binance session cash out display", () => {
  test.beforeEach(({ appPage }) => {
    dialogs = [];
    appPage.on("dialog", (d) => dialogs.push(d.message()));
  });

  test.afterEach(async ({ appPage }) => {
    await closeAllActiveSessions(appPage).catch(() => {});
  });

  test("basket shows the customer's cash side only, checkout instructs the payout, drawers move once", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const CUSTOMER = `L098 Binance ${ts}`;
    const PHONE = `76${String(ts).slice(-6)}`;
    const USDT = 50;

    await closeAllActiveSessions(appPage);
    const sessionId = await appPage.evaluate(
      async ({ name, phone }) => {
        const w = window as unknown as Api;
        const started = await w.api.session.start({
          customer_name: name,
          customer_phone: phone,
          started_by: "admin",
        });
        return (
          started.sessionId ?? (await w.api.session.getActive()).session?.id
        );
      },
      { name: CUSTOMER, phone: PHONE },
    );
    expect(sessionId).toBeTruthy();

    // Binance → Cash Out tab, $50, through the real UI. Wait for the page to
    // pick the session up first (else the submit books immediately instead of
    // deferring into the basket).
    await navigateTo(appPage, "/recharge");
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
    await appPage.locator("#crypto-amount").fill(String(USDT));
    await appPage.getByRole("button", { name: /Confirm Cash Out/i }).click();
    await expect
      .poll(
        async () =>
          appPage.evaluate(async (sid) => {
            const w = window as unknown as Api;
            return (await w.api.session.cartGet(sid)).items.length;
          }, sessionId as number),
        { timeout: 15_000 },
      )
      .toBe(1);

    // Hover the session button → popup panel. The basket is CUSTOMER
    // perspective only: the amount column shows the cash the shop pays the
    // customer (−$50.00). The USDT is the service, named in the LABEL; the
    // wallet movement is shop bookkeeping and must not appear as an amount
    // (neither the original "-50.00 USDT" nor a "+50.00 USDT" wallet line).
    const sessionButtonWrap = appPage
      .locator("button")
      .filter({ hasText: /Session - / })
      .first();
    await sessionButtonWrap.hover();
    const cartLine = appPage
      .locator("li")
      .filter({ hasText: /Binance Cash Out/ })
      .first();
    await expect(cartLine).toBeVisible({ timeout: 10_000 });
    await expect(cartLine).toContainText("-$50.00");
    await expect(appPage.getByText("-50.00 USDT")).toHaveCount(0);
    await expect(appPage.getByText("+50.00 USDT")).toHaveCount(0);
    // Cart Total is the customer's NET position per currency — a payout-only
    // basket nets to −$50.00 (the shop owes the customer fifty dollars).
    await expect(appPage.getByText("Cart Total").locator("..")).toContainText(
      "-$50.00",
    );

    const generalBefore = await drawerUsd(appPage, "General");
    const binanceBefore = await drawerUsdt(appPage, "Binance");

    // Open the checkout modal from the popup.
    await appPage
      .getByRole("button", { name: /Checkout \(1 items?\)/i })
      .click();
    await expect(appPage.getByText("Confirm Checkout")).toBeVisible({
      timeout: 10_000,
    });

    // Customer perspective in the modal too: the Total row speaks the NET
    // (payout-only basket → −$50.00), no shop-wallet rows — the one cash
    // instruction is the amber payout panel telling the operator to hand
    // the customer $50.
    await expect(
      appPage.getByText("Total", { exact: true }).locator(".."),
    ).toContainText("-$50.00");
    await expect(appPage.getByText("Binance wallet")).toHaveCount(0);
    // Phase F retitled the panel ("Payout to customer (cash)" →
    // "Payout to customer") because the payout METHOD is now
    // operator-chosen per currency via a select
    // (BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase F) instead of being
    // hardcoded to cash.
    await expect(appPage.getByText("Payout to customer")).toBeVisible();
    // The amber panel (the title's parent) carries the USD amount row.
    await expect(
      appPage.getByText("Payout to customer").locator(".."),
    ).toContainText("$50.00");
    // Untouched, the per-currency payout method must still default to Cash
    // (this basket has no chargeable client on account, so the pre-existing
    // derivation stays CASH — lira-098's original guarantee).
    const payoutMethodSelectUsd = appPage.locator(
      '[data-testid="payout-method-select-USD"]',
    );
    await expect(payoutMethodSelectUsd).toBeVisible();
    await expect(payoutMethodSelectUsd).toHaveValue("CASH");
    await expect(appPage.getByText("-50.00 USDT")).toHaveCount(0);
    await expect(appPage.getByText("+50.00 USDT")).toHaveCount(0);

    // Confirm: wallet +50 USDT, till −$50 — exactly once (replay self-post).
    await appPage.getByRole("button", { name: /^Confirm Checkout$/ }).click();
    await expect
      .poll(
        async () => (await drawerUsdt(appPage, "Binance")) - binanceBefore,
        { timeout: 15_000 },
      )
      .toBeCloseTo(USDT, 2);
    expect((await drawerUsd(appPage, "General")) - generalBefore).toBeCloseTo(
      -USDT,
      2,
    );
    expect(
      dialogs.filter((d) => /error|validation|nan/i.test(d)),
      "checkout raised an error dialog",
    ).toEqual([]);
  });
});
