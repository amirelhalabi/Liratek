/**
 * E2E: LIRA-073 — DataTable export with customizable columns
 *
 * Validates the shared DataTable column picker (DataTable.tsx):
 *   - The export bar exposes a "Columns" picker button next to the
 *     Excel / PDF export buttons whenever a table with rows is exporting.
 *   - Opening the picker reveals a checkbox list of the table's exportable
 *     columns (Actions / select-all checkbox columns excluded).
 *   - The default selection is Time / Summary / User (preselected/checked),
 *     while the other columns (Type, Client, Amount, Status, Reverses) start
 *     unchecked.
 *   - The picker drives BOTH export paths — Excel and PDF buttons remain
 *     present alongside it (no regression to existing export).
 *
 * Page under test: Audit → Transactions (/audit). To guarantee at least one
 * exporting row, an OMT App SEND transaction is created first (mirrors the
 * LIRA-063 flow), so the picker (hidden when rowCount === 0) is shown.
 *
 * Uses the shared Electron instance / fresh DB (same as the other specs).
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

const AMOUNT_USD = "30";

/** Default-checked headers per the ticket. */
const DEFAULT_COLUMNS = ["Time", "Summary", "User"] as const;
/** Headers that exist on the Transactions table but are NOT default-checked. */
const NON_DEFAULT_COLUMNS = [
  "Type",
  "Client",
  "Amount",
  "Status",
  "Reverses",
] as const;

test.describe("LIRA-073 — DataTable export customizable columns", () => {
  test("export column picker defaults to Time/Summary/User and toggles columns", async ({
    appPage,
  }) => {
    // ── Ensure the Transactions table has at least one exporting row ────────
    await createOmtAppSend(appPage);

    await navigateTo(appPage, "/audit");

    // Wait for the table to render at least one row (export bar is hidden when
    // rowCount === 0, which would also hide the column picker).
    await expect(appPage.locator("tbody tr").first()).toBeVisible({
      timeout: 10_000,
    });

    // ── The export bar still shows the Excel + PDF buttons (no regression) ──
    const excelBtn = appPage.getByRole("button", { name: /Excel/i });
    const pdfBtn = appPage.getByRole("button", { name: /PDF/i });
    await expect(excelBtn).toBeVisible({ timeout: 8_000 });
    await expect(pdfBtn).toBeVisible();

    // ── The new column picker button is present ─────────────────────────────
    const pickerBtn = appPage.getByTestId("export-column-picker-button");
    await expect(pickerBtn).toBeVisible();

    // Open the picker.
    await pickerBtn.click();
    const menu = appPage.getByTestId("export-column-picker-menu");
    await expect(menu).toBeVisible();

    // ── Default selection: Time / Summary / User are checked ────────────────
    for (const header of DEFAULT_COLUMNS) {
      const checkbox = menu
        .getByTestId(`export-column-option-${header}`)
        .locator('input[type="checkbox"]');
      await expect(checkbox).toBeChecked();
    }

    // ── The other exportable columns start unchecked ────────────────────────
    for (const header of NON_DEFAULT_COLUMNS) {
      const checkbox = menu
        .getByTestId(`export-column-option-${header}`)
        .locator('input[type="checkbox"]');
      await expect(checkbox).not.toBeChecked();
    }

    // The "Actions" column is excluded from the picker entirely.
    await expect(
      menu.getByTestId("export-column-option-Actions"),
    ).toHaveCount(0);

    // ── User can ADD a column before exporting ──────────────────────────────
    const amountCheckbox = menu
      .getByTestId("export-column-option-Amount")
      .locator('input[type="checkbox"]');
    await amountCheckbox.check();
    await expect(amountCheckbox).toBeChecked();

    // ── User can REMOVE a default column before exporting ───────────────────
    const userCheckbox = menu
      .getByTestId("export-column-option-User")
      .locator('input[type="checkbox"]');
    await userCheckbox.uncheck();
    await expect(userCheckbox).not.toBeChecked();

    // Export buttons remain available with the modified selection (both paths).
    await expect(excelBtn).toBeVisible();
    await expect(pdfBtn).toBeVisible();
  });
});

/**
 * Creates an OMT App SEND transaction (no client) so the Transactions table
 * has a row to export. Mirrors the LIRA-063 happy path.
 */
async function createOmtAppSend(appPage: Page): Promise<void> {
  await navigateTo(appPage, "/recharge");

  const omtAppTab = appPage
    .locator("button")
    .filter({ hasText: /^OMT App$/ })
    .first();
  await expect(omtAppTab).toBeVisible({ timeout: 8_000 });
  await omtAppTab.click({ force: true });

  const amountInput = appPage.locator("#transfer-amount");
  await expect(amountInput).toBeVisible({ timeout: 8_000 });
  await amountInput.fill(AMOUNT_USD);

  const proceedBtn = appPage.getByRole("button", { name: /Proceed to Pay/i });
  await expect(proceedBtn).toBeEnabled({ timeout: 5_000 });
  await proceedBtn.click();

  const confirmBtn = appPage
    .locator("button")
    .filter({ hasText: /^Pay / })
    .last();
  await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
  await confirmBtn.click();
  await expect(confirmBtn).toBeHidden({ timeout: 8_000 });
}
