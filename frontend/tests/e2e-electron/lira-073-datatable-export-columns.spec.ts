/**
 * E2E: LIRA-073 — DataTable export on the Transactions page
 *
 * Originally validated the shared DataTable column picker on Audit →
 * Transactions. Since the Transactions export became a designed export
 * TEMPLATE (owner decision 2026-10-16 — Summary / Transactions / Payments /
 * Details sheets and a PDF report), that table no longer offers the picker:
 * the template, not the picker, chooses the columns. The picker itself
 * (defaults, add / remove a column, Actions excluded) is still the default
 * for every other exporting table and is covered by the jest suites
 * `DataTable.test.tsx` / `DataTable.templateLessExport.test.tsx`.
 *
 * This spec now checks that the Transactions export bar keeps its Excel /
 * PDF buttons and shows no column picker. Updated without being run (no
 * desktop e2e on the machine it was edited on) — unverified.
 *
 * Page under test: Audit → Transactions (/audit). To guarantee at least one
 * exporting row, an OMT App SEND transaction is created first (mirrors the
 * LIRA-063 flow), since the export bar is hidden when rowCount === 0.
 *
 * Uses the shared Electron instance / fresh DB (same as the other specs).
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

const AMOUNT_USD = "30";

test.describe("LIRA-073 — DataTable export customizable columns", () => {
  test("Transactions export: Excel + PDF buttons, no column picker (template)", async ({
    appPage,
  }) => {
    // ── Ensure the Transactions table has at least one exporting row ────────
    await createOmtAppSend(appPage);

    // Bounce through "/" first (README "Assertion discipline" / LIRA-111) —
    // a viewer already parked on /audit from an earlier spec does not
    // remount on a same-route hash nav, so the table can show a stale list.
    await navigateTo(appPage, "/");
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

    // ── The export template picks its own columns: no picker ────────────────
    await expect(
      appPage.getByTestId("export-column-picker-button"),
    ).toHaveCount(0);
  });
});

/**
 * Creates an OMT App SEND transaction (no client) so the Transactions table
 * has a row to export. Mirrors the LIRA-063 happy path.
 */
async function createOmtAppSend(appPage: Page): Promise<void> {
  await navigateTo(appPage, "/recharge");

  const omtAppTab = appPage
    .getByRole("button", { name: "OMT App", exact: true })
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
