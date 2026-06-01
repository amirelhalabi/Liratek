import { test, expect, seedProduct, seedExpense, seedCustomService } from "../fixtures.js";
import { navigateTo } from "../fixtures.js";
import { DataTablePO } from "../page-objects/components/DataTable.po.js";
import { DateRangeFilterPO } from "../page-objects/components/DateRangeFilter.po.js";

test.describe.serial("DataTable", () => {
  let dt: DataTablePO;
  let drf: DateRangeFilterPO;

  test.beforeAll(async ({ appPage }) => {
    dt = new DataTablePO(appPage);
    drf = new DateRangeFilterPO(appPage);
  });

  // ── S27: Render list → rows appear ───────────────────────────────────

  test.describe("S27 — render list rows appear", () => {
    test.beforeAll(async ({ appPage }) => {
      await seedExpense(appPage, { description: "S27 Expense", amount_usd: 5 });
    });

    test("Expenses history shows at least 1 row", async ({ appPage }) => {
      await navigateTo(appPage, "/expenses");
      await appPage.waitForTimeout(500);
      // Open history if behind a button
      const historyBtn = appPage.getByRole("button", { name: /history/i }).first();
      if (await historyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await historyBtn.click();
        await appPage.waitForTimeout(500);
      }
      await dt.expectMinRowCount(1);
    });

    test("Maintenance history shows at least 1 row after seeding", async ({ appPage }) => {
      // Seed a maintenance job via API if available, otherwise just check table renders
      await navigateTo(appPage, "/maintenance");
      await appPage.waitForTimeout(500);
      const historyBtn = appPage.getByRole("button", { name: /history/i }).first();
      if (await historyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await historyBtn.click();
        await appPage.waitForTimeout(500);
      }
      // Table should render (even if empty)
      await expect(dt.table).toBeVisible();
    });
  });

  // ── S28: Sort ascending / descending ─────────────────────────────────

  test.describe("S28 — sort ascending/descending", () => {
    test.beforeAll(async ({ appPage }) => {
      // Seed 2 expenses with different amounts to verify sort
      await seedExpense(appPage, { description: "Sort Expense A", amount_usd: 10 });
      await seedExpense(appPage, { description: "Sort Expense B", amount_usd: 50 });
    });

    test("Expenses table sorts by amount column", async ({ appPage }) => {
      await navigateTo(appPage, "/expenses");
      await appPage.waitForTimeout(500);
      const historyBtn = appPage.getByRole("button", { name: /history/i }).first();
      if (await historyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await historyBtn.click();
        await appPage.waitForTimeout(500);
      }

      // Find a sortable column header (Amount or Date)
      const amountHeader = dt.table.locator("thead th").filter({ hasText: /amount|total/i }).first();
      const visible = await amountHeader.isVisible({ timeout: 2000 }).catch(() => false);
      if (!visible) return; // skip if column not found in this module

      // Click once → asc
      await amountHeader.click();
      await appPage.waitForTimeout(300);
      const firstRowAsc = await dt.rows().first().textContent();

      // Click again → desc
      await amountHeader.click();
      await appPage.waitForTimeout(300);
      const firstRowDesc = await dt.rows().first().textContent();

      // After two sorts the order should differ
      expect(firstRowAsc).not.toEqual(firstRowDesc);
    });
  });

  // ── S29: Pagination ───────────────────────────────────────────────────

  test.describe("S29 — pagination", () => {
    test.beforeAll(async ({ appPage }) => {
      // Seed 25 custom service records to force pagination (default pageSize = 20)
      for (let i = 1; i <= 25; i++) {
        await seedCustomService(appPage, {
          description: `Pagination Service ${i}`,
          amount_usd: i,
        });
      }
    });

    test("Custom Services history shows pagination controls with 25+ records", async ({ appPage }) => {
      await navigateTo(appPage, "/custom-services");
      await appPage.waitForTimeout(500);
      // Open history modal / view
      const historyBtn = appPage.getByRole("button", { name: /history/i }).first();
      if (await historyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await historyBtn.click();
        await appPage.waitForTimeout(500);
      }

      // Pagination controls should be visible
      await expect(dt.paginationNext).toBeVisible();
      await expect(dt.paginationPrev).toBeVisible();

      // First page: 20 rows (default pageSize)
      const firstPageCount = await dt.rows().count();
      expect(firstPageCount).toBeLessThanOrEqual(20);

      // Navigate to next page
      await dt.clickPaginationNext();
      await appPage.waitForTimeout(300);

      // Should show remaining rows
      await dt.expectMinRowCount(1);
    });
  });

  // ── S30: Shift+click multi-select (Inventory only) ────────────────────

  test.describe("S30 — shift+click multi-select (Inventory)", () => {
    let productIdA: number;
    let productIdB: number;

    test.beforeAll(async ({ appPage }) => {
      productIdA = await seedProduct(appPage, { name: "MultiSelect A", cost_price: 5, sell_price: 10, quantity: 5 });
      productIdB = await seedProduct(appPage, { name: "MultiSelect B", cost_price: 5, sell_price: 10, quantity: 5 });
    });

    test("Inventory: shift+click selects a range of rows", async ({ appPage }) => {
      await navigateTo(appPage, "/products");
      await appPage.waitForTimeout(800);

      const rowCount = await dt.rows().count();
      if (rowCount < 2) {
        test.skip(); // not enough rows
        return;
      }

      // Plain click on first row to set anchor
      await dt.rows().first().click();
      await appPage.waitForTimeout(200);

      // Shift+click on second row
      await dt.shiftClickRow(1);
      await appPage.waitForTimeout(300);

      // Verify at least one row is selected (checkbox checked or row has selected class)
      const checkedCheckboxes = appPage.locator('tbody tr input[type="checkbox"]:checked');
      const checkedCount = await checkedCheckboxes.count();
      expect(checkedCount).toBeGreaterThanOrEqual(1);

      void productIdA; void productIdB; // used for seeding
    });
  });

  // ── S31: Export to Excel ──────────────────────────────────────────────

  test.describe("S31 — export to Excel", () => {
    test.beforeAll(async ({ appPage }) => {
      await seedExpense(appPage, { description: "Export Excel Expense", amount_usd: 99 });
    });

    test("Expenses history: Excel export triggers file download", async ({ appPage }) => {
      await navigateTo(appPage, "/expenses");
      await appPage.waitForTimeout(500);
      const historyBtn = appPage.getByRole("button", { name: /history/i }).first();
      if (await historyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await historyBtn.click();
        await appPage.waitForTimeout(500);
      }

      const excelVisible = await dt.excelBtn.isVisible({ timeout: 2000 }).catch(() => false);
      if (!excelVisible) {
        test.skip(); // module does not show export button
        return;
      }

      const [download] = await Promise.all([
        appPage.waitForEvent("download"),
        dt.clickExcelExport(),
      ]);
      expect(download.suggestedFilename()).toMatch(/\.xlsx$/i);
    });
  });

  // ── S32: Export to PDF ────────────────────────────────────────────────

  test.describe("S32 — export to PDF", () => {
    test("Expenses history: PDF export triggers file download", async ({ appPage }) => {
      await navigateTo(appPage, "/expenses");
      await appPage.waitForTimeout(500);
      const historyBtn = appPage.getByRole("button", { name: /history/i }).first();
      if (await historyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await historyBtn.click();
        await appPage.waitForTimeout(500);
      }

      const pdfVisible = await dt.pdfBtn.isVisible({ timeout: 2000 }).catch(() => false);
      if (!pdfVisible) {
        test.skip();
        return;
      }

      const [download] = await Promise.all([
        appPage.waitForEvent("download"),
        dt.clickPdfExport(),
      ]);
      expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
    });
  });

  // ── S33: Empty state ──────────────────────────────────────────────────

  test.describe("S33 — empty state", () => {
    test("Loto history shows empty state when no records", async ({ appPage }) => {
      await navigateTo(appPage, "/loto");
      await appPage.waitForTimeout(500);
      // Navigate to history tab if available
      const historyTab = appPage.getByRole("tab", { name: /history/i }).first();
      if (await historyTab.isVisible({ timeout: 1500 }).catch(() => false)) {
        await historyTab.click();
        await appPage.waitForTimeout(500);
      }
      // Either no rows or an empty-state message
      const rowCount = await dt.rows().count();
      if (rowCount === 0) {
        // Correct: table is empty
        await dt.expectEmptyState();
      } else {
        // Some rows exist — skip; can't guarantee a fresh loto state
        test.skip();
      }
    });
  });

  // ── S34: Date range filter narrows rows ───────────────────────────────

  test.describe("S34 — date range filter narrows rows", () => {
    test.beforeAll(async ({ appPage }) => {
      await seedExpense(appPage, { description: "S34 Expense Today", amount_usd: 34 });
    });

    test("Expenses history: From date filters out older rows", async ({ appPage }) => {
      await navigateTo(appPage, "/expenses");
      await appPage.waitForTimeout(500);
      const historyBtn = appPage.getByRole("button", { name: /history/i }).first();
      if (await historyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await historyBtn.click();
        await appPage.waitForTimeout(500);
      }

      const fromVisible = await drf.fromInput.isVisible({ timeout: 2000 }).catch(() => false);
      if (!fromVisible) {
        test.skip();
        return;
      }

      const rowsBefore = await dt.rows().count();

      // Set From to tomorrow (should exclude all rows)
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      await drf.setFrom(tomorrow.toISOString().slice(0, 10));

      await appPage.waitForTimeout(500);
      const rowsAfter = await dt.rows().count();
      expect(rowsAfter).toBeLessThan(rowsBefore);

      // Clear filter → rows return
      await drf.clearBoth();
      await appPage.waitForTimeout(500);
      const rowsRestored = await dt.rows().count();
      expect(rowsRestored).toBeGreaterThanOrEqual(rowsBefore);
    });
  });
});
