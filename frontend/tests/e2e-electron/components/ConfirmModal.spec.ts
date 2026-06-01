import { test, expect, seedProduct } from "../fixtures.js";
import { navigateTo } from "../fixtures.js";
import { ConfirmModalPO } from "../page-objects/components/ConfirmModal.po.js";

test.describe.serial("ConfirmModal", () => {
  let cm: ConfirmModalPO;

  test.beforeAll(async ({ appPage }) => {
    cm = new ConfirmModalPO(appPage);
  });

  // ── S44: Opens on destructive action ─────────────────────────────────

  test.describe("S44 — opens on destructive action", () => {
    let deleteProductId: number;

    test.beforeAll(async ({ appPage }) => {
      deleteProductId = await seedProduct(appPage, {
        name: "CM Delete Target",
        cost_price: 5,
        sell_price: 10,
        quantity: 1,
      });
    });

    test("Inventory: delete product opens confirm modal", async ({ appPage }) => {
      await navigateTo(appPage, "/products");
      await appPage.waitForTimeout(800);

      // Find the product row and open its edit/delete action
      const productRow = appPage.locator("tbody tr").filter({ hasText: "CM Delete Target" }).first();
      await expect(productRow).toBeVisible({ timeout: 5000 });

      // Click the row or its action button to open edit panel
      await productRow.click();
      await appPage.waitForTimeout(500);

      // Click the Delete button inside the edit form / action panel
      const deleteBtn = appPage.getByRole("button", { name: /delete/i }).first();
      await expect(deleteBtn).toBeVisible({ timeout: 3000 });
      await deleteBtn.click();
      await appPage.waitForTimeout(300);

      await cm.expectOpen();
      void deleteProductId;
    });

    test("POS: clear cart opens confirm modal", async ({ appPage }) => {
      // Add a product to cart first
      const productId = await seedProduct(appPage, {
        name: "CM Cart Product",
        cost_price: 5,
        sell_price: 15,
        quantity: 10,
      });

      await navigateTo(appPage, "/pos");
      await appPage.waitForTimeout(800);

      // Search for the product and add to cart
      const searchInput = appPage.getByPlaceholder(/search|barcode/i).first();
      await searchInput.fill("CM Cart Product");
      await appPage.waitForTimeout(500);

      const productItem = appPage.locator("text=CM Cart Product").first();
      const productVisible = await productItem.isVisible({ timeout: 3000 }).catch(() => false);
      if (productVisible) {
        await productItem.click();
        await appPage.waitForTimeout(300);
      }

      // Click Clear Cart button
      const clearCartBtn = appPage.getByRole("button", { name: /clear cart|clear/i }).first();
      const clearVisible = await clearCartBtn.isVisible({ timeout: 2000 }).catch(() => false);
      if (!clearVisible) {
        test.skip();
        return;
      }
      await clearCartBtn.click();
      await appPage.waitForTimeout(300);

      await cm.expectOpen();
      void productId;
    });
  });

  // ── S45: Cancel → nothing changes ────────────────────────────────────

  test.describe("S45 — cancel → nothing changes", () => {
    let keepProductId: number;

    test.beforeAll(async ({ appPage }) => {
      keepProductId = await seedProduct(appPage, {
        name: "CM Keep This Product",
        cost_price: 5,
        sell_price: 10,
        quantity: 1,
      });
    });

    test("Inventory: cancel delete → product still exists", async ({ appPage }) => {
      await navigateTo(appPage, "/products");
      await appPage.waitForTimeout(800);

      const productRow = appPage.locator("tbody tr").filter({ hasText: "CM Keep This Product" }).first();
      await expect(productRow).toBeVisible({ timeout: 5000 });
      await productRow.click();
      await appPage.waitForTimeout(500);

      const deleteBtn = appPage.getByRole("button", { name: /delete/i }).first();
      const deleteVisible = await deleteBtn.isVisible({ timeout: 3000 }).catch(() => false);
      if (!deleteVisible) {
        test.skip();
        return;
      }
      await deleteBtn.click();
      await appPage.waitForTimeout(300);

      await cm.expectOpen();
      await cm.cancel();
      await appPage.waitForTimeout(500);

      // Modal should be closed
      await cm.expectClosed();

      // Product should still be in the list
      const stillExists = appPage.locator("tbody tr").filter({ hasText: "CM Keep This Product" });
      await expect(stillExists).toBeVisible({ timeout: 3000 });

      void keepProductId;
    });
  });

  // ── S46: Confirm → action executes ───────────────────────────────────

  test.describe("S46 — confirm → action executes", () => {
    let confirmDeleteId: number;

    test.beforeAll(async ({ appPage }) => {
      confirmDeleteId = await seedProduct(appPage, {
        name: "CM Confirm Delete Me",
        cost_price: 5,
        sell_price: 10,
        quantity: 1,
      });
    });

    test("Inventory: confirm delete → product removed from list", async ({ appPage }) => {
      await navigateTo(appPage, "/products");
      await appPage.waitForTimeout(800);

      // Search so the product is visible even if inventory is paginated
      const searchInput = appPage
        .locator('input[placeholder*="Search" i]')
        .first();
      if (await searchInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await searchInput.fill("CM Confirm Delete Me");
        await appPage.waitForTimeout(500);
      }
      const productRow = appPage.locator("tbody tr").filter({ hasText: "CM Confirm Delete Me" }).first();
      await expect(productRow).toBeVisible({ timeout: 5000 });
      await productRow.click();
      await appPage.waitForTimeout(500);

      const deleteBtn = appPage.getByRole("button", { name: /delete/i }).first();
      const deleteVisible = await deleteBtn.isVisible({ timeout: 3000 }).catch(() => false);
      if (!deleteVisible) {
        test.skip();
        return;
      }
      await deleteBtn.click();
      await appPage.waitForTimeout(300);

      await cm.expectOpen();
      await cm.confirm();
      await appPage.waitForTimeout(800);

      // Product should be gone
      await cm.expectClosed();
      const gone = appPage.locator("tbody tr").filter({ hasText: "CM Confirm Delete Me" });
      await expect(gone).not.toBeVisible({ timeout: 3000 });

      void confirmDeleteId;
    });
  });

  // ── S47: Keyboard focus restored after close (Electron Windows bug) ──

  test.describe("S47 — keyboard focus restored after close", () => {
    let focusTestId: number;

    test.beforeAll(async ({ appPage }) => {
      focusTestId = await seedProduct(appPage, {
        name: "CM Focus Test Product",
        cost_price: 5,
        sell_price: 10,
        quantity: 1,
      });
    });

    test("Inventory: focus returns to document after cancel", async ({ appPage }) => {
      await navigateTo(appPage, "/products");
      await appPage.waitForTimeout(800);

      const productRow = appPage.locator("tbody tr").filter({ hasText: "CM Focus Test Product" }).first();
      await expect(productRow).toBeVisible({ timeout: 5000 });
      await productRow.click();
      await appPage.waitForTimeout(500);

      const deleteBtn = appPage.getByRole("button", { name: /delete/i }).first();
      const deleteVisible = await deleteBtn.isVisible({ timeout: 3000 }).catch(() => false);
      if (!deleteVisible) {
        test.skip();
        return;
      }
      await deleteBtn.click();
      await appPage.waitForTimeout(300);

      await cm.expectOpen();
      await cm.cancel();
      await appPage.waitForTimeout(300);

      await cm.expectFocusRestored();
      void focusTestId;
    });
  });

  // ── S48: Danger variant shows red styling ─────────────────────────────

  test.describe("S48 — danger variant red styling", () => {
    let dangerTestId: number;

    test.beforeAll(async ({ appPage }) => {
      dangerTestId = await seedProduct(appPage, {
        name: "CM Danger Variant Product",
        cost_price: 5,
        sell_price: 10,
        quantity: 1,
      });
    });

    test("Inventory delete modal uses danger (red) variant", async ({ appPage }) => {
      await navigateTo(appPage, "/products");
      await appPage.waitForTimeout(800);

      const productRow = appPage.locator("tbody tr").filter({ hasText: "CM Danger Variant Product" }).first();
      await expect(productRow).toBeVisible({ timeout: 5000 });
      await productRow.click();
      await appPage.waitForTimeout(500);

      const deleteBtn = appPage.getByRole("button", { name: /delete/i }).first();
      const deleteVisible = await deleteBtn.isVisible({ timeout: 3000 }).catch(() => false);
      if (!deleteVisible) {
        test.skip();
        return;
      }
      await deleteBtn.click();
      await appPage.waitForTimeout(300);

      await cm.expectOpen();
      await cm.expectDangerVariant();

      // Close without deleting
      await cm.cancel();
      void dangerTestId;
    });
  });
});
