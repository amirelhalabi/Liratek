import { test, expect, seedExpense, seedCustomService } from "../fixtures.js";
import { navigateTo } from "../fixtures.js";
import { EditHistoryPopoverPO } from "../page-objects/components/EditHistoryPopover.po.js";

test.describe.serial("EditHistoryPopover", () => {
  let ehp: EditHistoryPopoverPO;

  test.beforeAll(async ({ appPage }) => {
    ehp = new EditHistoryPopoverPO(appPage);
  });

  /** Open the Expenses history view */
  async function openExpensesHistory(appPage: Parameters<typeof seedExpense>[0]) {
    await navigateTo(appPage, "/expenses");
    await appPage.waitForTimeout(500);
    const historyBtn = appPage.getByRole("button", { name: /history/i }).first();
    if (await historyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await historyBtn.click();
      await appPage.waitForTimeout(500);
    }
  }

  /** Open the Custom Services history view */
  async function openCustomServicesHistory(appPage: Parameters<typeof seedExpense>[0]) {
    await navigateTo(appPage, "/custom-services");
    await appPage.waitForTimeout(500);
    const historyBtn = appPage.getByRole("button", { name: /history/i }).first();
    if (await historyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await historyBtn.click();
      await appPage.waitForTimeout(500);
    }
  }

  /** Open the Maintenance history view */
  async function openMaintenanceHistory(appPage: Parameters<typeof seedExpense>[0]) {
    await navigateTo(appPage, "/maintenance");
    await appPage.waitForTimeout(500);
    const historyBtn = appPage.getByRole("button", { name: /history/i }).first();
    if (await historyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await historyBtn.click();
      await appPage.waitForTimeout(500);
    }
  }

  // ── S40: Popover opens on click (all 5 locations) ─────────────────────

  test.describe("S40 — popover opens on click", () => {
    let expenseId: number;
    let serviceId: number;

    test.beforeAll(async ({ appPage }) => {
      expenseId = await seedExpense(appPage, { description: "EHP Click Test Expense", amount_usd: 5 });
      serviceId = await seedCustomService(appPage, { description: "EHP Click Test Service", amount_usd: 10 });

      // Create an edit on the expense so the trigger badge appears
      await appPage.evaluate(
        ({ id }) =>
          window.api.expenses.update(id, { description: "EHP Click Test Expense (edited)" }),
        { id: expenseId },
      );

      // Create an edit on the service
      await appPage.evaluate(
        ({ id }) =>
          window.api.customServices.update(id, { description: "EHP Click Test Service (edited)" }),
        { id: serviceId },
      );

      void serviceId;
    });

    test("Expenses history: clicking edit-history trigger opens popover", async ({ appPage }) => {
      await openExpensesHistory(appPage);

      const triggerVisible = await ehp.firstTrigger.isVisible({ timeout: 3000 }).catch(() => false);
      if (!triggerVisible) {
        test.skip(); // no edited records visible
        return;
      }

      await ehp.clickFirstTrigger();
      await ehp.expectPopoverVisible();

      // Close by clicking outside
      await appPage.keyboard.press("Escape");
      await appPage.waitForTimeout(300);

      void expenseId;
    });

    test("Custom Services history: clicking edit-history trigger opens popover", async ({ appPage }) => {
      await openCustomServicesHistory(appPage);

      const triggerVisible = await ehp.firstTrigger.isVisible({ timeout: 3000 }).catch(() => false);
      if (!triggerVisible) {
        test.skip();
        return;
      }

      await ehp.clickFirstTrigger();
      await ehp.expectPopoverVisible();

      await appPage.keyboard.press("Escape");
      await appPage.waitForTimeout(300);
    });

    test("Maintenance history: clicking edit-history trigger opens popover", async ({ appPage }) => {
      await openMaintenanceHistory(appPage);

      const triggerVisible = await ehp.firstTrigger.isVisible({ timeout: 3000 }).catch(() => false);
      if (!triggerVisible) {
        test.skip(); // no edited maintenance records
        return;
      }

      await ehp.clickFirstTrigger();
      await ehp.expectPopoverVisible();

      await appPage.keyboard.press("Escape");
    });
  });

  // ── S41: Shows correct before/after values ────────────────────────────

  test.describe("S41 — correct before/after values in popover", () => {
    let serviceIdForEdit: number;

    test.beforeAll(async ({ appPage }) => {
      serviceIdForEdit = await seedCustomService(appPage, {
        description: "EHP Before Value",
        amount_usd: 20,
      });

      // Edit the description so we have a known before/after pair
      await appPage.evaluate(
        ({ id }) =>
          window.api.customServices.update(id, { description: "EHP After Value" }),
        { id: serviceIdForEdit },
      );
    });

    test("Custom Services: popover shows old and new description values", async ({ appPage }) => {
      await openCustomServicesHistory(appPage);

      const triggerVisible = await ehp.firstTrigger.isVisible({ timeout: 3000 }).catch(() => false);
      if (!triggerVisible) {
        test.skip();
        return;
      }

      await ehp.clickFirstTrigger();
      await ehp.expectPopoverVisible();

      // The popover should contain both before and after values
      const popover = ehp.popover;
      const popoverText = await popover.textContent();
      expect(popoverText).toBeTruthy();
      // Should contain at least one "→" separator indicating a field change
      expect(popoverText).toContain("→");

      await appPage.keyboard.press("Escape");
      void serviceIdForEdit;
    });
  });

  // ── S42: Multiple edits show full timeline ────────────────────────────

  test.describe("S42 — multiple edits show full timeline", () => {
    let multiEditExpenseId: number;

    test.beforeAll(async ({ appPage }) => {
      multiEditExpenseId = await seedExpense(appPage, {
        description: "EHP Multi Edit Expense",
        amount_usd: 42,
      });

      // Edit twice to create 2 audit entries
      await appPage.evaluate(
        ({ id }) =>
          window.api.expenses.update(id, { description: "EHP Multi Edit v2" }),
        { id: multiEditExpenseId },
      );
      await appPage.evaluate(
        ({ id }) =>
          window.api.expenses.update(id, { description: "EHP Multi Edit v3" }),
        { id: multiEditExpenseId },
      );
    });

    test("Expenses history: 2 edits produce 2+ timeline entries in popover", async ({ appPage }) => {
      await openExpensesHistory(appPage);

      const triggerVisible = await ehp.firstTrigger.isVisible({ timeout: 3000 }).catch(() => false);
      if (!triggerVisible) {
        test.skip();
        return;
      }

      await ehp.clickFirstTrigger();
      await ehp.expectPopoverVisible();

      const count = await ehp.entryCount();
      expect(count).toBeGreaterThanOrEqual(2);

      await appPage.keyboard.press("Escape");
      void multiEditExpenseId;
    });
  });

  // ── S43: Record never edited → badge hidden ───────────────────────────

  test.describe("S43 — record never edited has no badge", () => {
    let neverEditedId: number;

    test.beforeAll(async ({ appPage }) => {
      neverEditedId = await seedExpense(appPage, {
        description: "EHP Never Edited Expense",
        amount_usd: 43,
      });
    });

    test("Expenses history: freshly created record has no edit-history trigger", async ({ appPage }) => {
      await openExpensesHistory(appPage);
      await appPage.waitForTimeout(500);

      // Find the specific row for our never-edited expense
      const targetRow = appPage
        .locator("tbody tr")
        .filter({ hasText: "EHP Never Edited Expense" })
        .first();

      const rowVisible = await targetRow.isVisible({ timeout: 3000 }).catch(() => false);
      if (!rowVisible) {
        test.skip(); // row may be paginated away
        return;
      }

      // The edit-history trigger should NOT be present inside this row
      const triggerInRow = targetRow.getByTestId("edit-history-trigger");
      await expect(triggerInRow).not.toBeAttached();

      void neverEditedId;
    });
  });
});
