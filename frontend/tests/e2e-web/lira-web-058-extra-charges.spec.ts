/**
 * lira-web-058 — LIRA-319 (Extra charges) on the POS, over the web transport
 * (rule 19). Quickstart scenarios 1, 4 and 6:
 *
 *  1. Real POS page: one product (cost 5.00, price 6.00) in the cart, the
 *     payment box's Discount line switched to "+ Extra", 1 typed, $7 cash.
 *     The SALE row carries amount 7, extra_usd 1 and profit 1 (the extra is
 *     not item profit); the General USD drawer moves +7; Profits "Extra
 *     charges" moves +1. Voiding the SALE puts the drawer and "Extra
 *     charges" back where they were.
 *  2. REST: a sale of a $10 and a $5 item with a $3 extra. Refunding the $5
 *     item returns $5 + its share of the extra ($1, computed by the server);
 *     the REFUND row carries extra −1, the drawer moves −6 and "Extra
 *     charges" drops by 1. Undoing that refund brings "Extra charges" back.
 *
 * Rule 15: the web DB accumulates — rows are matched by identity (sale id,
 * refund id), every money check is a DELTA snapshotted around its own action.
 */
import type { Page } from "@playwright/test";
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

type Auth = { Authorization: string };
type TxnRow = {
  id: number;
  type: string;
  status?: string;
  source_table: string | null;
  source_id: number | null;
  amount_usd: number;
  amount_lbp: number;
  profit_usd: number;
  extra_usd: number | null;
  extra_lbp: number | null;
};
type ProfitModuleRow = { module: string; profit_usd: number };

const PROFITS_PASSWORD = "1234";

async function authOf(page: Page): Promise<Auth> {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  return { Authorization: `Bearer ${token}` };
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

/** Same pattern as lira-web-036: set the profits password if none is set
 *  yet, then unlock (idempotent). */
async function unlockProfits(page: Page, auth: Auth): Promise<void> {
  const status = await (
    await page.request.get(`${BACKEND_URL}/api/profits/password-status`, {
      headers: auth,
    })
  ).json();
  expect(status.success, JSON.stringify(status)).toBeTruthy();
  if (!status.isSet) {
    const set = await (
      await page.request.put(`${BACKEND_URL}/api/profits/password`, {
        headers: auth,
        data: { password: PROFITS_PASSWORD },
      })
    ).json();
    expect(set.success, JSON.stringify(set)).toBeTruthy();
  }
  const unlocked = await (
    await page.request.post(`${BACKEND_URL}/api/profits/unlock`, {
      headers: auth,
      data: { password: PROFITS_PASSWORD },
    })
  ).json();
  expect(unlocked.success, JSON.stringify(unlocked)).toBeTruthy();
}

function isoDay(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/** Profits "Extra charges" (USD) over yesterday..tomorrow — a window wide
 *  enough that the server's idea of "today" does not matter (rule 27). The
 *  row is listed only when its count is above 0, so absent = 0. */
async function extraChargesUsd(page: Page, auth: Auth): Promise<number> {
  const r = await (
    await page.request.get(
      `${BACKEND_URL}/api/profits/by-module?from=${isoDay(-1)}&to=${isoDay(1)}`,
      { headers: auth },
    )
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  const row = (r.data as ProfitModuleRow[]).find(
    (m) => m.module === "EXTRA_CHARGE",
  );
  return row?.profit_usd ?? 0;
}

async function saleTxn(
  page: Page,
  auth: Auth,
  saleId: number,
): Promise<TxnRow> {
  const r = await (
    await page.request.get(
      `${BACKEND_URL}/api/transactions/by-source/sales/${saleId}`,
      { headers: auth },
    )
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  expect(r.transaction, `SALE row for sale #${saleId} not found`).toBeTruthy();
  const t = r.transaction as TxnRow;
  expect(t.type).toBe("SALE");
  expect(t.source_id).toBe(saleId);
  return t;
}

async function txnById(page: Page, auth: Auth, id: number): Promise<TxnRow> {
  const r = await (
    await page.request.get(`${BACKEND_URL}/api/transactions/${id}`, {
      headers: auth,
    })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return r.transaction as TxnRow;
}

async function createProduct(
  page: Page,
  auth: Auth,
  name: string,
  cost: number,
  price: number,
): Promise<number> {
  const r = await (
    await page.request.post(`${BACKEND_URL}/api/inventory/products`, {
      headers: auth,
      data: {
        name,
        category: "General",
        cost_price_usd: cost,
        retail_price_usd: price,
        stock: 5,
        min_stock_threshold: 0,
      },
    })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return r.data.id as number;
}

/** An active session turns the POS checkout into "add to basket", where the
 *  extra is not offered — close every one first (as lira-web-057 does). */
async function closeActiveSessions(page: Page, auth: Auth): Promise<void> {
  const r = await (
    await page.request.get(`${BACKEND_URL}/api/sessions/active-list`, {
      headers: auth,
    })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  for (const s of (r.sessions ?? []) as Array<{ id: number }>) {
    const closed = await (
      await page.request.post(`${BACKEND_URL}/api/sessions/${s.id}/close`, {
        headers: auth,
      })
    ).json();
    expect(closed.success, JSON.stringify(closed)).toBeTruthy();
  }
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
}

test.describe.serial("lira-web-058 POS extra charges", () => {
  test("POS page: $6 item + $1 Extra paid $7 cash — SALE amount 7, extra 1, profit 1; drawer +7, Extra charges +1; void puts both back", async ({
    page,
  }) => {
    const dialogs: string[] = [];
    page.on("dialog", (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    const auth = await authOf(page);
    await closeActiveSessions(page, auth);
    await unlockProfits(page, auth);

    const COST = 5;
    const PRICE = 6;
    const EXTRA = 1;
    const CHARGED = PRICE + EXTRA;
    const NAME = `L-web-058 Case ${Date.now()}`;
    await createProduct(page, auth, NAME, COST, PRICE);

    const drawerBefore = await generalUsd(page, auth);
    const extraBefore = await extraChargesUsd(page, auth);

    await page.goto("/#/pos");
    await expect(page.locator("#root")).not.toContainText(
      "Something went wrong",
    );
    const search = page.getByPlaceholder(
      "Search products by name or barcode...",
    );
    await expect(search).toBeVisible({ timeout: 15_000 });
    await search.fill(NAME);
    await page.locator(`text=${NAME}`).first().click();
    await page.getByRole("button", { name: /Proceed to Checkout/i }).click();

    const modal = page.getByTestId("checkout-modal");
    await expect(modal).toBeVisible({ timeout: 10_000 });

    await modal.getByTestId("discount-mode-extra").click();
    const extraInput = modal.getByLabel("Extra", { exact: true });
    await expect(extraInput).toBeVisible();
    await extraInput.fill(String(EXTRA));

    const mpi = modal.getByTestId("multi-payment-input");
    await mpi
      .locator('[data-testid^="payment-amount-"]')
      .first()
      .fill(String(CHARGED));
    await expect(mpi.getByTestId("after-page-extra").first()).toContainText(
      CHARGED.toFixed(2),
    );

    const [resp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          /\/api\/sales\/process$/.test(new URL(r.url()).pathname),
      ),
      modal.getByTestId("checkout-complete-btn").click(),
    ]);
    const sale = await resp.json();
    expect(sale.success, JSON.stringify(sale)).toBeTruthy();
    const saleId = sale.id as number;
    expect(saleId).toBeTruthy();
    // The page sent the extra as its own field, not folded into the price.
    const sent = resp.request().postDataJSON() as {
      extra_usd?: number;
      final_amount: number;
      items: Array<{ price: number }>;
    };
    expect(sent.extra_usd).toBe(EXTRA);
    expect(sent.final_amount).toBeCloseTo(PRICE, 2);
    expect(sent.items[0].price).toBeCloseTo(PRICE, 2);

    const txn = await saleTxn(page, auth, saleId);
    expect(txn.amount_usd).toBeCloseTo(CHARGED, 2);
    expect(txn.extra_usd ?? 0).toBeCloseTo(EXTRA, 2);
    expect(txn.profit_usd).toBeCloseTo(PRICE - COST, 2);

    expect((await generalUsd(page, auth)) - drawerBefore).toBeCloseTo(
      CHARGED,
      2,
    );
    expect((await extraChargesUsd(page, auth)) - extraBefore).toBeCloseTo(
      EXTRA,
      2,
    );

    // Void → the drawer and "Extra charges" are back where they were.
    const voided = await (
      await page.request.post(
        `${BACKEND_URL}/api/transactions/${txn.id}/void`,
        { headers: auth },
      )
    ).json();
    expect(voided.success, JSON.stringify(voided)).toBeTruthy();
    expect((await generalUsd(page, auth)) - drawerBefore).toBeCloseTo(0, 2);
    expect((await extraChargesUsd(page, auth)) - extraBefore).toBeCloseTo(0, 2);
    expect(dialogs, "the page raised an alert").toEqual([]);
  });

  test("REST: $10 + $5 items with a $3 extra; refunding the $5 item returns $6 (its $1 share), Extra charges −1; undo restores it", async ({
    page,
  }) => {
    const auth = await authOf(page);
    await unlockProfits(page, auth);
    const ts = Date.now();
    const bigId = await createProduct(page, auth, `L-web-058 Big ${ts}`, 7, 10);
    const smallId = await createProduct(
      page,
      auth,
      `L-web-058 Small ${ts}`,
      3,
      5,
    );

    const EXTRA = 3;
    const TOTAL = 15;
    const SHARE = (EXTRA * 5) / TOTAL; // 1.00 — the server computes it

    const drawerBefore = await generalUsd(page, auth);
    const extraBefore = await extraChargesUsd(page, auth);

    const sale = await (
      await page.request.post(`${BACKEND_URL}/api/sales/process`, {
        headers: auth,
        data: {
          client_id: null,
          items: [
            { product_id: bigId, quantity: 1, price: 10 },
            { product_id: smallId, quantity: 1, price: 5 },
          ],
          total_amount: TOTAL,
          discount: 0,
          final_amount: TOTAL,
          extra_usd: EXTRA,
          payment_usd: TOTAL + EXTRA,
          payment_lbp: 0,
          payments: [
            { method: "CASH", currency_code: "USD", amount: TOTAL + EXTRA },
          ],
          change_given_usd: 0,
          change_given_lbp: 0,
          exchange_rate: 89500,
          status: "completed",
        },
      })
    ).json();
    expect(sale.success, JSON.stringify(sale)).toBeTruthy();
    const saleId = sale.id as number;

    const txn = await saleTxn(page, auth, saleId);
    expect(txn.amount_usd).toBeCloseTo(TOTAL + EXTRA, 2);
    expect(txn.extra_usd ?? 0).toBeCloseTo(EXTRA, 2);
    expect((await generalUsd(page, auth)) - drawerBefore).toBeCloseTo(
      TOTAL + EXTRA,
      2,
    );
    expect((await extraChargesUsd(page, auth)) - extraBefore).toBeCloseTo(
      EXTRA,
      2,
    );

    const items = await (
      await page.request.get(`${BACKEND_URL}/api/sales/${saleId}/items`, {
        headers: auth,
      })
    ).json();
    expect(items.success, JSON.stringify(items)).toBeTruthy();
    const smallItem = (
      items.items as Array<{ id: number; product_id: number }>
    ).find((i) => i.product_id === smallId);
    expect(smallItem, "the $5 sale item not found").toBeTruthy();

    const drawerBeforeRefund = await generalUsd(page, auth);
    const refund = await (
      await page.request.post(
        `${BACKEND_URL}/api/sales/${saleId}/refund-item`,
        {
          headers: auth,
          data: { saleItemId: smallItem!.id, refundQuantity: 1 },
        },
      )
    ).json();
    expect(refund.success, JSON.stringify(refund)).toBeTruthy();
    const refundId = refund.refundId as number;
    expect(refundId).toBeTruthy();

    const refundRow = await txnById(page, auth, refundId);
    expect(refundRow.type).toBe("REFUND");
    expect(Math.abs(refundRow.amount_usd)).toBeCloseTo(5 + SHARE, 2);
    expect(refundRow.extra_usd ?? 0).toBeCloseTo(-SHARE, 2);
    // The customer got $6 back out of the cash drawer.
    expect((await generalUsd(page, auth)) - drawerBeforeRefund).toBeCloseTo(
      -(5 + SHARE),
      2,
    );
    expect((await extraChargesUsd(page, auth)) - extraBefore).toBeCloseTo(
      EXTRA - SHARE,
      2,
    );

    // Undo the item refund → "Extra charges" is back to the full $3.
    const undo = await (
      await page.request.post(`${BACKEND_URL}/api/sales/undo-item-refund`, {
        headers: auth,
        data: { refundTransactionId: refundId },
      })
    ).json();
    expect(undo.success, JSON.stringify(undo)).toBeTruthy();
    expect((await extraChargesUsd(page, auth)) - extraBefore).toBeCloseTo(
      EXTRA,
      2,
    );
  });
});
