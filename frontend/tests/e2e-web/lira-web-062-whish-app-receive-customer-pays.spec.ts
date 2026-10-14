/**
 * lira-web-062 — LIRA-321 US3 (T040): Whish App cash-out where the customer
 * pays the transfer in several ways, over the web transport (rule 19).
 *
 * Spec US3 case (c): a $100 Whish App cash-out with a $5 fee paid
 * separately, paid out to the customer as $100 USD cash. A linked client
 * pays Whish $90 + Cash $5 (the fee) and leaves $10 on Customer Account.
 *
 *   - Whish_App drawer  +90 USD
 *   - General drawer    −95 USD (−100 payout + 5 fee)
 *   - OMT_App drawer      0
 *   - client debt       +10 USD
 *
 * Refunding the transaction brings every one of those back to 0 (US5,
 * rule 20).
 *
 * The body is typed by the schema's own input type
 * (`CreateFinancialServicePayload`, a type-only import — rules 21 and 24),
 * the same shape `buildWalletTransferPayload` sends from the form. A second
 * test opens the real form and checks the "Customer pays" section is seeded
 * with the two lines (Whish wallet + Cash fee); it confirms nothing.
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

const TRANSFER = 100;
const FEE = 5;
const VIA_WHISH = 90;
const ON_ACCOUNT = 10;

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
  whishApp: number;
  omtApp: number;
  general: number;
  debtUsd: number;
  debtLbp: number;
};

async function snapshot(
  page: Page,
  auth: Auth,
  clientId: number,
): Promise<Snapshot> {
  const r = await getJson(page, auth, "/api/recharge/drawer-balances");
  const usd = (name: string) =>
    (
      r.balances as Array<{ name: string; usdBalance: number }>
    ).find((d) => d.name === name)?.usdBalance ?? 0;
  const debt = await getJson(
    page,
    auth,
    `/api/debts/clients/${clientId}/balance`,
  );
  return {
    whishApp: usd("Whish_App"),
    omtApp: usd("OMT_App"),
    general: usd("General"),
    debtUsd: debt.data.balance_usd as number,
    debtLbp: debt.data.balance_lbp as number,
  };
}

function delta(after: Snapshot, before: Snapshot): Snapshot {
  return {
    whishApp: after.whishApp - before.whishApp,
    omtApp: after.omtApp - before.omtApp,
    general: after.general - before.general,
    debtUsd: after.debtUsd - before.debtUsd,
    debtLbp: after.debtLbp - before.debtLbp,
  };
}

test.describe("lira-web-062 Whish App cash-out — Customer pays", () => {
  test("case (c): Whish $90 + Cash $5 fee + $10 on account — wallet +90, cash −95, debt +10; refund nets to 0", async ({
    page,
  }) => {
    const auth = await authOf(page);
    const stamp = Date.now().toString().slice(-6);

    const client = await postJson(page, auth, "/api/clients", {
      full_name: `L062 Customer Pays ${stamp}`,
      phone_number: `71${stamp}`,
    });
    const clientId = (client.data?.id ?? client.id) as number;
    expect(clientId, JSON.stringify(client)).toBeTruthy();

    const before = await snapshot(page, auth, clientId);

    const body: CreateFinancialServicePayload = {
      provider: "WHISH_APP",
      serviceType: "RECEIVE",
      // Fee paid separately: the wallet receives the bare transfer.
      amount: TRANSFER,
      currency: "USD",
      commission: FEE,
      whishFee: FEE,
      clientId,
      clientName: `L062 Customer Pays ${stamp}`,
      referenceNumber: "",
      phoneNumber: `71${stamp}`,
      note: "RECEIVE transfer via Whish App",
      paidByMethod: "CASH",
      // Shop pays: the full $100 in USD cash.
      payments: [{ method: "CASH", currencyCode: "USD", amount: TRANSFER }],
      cashoutMethod: "CASH",
      includingFees: false,
      // Customer pays: Whish $90 + Cash $5 fee + $10 on the account.
      customerPayments: [
        { method: "WHISH", currencyCode: "USD", amount: VIA_WHISH },
        { method: "CASH", currencyCode: "USD", amount: FEE },
        { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: ON_ACCOUNT },
      ],
      feeCollectedSeparately: true,
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

    const booked = delta(await snapshot(page, auth, clientId), before);
    expect(booked.whishApp).toBeCloseTo(VIA_WHISH, 2);
    expect(booked.omtApp).toBeCloseTo(0, 2);
    expect(booked.general).toBeCloseTo(-TRANSFER + FEE, 2); // −95
    expect(booked.debtUsd).toBeCloseTo(ON_ACCOUNT, 2);
    expect(booked.debtLbp).toBeCloseTo(0, 2);

    // The transaction by identity (its own source row), never by position.
    const txn = (
      await getJson(
        page,
        auth,
        `/api/transactions/by-source/financial_services/${fsId}`,
      )
    ).transaction as { id: number; status: string; client_id: number | null };
    expect(txn.id).toBeTruthy();
    expect(txn.client_id).toBe(clientId);

    const refunded = await postJson(
      page,
      auth,
      `/api/transactions/${txn.id}/refund`,
    );
    expect(refunded.success, JSON.stringify(refunded)).toBeTruthy();

    const net = delta(await snapshot(page, auth, clientId), before);
    expect(net.whishApp).toBeCloseTo(0, 2);
    expect(net.omtApp).toBeCloseTo(0, 2);
    expect(net.general).toBeCloseTo(0, 2);
    expect(net.debtUsd).toBeCloseTo(0, 2);
    expect(net.debtLbp).toBeCloseTo(0, 2);
  });

  test("the form seeds 'Customer pays' with the Whish line and the Cash fee line", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await gotoAndSettle(page, "/#/recharge");

    const tab = page
      .locator("button")
      .filter({ hasText: /^Whish App$/ })
      .first();
    await expect(tab).toBeVisible({ timeout: 8_000 });
    await tab.click();
    // Whish App keeps its inner Transfer/Bills mode — force Transfer.
    const transferTab = page
      .locator("button")
      .filter({ hasText: /^Transfer$/ })
      .first();
    await expect(transferTab).toBeVisible({ timeout: 10_000 });
    await transferTab.click();

    await page
      .locator("button")
      .filter({ hasText: /^Receive$/ })
      .first()
      .click();
    await expect(page.locator("#receiver-name")).toBeVisible({
      timeout: 5_000,
    });

    await page.locator("#transfer-amount").fill(String(TRANSFER));
    await page.locator("#transfer-fee").fill(String(FEE));
    await page.getByTestId("fee-mode-separate").check();

    await page.getByRole("button", { name: /Proceed to Pay/i }).click();

    const section = page.getByTestId("counter-flow-section");
    await expect(section).toBeVisible({ timeout: 5_000 });
    const methods = section.locator('[data-testid^="counter-flow-method-"]');
    await expect(methods).toHaveCount(2);
    await expect(methods.nth(0)).toHaveValue("WHISH");
    await expect(methods.nth(1)).toHaveValue("CASH");
    const amounts = section.locator('[data-testid^="counter-flow-amount-"]');
    await expect(amounts.nth(0)).toHaveValue(/^100(\.00)?$/);
    await expect(amounts.nth(1)).toHaveValue(/^5(\.00)?$/);
  });
});
