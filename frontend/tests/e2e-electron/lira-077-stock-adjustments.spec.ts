/**
 * E2E: LIRA-077 — stock adjustment UI + audit trail
 *
 * WRITTEN BUT NEVER RUN by this workstream (W4) — per the parallel-workstream
 * plan, other agents are concurrently editing the renderer (a mid-edit agent
 * breaks the Vite bundle for every spec) and the e2e DB is single-instance.
 * Fable runs this in the centralized verification phase
 * (`yarn dev` → stop → `env -u ELECTRON_RUN_AS_NODE yarn test:e2e`).
 *
 * Naming collision (flag for the verifier): frontend/tests/e2e-electron/
 * lira-077-app-drawer-movement.spec.ts ALREADY exists, covering an unrelated
 * C4 OMT/Whish/Binance wallet-drawer fix. README.md's own "091" entry
 * documents this exact class of coincidental collision as tolerated ("Two
 * files share the 091 number... unrelated topics; ticket-number collision
 * only"). This file is named lira-077-stock-adjustments.spec.ts per the
 * PARTIAL_TASKS_COMPLETION_PLAN's explicit filename (LIRA-077 = stock
 * replenishment/adjustment, the JIRA ticket this workstream closes) — a
 * DIFFERENT numbering scheme than the e2e spec sequence. Both specs are
 * independent; alphabetical ordering after "-app-" is fine since every
 * assertion here is delta/identity-based (rule 15), never row-position or
 * cross-file-order dependent.
 *
 * Guards:
 *  - Delta-mode "Adjust stock" changes stock_quantity by EXACTLY the delta
 *    (read the product back via IPC before/after — never assumed).
 *  - Set-mode "Adjust stock" sets stock_quantity to EXACTLY the entered
 *    value.
 *  - Each adjustment writes ONE stock_adjustments row, identity-matched by
 *    a Date.now()-unique `reason` marker (never getStockAdjustments()[0]),
 *    with the correct old_quantity/new_quantity/delta triple.
 *  - Submitting with an empty reason is rejected client-side: the modal
 *    stays open, stock_quantity is unchanged (delta = 0), and the
 *    stock_adjustments row COUNT is unchanged (not an absolute count).
 *  - Re-opening the modal renders the just-written row in the per-product
 *    history panel — proves the read path (getStockAdjustments) end-to-end
 *    through the UI, not just via direct IPC.
 *
 * Failing-first procedure for the verifier (rule 17): in
 * packages/core/src/repositories/ProductRepository.ts, temporarily comment
 * out the `getStockAdjustmentRepository().create(...)` call inside BOTH
 * adjustStock() and adjustStockDelta() (leave the stock_quantity UPDATE
 * itself untouched), rebuild core + sync, re-run. The delta/set stock_quantity
 * assertions still pass, but every "audit row" assertion (row-found,
 * delta/old/new values, and the history-panel render) fails because no
 * stock_adjustments row was ever written. Restore afterward.
 */

import { test, expect, navigateTo, seedProduct } from "./fixtures";

test.describe.configure({ retries: 0 });

type StockAdjustmentRow = {
  id: number;
  product_id: number;
  delta: number;
  old_quantity: number;
  new_quantity: number;
  reason: string;
  user_id: number | null;
  username: string | null;
};

type Api = {
  api: {
    inventory: {
      getProduct: (
        id: number,
      ) => Promise<{ id: number; stock_quantity: number } | null>;
      getStockAdjustments: (
        productId?: number,
      ) => Promise<StockAdjustmentRow[]>;
    };
  };
};

async function readStock(
  appPage: import("@playwright/test").Page,
  id: number,
): Promise<number | null> {
  return appPage.evaluate(async (productId) => {
    const w = window as unknown as Api;
    return (
      (await w.api.inventory.getProduct(productId))?.stock_quantity ?? null
    );
  }, id);
}

async function findAdjustmentByReason(
  appPage: import("@playwright/test").Page,
  id: number,
  reason: string,
): Promise<StockAdjustmentRow | null> {
  return appPage.evaluate(
    async ({ productId, marker }) => {
      const w = window as unknown as Api;
      const rows = await w.api.inventory.getStockAdjustments(productId);
      return rows.find((r) => r.reason === marker) ?? null;
    },
    { productId: id, marker: reason },
  );
}

const REASON_PLACEHOLDER =
  "e.g. Physical recount, damaged goods, supplier correction…";

test.describe("LIRA-077 — stock adjustment UI + audit trail", () => {
  test("delta adjustment: exact stock delta + identity-matched audit row", async ({
    appPage,
  }) => {
    const uniqueName = `E2E-077-Delta-${Date.now()}`;
    const productId = await seedProduct(appPage, {
      name: uniqueName,
      cost_price: 3,
      sell_price: 6,
      quantity: 20,
    });
    expect(await readStock(appPage, productId)).toBe(20);

    await navigateTo(appPage, "/products");
    await appPage.getByPlaceholder(/search by name, barcode/i).fill(uniqueName);
    await expect(appPage.locator(`text=${uniqueName}`).first()).toBeVisible({
      timeout: 10_000,
    });

    await appPage.locator('button[title="Adjust stock"]').first().click();
    await expect(
      appPage.getByRole("heading", { name: "Adjust Stock" }),
    ).toBeVisible({ timeout: 5000 });

    await appPage.getByRole("button", { name: "Add / remove (+/-)" }).click();

    const reasonMarker = `E2E-077-delta-reason-${Date.now()}`;
    await appPage.getByPlaceholder("+10 or -5").fill("-7");
    await appPage.getByPlaceholder(REASON_PLACEHOLDER).fill(reasonMarker);
    await appPage.getByRole("button", { name: "Apply Adjustment" }).click();

    // Success closes the modal (onSuccess -> setAdjustingProduct(null)).
    await expect(
      appPage.getByRole("heading", { name: "Adjust Stock" }),
    ).not.toBeVisible({ timeout: 10_000 });

    expect(await readStock(appPage, productId)).toBe(13); // 20 - 7, delta not absolute

    const row = await findAdjustmentByReason(appPage, productId, reasonMarker);
    expect(row).not.toBeNull();
    expect(row!.delta).toBe(-7);
    expect(row!.old_quantity).toBe(20);
    expect(row!.new_quantity).toBe(13);
    expect(row!.product_id).toBe(productId);
  });

  test("absolute (set) adjustment: sets exact quantity + its own audit row", async ({
    appPage,
  }) => {
    const uniqueName = `E2E-077-Set-${Date.now()}`;
    const productId = await seedProduct(appPage, {
      name: uniqueName,
      cost_price: 2,
      sell_price: 5,
      quantity: 9,
    });

    await navigateTo(appPage, "/products");
    await appPage.getByPlaceholder(/search by name, barcode/i).fill(uniqueName);
    await expect(appPage.locator(`text=${uniqueName}`).first()).toBeVisible({
      timeout: 10_000,
    });

    await appPage.locator('button[title="Adjust stock"]').first().click();
    await expect(
      appPage.getByRole("heading", { name: "Adjust Stock" }),
    ).toBeVisible({ timeout: 5000 });

    // Set mode is the default toggle — no click needed.
    const reasonMarker = `E2E-077-set-reason-${Date.now()}`;
    await appPage.getByPlaceholder("0").fill("100");
    await appPage.getByPlaceholder(REASON_PLACEHOLDER).fill(reasonMarker);
    await appPage.getByRole("button", { name: "Apply Adjustment" }).click();

    await expect(
      appPage.getByRole("heading", { name: "Adjust Stock" }),
    ).not.toBeVisible({ timeout: 10_000 });

    expect(await readStock(appPage, productId)).toBe(100);

    const row = await findAdjustmentByReason(appPage, productId, reasonMarker);
    expect(row).not.toBeNull();
    expect(row!.delta).toBe(91); // 100 - 9
    expect(row!.old_quantity).toBe(9);
    expect(row!.new_quantity).toBe(100);
  });

  test("empty reason is rejected client-side: no stock change, no new audit row", async ({
    appPage,
  }) => {
    const uniqueName = `E2E-077-NoReason-${Date.now()}`;
    const productId = await seedProduct(appPage, {
      name: uniqueName,
      cost_price: 1,
      sell_price: 2,
      quantity: 4,
    });

    await navigateTo(appPage, "/products");
    await appPage.getByPlaceholder(/search by name, barcode/i).fill(uniqueName);
    await expect(appPage.locator(`text=${uniqueName}`).first()).toBeVisible({
      timeout: 10_000,
    });

    const rowsBefore = await appPage.evaluate(async (id) => {
      const w = window as unknown as Api;
      return (await w.api.inventory.getStockAdjustments(id)).length;
    }, productId);

    await appPage.locator('button[title="Adjust stock"]').first().click();
    await expect(
      appPage.getByRole("heading", { name: "Adjust Stock" }),
    ).toBeVisible({ timeout: 5000 });

    await appPage.getByPlaceholder("0").fill("50");
    // No reason filled in — submit must be rejected client-side.
    await appPage.getByRole("button", { name: "Apply Adjustment" }).click();

    await expect(appPage.getByText("Reason is required")).toBeVisible({
      timeout: 5000,
    });
    // Modal stays open — the submit never reached the API.
    await expect(
      appPage.getByRole("heading", { name: "Adjust Stock" }),
    ).toBeVisible();

    await appPage.getByRole("button", { name: "Cancel" }).click();

    expect(await readStock(appPage, productId)).toBe(4); // unchanged (delta = 0)

    const rowsAfter = await appPage.evaluate(async (id) => {
      const w = window as unknown as Api;
      return (await w.api.inventory.getStockAdjustments(id)).length;
    }, productId);
    expect(rowsAfter).toBe(rowsBefore); // no new row written
  });

  test("adjustment history renders in the modal (identity-matched, not position)", async ({
    appPage,
  }) => {
    const uniqueName = `E2E-077-History-${Date.now()}`;
    await seedProduct(appPage, {
      name: uniqueName,
      cost_price: 1,
      sell_price: 3,
      quantity: 15,
    });

    await navigateTo(appPage, "/products");
    await appPage.getByPlaceholder(/search by name, barcode/i).fill(uniqueName);
    await expect(appPage.locator(`text=${uniqueName}`).first()).toBeVisible({
      timeout: 10_000,
    });

    const reasonMarker = `E2E-077-history-reason-${Date.now()}`;
    await appPage.locator('button[title="Adjust stock"]').first().click();
    await appPage.getByRole("button", { name: "Add / remove (+/-)" }).click();
    await appPage.getByPlaceholder("+10 or -5").fill("5");
    await appPage.getByPlaceholder(REASON_PLACEHOLDER).fill(reasonMarker);
    await appPage.getByRole("button", { name: "Apply Adjustment" }).click();
    await expect(
      appPage.getByRole("heading", { name: "Adjust Stock" }),
    ).not.toBeVisible({ timeout: 10_000 });

    // Re-open — the history panel must show the row we just wrote, matched
    // by its unique reason text (never assumed to be "the first row").
    await appPage.locator('button[title="Adjust stock"]').first().click();
    await expect(
      appPage.getByRole("heading", { name: "Adjust Stock" }),
    ).toBeVisible({ timeout: 5000 });
    await expect(appPage.getByText(reasonMarker)).toBeVisible({
      timeout: 10_000,
    });
    await expect(appPage.getByText("+5 (15 → 20)")).toBeVisible();
  });
});
