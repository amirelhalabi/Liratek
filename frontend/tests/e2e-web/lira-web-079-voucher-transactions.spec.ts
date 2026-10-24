/**
 * lira-web-079 — vouchers are sold for money and cancelled with a refund
 * (LIRA-339, owner decisions 2026-10-24), over REST.
 *
 * Rule 15: every row is matched by IDENTITY (source_table 'vouchers' +
 * source_id = the voucher id) and every money check is a DELTA taken around
 * the action — never "newest row", never absolute totals.
 *
 * Written FIRST (rule 17, task T007). Expected to fail on pre-LIRA-339 code:
 * creating a voucher wrote no transaction and moved no drawer, and cancel
 * refunded nothing. T070 re-ran it green and added the What's new screenshot,
 * the "paid with a gift card" POS redemption case and the Vouchers page
 * sell/cancel walk-through (no window.confirm: the cancel sheet).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

// What's new card image (CLAUDE.md rule 30), taken from the real screen.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT = path.join(
  __dirname,
  "../../public/whats-new/1.35.0/voucher-sale.png",
);

type Auth = { Authorization: string };
type Drawers = Record<string, Record<string, number>>;
interface Row {
  id: number;
  type: string;
  source_table: string;
  source_id: number;
  amount_usd: number;
  amount_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  client_id: number | null;
  paid_via_account?: boolean;
  paid_via_voucher?: boolean;
}

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

async function drawers(page: Page, auth: Auth): Promise<Drawers> {
  const r = await getJson<{ success: boolean; balances: Drawers }>(
    page,
    auth,
    "/api/closing/system-expected-balances-dynamic",
  );
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return r.balances;
}
const moved = (a: Drawers, b: Drawers, d: string, c: string): number =>
  (a[d]?.[c] ?? 0) - (b[d]?.[c] ?? 0);

async function balance(
  page: Page,
  auth: Auth,
  clientId: number,
): Promise<{ usd: number; lbp: number }> {
  const r = await getJson<{
    success: boolean;
    data: { balance_usd: number; balance_lbp: number };
  }>(page, auth, `/api/debts/clients/${clientId}/balance`);
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return { usd: r.data.balance_usd, lbp: r.data.balance_lbp };
}

async function voucherRows(
  page: Page,
  auth: Auth,
  voucherId: number,
  typeFilters?: unknown[],
): Promise<Row[]> {
  const q = typeFilters
    ? `&typeFilters=${encodeURIComponent(JSON.stringify(typeFilters))}`
    : "";
  const r = await getJson<{ success: boolean; transactions: Row[] }>(
    page,
    auth,
    `/api/transactions/recent?limit=300${q}`,
  );
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return r.transactions.filter(
    (t) => t.source_table === "vouchers" && t.source_id === voucherId,
  );
}

test("vouchers: sold for money, cancelled with a refund, shown in Transactions", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth: Auth = { Authorization: `Bearer ${token}` };
  const stamp = String(Date.now()).slice(-6);

  const client = await postJson<{ data?: { id: number }; id?: number }>(
    page,
    auth,
    "/api/clients",
    { full_name: `Voucher Money ${stamp}`, phone_number: `79${stamp}` },
  );
  const clientId = (client.data?.id ?? client.id) as number;
  expect(clientId).toBeTruthy();

  // ── 1. Cash sale: $50 voucher paid $60 cash, $10 change back ────────────
  let before = await drawers(page, auth);
  const sold = await postJson<{
    success: boolean;
    voucher: { id: number; code: string };
    transactionId?: number;
  }>(page, auth, "/api/vouchers", {
    clientId,
    amount: 50,
    currency: "USD",
    payments: [
      { method: "CASH", currency_code: "USD", amount: 60 },
      { method: "CASH", currency_code: "USD", amount: 10, direction: "OUT" },
    ],
  });
  expect(sold.success, JSON.stringify(sold)).toBeTruthy();
  const cashVoucherId = sold.voucher.id;
  let after = await drawers(page, auth);
  expect(moved(after, before, "General", "USD")).toBeCloseTo(50, 2);

  const saleRows = await voucherRows(page, auth, cashVoucherId);
  const sale = saleRows.find((r) => r.type === "VOUCHER_SALE");
  expect(sale, JSON.stringify(saleRows)).toBeTruthy();
  expect(sale).toMatchObject({
    amount_usd: 50,
    profit_usd: 0,
    profit_lbp: 0,
    client_id: clientId,
  });

  // The sale cannot be voided from Transactions (the Vouchers page owns it).
  const voided = await postJson<{ success: boolean; error?: string }>(
    page,
    auth,
    `/api/transactions/${sale!.id}/void`,
  );
  expect(voided.success).toBe(false);

  // ── 2. Cancel with a cash refund: drawer back to where it was ───────────
  before = await drawers(page, auth);
  const cancelled = await postJson<{ success: boolean }>(
    page,
    auth,
    `/api/vouchers/${cashVoucherId}/cancel`,
    {
      payments: [{ method: "CASH", currency_code: "USD", amount: 50 }],
      client_day: new Date().toISOString().slice(0, 10),
    },
  );
  expect(cancelled.success, JSON.stringify(cancelled)).toBeTruthy();
  after = await drawers(page, auth);
  expect(moved(after, before, "General", "USD")).toBeCloseTo(-50, 2);
  const cancelRow = (await voucherRows(page, auth, cashVoucherId)).find(
    (r) => r.type === "VOUCHER_CANCEL",
  );
  expect(cancelRow).toMatchObject({ amount_usd: 50, profit_usd: 0 });

  // ── 3. On account: $50 = $20 cash + $30 on the client's account ─────────
  before = await drawers(page, auth);
  const balBefore = await balance(page, auth, clientId);
  const onAccount = await postJson<{
    success: boolean;
    voucher: { id: number };
  }>(page, auth, "/api/vouchers", {
    clientId,
    amount: 50,
    currency: "USD",
    payments: [
      { method: "CASH", currency_code: "USD", amount: 20 },
      { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 30 },
    ],
  });
  expect(onAccount.success, JSON.stringify(onAccount)).toBeTruthy();
  const accountVoucherId = onAccount.voucher.id;
  after = await drawers(page, auth);
  const balMid = await balance(page, auth, clientId);
  expect(moved(after, before, "General", "USD")).toBeCloseTo(20, 2);
  expect(balMid.usd - balBefore.usd).toBeCloseTo(30, 2);

  // Shows under both the Vouchers and the Debts filters (owner 2026-10-24).
  const viaVouchers = await voucherRows(page, auth, accountVoucherId, [
    { type: "VOUCHER_SALE", paid_via_voucher: true },
  ]);
  expect(viaVouchers.some((r) => r.type === "VOUCHER_SALE")).toBe(true);
  const viaDebts = await voucherRows(page, auth, accountVoucherId, [
    { type: "DEBT_REPAYMENT", paid_via_account: true },
  ]);
  expect(viaDebts.some((r) => r.type === "VOUCHER_SALE")).toBe(true);

  // Cancel: the $30 comes off the account, $20 cash goes back. Both net 0.
  const cancelledAccount = await postJson<{ success: boolean }>(
    page,
    auth,
    `/api/vouchers/${accountVoucherId}/cancel`,
    { payments: [{ method: "CASH", currency_code: "USD", amount: 20 }] },
  );
  expect(cancelledAccount.success, JSON.stringify(cancelledAccount)).toBeTruthy();
  const afterCancel = await drawers(page, auth);
  const balAfter = await balance(page, auth, clientId);
  expect(moved(afterCancel, before, "General", "USD")).toBeCloseTo(0, 2);
  expect(balAfter.usd - balBefore.usd).toBeCloseTo(0, 2);
  expect(balAfter.lbp - balBefore.lbp).toBeCloseTo(0, 0);

  // ── 4. A POS sale paid with a gift card shows under the Vouchers filter;
  //       an unrelated sale does not ─────────────────────────────────────
  const product = await postJson<{ success: boolean; data: { id: number } }>(
    page,
    auth,
    "/api/inventory/products",
    {
      name: `L-web-079 Widget ${stamp}`,
      category: "General",
      cost_price_usd: 10,
      retail_price_usd: 30,
      stock: 10,
      min_stock_threshold: 0,
    },
  );
  expect(product.success, JSON.stringify(product)).toBeTruthy();
  const productId = product.data.id;
  const giftSold = await postJson<{
    success: boolean;
    voucher: { id: number; code: string };
  }>(page, auth, "/api/vouchers", {
    clientId,
    amount: 30,
    currency: "USD",
    payments: [{ method: "CASH", currency_code: "USD", amount: 30 }],
  });
  expect(giftSold.success, JSON.stringify(giftSold)).toBeTruthy();
  const sale30 = (payments: unknown[]) => ({
    client_id: clientId,
    items: [{ product_id: productId, quantity: 1, price: 30 }],
    total_amount: 30,
    discount: 0,
    final_amount: 30,
    payment_usd: 30,
    payment_lbp: 0,
    payments,
    change_given_usd: 0,
    change_given_lbp: 0,
    exchange_rate: 90000,
  });
  const redeemed = await postJson<{ success: boolean; id?: number; saleId?: number }>(
    page,
    auth,
    "/api/sales/process",
    sale30([
      {
        method: "GIFT_CARD",
        currency_code: "USD",
        amount: 30,
        voucher_code: giftSold.voucher.code,
      },
    ]),
  );
  expect(redeemed.success, JSON.stringify(redeemed)).toBeTruthy();
  const unrelated = await postJson<{ success: boolean }>(
    page,
    auth,
    "/api/sales/process",
    sale30([{ method: "CASH", currency_code: "USD", amount: 30 }]),
  );
  expect(unrelated.success, JSON.stringify(unrelated)).toBeTruthy();

  // Which transaction did the redemption write? The voucher row says.
  const listed = await getJson<{
    success: boolean;
    vouchers: Array<{ id: number; status: string; redeemed_transaction_id?: number | null }>;
  }>(page, auth, `/api/vouchers?clientId=${clientId}`);
  const giftRow = listed.vouchers.find((v) => v.id === giftSold.voucher.id);
  expect(giftRow?.status).toBe("redeemed");
  const redeemTxnId = giftRow?.redeemed_transaction_id;
  expect(redeemTxnId, JSON.stringify(giftRow)).toBeTruthy();

  const voucherGroup = [
    { type: "VOUCHER_SALE", paid_via_voucher: true },
    { type: "VOUCHER_CANCEL", paid_via_voucher: true },
  ];
  const grouped = await getJson<{ success: boolean; transactions: Row[] }>(
    page,
    auth,
    `/api/transactions/recent?limit=300&typeFilters=${encodeURIComponent(
      JSON.stringify(voucherGroup),
    )}`,
  );
  expect(grouped.success, JSON.stringify(grouped)).toBeTruthy();
  const ids = new Set(grouped.transactions.map((t) => t.id));
  expect(ids.has(redeemTxnId as number)).toBe(true);
  expect(ids.has(sale!.id)).toBe(true);
  // The unrelated cash sale is the newest sale for this client that is
  // NOT the redemption — matched by identity, never by position.
  const clientSales = (
    await getJson<{ success: boolean; transactions: Row[] }>(
      page,
      auth,
      `/api/transactions/recent?limit=300&client_id=${clientId}`,
    )
  ).transactions.filter((t) => t.type === "SALE" && t.client_id === clientId);
  const unrelatedRow = clientSales.find((t) => t.id !== redeemTxnId);
  expect(unrelatedRow, JSON.stringify(clientSales)).toBeTruthy();
  expect(ids.has(unrelatedRow!.id)).toBe(false);

  // ── 5. The Vouchers page: sell for money, then cancel with a refund ────
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/vouchers");
  await expect(page.locator("#root")).not.toContainText("Something went wrong");
  const search = page.getByPlaceholder("Search or enter client name");
  await search.fill(`Voucher Money ${stamp}`);
  // The search dropdown's option (a button) — the list below also shows
  // this client's earlier vouchers by name, so never match bare text.
  await page
    .getByRole("button", { name: new RegExp(`^Voucher Money ${stamp}`) })
    .first()
    .click();
  await page.getByTestId("voucher-amount").fill("25");
  const submit = page.getByTestId("voucher-create-submit");
  await expect(submit).toBeEnabled({ timeout: 10_000 });
  // The button fades slate→orange (transition-colors); shoot once it has.
  await page.waitForTimeout(400);
  await page.screenshot({ path: SCREENSHOT });

  before = await drawers(page, auth);
  const createResp = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/vouchers") && r.request().method() === "POST",
  );
  await submit.click();
  const uiSold = (await (await createResp).json()) as {
    success: boolean;
    voucher: { id: number };
  };
  expect(uiSold.success, JSON.stringify(uiSold)).toBeTruthy();
  after = await drawers(page, auth);
  expect(moved(after, before, "General", "USD")).toBeCloseTo(25, 2);

  before = await drawers(page, auth);
  await page.getByTestId(`voucher-cancel-${uiSold.voucher.id}`).click();
  const sheet = page.getByTestId("voucher-cancel-sheet");
  await expect(sheet).toBeVisible();
  const cancelResp = page.waitForResponse(
    (r) =>
      r.url().includes(`/api/vouchers/${uiSold.voucher.id}/cancel`) &&
      r.request().method() === "POST",
  );
  await page.getByTestId("voucher-cancel-confirm").click();
  const uiCancelled = (await (await cancelResp).json()) as { success: boolean };
  expect(uiCancelled.success, JSON.stringify(uiCancelled)).toBeTruthy();
  after = await drawers(page, auth);
  expect(moved(after, before, "General", "USD")).toBeCloseTo(-25, 2);
});
