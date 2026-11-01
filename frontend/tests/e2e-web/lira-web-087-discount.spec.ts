/**
 * lira-web-087 — LIRA-365: a Discount where the customer pays the shop, over
 * the web transport (rule 19).
 *
 *  1. OMT system SEND, $400 + $15 fee − $2 discount, cash $413 (the owner's
 *     example): the OMT drawer takes $413, OMT is still owed the full $415,
 *     and one $2 "Discount given" expense is booked.
 *  2. Exchange, a client owes 89,500,000 LBP for $1,000 and pays 89,450,000:
 *     the 50,000 LBP Discount from the "Customer pays" box travels as
 *     `customer_waived_amount`; General LBP +89,450,000, USD −1,000, and the
 *     row's details record the discount.
 *  3. The Vouchers page: a $50 voucher with a $2 Discount, paid $48 — the
 *     What's new screenshot is taken here (rule 30). General USD +48, the
 *     voucher stays worth $50, one $2 "Discount given" expense.
 *
 * Rule 15: rows are matched by identity, every money check is a delta
 * around its own action.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT = path.join(
  __dirname,
  "../../public/whats-new/1.35.0/discount-line.png",
);

type Auth = { Authorization: string };

async function getJson<T>(page: Page, auth: Auth, p: string): Promise<T> {
  return (await (
    await page.request.get(`${BACKEND_URL}${p}`, { headers: auth })
  ).json()) as T;
}
async function postJson<T>(
  page: Page,
  auth: Auth,
  p: string,
  data?: unknown,
): Promise<T> {
  return (await (
    await page.request.post(`${BACKEND_URL}${p}`, { headers: auth, data })
  ).json()) as T;
}

type Balances = {
  general: { usd: number; lbp: number };
  omt: { usd: number };
};
async function drawers(page: Page, auth: Auth): Promise<Balances> {
  const r = await getJson<{
    success: boolean;
    balances: {
      generalDrawer: { usd: number; lbp: number };
      omtDrawer: { usd: number };
    };
  }>(page, auth, "/api/dashboard/drawer-balances");
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return {
    general: { usd: r.balances.generalDrawer.usd, lbp: r.balances.generalDrawer.lbp },
    omt: { usd: r.balances.omtDrawer.usd },
  };
}

type Expense = {
  id: number;
  category: string;
  description: string;
  amount_usd: number;
  amount_lbp: number;
};
async function discountExpenses(
  page: Page,
  auth: Auth,
  descriptionPart: string,
): Promise<Expense[]> {
  const r = await getJson<{ success: boolean; expenses: Expense[] }>(
    page,
    auth,
    "/api/expenses/history",
  );
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return r.expenses.filter(
    (e) =>
      e.category === "Discount given" && e.description.includes(descriptionPart),
  );
}

type Txn = {
  id: number;
  type: string;
  source_table: string;
  source_id: number;
  amount_usd: number;
  amount_lbp: number;
  metadata_json?: string | null;
};
async function txnOf(
  page: Page,
  auth: Auth,
  sourceTable: string,
  sourceId: number,
  type: string,
): Promise<Txn> {
  const r = await getJson<{ success: boolean; transactions: Txn[] }>(
    page,
    auth,
    "/api/transactions/recent?limit=300",
  );
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  const row = r.transactions.find(
    (t) =>
      t.source_table === sourceTable &&
      t.source_id === sourceId &&
      t.type === type,
  );
  expect(row, `${type} for ${sourceTable} #${sourceId} not found`).toBeTruthy();
  return row as Txn;
}
function detailsOf(t: Txn): Record<string, unknown> {
  const meta = JSON.parse(t.metadata_json ?? "{}") as {
    details?: Record<string, unknown>;
  };
  return meta.details ?? {};
}

test("LIRA-365: discount on an OMT send, an exchange and a voucher sale", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth: Auth = { Authorization: `Bearer ${token}` };
  const stamp = String(Date.now()).slice(-6);

  const suppliers = await getJson<{
    success: boolean;
    suppliers: Array<{ id: number; provider: string | null }>;
  }>(page, auth, "/api/suppliers");
  const omtId = suppliers.suppliers.find((s) => s.provider === "OMT")?.id;
  expect(omtId, "OMT supplier not found").toBeTruthy();
  const omtOwed = async (): Promise<number> => {
    const r = await getJson<{
      success: boolean;
      balances: Array<{ supplier_id: number; total_usd: number }>;
    }>(page, auth, "/api/suppliers/balances");
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return r.balances.find((b) => b.supplier_id === omtId)?.total_usd ?? 0;
  };

  // ── 1. OMT system SEND: $400 + $15 − $2, cash $413 ─────────────────────
  let before = await drawers(page, auth);
  const owedBefore = await omtOwed();
  const send = await postJson<{ success: boolean; id?: number; error?: string }>(
    page,
    auth,
    "/api/services/transactions",
    {
      provider: "OMT",
      serviceType: "SEND",
      omtServiceType: "WESTERN_UNION",
      amount: 400,
      currency: "USD",
      omtFee: 15,
      discount_amount: 2,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 413 }],
    },
  );
  expect(send.success, JSON.stringify(send)).toBeTruthy();
  let after = await drawers(page, auth);
  expect(after.omt.usd - before.omt.usd).toBeCloseTo(413, 2);
  expect((await omtOwed()) - owedBefore).toBeCloseTo(415, 2);
  const sendExp = await discountExpenses(page, auth, `send #${send.id}`);
  expect(sendExp, JSON.stringify(send)).toHaveLength(1);
  expect(sendExp[0]).toMatchObject({ amount_usd: 2, amount_lbp: 0 });

  // ── 2. Exchange: 50,000 LBP Discount in the Customer pays box ──────────
  const client = await postJson<{ data?: { id: number }; id?: number }>(
    page,
    auth,
    "/api/clients",
    { full_name: `Discount Web ${stamp}`, phone_number: `78${stamp}` },
  );
  const clientId = (client.data?.id ?? client.id) as number;
  expect(clientId).toBeTruthy();
  before = await drawers(page, auth);
  const exchange = await postJson<{ success: boolean; id?: number }>(
    page,
    auth,
    "/api/exchange/transactions",
    {
      fromCurrency: "LBP",
      toCurrency: "USD",
      amountIn: 89_500_000,
      amountOut: 1_000,
      leg1Rate: 89_500,
      leg1MarketRate: 89_500,
      leg1ProfitUsd: 0,
      totalProfitUsd: 0,
      clientName: `Discount Web ${stamp}`,
      clientId,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 1_000 }],
      customerPayments: [
        { method: "CASH", currencyCode: "LBP", amount: 89_450_000 },
      ],
      customer_waived_amount: 50_000,
    },
  );
  expect(exchange.success, JSON.stringify(exchange)).toBeTruthy();
  after = await drawers(page, auth);
  expect(after.general.lbp - before.general.lbp).toBeCloseTo(89_450_000, 0);
  expect(after.general.usd - before.general.usd).toBeCloseTo(-1_000, 2);
  const exTxn = await getJson<{
    success: boolean;
    transactions: Txn[];
  }>(page, auth, `/api/transactions/client/${clientId}?limit=50`);
  const exRow = exTxn.transactions.find(
    (t) => t.source_table === "exchange_transactions" && t.source_id === exchange.id,
  );
  expect(exRow, JSON.stringify(exTxn.transactions)).toBeTruthy();
  expect(detailsOf(exRow!).discount).toEqual({ amount: 50_000, currency: "LBP" });

  // ── 3. The Vouchers page: $50 voucher, $2 Discount, paid $48 ───────────
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/vouchers");
  await expect(page.locator("#root")).not.toContainText("Something went wrong");
  await page.getByPlaceholder("Search or enter client name").fill(`Discount Web ${stamp}`);
  await page
    .getByRole("button", { name: new RegExp(`^Discount Web ${stamp}`) })
    .first()
    .click();
  await page.getByTestId("voucher-amount").fill("50");
  await page.getByLabel("Discount", { exact: true }).fill("2");
  const amount = page.locator('input[data-testid^="payment-amount-"]').first();
  await expect(amount).toHaveValue("48", { timeout: 10_000 });
  const submit = page.getByTestId("voucher-create-submit");
  await expect(submit).toBeEnabled({ timeout: 10_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: SCREENSHOT });

  before = await drawers(page, auth);
  const createResp = page.waitForResponse(
    (r) => r.url().endsWith("/api/vouchers") && r.request().method() === "POST",
  );
  await submit.click();
  const sold = (await (await createResp).json()) as {
    success: boolean;
    voucher: { id: number; code: string; amount: number };
  };
  expect(sold.success, JSON.stringify(sold)).toBeTruthy();
  expect(sold.voucher.amount).toBe(50);
  after = await drawers(page, auth);
  expect(after.general.usd - before.general.usd).toBeCloseTo(48, 2);
  const sale = await txnOf(page, auth, "vouchers", sold.voucher.id, "VOUCHER_SALE");
  expect(sale.amount_usd).toBeCloseTo(48, 2);
  expect(detailsOf(sale).discount).toEqual({ amount: 2, currency: "USD" });
  const vExp = await discountExpenses(page, auth, sold.voucher.code);
  expect(vExp).toHaveLength(1);
  expect(vExp[0]).toMatchObject({ amount_usd: 2, amount_lbp: 0 });
});
