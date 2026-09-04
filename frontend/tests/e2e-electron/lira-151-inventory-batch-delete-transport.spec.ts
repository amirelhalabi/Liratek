/**
 * E2E: LIRA-149 — inventory batch-delete over the shared `useApi()` adapter
 * (dual-transport, rule 19). Desktop (IPC) half of the dual-transport pair;
 * the REST/browser half — where the ticket's actual bug lived — is the twin
 * `lira-web-028-inventory-batch-delete-transport.spec.ts`.
 *
 * Two bugs this ticket closed (see backend/src/api/inventory.ts and
 * frontend/src/features/inventory/pages/Inventory/ProductList.tsx for the
 * full story):
 *
 *  (a) `ProductList.tsx`'s `handleBatchDelete` used to gate on raw
 *      `window.api` truthiness instead of the dual-mode `useApi()` adapter —
 *      harmless in Electron (`window.api` is always truthy here), but a
 *      false-success no-op in the browser (REST twin covers that half).
 *      This file proves the ELECTRON path still genuinely deletes via the
 *      real UI (checkbox selection → "Delete (N)" → confirm), not that the
 *      old bug reproduces here (it structurally can't — see the web twin).
 *  (b) `inventory:batch-delete` had NO Zod validation at all before this
 *      ticket. Not driven from the UI (the UI never sends a malformed
 *      payload), so that half is covered by the backend/core unit level,
 *      not here.
 *
 * Rule 15 (ONE accumulating DB, specs run in order): seeds two products with
 * a `Date.now()`-stamped name unique to this file, matches rows by that name
 * (never position/recency), and asserts the delta this action itself
 * produces (both products' `getProduct` reads flip from "exists" to `null`),
 * never an absolute product count.
 *
 * Rule 17 (failing-first procedure for the verifier): in
 * `frontend/src/features/inventory/pages/Inventory/ProductList.tsx`,
 * temporarily revert `handleBatchDelete` to gate on raw `window.api` instead
 * of `api.batchDeleteProducts(ids)` — the pre-fix form, preserved verbatim in
 * this ticket's report. In Electron `window.api` is truthy, so the request
 * still reaches `inventory:batch-delete` and both products are still deleted
 * — this spec's assertions still pass, because Electron was never the
 * broken half. The failing-first proof for THIS bug lives in the frontend
 * jest guard (`ProductList.deleteConfirm.test.tsx`'s "LIRA-149" describe
 * block, which runs in jsdom with no `window.api` and DOES fail pre-fix —
 * see the ticket report for the captured output) and in the web e2e twin.
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

const RUN = Date.now();
const NAME_A = `LIRA149 BatchDel A ${RUN}`;
const NAME_B = `LIRA149 BatchDel B ${RUN}`;
/** Free-text term that matches both seeds and nothing else in the suite. */
const SEARCH_SCOPE = `LIRA149 BatchDel`;

type CreateResult = { success: boolean; id?: number; error?: string };

async function createProduct(appPage: Page, name: string): Promise<number> {
  const created = await appPage.evaluate(
    (n) =>
      window.api.inventory.createProduct({
        barcode: "",
        name: n,
        category: "LIRA149Cat",
        cost_price: 5,
        retail_price: 10,
        stock_quantity: 1,
        min_stock_level: 0,
      }) as Promise<CreateResult>,
    name,
  );
  if (!created.success || created.id == null) {
    throw new Error(
      `lira-151 seed "${name}" failed: ${created.error ?? "no id returned"}`,
    );
  }
  return created.id;
}

/** One table row, matched by a product NAME unique to this file (rule 15). */
function productRow(appPage: Page, name: string) {
  return appPage.locator("tbody tr").filter({ hasText: name });
}

test.describe("Inventory batch delete — desktop (IPC) transport (LIRA-149)", () => {
  test("selecting two products and confirming Batch Delete removes both via the real toolbar", async ({
    appPage,
  }) => {
    const idA = await createProduct(appPage, NAME_A);
    const idB = await createProduct(appPage, NAME_B);

    // Sanity: both reads resolve BEFORE the delete (the delta this test
    // proves is these two flipping to null, not an absolute product count).
    const before = await appPage.evaluate(
      async (ids) => {
        const results = await Promise.all(
          ids.map((id) => window.api.inventory.getProduct(id)),
        );
        return results.map((r) => r != null);
      },
      [idA, idB],
    );
    expect(before).toEqual([true, true]);

    await navigateTo(appPage, "/products");
    await appPage.getByPlaceholder(/search by name, barcode/i).fill(SEARCH_SCOPE);

    const rowA = productRow(appPage, NAME_A);
    const rowB = productRow(appPage, NAME_B);
    await expect(rowA).toHaveCount(1);
    await expect(rowB).toHaveCount(1);

    // Select both rows via their own checkbox — identity-scoped locators,
    // never a bare `tbody tr` index (rule 15).
    await rowA.locator('input[type="checkbox"]').check();
    await rowB.locator('input[type="checkbox"]').check();

    await appPage.getByTestId("inventory-batch-delete").click();
    await expect(appPage.getByTestId("confirm-modal")).toBeVisible();
    // The unit-check runs before the button reads "Confirm" (LIRA-143 item
    // #7's IN_STOCK-IMEI disclosure) — wait it out.
    await expect(
      appPage.getByTestId("confirm-modal-confirm-btn"),
    ).toHaveText("Confirm");
    await appPage.getByTestId("confirm-modal-confirm-btn").click();

    // The notification must report the count the backend actually deleted —
    // exactly 2 here, matched by the plural wording, not a hardcoded string
    // in case the shared DB already carries other selectable rows (it never
    // does for THIS file's own unique ids, but the wording is what the
    // ticket's bug (a) got wrong, so pin it precisely).
    await expect(
      appPage.locator('[role="alert"]', { hasText: /2 products deleted/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    await expect(rowA).toHaveCount(0);
    await expect(rowB).toHaveCount(0);

    // Repository-level proof (rule 15 — identity, not position): both ids
    // are genuinely gone (soft-deleted — ProductRepository's read queries
    // filter `is_active = 1 AND is_deleted = 0`), not merely hidden by the
    // still-active search filter.
    const after = await appPage.evaluate(
      async (ids) => {
        const results = await Promise.all(
          ids.map((id) => window.api.inventory.getProduct(id)),
        );
        return results.map((r) => r != null);
      },
      [idA, idB],
    );
    expect(after).toEqual([false, false]);
  });
});
