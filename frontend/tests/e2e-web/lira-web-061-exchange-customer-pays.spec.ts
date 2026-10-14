/**
 * lira-web-061 — LIRA-321 "Customer pays" on the Exchange page, over the web
 * transport (rule 19). Spec US1 + US5, tasks T028 + T031.
 *
 * Scenario (owner mock): a saved client buys $1,000 at 89,500 LBP — he owes
 * 89,500,000 LBP but hands over only 87,600,000. The payout sheet's
 * "Customer pays — LBP" section splits off the 1,900,000 LBP leftover onto
 * the client's account.
 *
 *  (a) T028 — through the real page: pick the client, type the exchange,
 *      type 87,600,000 in the customer's line (the leftover line turns into
 *      a Customer Account line by itself), pay $1,000. Then:
 *        General LBP +87,600,000 · General USD −1,000 · client debt
 *        +1,900,000 LBP; the exchange row carries the client.
 *      Then repay the 1,900,000 LBP on the Debts page: debt back to where it
 *      was, General LBP +1,900,000.
 *  (b) T031 — the same exchange over REST (exact payload, one schema), then
 *      a refund of its transaction: every delta returns to 0 (General LBP,
 *      General USD, client debt in both currencies).
 *
 * Rule 15: the web DB accumulates — the exchange is matched by identity
 * (client_id + amount_in, then source_table/source_id), and every money
 * check is a DELTA around its own action. The exchange rate is set with the
 * page's own rate field, never by changing the shop's saved rates (shared
 * state for other specs).
 *
 * WRITTEN, NOT RUN (owner asks before e2e runs). UI selectors marked
 * "unverified" below have not been executed against the live page.
 */
import type { Locator, Page } from "@playwright/test";
import {
  test,
  expect,
  loginAsAdmin,
  gotoAndSettle,
  BACKEND_URL,
} from "./fixtures";

type Auth = { Authorization: string };

const AMOUNT_IN_LBP = 89_500_000;
const AMOUNT_OUT_USD = 1_000;
const RATE = 89_500;
const PAID_LBP = 87_600_000;
const ON_ACCOUNT_LBP = 1_900_000;

async function authOf(page: Page): Promise<Auth> {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  return { Authorization: `Bearer ${token}` };
}

async function seedClient(
  page: Page,
  auth: Auth,
  name: string,
  phone: string,
): Promise<number> {
  const client = await (
    await page.request.post(`${BACKEND_URL}/api/clients`, {
      headers: auth,
      data: { full_name: name, phone_number: phone },
    })
  ).json();
  const clientId = (client.data?.id ?? client.id) as number;
  expect(clientId, JSON.stringify(client)).toBeTruthy();
  return clientId;
}

async function general(
  page: Page,
  auth: Auth,
): Promise<{ usd: number; lbp: number }> {
  const r = await (
    await page.request.get(`${BACKEND_URL}/api/dashboard/drawer-balances`, {
      headers: auth,
    })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return {
    usd: r.balances.generalDrawer.usd as number,
    lbp: r.balances.generalDrawer.lbp as number,
  };
}

async function debtOf(
  page: Page,
  auth: Auth,
  clientId: number,
): Promise<{ usd: number; lbp: number }> {
  const r = await (
    await page.request.get(
      `${BACKEND_URL}/api/debts/clients/${clientId}/balance`,
      { headers: auth },
    )
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  const data = r.data ?? r;
  return {
    usd: data.balance_usd as number,
    lbp: data.balance_lbp as number,
  };
}

type HistoryRow = {
  id: number;
  client_id: number | null;
  client_full_name: string | null;
  from_currency: string;
  to_currency: string;
  amount_in: number | string;
  amount_out: number | string;
};

/** The exchange this test made — by identity (client + pair + amount). */
async function exchangeOf(
  page: Page,
  auth: Auth,
  clientId: number,
): Promise<HistoryRow> {
  const r = await (
    await page.request.get(`${BACKEND_URL}/api/exchange/history?limit=500`, {
      headers: auth,
    })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  const row = (r.history as HistoryRow[]).find(
    (h) =>
      h.client_id === clientId &&
      h.from_currency === "LBP" &&
      h.to_currency === "USD" &&
      Number(h.amount_in) === AMOUNT_IN_LBP,
  );
  expect(row, `exchange for client #${clientId} not found`).toBeTruthy();
  return row as HistoryRow;
}

/** The unified transaction of an exchange — source_table + source_id. */
async function exchangeTxnId(
  page: Page,
  auth: Auth,
  clientId: number,
  exchangeId: number,
): Promise<number> {
  const r = await (
    await page.request.get(
      `${BACKEND_URL}/api/transactions/client/${clientId}?limit=50`,
      { headers: auth },
    )
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  const txn = (
    r.transactions as Array<{
      id: number;
      source_table: string;
      source_id: number;
      reverses_id?: number | null;
    }>
  ).find(
    (t) =>
      t.source_table === "exchange_transactions" &&
      t.source_id === exchangeId &&
      !t.reverses_id,
  );
  expect(txn, `transaction for exchange #${exchangeId} not found`).toBeTruthy();
  return txn!.id;
}

// ── Exchange page locators (same shapes as lira-142 / lira-146) ───────────

function fromBox(page: Page): Locator {
  return page
    .getByText("From", { exact: true })
    .locator("xpath=following-sibling::div[1]");
}
function toBox(page: Page): Locator {
  return page
    .getByText("To", { exact: true })
    .locator("xpath=following-sibling::div[1]");
}
function amountInInput(page: Page): Locator {
  return page
    .locator("label", { hasText: "You Receive" })
    .locator("xpath=following-sibling::div[1]//input");
}

test.describe("Exchange — customer pays part, the rest on account (LIRA-321)", () => {
  test("(a) page: 87,600,000 paid + 1,900,000 on account; then repaid on the Debts page", async ({
    page,
  }) => {
    const auth = await authOf(page);
    const stamp = Date.now().toString();
    const name = `L061a Client ${stamp}`;
    const clientId = await seedClient(
      page,
      auth,
      name,
      `0361${stamp.slice(-6)}`,
    );

    await gotoAndSettle(page, "/#/exchange");
    await expect(page.locator("#root")).not.toContainText(
      "Something went wrong",
    );

    // LBP → USD.
    await fromBox(page)
      .getByRole("button", { name: "LBP", exact: true })
      .click();
    await toBox(page).getByRole("button", { name: "USD", exact: true }).click();
    await amountInInput(page).fill(String(AMOUNT_IN_LBP));
    // The page's own rate field (not the shop's saved rates).
    await page.getByTestId("exchange-direct-rate-input").fill(String(RATE));

    // Pick the saved client from the autocomplete (unverified selector:
    // the dropdown option testid comes from ClientAutocompleteInput).
    await page.getByPlaceholder("Walk-in Client").fill(name);
    await page.getByTestId(`client-option-${clientId}`).click();
    await expect(page.getByTestId("exchange-linked-client")).toBeVisible();

    const drawersBefore = await general(page, auth);
    const debtBefore = await debtOf(page, auth, clientId);

    await page.getByRole("button", { name: /Proceed to Payout/i }).click();
    await expect(
      page.getByRole("heading", { name: /Confirm Payout/i }),
    ).toBeVisible();

    // "Customer pays — LBP" sits above "Shop pays"; one locked line seeded
    // at the full 89,500,000.
    const section = page.getByTestId("counter-flow-section");
    await expect(section).toContainText("Customer pays — LBP");
    const customerAmount = section
      .locator('[data-testid^="counter-flow-amount-"]')
      .first();
    await expect(
      section.locator('[data-testid^="counter-flow-currency-"]').first(),
    ).toBeDisabled();

    // Type what the customer actually hands over: the leftover line appears
    // and, with a client picked, goes on the client's account.
    await customerAmount.fill(String(PAID_LBP));
    await customerAmount.blur();
    const methods = section.locator('[data-testid^="counter-flow-method-"]');
    await expect(methods).toHaveCount(2);
    await expect(methods.nth(1)).toHaveValue("CUSTOMER_ACCOUNT");
    await expect(
      section.locator('[data-testid^="counter-flow-amount-"]').nth(1),
    ).toHaveValue(/1,?900,?000/);

    const payBtn = page.getByRole("button", { name: /^Pay\s/i });
    await expect(payBtn).toBeEnabled();
    await payBtn.click();
    await expect(payBtn).toBeHidden({ timeout: 10_000 });

    // Identity: the exchange row carries the client.
    const row = await exchangeOf(page, auth, clientId);
    expect(row.client_full_name).toBe(name);
    expect(Number(row.amount_out)).toBeCloseTo(AMOUNT_OUT_USD, 2);

    const drawersAfter = await general(page, auth);
    const debtAfter = await debtOf(page, auth, clientId);
    expect(drawersAfter.lbp - drawersBefore.lbp).toBeCloseTo(PAID_LBP, 0);
    expect(drawersAfter.usd - drawersBefore.usd).toBeCloseTo(
      -AMOUNT_OUT_USD,
      2,
    );
    expect(debtAfter.lbp - debtBefore.lbp).toBeCloseTo(ON_ACCOUNT_LBP, 0);
    expect(debtAfter.usd - debtBefore.usd).toBeCloseTo(0, 2);

    // ── Repay the 1,900,000 LBP on the Debts page (unverified selectors:
    //    the LBP currency switch on the repayment line). ──────────────────
    await gotoAndSettle(page, "/#/debts");
    await page.getByPlaceholder(/Search client/i).fill(name);
    await page.locator("button").filter({ hasText: name }).first().click();
    await page
      .locator("button")
      .filter({ hasText: /Settle Debt/i })
      .first()
      .click();
    await expect(page.getByText("Process Repayment")).toBeVisible();

    const lineCurrency = page
      .locator('[data-testid^="payment-currency-"]')
      .first();
    if ((await lineCurrency.inputValue()) !== "LBP") {
      await lineCurrency.selectOption("LBP");
    }
    const lineAmount = page.locator('[data-testid^="payment-amount-"]').first();
    await lineAmount.fill(String(ON_ACCOUNT_LBP));
    await lineAmount.blur();

    const beforeRepay = await general(page, auth);
    await page.getByRole("button", { name: /^Confirm Payment$/ }).click();
    await expect(
      page
        .locator('[role="alert"]', { hasText: /Repayment processed/i })
        .first(),
    ).toBeVisible({ timeout: 15_000 });

    const afterRepay = await general(page, auth);
    const debtRepaid = await debtOf(page, auth, clientId);
    expect(afterRepay.lbp - beforeRepay.lbp).toBeCloseTo(ON_ACCOUNT_LBP, 0);
    expect(debtRepaid.lbp - debtBefore.lbp).toBeCloseTo(0, 0);
    expect(debtRepaid.usd - debtBefore.usd).toBeCloseTo(0, 2);
  });

  test("(b) REST: refunding the exchange brings every delta back to 0", async ({
    page,
  }) => {
    const auth = await authOf(page);
    const stamp = Date.now().toString();
    const name = `L061b Client ${stamp}`;
    const clientId = await seedClient(
      page,
      auth,
      name,
      `0362${stamp.slice(-6)}`,
    );

    const drawersBefore = await general(page, auth);
    const debtBefore = await debtOf(page, auth, clientId);

    // The same payload the page builds (exchangeSubmitSchema).
    const res = await (
      await page.request.post(`${BACKEND_URL}/api/exchange/transactions`, {
        headers: auth,
        data: {
          fromCurrency: "LBP",
          toCurrency: "USD",
          amountIn: AMOUNT_IN_LBP,
          amountOut: AMOUNT_OUT_USD,
          leg1Rate: RATE,
          leg1MarketRate: RATE,
          leg1ProfitUsd: 0,
          totalProfitUsd: 0,
          clientName: name,
          clientId,
          payments: [
            { method: "CASH", currencyCode: "USD", amount: AMOUNT_OUT_USD },
          ],
          customerPayments: [
            { method: "CASH", currencyCode: "LBP", amount: PAID_LBP },
            {
              method: "CUSTOMER_ACCOUNT",
              currencyCode: "LBP",
              amount: ON_ACCOUNT_LBP,
            },
          ],
        },
      })
    ).json();
    expect(res.success, JSON.stringify(res)).toBe(true);

    const row = await exchangeOf(page, auth, clientId);
    expect(row.id).toBe(res.id);

    const drawersMid = await general(page, auth);
    const debtMid = await debtOf(page, auth, clientId);
    expect(drawersMid.lbp - drawersBefore.lbp).toBeCloseTo(PAID_LBP, 0);
    expect(drawersMid.usd - drawersBefore.usd).toBeCloseTo(-AMOUNT_OUT_USD, 2);
    expect(debtMid.lbp - debtBefore.lbp).toBeCloseTo(ON_ACCOUNT_LBP, 0);

    const txnId = await exchangeTxnId(page, auth, clientId, row.id);
    const refunded = await (
      await page.request.post(
        `${BACKEND_URL}/api/transactions/${txnId}/refund`,
        { headers: auth },
      )
    ).json();
    expect(refunded.success, JSON.stringify(refunded)).toBeTruthy();

    const drawersAfter = await general(page, auth);
    const debtAfter = await debtOf(page, auth, clientId);
    expect(drawersAfter.lbp - drawersBefore.lbp).toBeCloseTo(0, 0);
    expect(drawersAfter.usd - drawersBefore.usd).toBeCloseTo(0, 2);
    expect(debtAfter.lbp - debtBefore.lbp).toBeCloseTo(0, 0);
    expect(debtAfter.usd - debtBefore.usd).toBeCloseTo(0, 2);
  });
});
