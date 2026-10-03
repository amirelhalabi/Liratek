/**
 * E2E: LIRA-117 — Custom Services inventory PICK path -> stock decrement.
 *
 * NOTE on scope (premise check, per the ticket's own text in
 * current_sprint.md): LIRA-117 is about the Custom Services page's
 * `custom-service-item-search` SearchBar, NOT Maintenance/PartPicker.
 * §2b (`69c29e8`) made an inventory-backed custom service consume stock via
 * `custom_services.product_id`, but every existing spec that touches
 * `custom-service-item-search` (lira-088, lira-093, lira-094, lira-135)
 * drives the FREE-TEXT commit path (`.fill(text)` + `press("Enter")`), which
 * sends no `product_id` — confirmed by re-grepping all four files plus the
 * whole `tests/e2e-electron/` tree before writing this spec. No spec ever
 * clicks a SearchBar dropdown RESULT here, so a UI-side regression (the page
 * failing to send `product_id`, or sending the wrong one) would pass every
 * test that existed before this one. (LIRA-176/lira-176-maintenance-parts
 * covers the equivalent PICK path for the separate Maintenance/PartPicker
 * component, which is a different page+testid and does not touch this gap.)
 *
 * Rule 15 (shared accumulating DB): the product name is `Date.now()`-unique;
 * rows are matched by that name substring on /audit, never by list position.
 * Every assertion is a delta against a stock snapshot taken immediately
 * before the action.
 */
import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

type Api = {
  api: {
    inventory: {
      createProduct: (product: {
        name: string;
        category: string;
        cost_price: number;
        retail_price: number;
        stock_quantity?: number;
        barcode?: string;
      }) => Promise<{ success: boolean; id?: number; error?: string }>;
      getProduct: (
        id: number,
      ) => Promise<{ id: number; stock_quantity: number } | null>;
    };
    customServices: {
      list: (filter?: {
        date?: string;
      }) => Promise<
        Array<{ id: number; description: string; product_id: number | null }>
      >;
    };
    transactions: {
      getBySource: (
        sourceTable: string,
        sourceId: number,
      ) => Promise<{
        id: number;
        amount_usd: number;
        profit_usd: number;
      } | null>;
    };
  };
};

async function createPartProduct(
  page: Page,
  args: { name: string; cost: number; price: number; stock: number },
): Promise<number> {
  const result = await page.evaluate(async (a) => {
    const w = window as unknown as Api;
    return w.api.inventory.createProduct({
      name: a.name,
      category: "Parts",
      cost_price: a.cost,
      retail_price: a.price,
      stock_quantity: a.stock,
      barcode: "",
    });
  }, args);
  if (!result.success || result.id == null) {
    throw new Error(`createPartProduct failed: ${result.error ?? "no id"}`);
  }
  return result.id;
}

async function getStock(page: Page, productId: number): Promise<number> {
  return page.evaluate(async (id) => {
    const w = window as unknown as Api;
    const p = await w.api.inventory.getProduct(id);
    return p?.stock_quantity ?? -1;
  }, productId);
}

async function findCustomServiceByDescription(
  page: Page,
  description: string,
): Promise<{ id: number; product_id: number | null } | null> {
  return page.evaluate(async (desc) => {
    const w = window as unknown as Api;
    const rows = await w.api.customServices.list();
    const row = rows.find((r) => r.description === desc);
    return row ? { id: row.id, product_id: row.product_id } : null;
  }, description);
}

test.describe("LIRA-117 — custom services inventory PICK path", () => {
  test("picking a product from the SearchBar dropdown decrements stock by exactly 1, prices/profit land on the transaction, and refund restores stock", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const partName = `L117 Part ${ts}`;

    // Cost 20 / price 35 so cost and price are distinguishable in the
    // pre-fill + profit assertions below.
    const productId = await createPartProduct(appPage, {
      name: partName,
      cost: 20,
      price: 35,
      stock: 10,
    });

    await navigateTo(appPage, "/custom-services");

    // ── Real PICK path: type, wait for the dropdown RESULT, click it.
    // Never `.press("Enter")` — that is the free-text path every other
    // spec already drives, and sends no product_id. ──
    const search = appPage.getByTestId("custom-service-item-search");
    await search.fill(partName);
    const option = appPage
      .getByText(partName, { exact: true })
      .first();
    await expect(option).toBeVisible({ timeout: 10_000 });
    await option.click();

    // Picking replaces the SearchBar with a selection chip showing the
    // product name, and pre-fills cost/price from the product record.
    await expect(
      appPage.locator("div").filter({ hasText: partName }).first(),
    ).toBeVisible();
    await expect(appPage.locator("#svc-cost")).toHaveValue("20");
    await expect(appPage.locator("#svc-price")).toHaveValue("35");

    const stockBeforeSubmit = await getStock(appPage, productId);
    expect(stockBeforeSubmit).toBe(10);

    // Default CASH payment auto-fills from the price — no extra
    // interaction needed (same minimal flow lira-135's custom-services step
    // uses for a plain cash submission).
    await appPage.getByRole("button", { name: /Submit Service/i }).click();

    // Stock decrements by exactly 1 (delta, never an absolute read).
    await expect
      .poll(async () => getStock(appPage, productId), { timeout: 10_000 })
      .toBe(stockBeforeSubmit - 1);

    const created = await findCustomServiceByDescription(appPage, partName);
    expect(created).not.toBeNull();
    if (!created) return;
    expect(created.product_id).toBe(productId);

    const txn = await appPage.evaluate(async (id) => {
      const w = window as unknown as Api;
      return w.api.transactions.getBySource("custom_services", id);
    }, created.id);
    expect(txn).not.toBeNull();
    if (!txn) return;
    expect(txn.amount_usd).toBeCloseTo(35, 2);
    expect(txn.profit_usd).toBeCloseTo(15, 2); // 35 - 20

    // ── Refund via the real /audit Refund button. A CASH-paid row has
    // non-empty `payments` legs, so TransactionsViewer opens
    // RefundMethodModal (tender-selection) instead of a bare confirm() —
    // same reasoning lira-129/lira-176 document; confirming the pre-filled
    // default is byte-identical to a bare refund. ──
    await navigateTo(appPage, "/audit");
    const row = appPage.locator("tbody tr").filter({ hasText: partName });
    await expect(row).toBeVisible({ timeout: 10_000 });
    const refundBtn = row.getByRole("button", { name: /^Refund$/ });
    await expect(refundBtn).toBeVisible();
    await refundBtn.click();

    const confirmBtn = appPage.getByRole("button", { name: "Confirm Refund" });
    await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();

    // Stock is restored exactly once — back to the pre-submit level.
    await expect
      .poll(async () => getStock(appPage, productId), { timeout: 10_000 })
      .toBe(stockBeforeSubmit);

    // ── Negative case: the FREE-TEXT path (type text with no product
    // match, Enter commits it) must never touch ANY product's stock — the
    // regression this ticket cares about most, since all three input paths
    // (preset / free-text / pick) share one backend code path and only the
    // pick path is supposed to send product_id. ──
    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/custom-services");

    const freeTextDesc = `L117 Free Text ${ts}`;
    const search2 = appPage.getByTestId("custom-service-item-search");
    await search2.fill(freeTextDesc);
    await search2.press("Enter");
    await expect(appPage.locator("#svc-description")).toHaveValue(
      freeTextDesc,
      { timeout: 1_000 },
    );
    await appPage.locator("#svc-price").fill("10");
    await appPage.getByRole("button", { name: /Submit Service/i }).click();

    const freeTextRow = await findCustomServiceByDescription(
      appPage,
      freeTextDesc,
    );
    expect(freeTextRow).not.toBeNull();
    if (freeTextRow) {
      expect(freeTextRow.product_id).toBeNull();
    }

    const stockAfterFreeText = await getStock(appPage, productId);
    expect(stockAfterFreeText).toBe(stockBeforeSubmit);
  });
});
