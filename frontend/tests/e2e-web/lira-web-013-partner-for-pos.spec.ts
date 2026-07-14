/**
 * lira-web-013 — POS sale "for a partner" over REST (the web-transport proof
 * for the partner-FOR POS flow). The REST twin of the desktop lira-113.
 *
 * Owner-validated model (docs/plans/done_plans/PARTNER_FOR_TRANSACTIONS_PLAN.md,
 * "⭐ VALIDATED FLOW CATALOG"; corrected in PFT-R): a FOR-partner sale has NO
 * walk-in customer and takes NO counter cash — the partner owes the FULL sale
 * amount (booked to partner_ledger FOR_POS DEBIT against the selected partner,
 * never a client's debt_ledger; client_id === null here), settled later on the
 * Partners page. Voiding the sale nets the partner back to exactly 0 (rule 20 —
 * TransactionRepository's type-agnostic partner_ledger reversal).
 *
 * Guards POST /api/sales/process's partnerId/partnerMode fields (the SHARED
 * saleProcessSchema, same SalesService.processSale the Electron IPC path uses)
 * over REST — dual-transport parity with lira-113. This is the REST-transport
 * proof, not a UI test (lira-114 drives the desktop checkout control).
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

test("POS sale 'FOR' a partner books the FULL amount to partner_ledger over REST; a counter payment is rejected", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };

  const ts = Date.now();
  const NAME = `L-web-013 Partner Widget ${ts}`;

  // Seed product: cost 60, sell 100 — the partner owes the full $100, no cash.
  const product = await (
    await page.request.post(`${BACKEND_URL}/api/inventory/products`, {
      headers: auth,
      data: {
        name: NAME,
        category: "General",
        cost_price_usd: 60,
        retail_price_usd: 100,
        stock: 5,
        min_stock_threshold: 0,
      },
    })
  ).json();
  expect(product.success, JSON.stringify(product)).toBeTruthy();
  const productId = product.data.id as number;
  expect(productId).toBeTruthy();

  // Seed partner — unique name, the e2e DB accumulates across runs (rule 15).
  const partner = await (
    await page.request.post(`${BACKEND_URL}/api/partners`, {
      headers: auth,
      data: { name: `${NAME} Partner`, phone: `Lweb013${ts}`.slice(0, 15) },
    })
  ).json();
  expect(partner.success, JSON.stringify(partner)).toBeTruthy();
  const partnerId = partner.data.id as number;
  expect(partnerId).toBeTruthy();

  const balOf = async (): Promise<number> => {
    const r = await (
      await page.request.get(
        `${BACKEND_URL}/api/partners/${partnerId}/balance`,
        { headers: auth },
      )
    ).json();
    expect(r.success).toBeTruthy();
    return r.balance.usd as number;
  };
  const drawerUsd = async (): Promise<number> => {
    const r = await (
      await page.request.get(`${BACKEND_URL}/api/dashboard/drawer-balances`, {
        headers: auth,
      })
    ).json();
    expect(r.success).toBeTruthy();
    return r.balances.generalDrawer.usd as number;
  };

  const partnerBalBefore = await balOf();
  const drawerBefore = await drawerUsd();

  // A FOR-partner sale takes NO counter payment — a $40 CASH IN leg must be
  // REJECTED outright (not accepted and partially booked as a "remainder").
  const rejected = await (
    await page.request.post(`${BACKEND_URL}/api/sales/process`, {
      headers: auth,
      data: {
        client_id: null,
        partnerId,
        partnerMode: "FOR",
        items: [{ product_id: productId, quantity: 1, price: 100 }],
        total_amount: 100,
        discount: 0,
        final_amount: 100,
        payment_usd: 40,
        payment_lbp: 0,
        payments: [
          { method: "CASH", currency_code: "USD", amount: 40, direction: "IN" },
        ],
        change_given_usd: 0,
        change_given_lbp: 0,
        exchange_rate: 90000,
      },
    })
  ).json();
  // Rule 19c envelope: HTTP 200 with { success:false, error } — not a 4xx.
  expect(rejected.success).toBe(false);
  expect(String(rejected.error ?? "")).toContain("no counter payment");
  // The rejected attempt is a full no-op — the partner balance didn't move.
  expect((await balOf()) - partnerBalBefore).toBeCloseTo(0, 2);

  // The real FOR-partner sale: NO payment legs at all — the full $100 goes
  // on the partner's tab.
  const sale = await (
    await page.request.post(`${BACKEND_URL}/api/sales/process`, {
      headers: auth,
      data: {
        client_id: null,
        partnerId,
        partnerMode: "FOR",
        items: [{ product_id: productId, quantity: 1, price: 100 }],
        total_amount: 100,
        discount: 0,
        final_amount: 100,
        payment_usd: 0,
        payment_lbp: 0,
        payments: [],
        change_given_usd: 0,
        change_given_lbp: 0,
        exchange_rate: 90000,
      },
    })
  ).json();
  expect(sale.success, JSON.stringify(sale)).toBeTruthy();

  // Routing: the partner owes the FULL $100 (FOR_POS DEBIT).
  const partnerBalAfterSale = await balOf();
  expect(partnerBalAfterSale - partnerBalBefore).toBeCloseTo(100, 2);

  // No cash was collected — the General drawer is untouched.
  const drawerAfterSale = await drawerUsd();
  expect(drawerAfterSale - drawerBefore).toBeCloseTo(0, 2);

  // Reversal symmetry (rule 20): void the SALE and confirm the partner nets
  // back to exactly 0 — matched by identity (type + unique product name in
  // the summary), never by row position (rule 15).
  const recent = await (
    await page.request.get(`${BACKEND_URL}/api/transactions/recent?limit=100`, {
      headers: auth,
    })
  ).json();
  const row = (
    recent.transactions as Array<{
      id: number;
      type: string;
      summary: string | null;
    }>
  ).find((t) => t.type === "SALE" && (t.summary ?? "").includes(NAME));
  expect(row, "sale txn not found").toBeTruthy();

  const voided = await (
    await page.request.post(`${BACKEND_URL}/api/transactions/${row!.id}/void`, {
      headers: auth,
    })
  ).json();
  expect(voided.success, JSON.stringify(voided)).toBeTruthy();

  const partnerBalAfterVoid = await balOf();
  expect(partnerBalAfterVoid - partnerBalBefore).toBeCloseTo(0, 2);

  // The drawer was never touched, so it stays at baseline through the void.
  const drawerAfterVoid = await drawerUsd();
  expect(drawerAfterVoid - drawerBefore).toBeCloseTo(0, 2);
});
