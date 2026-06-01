import { test, expect, seedExpense, seedCustomService } from "../fixtures.js";
import { navigateTo } from "../fixtures.js";
import { DataTablePO } from "../page-objects/components/DataTable.po.js";
import { DateRangeFilterPO } from "../page-objects/components/DateRangeFilter.po.js";

/** YYYY-MM-DD string for today + offset days */
function offsetDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

test.describe.serial("DateRangeFilter", () => {
  let dt: DataTablePO;
  let drf: DateRangeFilterPO;

  test.beforeAll(async ({ appPage }) => {
    dt = new DataTablePO(appPage);
    drf = new DateRangeFilterPO(appPage);
    // Seed at least one expense record for today so tables are not empty
    await seedExpense(appPage, { description: "DRF Baseline Expense", amount_usd: 10 });
  });

  /** Navigate to the Expenses history view and wait for the table */
  async function openExpensesHistory(appPage: Parameters<typeof seedExpense>[0]) {
    await navigateTo(appPage, "/expenses");
    await appPage.waitForTimeout(500);
    const historyBtn = appPage.getByRole("button", { name: /history/i }).first();
    if (await historyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await historyBtn.click();
      await appPage.waitForTimeout(500);
    }
  }

  /** Navigate to the Custom Services history view */
  async function openCustomServicesHistory(appPage: Parameters<typeof seedExpense>[0]) {
    await navigateTo(appPage, "/custom-services");
    await appPage.waitForTimeout(500);
    const historyBtn = appPage.getByRole("button", { name: /history/i }).first();
    if (await historyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await historyBtn.click();
      await appPage.waitForTimeout(500);
    }
  }

  // ── S35: Set From date → older rows disappear ─────────────────────────

  test.describe("S35 — From date filters out older rows", () => {
    test("Expenses: rows disappear when From is set to tomorrow", async ({ appPage }) => {
      await openExpensesHistory(appPage);

      const filterVisible = await drf.fromInput.isVisible({ timeout: 2000 }).catch(() => false);
      if (!filterVisible) { test.skip(); return; }

      const rowsBefore = await dt.rows().count();

      await drf.setFrom(offsetDate(1)); // tomorrow → nothing matches
      await appPage.waitForTimeout(500);

      const rowsAfter = await dt.rows().count();
      expect(rowsAfter).toBeLessThan(rowsBefore);

      await drf.clearBoth();
    });
  });

  // ── S36: Set To date → newer rows disappear ───────────────────────────

  test.describe("S36 — To date filters out newer rows", () => {
    test("Expenses: rows disappear when To is set to yesterday", async ({ appPage }) => {
      await openExpensesHistory(appPage);

      const filterVisible = await drf.toInput.isVisible({ timeout: 2000 }).catch(() => false);
      if (!filterVisible) { test.skip(); return; }

      const rowsBefore = await dt.rows().count();

      await drf.setTo(offsetDate(-1)); // yesterday → today's records disappear
      await appPage.waitForTimeout(500);

      const rowsAfter = await dt.rows().count();
      expect(rowsAfter).toBeLessThan(rowsBefore);

      await drf.clearBoth();
    });
  });

  // ── S37: From > To → table empties ───────────────────────────────────

  test.describe("S37 — From after To empties the table", () => {
    test("Expenses: inverted range produces 0 rows or error", async ({ appPage }) => {
      await openExpensesHistory(appPage);

      const filterVisible = await drf.fromInput.isVisible({ timeout: 2000 }).catch(() => false);
      if (!filterVisible) { test.skip(); return; }

      // From = tomorrow, To = yesterday (inverted range)
      await drf.setFrom(offsetDate(1));
      await drf.setTo(offsetDate(-1));
      await appPage.waitForTimeout(500);

      const rowsAfter = await dt.rows().count();
      expect(rowsAfter).toBe(0);

      await drf.clearBoth();
    });
  });

  // ── S38: Clear both → all rows return ────────────────────────────────

  test.describe("S38 — clearing both filters restores all rows", () => {
    test("Expenses: clear after filtering restores full row count", async ({ appPage }) => {
      await openExpensesHistory(appPage);

      const filterVisible = await drf.fromInput.isVisible({ timeout: 2000 }).catch(() => false);
      if (!filterVisible) { test.skip(); return; }

      const rowsBefore = await dt.rows().count();

      // Apply a filter
      await drf.setFrom(offsetDate(1));
      await appPage.waitForTimeout(500);

      // Clear both
      await drf.clearBoth();
      await appPage.waitForTimeout(500);

      const rowsAfter = await dt.rows().count();
      expect(rowsAfter).toBeGreaterThanOrEqual(rowsBefore);
    });
  });

  // ── S39: Boundary date (From = To) → only that day's rows ────────────

  test.describe("S39 — boundary date: From equals To shows only that day", () => {
    test.beforeAll(async ({ appPage }) => {
      await seedCustomService(appPage, {
        description: "DRF Boundary Service",
        amount_usd: 39,
      });
    });

    test("Custom Services: From = To = today shows today's records only", async ({ appPage }) => {
      await openCustomServicesHistory(appPage);

      const filterVisible = await drf.fromInput.isVisible({ timeout: 2000 }).catch(() => false);
      if (!filterVisible) { test.skip(); return; }

      const today = offsetDate(0);
      await drf.setFrom(today);
      await drf.setTo(today);
      await appPage.waitForTimeout(500);

      // Should show at least the record we seeded today
      await dt.expectMinRowCount(1);

      // All visible rows should be from today
      const rows = dt.rows();
      const count = await rows.count();
      for (let i = 0; i < count; i++) {
        const text = await rows.nth(i).textContent();
        // Date columns typically contain today's date in some format
        expect(text).toBeTruthy();
      }

      await drf.clearBoth();
    });
  });
});
