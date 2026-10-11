/**
 * lira-web-057 — LIRA-310 (Waive everywhere) over the web transport
 * (rule 19). Each test drives the real REST routes the web app calls:
 *
 *  1. Session basket Waive — POST /api/sessions/checkout with a $20 basket
 *     paid $17 cash and `waived_usd: 3` books a WAIVED_SHORTFALL row for
 *     that session (profit −3). A claim that is not the real gap, and a
 *     claim above the $5 cap, are both refused with `success: false`.
 *  2. Loto ticket discount — POST /api/loto/sell, a 500,000 LBP ticket paid
 *     480,000 with `discount_lbp: 20000`: the LOTO supplier is owed exactly
 *     what an identical full-price ticket adds (sale − commission); only the
 *     ticket's profit drops. A discount above the commission is refused.
 *  3. Supplier batch settle with a discount, then void — an OMT SEND settled
 *     with legs $3 short and `discount: { amount_usd: 3 }` closes the whole
 *     amount owed; voiding the SUPPLIER_SETTLEMENT puts the supplier balance
 *     and the drawer back exactly where they were before the settle.
 *
 * Rule 15: the web DB accumulates — rows are matched by identity (session
 * id, ticket id, ledger id), every money check is a DELTA snapshotted right
 * around its own action, and amounts are unique to this file.
 */
import type { Page } from "@playwright/test";
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

type Auth = { Authorization: string };
type RecentTxn = {
  id: number;
  type: string;
  source_table: string;
  source_id: number | null;
  profit_usd: number;
  profit_lbp: number;
  amount_usd: number;
  amount_lbp: number;
};
type SupplierRow = { id: number; provider: string | null };
type BalanceRow = { supplier_id: number; total_usd: number; total_lbp: number };

async function authOf(page: Page): Promise<Auth> {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  return { Authorization: `Bearer ${token}` };
}

async function supplierIdByProvider(
  page: Page,
  auth: Auth,
  provider: string,
): Promise<number> {
  const r = await (
    await page.request.get(`${BACKEND_URL}/api/suppliers`, { headers: auth })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  const s = (r.suppliers as SupplierRow[]).find((x) => x.provider === provider);
  expect(s, `${provider} supplier not found`).toBeTruthy();
  return s!.id;
}

async function supplierBalance(
  page: Page,
  auth: Auth,
  supplierId: number,
): Promise<{ usd: number; lbp: number }> {
  const r = await (
    await page.request.get(`${BACKEND_URL}/api/suppliers/balances`, {
      headers: auth,
    })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  const b = (r.balances as BalanceRow[]).find(
    (x) => x.supplier_id === supplierId,
  );
  return { usd: b?.total_usd ?? 0, lbp: b?.total_lbp ?? 0 };
}

async function waivedRowsForSession(
  page: Page,
  auth: Auth,
  sessionId: number,
): Promise<RecentTxn[]> {
  const r = await (
    await page.request.get(
      `${BACKEND_URL}/api/transactions/recent?type=WAIVED_SHORTFALL&limit=500`,
      { headers: auth },
    )
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return (r.transactions as RecentTxn[]).filter(
    (t) =>
      t.type === "WAIVED_SHORTFALL" &&
      t.source_table === "customer_sessions" &&
      t.source_id === sessionId,
  );
}

async function generalUsd(page: Page, auth: Auth): Promise<number> {
  const r = await (
    await page.request.get(`${BACKEND_URL}/api/dashboard/drawer-balances`, {
      headers: auth,
    })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return r.balances.generalDrawer.usd as number;
}

/** Start a session and check out one custom service at `price` USD, paid
 *  `cashUsd` cash, claiming `waivedUsd`. Returns the session id and the raw
 *  checkout envelope. */
async function checkoutBasket(
  page: Page,
  auth: Auth,
  tag: string,
  price: number,
  cashUsd: number,
  waivedUsd: number,
): Promise<{
  sessionId: number;
  result: { success: boolean; error?: string };
}> {
  const name = `L057 ${tag} ${Date.now()}`;
  const started = await (
    await page.request.post(`${BACKEND_URL}/api/sessions/start`, {
      headers: auth,
      data: { customer_name: name },
    })
  ).json();
  expect(started.success, JSON.stringify(started)).toBeTruthy();
  const sessionId = started.sessionId as number;
  expect(sessionId).toBeTruthy();

  const result = await (
    await page.request.post(`${BACKEND_URL}/api/sessions/checkout`, {
      headers: auth,
      data: {
        sessionId,
        cartItems: [
          {
            id: `l057-${tag}-cs`,
            module: "custom_services",
            label: `L057 ${tag} Service`,
            amount: price,
            currency: "USD",
            ipcChannel: "custom-services:add",
            formData: {
              description: `L057 ${tag} Service`,
              price_usd: price,
              cost_usd: 11,
              status: "completed",
            },
          },
        ],
        payments: [{ method: "CASH", currency_code: "USD", amount: cashUsd }],
        exchangeRate: 89500,
        waived_usd: waivedUsd,
        userId: 1,
      },
    })
  ).json();
  return { sessionId, result };
}

test("lira-web-057 session basket: $3 waived books a WAIVED_SHORTFALL row (profit −3); a wrong or over-cap claim is refused", async ({
  page,
}) => {
  const auth = await authOf(page);

  // $20.57 basket, $17.57 cash, $3 waived → accepted.
  const ok = await checkoutBasket(page, auth, "ok", 20.57, 17.57, 3);
  expect(ok.result.success, JSON.stringify(ok.result)).toBeTruthy();
  const rows = await waivedRowsForSession(page, auth, ok.sessionId);
  expect(rows, JSON.stringify(rows)).toHaveLength(1);
  expect(rows[0].profit_usd).toBeCloseTo(-3, 2);
  expect(rows[0].profit_lbp).toBeCloseTo(0, 2);
  expect(rows[0].amount_usd).toBeCloseTo(0, 2);

  // Claim ≠ real gap ($3 short, $2 claimed) → refused, nothing booked.
  const generalBefore = await generalUsd(page, auth);
  const wrong = await checkoutBasket(page, auth, "wrong", 20.57, 17.57, 2);
  expect(wrong.result.success, JSON.stringify(wrong.result)).toBe(false);
  expect(wrong.result.error ?? "").toMatch(/does not match/i);
  expect(await waivedRowsForSession(page, auth, wrong.sessionId)).toHaveLength(
    0,
  );

  // Real gap $5.01 claimed in full → above the $5 cap, refused.
  const over = await checkoutBasket(page, auth, "over", 20.57, 15.56, 5.01);
  expect(over.result.success, JSON.stringify(over.result)).toBe(false);
  expect(over.result.error ?? "").toMatch(/more than \$5/i);
  expect(await waivedRowsForSession(page, auth, over.sessionId)).toHaveLength(
    0,
  );
  // Neither refused checkout moved any cash into the General drawer.
  expect((await generalUsd(page, auth)) - generalBefore).toBeCloseTo(0, 2);
});

test("lira-web-057 loto ticket discount: LOTO is owed the same as a full-price ticket; profit drops by the discount; a discount above the commission is refused", async ({
  page,
}) => {
  const auth = await authOf(page);
  const lotoId = await supplierIdByProvider(page, auth, "LOTO");

  const SALE = 500_000;
  const RATE = 0.0445;
  const COMMISSION = SALE * RATE; // 22,250
  const DISCOUNT = 20_000;

  const sell = async (paidLbp: number, discountLbp?: number) =>
    (
      await page.request.post(`${BACKEND_URL}/api/loto/sell`, {
        headers: auth,
        data: {
          ticket_number: `L057-${Date.now()}-${paidLbp}`,
          sale_amount: SALE,
          commission_rate: RATE,
          currency: "LBP",
          payment_method: "CASH",
          payments: [{ method: "CASH", currencyCode: "LBP", amount: paidLbp }],
          tender_exchange_rate: 89500,
          ...(discountLbp !== undefined ? { discount_lbp: discountLbp } : {}),
        },
      })
    ).json();

  // Reference: an identical ticket paid in full.
  const b0 = await supplierBalance(page, auth, lotoId);
  const full = await sell(SALE);
  expect(full.success, JSON.stringify(full)).toBeTruthy();
  const b1 = await supplierBalance(page, auth, lotoId);
  const fullDelta = b1.lbp - b0.lbp;
  expect(fullDelta).toBeCloseTo(SALE - COMMISSION, 0);

  // The discounted ticket.
  const disc = await sell(SALE - DISCOUNT, DISCOUNT);
  expect(disc.success, JSON.stringify(disc)).toBeTruthy();
  const b2 = await supplierBalance(page, auth, lotoId);
  expect(b2.lbp - b1.lbp).toBeCloseTo(fullDelta, 0);
  expect(b2.usd - b1.usd).toBeCloseTo(0, 2);

  // Its transaction's profit is the commission minus the discount.
  const txn = await (
    await page.request.get(
      `${BACKEND_URL}/api/transactions/by-source/loto_tickets/${disc.ticket.id}`,
      { headers: auth },
    )
  ).json();
  expect(txn.success, JSON.stringify(txn)).toBeTruthy();
  expect(txn.transaction.profit_lbp).toBeCloseTo(COMMISSION - DISCOUNT, 0);
  expect(txn.transaction.amount_lbp).toBeCloseTo(SALE, 0);

  // 25,000 off a 22,250 commission → refused, LOTO balance untouched.
  const tooMuch = await sell(SALE - 25_000, 25_000);
  expect(tooMuch.success, JSON.stringify(tooMuch)).toBe(false);
  expect(String(tooMuch.error ?? "")).toMatch(/commission/i);
  const b3 = await supplierBalance(page, auth, lotoId);
  expect(b3.lbp - b2.lbp).toBeCloseTo(0, 0);
});

test("lira-web-057 supplier batch settle with a $3 discount closes the full amount owed; voiding it restores the balance and the drawer", async ({
  page,
}) => {
  const auth = await authOf(page);
  const omtId = await supplierIdByProvider(page, auth, "OMT");

  const X = 263;
  const FEE = 4;
  const GROSS = X + FEE; // 267 — what a new-model SEND owes OMT
  const COMMISSION = 1.11;
  const NET = Math.round((GROSS - COMMISSION) * 100) / 100; // 265.89 owed in cash
  const WAIVE = 3;
  const PAID = Math.round((NET - WAIVE) * 100) / 100; // 262.89 handed over

  const pcdUsd = async (): Promise<number> => {
    const r = await (
      await page.request.get(`${BACKEND_URL}/api/dashboard/drawer-balances`, {
        headers: auth,
      })
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return r.balances.omtDrawer.usd as number;
  };

  const sent = await (
    await page.request.post(`${BACKEND_URL}/api/services/transactions`, {
      headers: auth,
      data: {
        provider: "OMT",
        serviceType: "SEND",
        amount: X,
        currency: "USD",
        omtServiceType: "INTRA",
        omtFee: FEE,
        payments: [{ method: "CASH", currencyCode: "USD", amount: GROSS }],
      },
    })
  ).json();
  expect(sent.success, JSON.stringify(sent)).toBeTruthy();
  const sendId = sent.id as number;

  const owedBefore = await supplierBalance(page, auth, omtId);
  const pcdBefore = await pcdUsd();

  const settled = await (
    await page.request.post(`${BACKEND_URL}/api/suppliers/${omtId}/settle`, {
      headers: auth,
      data: {
        financial_service_ids: [sendId],
        amount_usd: NET,
        amount_lbp: 0,
        commission_usd: COMMISSION,
        commission_lbp: 0,
        entry_mode: "LUMP",
        note: "L-web-057 waive settlement",
        payments: [{ method: "CASH", currency_code: "USD", amount: PAID }],
        discount: { amount_usd: WAIVE, amount_lbp: 0 },
      },
    })
  ).json();
  expect(settled.success, JSON.stringify(settled)).toBeTruthy();
  const settlementLedgerId = settled.id as number;

  // The whole GROSS is closed: paid 262.89 + commission 1.11 + waived 3.
  const owedAfter = await supplierBalance(page, auth, omtId);
  expect(owedAfter.usd - owedBefore.usd).toBeCloseTo(-GROSS, 2);
  // Only the cash actually handed over left the drawer.
  expect((await pcdUsd()) - pcdBefore).toBeCloseTo(-PAID, 2);

  const recent = await (
    await page.request.get(
      `${BACKEND_URL}/api/transactions/recent?type=SUPPLIER_SETTLEMENT&limit=200`,
      { headers: auth },
    )
  ).json();
  expect(recent.success, JSON.stringify(recent)).toBeTruthy();
  const settlementTxn = (recent.transactions as RecentTxn[]).find(
    (t) =>
      t.source_table === "supplier_ledger" &&
      t.source_id === settlementLedgerId,
  );
  expect(settlementTxn, "SUPPLIER_SETTLEMENT not found").toBeTruthy();

  const voided = await (
    await page.request.post(
      `${BACKEND_URL}/api/transactions/${settlementTxn!.id}/void`,
      { headers: auth },
    )
  ).json();
  expect(voided.success, JSON.stringify(voided)).toBeTruthy();

  const owedVoided = await supplierBalance(page, auth, omtId);
  expect(owedVoided.usd - owedBefore.usd).toBeCloseTo(0, 2);
  expect(owedVoided.lbp - owedBefore.lbp).toBeCloseTo(0, 0);
  expect((await pcdUsd()) - pcdBefore).toBeCloseTo(0, 2);
});

test("lira-web-057 Alfa card sold $0.50 short with the gap waived: profit is the full-price profit minus 0.50", async ({
  page,
}) => {
  const auth = await authOf(page);
  const COST = 7.07;
  const PRICE = 7.67;
  const WAIVE = 0.5;

  const sell = async (paid: number, discount?: number) =>
    (
      await page.request.post(`${BACKEND_URL}/api/recharge/process`, {
        headers: auth,
        data: {
          provider: "Alfa",
          type: "VOUCHER",
          amount: 1,
          cost: COST,
          price: PRICE,
          currency: "USD",
          paid_by_method: "CASH",
          payments: [{ method: "CASH", currencyCode: "USD", amount: paid }],
          tender_exchange_rate: 89500,
          ...(discount !== undefined ? { discount } : {}),
        },
      })
    ).json();
  const profitOf = async (rechargeId: number): Promise<number> => {
    const r = await (
      await page.request.get(
        `${BACKEND_URL}/api/transactions/by-source/recharges/${rechargeId}`,
        { headers: auth },
      )
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    expect(r.transaction, "recharge transaction not found").toBeTruthy();
    return r.transaction.profit_usd as number;
  };

  // Reference: the identical card at full price.
  const full = await sell(PRICE);
  expect(full.success, JSON.stringify(full)).toBeTruthy();
  const fullProfit = await profitOf(full.id as number);

  // The same card, $0.50 short, the gap waived (the page sends it as the
  // sheet's discount).
  const waived = await sell(Math.round((PRICE - WAIVE) * 100) / 100, WAIVE);
  expect(waived.success, JSON.stringify(waived)).toBeTruthy();
  expect(await profitOf(waived.id as number)).toBeCloseTo(
    fullProfit - WAIVE,
    2,
  );
});

test("lira-web-057 Expenses page: a $3 shortfall shows Waive in the Remaining row; clicking it lowers the bill and the Remaining row goes away", async ({
  page,
}) => {
  await authOf(page);
  await page.goto("/#/expenses");
  await expect(page.locator("#root")).not.toContainText("Something went wrong");

  await page.locator("#expense-description").fill(`L057 waive ${Date.now()}`);
  await page.getByTestId("expense-bill-currency-USD").click();
  await page.getByTestId("expense-bill-amount").fill("10.57");
  const amount = page.locator('[data-testid^="payment-amount-"]').first();
  await amount.fill("7.57");

  const remaining = page.getByTestId("remaining-row");
  const waive = page.getByTestId("waive-remaining");
  await expect(remaining).toBeVisible();
  await expect(waive).toBeVisible();

  await waive.click();
  await expect(page.getByTestId("expense-bill-amount")).toHaveValue("7.57");
  await expect(remaining).toHaveCount(0);
  await expect(waive).toHaveCount(0);
});
