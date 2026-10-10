/**
 * lira-web-050 — LIRA-298: a backdated POS sale is booked on its chosen day
 * over REST (the web transport).
 *
 * The checkout sends `transaction_time` (ISO datetime) when the cashier
 * overrides the sale time. `POST /api/sales/process` validates with core's
 * shared `saleProcessSchema`; before LIRA-298 that schema had no
 * `transaction_time` key, so Zod stripped it and the sale and its unified
 * SALE transaction row were dated "now". This proves the field survives the
 * REST edge end to end: the stored sale and its transaction carry the chosen
 * instant. The row is matched by identity (unique product name in the
 * summary), never by position (rule 15).
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

test("a POS sale sent with transaction_time is stored on that day (sale + transaction row)", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };

  const ts = Date.now();
  const NAME = `L-web-050 Backdated Widget ${ts}`;

  // 3 days ago at 09:00 UTC (12:00 Beirut) — mid-day, so no day-boundary
  // ambiguity in any zone the suite might run in.
  const d = new Date(ts - 3 * 24 * 60 * 60 * 1000);
  d.setUTCHours(9, 0, 0, 0);
  const BACKDATED = d.toISOString();
  const DAY = BACKDATED.slice(0, 10);

  const product = await (
    await page.request.post(`${BACKEND_URL}/api/inventory/products`, {
      headers: auth,
      data: {
        name: NAME,
        category: "General",
        cost_price_usd: 2,
        retail_price_usd: 7,
        stock: 5,
        min_stock_threshold: 0,
      },
    })
  ).json();
  expect(product.success, JSON.stringify(product)).toBeTruthy();
  const productId = product.data.id as number;

  const sale = await (
    await page.request.post(`${BACKEND_URL}/api/sales/process`, {
      headers: auth,
      data: {
        client_id: null,
        items: [{ product_id: productId, quantity: 1, price: 7 }],
        total_amount: 7,
        discount: 0,
        final_amount: 7,
        payment_usd: 7,
        payment_lbp: 0,
        payments: [{ method: "CASH", currency_code: "USD", amount: 7 }],
        change_given_usd: 0,
        change_given_lbp: 0,
        exchange_rate: 89500,
        status: "completed",
        transaction_time: BACKDATED,
      },
    })
  ).json();
  expect(sale.success, JSON.stringify(sale)).toBeTruthy();
  const saleId = sale.id as number;

  const got = await (
    await page.request.get(`${BACKEND_URL}/api/sales/${saleId}`, {
      headers: auth,
    })
  ).json();
  expect(got.success, JSON.stringify(got)).toBeTruthy();
  expect(String(got.sale.created_at).slice(0, 10)).toBe(DAY);

  const recent = await (
    await page.request.get(`${BACKEND_URL}/api/transactions/recent?limit=200`, {
      headers: auth,
    })
  ).json();
  const row = (
    recent.transactions as Array<{
      type: string;
      source_id: number | null;
      created_at: string;
    }>
  ).find((t) => t.type === "SALE" && t.source_id === saleId);
  expect(row, "sale txn not found").toBeTruthy();
  expect(String(row!.created_at).slice(0, 10)).toBe(DAY);
});
