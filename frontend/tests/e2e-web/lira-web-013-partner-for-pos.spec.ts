/**
 * lira-web-013 — POS sale "for a partner" over REST (the web-transport proof
 * deferred from PFT-2 / ddae06f; PFT-2's own note explicitly defers the web
 * e2e to this spec).
 *
 * Guards POST /api/sales/process's partnerId/partnerMode fields (added to the
 * SHARED saleProcessSchema in PFT-2 — same schema, same SalesService.processSale
 * as the Electron IPC path) into the same core routing lira-113 proves over
 * IPC: a sale "FOR" a partner books its unpaid remainder to partner_ledger
 * (FOR_POS DEBIT) instead of a client's debt_ledger — no client is involved
 * here (client_id === null) — while the cash the customer DID pay still goes
 * to the General drawer as usual. Voiding the sale must net the partner back
 * to exactly 0 (reversal symmetry, rule 20 — TransactionRepository's
 * type-agnostic partner_ledger reversal, already guarded generically by
 * lira-113).
 *
 * This is the REST-transport proof, not a UI test — lira-114 is the dedicated
 * desktop UI spec that drives the new checkout "For Partner" control itself.
 * Pre-PFT-2, /api/sales/process's schema stripped partnerId/partnerMode and
 * the sale fell into the client-debt branch with client_id === null, which
 * throws "Cannot create debt for anonymous client" — the create step below
 * cannot pass without the shared-schema fields PFT-2 added.
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

test("POS sale 'FOR' a partner books the remainder to partner_ledger over REST", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };

  const ts = Date.now();
  const NAME = `L-web-013 Partner Widget ${ts}`;

  // Seed product: cost 60, sell 100 — paying $40 leaves the $60 remainder.
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

  // Action: $100 sale, $40 CASH paid, $60 remainder routed to the partner.
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
        payment_usd: 40,
        payment_lbp: 0,
        payments: [
          {
            method: "CASH",
            currency_code: "USD",
            amount: 40,
            direction: "IN",
          },
        ],
        change_given_usd: 0,
        change_given_lbp: 0,
        exchange_rate: 90000,
      },
    })
  ).json();
  expect(sale.success, JSON.stringify(sale)).toBeTruthy();

  // Routing: the partner now owes the $60 remainder (FOR_POS DEBIT). Pre-PFT-2
  // this throws for the anonymous client before ever reaching this delta.
  const partnerBalAfterSale = await balOf();
  expect(partnerBalAfterSale - partnerBalBefore).toBeCloseTo(60, 2);

  // The General drawer still takes the $40 cash the customer paid.
  const drawerAfterSale = await drawerUsd();
  expect(drawerAfterSale - drawerBefore).toBeCloseTo(40, 2);

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

  // And the drawer gives the $40 cash back on void.
  const drawerAfterVoid = await drawerUsd();
  expect(drawerAfterVoid - drawerBefore).toBeCloseTo(0, 2);
});
