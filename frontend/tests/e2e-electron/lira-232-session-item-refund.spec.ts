/**
 * E2E: LIRA-232 — refunding a single item from a customer session basket.
 *
 * SESSION_ITEM_REFUND_PLAN.md's own worked example (a session basket paid
 * fully on a client's account, then one item refunded) drives every
 * assertion here as a DELTA matched by IDENTITY (rule 15) — never an
 * absolute total or `getRecent()[0]`, since this shared-accumulating-DB
 * suite runs dozens of other specs before this one.
 *
 * Scenario (account basket): a fresh client's session sells THREE products
 * in one basket, checked out entirely on the client's CUSTOMER_ACCOUNT.
 *   1. Refund ONE item (Product A) from the Transactions page's session
 *      group — the account reduces first (no drawer move), stock +1.
 *   2. Refund a SECOND item (Product B) from the POS sale screen — same
 *      account-first behavior, same modal.
 *   3. Refund the WHOLE basket (Product C is the only item left) — nets
 *      the client's debt, every product's stock, and General back to their
 *      pre-checkout baseline exactly (SESSION_ITEM_REFUND_PLAN.md §6/§9 Q1:
 *      "reverse only what's left" — items already refunded are skipped).
 *
 * Scenario (cash basket): a single-item CASH-paid session sale — the
 * refund form pre-fills the cash-back leg (no account line, since nothing
 * was charged to an account) and General moves DOWN by exactly the item.
 *
 * NOT RUN by this build — the owner runs the e2e cycle (CLAUDE.md's E2E
 * procedure: `yarn dev` → stop → `node scripts/run-e2e.mjs electron`).
 * Step 3 (whole-basket reversal after two item refunds already landed)
 * depends on SESSION_ITEM_REFUND_PLAN.md's phase 4 ("reverse only what's
 * left"), which is a LATER phase than this build (phase 3, UI) — if phase 4
 * has not landed yet when this runs, step 3 may fail or double-reverse.
 */

import { test, expect, navigateTo, seedProduct } from "./fixtures";
import type { Page, Locator } from "@playwright/test";

test.describe.configure({ retries: 0 });

type CheckoutResultItem = {
  cartItemId: string;
  module: string;
  transactionId: number;
  success: boolean;
  error?: string;
};

type CheckoutPaymentLeg = {
  method: string;
  currency_code: string;
  amount: number;
  direction: "IN" | "OUT";
};

type DebtorRow = {
  id: number;
  full_name: string;
  total_debt_usd: number;
  total_debt_lbp: number;
};

type Api = {
  api: {
    session: {
      start: (data: {
        customer_name: string;
        customer_phone?: string;
        started_by: string;
      }) => Promise<{ success: boolean; sessionId?: number; error?: string }>;
      checkout: (data: {
        sessionId: number;
        cartItems: Array<{
          id: string;
          module: string;
          label: string;
          amount: number;
          currency: string;
          formData: Record<string, unknown>;
          ipcChannel: string;
        }>;
        paidByMethod: string;
        payments: CheckoutPaymentLeg[];
        exchangeRate: number;
        userId: number;
      }) => Promise<{
        success: boolean;
        results?: CheckoutResultItem[];
        error?: string;
      }>;
    };
    debt: { getDebtors: () => Promise<DebtorRow[]> };
    inventory: {
      getProduct: (
        id: number,
      ) => Promise<{ id: number; stock_quantity: number } | null>;
    };
    dashboard: {
      getDrawerBalances: () => Promise<{
        generalDrawer: { usd: number; lbp: number };
      }>;
    };
  };
};

async function generalUsd(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const balances = await (
      window as unknown as Api
    ).api.dashboard.getDrawerBalances();
    return balances.generalDrawer.usd;
  });
}

async function stockOf(page: Page, productId: number): Promise<number> {
  return page.evaluate(async (id) => {
    const p = await (window as unknown as Api).api.inventory.getProduct(id);
    return p?.stock_quantity ?? -1;
  }, productId);
}

/** Missing-from-list (fully settled) reads as 0, matching lira-104's helper. */
async function debtUsd(page: Page, clientName: string): Promise<number> {
  return page.evaluate(async (name) => {
    const row = (await (window as unknown as Api).api.debt.getDebtors()).find(
      (d) => d.full_name === name,
    );
    return row?.total_debt_usd ?? 0;
  }, clientName);
}

/** Open the real POS sale-detail modal for `saleId`, matched via the
 *  sales-panel row carrying `clientName` — mirrors lira-143's own
 *  `openSaleDetail` helper (each e2e file keeps its own copy, per this
 *  suite's convention). */
async function openSaleDetail(
  page: Page,
  saleId: number,
  clientName: string,
): Promise<Locator> {
  await navigateTo(page, "/pos");
  const posSearch = page.getByPlaceholder(
    "Search products by name or barcode...",
  );
  await expect(posSearch).toBeVisible({ timeout: 10_000 });
  // The sales panel only renders while the search box is empty.
  await posSearch.fill("");
  await page
    .locator("button, tbody tr")
    .filter({ hasText: clientName })
    .first()
    .click();
  const heading = page.getByRole("heading", { name: `Sale #${saleId}` });
  await expect(heading).toBeVisible({ timeout: 10_000 });
  return heading.locator("xpath=ancestor::div[contains(@class,'max-w-lg')][1]");
}

/** Confirm the RefundMethodModal that's already open (pre-filled default,
 *  no override) — same "Confirm Refund" click every refund path in this
 *  file ends with. */
async function confirmRefundModal(page: Page): Promise<void> {
  const modal = page.getByTestId("counterparty-settle-modal");
  await expect(modal).toBeVisible({ timeout: 10_000 });
  const confirmBtn = page.getByRole("button", { name: "Confirm Refund" });
  await expect(confirmBtn).toBeEnabled({ timeout: 10_000 });
  await confirmBtn.click();
  await expect(modal).not.toBeVisible({ timeout: 15_000 });
}

test.describe("LIRA-232 — session basket single-item refund", () => {
  test("account basket: item refund (Transactions page) + item refund (POS) + whole-basket refund all net to zero", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const CLIENT_NAME = `L232 Refund ${ts}`;
    const PHONE = `71${String(ts).slice(-6)}`;
    const NAME_A = `L232 Widget A ${ts}`;
    const NAME_B = `L232 Widget B ${ts}`;
    const NAME_C = `L232 Widget C ${ts}`;

    const idA = await seedProduct(appPage, {
      name: NAME_A,
      cost_price: 40,
      sell_price: 100,
      quantity: 5,
    });
    const idB = await seedProduct(appPage, {
      name: NAME_B,
      cost_price: 20,
      sell_price: 50,
      quantity: 5,
    });
    const idC = await seedProduct(appPage, {
      name: NAME_C,
      cost_price: 5,
      sell_price: 20,
      quantity: 5,
    });
    expect(idA).toBeGreaterThan(0);
    expect(idB).toBeGreaterThan(0);
    expect(idC).toBeGreaterThan(0);

    const stockABefore = await stockOf(appPage, idA);
    const stockBBefore = await stockOf(appPage, idB);
    const stockCBefore = await stockOf(appPage, idC);
    const drawerBefore = await generalUsd(appPage);

    // ── Session: sell 3 products, checkout entirely on the client's account ──
    const setup = await appPage.evaluate(
      async ({ idA, idB, idC, name, phone }) => {
        const w = window as unknown as Api;
        const started = await w.api.session.start({
          customer_name: name,
          customer_phone: phone,
          started_by: "admin",
        });
        const sessionId = started.sessionId;
        if (!sessionId) return { error: started.error ?? "no sessionId" };

        const checkout = await w.api.session.checkout({
          sessionId,
          cartItems: [
            {
              id: "l232-sale",
              module: "pos",
              label: "L232 Sale",
              amount: 170,
              currency: "USD",
              ipcChannel: "sales:process",
              formData: {
                client_id: null,
                items: [
                  { product_id: idA, quantity: 1, price: 100 },
                  { product_id: idB, quantity: 1, price: 50 },
                  { product_id: idC, quantity: 1, price: 20 },
                ],
                total_amount: 170,
                discount: 0,
                final_amount: 170,
                payment_usd: 0,
                payment_lbp: 0,
                exchange_rate: 90000,
                status: "completed",
              },
            },
          ],
          paidByMethod: "CUSTOMER_ACCOUNT",
          payments: [
            {
              method: "CUSTOMER_ACCOUNT",
              currency_code: "USD",
              amount: 170,
              direction: "IN",
            },
          ],
          exchangeRate: 90000,
          userId: 1,
        });
        if (!checkout.success) {
          return { error: checkout.error ?? "checkout failed" };
        }
        const saleResult = (checkout.results ?? []).find(
          (r) => r.cartItemId === "l232-sale",
        );
        return {
          error: null,
          saleId: saleResult?.transactionId ?? null,
        };
      },
      { idA, idB, idC, name: CLIENT_NAME, phone: PHONE },
    );
    expect(setup.error).toBeNull();
    expect(setup.saleId).toBeTruthy();
    const saleId = setup.saleId as number;

    // Debt booked, stock down by 1 each, drawer untouched (account charge).
    await expect
      .poll(async () => debtUsd(appPage, CLIENT_NAME), { timeout: 10_000 })
      .toBeCloseTo(170, 2);
    expect(await stockOf(appPage, idA)).toBe(stockABefore - 1);
    expect(await stockOf(appPage, idB)).toBe(stockBBefore - 1);
    expect(await stockOf(appPage, idC)).toBe(stockCBefore - 1);
    expect(await generalUsd(appPage)).toBeCloseTo(drawerBefore, 2);

    // ── Step 1: refund Product A from the Transactions page session group ──
    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/audit");

    // Round-2 review (finding 6) — matched by IDENTITY (rule 15), never a
    // text substring: `.filter({ hasText: "SALE" })` is a CASE-INSENSITIVE
    // substring match in Playwright, and a REFUND row's own summary says
    // "... from Sale #N" (lowercase "ale"), which matches "SALE"
    // case-insensitively too — so once this file's own steps 1/2 create
    // REFUND rows for the same client, `.first()` in newest-first order
    // would pick the REFUND row, not the original SALE member. "Refund
    // basket" is rendered ONLY for a live, not-yet-fully-reversed SALE
    // session member (`isReversibleRow` excludes every REFUND-typed row
    // outright — TransactionCells.tsx), so filtering on that button's
    // presence identifies the SALE row unambiguously at every step below.
    const saleRow = appPage
      .locator("tbody tr")
      .filter({ hasText: CLIENT_NAME })
      .filter({ has: appPage.getByRole("button", { name: "Refund basket" }) })
      .first();
    await expect(saleRow).toBeVisible({ timeout: 10_000 });
    await saleRow.getByRole("button", { name: "Refund item" }).click();

    const linePickerHeading = appPage.getByRole("heading", {
      name: "Refund Which Item?",
    });
    await expect(linePickerHeading).toBeVisible({ timeout: 10_000 });
    const lineA = appPage
      .locator('[data-testid^="session-sale-line-"]')
      .filter({ hasText: NAME_A });
    await expect(lineA).toBeVisible({ timeout: 5_000 });
    await lineA.getByRole("button", { name: "Refund" }).click();

    const qtyHeading = appPage.getByRole("heading", {
      name: "Refund Item Quantity",
    });
    await expect(qtyHeading).toBeVisible({ timeout: 5_000 });
    await appPage.getByRole("button", { name: /^Refund 1x$/ }).click();
    await expect(qtyHeading).not.toBeVisible({ timeout: 10_000 });

    // Account-first (owner decision #3): $100 <= the $170 owed, so it's
    // cancelled entirely — no drawer legs, the account line only.
    await expect(
      appPage.getByTestId("refund-account-reduction"),
    ).toContainText("$100");
    await confirmRefundModal(appPage);

    await expect
      .poll(async () => debtUsd(appPage, CLIENT_NAME), { timeout: 10_000 })
      .toBeCloseTo(70, 2);
    expect(await stockOf(appPage, idA)).toBe(stockABefore);
    expect(await generalUsd(appPage)).toBeCloseTo(drawerBefore, 2);

    // ── Step 2: refund Product B from the POS sale screen ──────────────────
    const modal = await openSaleDetail(appPage, saleId, CLIENT_NAME);
    const itemRowB = modal
      .getByText(NAME_B, { exact: true })
      .locator("xpath=ancestor::div[contains(@class,'justify-between')][1]");
    await expect(itemRowB).toBeVisible({ timeout: 5_000 });
    await itemRowB.locator('button[title="Refund item"]').click();

    await expect(qtyHeading).toBeVisible({ timeout: 5_000 });
    await appPage.getByRole("button", { name: /^Refund 1x$/ }).click();
    await expect(qtyHeading).not.toBeVisible({ timeout: 10_000 });

    await expect(
      appPage.getByTestId("refund-account-reduction"),
    ).toContainText("$50");
    await confirmRefundModal(appPage);

    await expect
      .poll(async () => debtUsd(appPage, CLIENT_NAME), { timeout: 10_000 })
      .toBeCloseTo(20, 2);
    expect(await stockOf(appPage, idB)).toBe(stockBBefore);
    expect(await generalUsd(appPage)).toBeCloseTo(drawerBefore, 2);

    // ── Step 3: refund the WHOLE basket (only Product C is left) ───────────
    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/audit");

    // Same identity match as step 1 above (finding 6) — by now TWO item
    // REFUND rows exist for this client (steps 1 and 2), each carrying
    // "... from Sale #N" in its summary, so a text-substring filter would be
    // even more likely to pick a REFUND row here than at step 1.
    const remainingRow = appPage
      .locator("tbody tr")
      .filter({ hasText: CLIENT_NAME })
      .filter({ has: appPage.getByRole("button", { name: "Refund basket" }) })
      .first();
    await expect(remainingRow).toBeVisible({ timeout: 10_000 });

    const confirmSeen = new Promise<string>((resolve) => {
      appPage.once("dialog", (d) => {
        d.accept().catch(() => {});
        resolve(d.message());
      });
    });
    await remainingRow.getByRole("button", { name: "Refund basket" }).click();
    expect(await confirmSeen).toMatch(/Refund the entire session/i);

    // Everything nets back to the pre-checkout baseline.
    await expect
      .poll(async () => debtUsd(appPage, CLIENT_NAME), { timeout: 15_000 })
      .toBeCloseTo(0, 2);
    expect(await stockOf(appPage, idA)).toBe(stockABefore);
    expect(await stockOf(appPage, idB)).toBe(stockBBefore);
    expect(await stockOf(appPage, idC)).toBe(stockCBefore);
    expect(await generalUsd(appPage)).toBeCloseTo(drawerBefore, 2);
  });

  test("cash basket: the refund form pre-fills the cash leg and General moves down by exactly the item", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const CLIENT_NAME = `L232 Cash ${ts}`;
    const PHONE = `72${String(ts).slice(-6)}`;
    const NAME_D = `L232 Widget D ${ts}`;

    const idD = await seedProduct(appPage, {
      name: NAME_D,
      cost_price: 10,
      sell_price: 30,
      quantity: 5,
    });
    expect(idD).toBeGreaterThan(0);

    const stockDBefore = await stockOf(appPage, idD);
    const drawerBefore = await generalUsd(appPage);

    const setup = await appPage.evaluate(
      async ({ idD, name, phone }) => {
        const w = window as unknown as Api;
        const started = await w.api.session.start({
          customer_name: name,
          customer_phone: phone,
          started_by: "admin",
        });
        const sessionId = started.sessionId;
        if (!sessionId) return { error: started.error ?? "no sessionId" };

        const checkout = await w.api.session.checkout({
          sessionId,
          cartItems: [
            {
              id: "l232-cash-sale",
              module: "pos",
              label: "L232 Cash Sale",
              amount: 30,
              currency: "USD",
              ipcChannel: "sales:process",
              formData: {
                client_id: null,
                items: [{ product_id: idD, quantity: 1, price: 30 }],
                total_amount: 30,
                discount: 0,
                final_amount: 30,
                payment_usd: 0,
                payment_lbp: 0,
                exchange_rate: 90000,
                status: "completed",
              },
            },
          ],
          paidByMethod: "CASH",
          payments: [
            { method: "CASH", currency_code: "USD", amount: 30, direction: "IN" },
          ],
          exchangeRate: 90000,
          userId: 1,
        });
        if (!checkout.success) return { error: checkout.error ?? "failed" };
        const saleResult = (checkout.results ?? []).find(
          (r) => r.cartItemId === "l232-cash-sale",
        );
        return { error: null, saleId: saleResult?.transactionId ?? null };
      },
      { idD, name: CLIENT_NAME, phone: PHONE },
    );
    expect(setup.error).toBeNull();
    expect(setup.saleId).toBeTruthy();

    // Cash sale: drawer UP by $30, stock down by 1, no debt.
    await expect
      .poll(async () => generalUsd(appPage), { timeout: 10_000 })
      .toBeCloseTo(drawerBefore + 30, 2);
    expect(await stockOf(appPage, idD)).toBe(stockDBefore - 1);
    expect(await debtUsd(appPage, CLIENT_NAME)).toBeCloseTo(0, 2);
    const drawerAfterSale = await generalUsd(appPage);

    // ── Refund the item from the Transactions page ──────────────────────────
    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/audit");

    const saleRow = appPage
      .locator("tbody tr")
      .filter({ hasText: CLIENT_NAME })
      .first();
    await expect(saleRow).toBeVisible({ timeout: 10_000 });
    await saleRow.getByRole("button", { name: "Refund item" }).click();

    const linePickerHeading = appPage.getByRole("heading", {
      name: "Refund Which Item?",
    });
    await expect(linePickerHeading).toBeVisible({ timeout: 10_000 });
    const lineD = appPage
      .locator('[data-testid^="session-sale-line-"]')
      .filter({ hasText: NAME_D });
    await expect(lineD).toBeVisible({ timeout: 5_000 });
    await lineD.getByRole("button", { name: "Refund" }).click();

    const qtyHeading = appPage.getByRole("heading", {
      name: "Refund Item Quantity",
    });
    await expect(qtyHeading).toBeVisible({ timeout: 5_000 });
    await appPage.getByRole("button", { name: /^Refund 1x$/ }).click();
    await expect(qtyHeading).not.toBeVisible({ timeout: 10_000 });

    // No account charge exists — the account-reduction line must be absent,
    // and the pre-filled return summary shows the cash leg pre-filled.
    await expect(
      appPage.getByTestId("refund-account-reduction"),
    ).not.toBeVisible();
    await expect(appPage.getByTestId("refund-return-summary")).toContainText(
      "$30",
    );
    await confirmRefundModal(appPage);

    await expect
      .poll(async () => generalUsd(appPage), { timeout: 10_000 })
      .toBeCloseTo(drawerAfterSale - 30, 2);
    expect(await stockOf(appPage, idD)).toBe(stockDBefore);
  });
});
