/**
 * lira-web-064 — LIRA-321 US4 (T045): Binance cash-out where the customer
 * pays the USDT in several ways, over the web transport (rule 19).
 *
 * Spec US4.2: a 100 USDT cash-out with a $2 fee paid separately, paid out
 * to the customer as $100 USD cash. The customer pays 80 USDT by Binance +
 * $20 Cash for the rest of the transfer + $2 Cash for the fee.
 *
 *   - Binance drawer   +80 USDT
 *   - General drawer   −78 USD (−100 payout + 20 + 2)
 *   - Binance drawer     0 USD (the USDT line never opens a USD balance)
 *
 * Refunding the transaction brings every one of those back to 0 (US5,
 * rule 20).
 *
 * The body is typed by the schema's own input type
 * (`CreateFinancialServicePayload`, a type-only import — rules 21 and 24),
 * the same shape `handleCryptoSubmit` sends from the Recharge page. A second
 * test opens the real form and checks the "Customer pays" section is seeded
 * with the two lines (100 USDT Binance + $2 Cash fee); it confirms nothing.
 *
 * Rule 15: the web DB accumulates — the transaction is found by identity
 * (its own financial_services id) and every money check is a DELTA taken
 * around its action.
 *
 * Written, NOT YET RUN (owner asks before e2e runs).
 */
import type { Page } from "@playwright/test";
import type { CreateFinancialServicePayload } from "@liratek/core";
import {
  test,
  expect,
  loginAsAdmin,
  gotoAndSettle,
  BACKEND_URL,
} from "./fixtures";

type Auth = { Authorization: string };

const USDT_AMOUNT = 100;
const FEE = 2;
const VIA_BINANCE = 80;
const CASH_FOR_TRANSFER = 20;

async function authOf(page: Page): Promise<Auth> {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  return { Authorization: `Bearer ${token}` };
}

async function getJson(page: Page, auth: Auth, path: string) {
  const r = await (
    await page.request.get(`${BACKEND_URL}${path}`, { headers: auth })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return r;
}

async function postJson(page: Page, auth: Auth, path: string, data?: unknown) {
  return (
    await page.request.post(`${BACKEND_URL}${path}`, { headers: auth, data })
  ).json();
}

type Snapshot = {
  binanceUsdt: number;
  binanceUsd: number;
  general: number;
};

async function snapshot(page: Page, auth: Auth): Promise<Snapshot> {
  const r = await getJson(page, auth, "/api/recharge/drawer-balances");
  const drawers = r.balances as Array<{
    name: string;
    usdBalance: number;
    usdtBalance?: number;
  }>;
  const find = (name: string) => drawers.find((d) => d.name === name);
  return {
    binanceUsdt: find("Binance")?.usdtBalance ?? 0,
    binanceUsd: find("Binance")?.usdBalance ?? 0,
    general: find("General")?.usdBalance ?? 0,
  };
}

function delta(after: Snapshot, before: Snapshot): Snapshot {
  return {
    binanceUsdt: after.binanceUsdt - before.binanceUsdt,
    binanceUsd: after.binanceUsd - before.binanceUsd,
    general: after.general - before.general,
  };
}

test.describe("lira-web-064 Binance cash-out — Customer pays", () => {
  test("US4.2: 80 USDT Binance + $20 Cash + $2 Cash fee — Binance +80 USDT, cash −78; refund nets to 0", async ({
    page,
  }) => {
    const auth = await authOf(page);
    const stamp = Date.now().toString().slice(-6);

    const before = await snapshot(page, auth);

    const body: CreateFinancialServicePayload = {
      provider: "BINANCE",
      serviceType: "RECEIVE",
      // Fee paid separately: the wallet receives the bare USDT amount.
      amount: USDT_AMOUNT,
      currency: "USDT",
      commission: FEE,
      clientName: `L064 Binance ${stamp}`,
      referenceNumber: "",
      paidByMethod: "CASH",
      // Shop pays: the full $100 in USD cash.
      payments: [{ method: "CASH", currencyCode: "USD", amount: USDT_AMOUNT }],
      // Customer pays: 80 USDT by Binance + $20 Cash + the $2 Cash fee.
      customerPayments: [
        { method: "BINANCE", currencyCode: "USDT", amount: VIA_BINANCE },
        { method: "CASH", currencyCode: "USD", amount: CASH_FOR_TRANSFER },
        { method: "CASH", currencyCode: "USD", amount: FEE },
      ],
      feeCollectedSeparately: true,
      customer_waived_amount: 0,
    };
    const created = await postJson(
      page,
      auth,
      "/api/services/transactions",
      body,
    );
    expect(created.success, JSON.stringify(created)).toBeTruthy();
    const fsId = created.id as number;
    expect(fsId).toBeTruthy();

    const booked = delta(await snapshot(page, auth), before);
    expect(booked.binanceUsdt).toBeCloseTo(VIA_BINANCE, 2); // +80 USDT
    expect(booked.binanceUsd).toBeCloseTo(0, 2);
    expect(booked.general).toBeCloseTo(
      -USDT_AMOUNT + CASH_FOR_TRANSFER + FEE,
      2,
    ); // −78

    // The transaction by identity (its own source row), never by position.
    const txn = (
      await getJson(
        page,
        auth,
        `/api/transactions/by-source/financial_services/${fsId}`,
      )
    ).transaction as { id: number; status: string };
    expect(txn.id).toBeTruthy();

    const refunded = await postJson(
      page,
      auth,
      `/api/transactions/${txn.id}/refund`,
    );
    expect(refunded.success, JSON.stringify(refunded)).toBeTruthy();

    const net = delta(await snapshot(page, auth), before);
    expect(net.binanceUsdt).toBeCloseTo(0, 2);
    expect(net.binanceUsd).toBeCloseTo(0, 2);
    expect(net.general).toBeCloseTo(0, 2);
  });

  test("the form seeds 'Customer pays' with the USDT Binance line and the Cash fee line", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await gotoAndSettle(page, "/#/recharge");

    // One click right after navigation can land before the provider tabs
    // settle — retry until the crypto form is up (as lira-136 does).
    await expect(async () => {
      await page
        .getByRole("button", { name: "Binance", exact: true })
        .first()
        .click({ force: true });
      await expect(page.locator("#crypto-amount")).toBeVisible({
        timeout: 3_000,
      });
    }).toPass({ timeout: 20_000 });
    await page
      .locator("button")
      .filter({ hasText: /^Cash Out$/ })
      .first()
      .click();

    await page.locator("#crypto-amount").fill(String(USDT_AMOUNT));
    await page.locator("#crypto-fee").fill(String(FEE));
    await page.getByTestId("crypto-fee-mode-separate").check();

    // The outer trigger (exact text) — the sheet's own button carries the
    // payout amount.
    await page
      .getByRole("button", { name: "Confirm Cash Out", exact: true })
      .click();

    const section = page.getByTestId("counter-flow-section");
    await expect(section).toBeVisible({ timeout: 5_000 });
    const methods = section.locator('[data-testid^="counter-flow-method-"]');
    await expect(methods).toHaveCount(2);
    await expect(methods.nth(0)).toHaveValue("BINANCE");
    await expect(methods.nth(1)).toHaveValue("CASH");
    const currencies = section.locator(
      '[data-testid^="counter-flow-currency-"]',
    );
    await expect(currencies.nth(0)).toHaveValue("USDT");
    await expect(currencies.nth(1)).toHaveValue("USD");
    const amounts = section.locator('[data-testid^="counter-flow-amount-"]');
    await expect(amounts.nth(0)).toHaveValue(/^100(\.00)?$/);
    await expect(amounts.nth(1)).toHaveValue(/^2(\.00)?$/);
  });
});
