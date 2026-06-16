/**
 * E2E: Full Application Flow Tests
 *
 * Single file ensures correct execution order.
 * Setup runs once via shared fixture, then all tests use the same session.
 *
 * Order:
 * 1. Smoke tests (page loads)
 * 2. Inventory: create product (needed by POS)
 * 3. Clients: create client (needed by Debts)
 * 4. Flow tests (actual business operations)
 */

import { test, expect, navigateTo } from "./fixtures";

// Tests share sequential state (product + client created in earlier tests).
// Retries would relaunch Electron fresh, losing that state — disable them.
test.describe.configure({ retries: 0 });

// ============================================================
// SMOKE TESTS — verify pages load
// ============================================================

test("POS: page loads", async ({ appPage }) => {
  await navigateTo(appPage, "/pos");
  const search = appPage.getByPlaceholder(/search/i).first();
  await expect(search).toBeVisible({ timeout: 10_000 });
});

test("Inventory: page loads", async ({ appPage }) => {
  await navigateTo(appPage, "/products");
  const addBtn = appPage.locator("button").filter({ hasText: "Add Product" });
  await expect(addBtn).toBeVisible({ timeout: 10_000 });
});

test("Services: page loads and OMT buttons active", async ({ appPage }) => {
  await navigateTo(appPage, "/services");
  const omtBtn = appPage.locator("button").filter({ hasText: "OMT" }).first();
  await expect(omtBtn).toBeVisible({ timeout: 10_000 });
  await expect(omtBtn).toBeEnabled();
});

test("Exchange: page loads", async ({ appPage }) => {
  await navigateTo(appPage, "/exchange");
  const heading = appPage.locator("text=Exchange").first();
  await expect(heading).toBeVisible({ timeout: 10_000 });
});

test("Debts: page loads", async ({ appPage }) => {
  await navigateTo(appPage, "/debts");
  const heading = appPage.locator("text=Debt").first();
  await expect(heading).toBeVisible({ timeout: 10_000 });
});

test("Expenses: page loads", async ({ appPage }) => {
  await navigateTo(appPage, "/expenses");
  const heading = appPage.locator("text=Expense").first();
  await expect(heading).toBeVisible({ timeout: 10_000 });
});

// ============================================================
// SETUP FLOWS — create data needed by later tests
// ============================================================

test("Inventory: create a product", async ({ appPage }) => {
  await navigateTo(appPage, "/products");

  const addBtn = appPage.locator("button").filter({ hasText: "Add Product" });
  await expect(addBtn).toBeVisible({ timeout: 10_000 });
  await addBtn.click();
  await expect(appPage.locator("#product-name")).toBeVisible({ timeout: 5000 });

  await appPage.locator("#product-name").fill("E2E Test Widget");
  await appPage.locator("#product-cost-price").fill("5");
  await appPage.locator("#product-retail-price").fill("10");
  await appPage.locator("#product-stock").fill("50");

  await appPage.getByRole("button", { name: /Save Product/i }).click();

  // Verify in list
  await expect(appPage.locator("text=E2E Test Widget").first()).toBeVisible({
    timeout: 10_000,
  });
});

test("Clients: create a client", async ({ appPage }) => {
  await navigateTo(appPage, "/clients");

  await appPage.getByRole("button", { name: /Add Client/i }).click();
  await expect(appPage.locator("#client-full-name")).toBeVisible({
    timeout: 5000,
  });

  await appPage.locator("#client-full-name").fill("E2E Test Client");
  await appPage.locator("#client-phone").fill("03999888");

  await appPage.getByRole("button", { name: /Save Client/i }).click();

  await expect(appPage.locator("text=E2E Test Client").first()).toBeVisible({
    timeout: 10_000,
  });
});

// ============================================================
// BUSINESS FLOW TESTS
// ============================================================

test("POS: search product, add to cart, complete sale", async ({ appPage }) => {
  await navigateTo(appPage, "/pos");

  const searchInput = appPage.getByPlaceholder(
    "Search products by name or barcode...",
  );
  await expect(searchInput).toBeVisible({ timeout: 10_000 });

  await searchInput.fill("E2E Test Widget");
  await expect(appPage.locator("text=E2E Test Widget").first()).toBeVisible({
    timeout: 5000,
  });

  // Click product to add to cart
  const productItem = appPage.locator("text=E2E Test Widget").first();
  await expect(productItem).toBeVisible({ timeout: 5000 });
  await productItem.click();

  // Verify in cart
  await expect(appPage.locator("text=Cart is empty")).not.toBeVisible();

  // Checkout
  await appPage.getByRole("button", { name: /Proceed to Checkout/i }).click();

  await expect(appPage.locator("text=Checkout").first()).toBeVisible({
    timeout: 5000,
  });

  // Complete sale
  await appPage.getByRole("button", { name: /Complete Sale/i }).click();

  // Verify cart empty
  await expect(appPage.locator("text=Cart is empty")).toBeVisible({
    timeout: 10_000,
  });
});

test("Exchange: complete USD to LBP exchange", async ({ appPage }) => {
  await navigateTo(appPage, "/exchange");

  // Select USD from
  const usdBtn = appPage.locator("button").filter({ hasText: /^USD$/ }).first();
  await usdBtn.click();

  // Select LBP to
  const lbpBtn = appPage.locator("button").filter({ hasText: /^LBP$/ }).nth(1);
  await lbpBtn.click();

  // Enter amount
  const amountInputs = appPage.locator(
    'input[type="number"][placeholder="0.00"]',
  );
  const youReceive = amountInputs.first();
  await youReceive.fill("100");

  // Confirm
  const confirmBtn = appPage.getByRole("button", { name: /Confirm Exchange/i });
  await expect(confirmBtn).toBeEnabled({ timeout: 5000 });
  await confirmBtn.click();

  // Verify cleared
  await expect(youReceive).toHaveValue("", { timeout: 5000 });
});

test("Services: complete OMT send transaction", async ({ appPage }) => {
  await navigateTo(appPage, "/services");

  // Select OMT SEND
  const omtSendBtn = appPage
    .locator("button")
    .filter({ hasText: /OMT/ })
    .filter({ hasText: /↑/ })
    .first();
  await expect(omtSendBtn).toBeVisible({ timeout: 5000 });
  await omtSendBtn.click();

  // Enter amount
  const amountInput = appPage.locator("#service-amount");
  await expect(amountInput).toBeVisible({ timeout: 5000 });
  await amountInput.fill("50");

  // Submit
  const submitBtn = appPage.getByRole("button", { name: /Record Send/i });
  await expect(submitBtn).toBeVisible({ timeout: 5000 });
  await submitBtn.click();

  // Verify reset
  await expect(amountInput).toHaveValue("", { timeout: 5000 });
});

test("Expenses: record an expense", async ({ appPage }) => {
  await navigateTo(appPage, "/expenses");

  const descInput = appPage.locator("#expense-description");
  await expect(descInput).toBeVisible({ timeout: 10_000 });

  await descInput.fill("E2E Test Expense - Office Supplies");

  // Amount — use data-testid prefix to avoid matching exchange-rate input
  // (whose placeholder "89,000" contains "0" and would be matched first by
  //  getByPlaceholder("0") since it now always renders in the header)
  const amountInput = appPage.locator('[data-testid^="payment-amount-"]').first();
  await amountInput.click();
  await amountInput.fill("35");

  // Submit
  await appPage.getByRole("button", { name: /Record Expense/i }).click();

  // Verify form cleared (success)
  await expect(descInput).toHaveValue("", { timeout: 5000 });
});

test("Debts: add sale debt and settle", async ({ appPage }) => {
  // Create a debt by completing a POS sale on Customer Account
  await navigateTo(appPage, "/pos");

  const searchInput = appPage.getByPlaceholder(
    "Search products by name or barcode...",
  );
  await expect(searchInput).toBeVisible({ timeout: 10_000 });
  await searchInput.fill("E2E Test Widget");
  await expect(appPage.locator("text=E2E Test Widget").first()).toBeVisible({
    timeout: 10_000,
  });
  await appPage.locator("text=E2E Test Widget").first().click();
  await expect(appPage.locator("text=Cart is empty")).not.toBeVisible();

  await appPage.getByRole("button", { name: /Proceed to Checkout/i }).click();
  await expect(appPage.locator('[data-testid="checkout-modal"]')).toBeVisible({
    timeout: 5000,
  });

  // Assign E2E Test Client — payment auto-switches to Customer Account
  const clientField = appPage.locator(
    '[data-testid="checkout-modal"] [data-testid="client-autocomplete-field"]',
  );
  await expect(clientField).toBeVisible({ timeout: 5000 });
  await clientField.fill("E2E Test");
  await expect(
    appPage.locator('[data-testid="client-dropdown"]'),
  ).toBeVisible({ timeout: 5000 });
  await appPage.locator('[data-testid^="client-option-"]').first().click();

  // Complete sale on Customer Account
  await appPage.getByRole("button", { name: /Complete Sale/i }).click();
  await expect(appPage.locator("text=Cart is empty")).toBeVisible({
    timeout: 10_000,
  });

  // Navigate to Debts and settle
  await navigateTo(appPage, "/debts");
  // Wait for the debtor list to finish loading before clicking — avoids
  // detach-on-click when the list re-renders during the initial data fetch.
  await appPage.waitForLoadState("networkidle", { timeout: 10_000 });

  const clientRow = appPage
    .locator("button")
    .filter({ hasText: "E2E Test Client" })
    .first();
  await expect(clientRow).toBeVisible({ timeout: 10_000 });
  await clientRow.click();

  const settleBtn = appPage.getByRole("button", { name: /Settle Debt/i });
  await expect(settleBtn).toBeVisible({ timeout: 10_000 });
  await settleBtn.click();

  const fullDebtBtn = appPage
    .locator("button")
    .filter({ hasText: /Full debt/i })
    .first();
  await expect(fullDebtBtn).toBeVisible({ timeout: 5000 });
  await fullDebtBtn.click();

  // Confirm (triggers native alert — auto-dismissed)
  await appPage.getByRole("button", { name: /Confirm Payment/i }).click();
});

test("Services: WHISH disabled without partner (OMT-base)", async ({
  appPage,
}) => {
  await navigateTo(appPage, "/services");

  const firstWhish = appPage
    .locator("button")
    .filter({ hasText: "WHISH" })
    .first();
  await expect(firstWhish).toBeVisible({ timeout: 5000 });
  await expect(firstWhish).toBeDisabled();
});
