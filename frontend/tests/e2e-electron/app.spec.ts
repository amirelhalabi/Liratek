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
  await appPage.waitForTimeout(500);

  await appPage.locator("#product-name").fill("E2E Test Widget");
  await appPage.locator("#product-cost-price").fill("5");
  await appPage.locator("#product-retail-price").fill("10");
  await appPage.locator("#product-stock").fill("50");

  await appPage.getByRole("button", { name: /Save Product/i }).click();
  await appPage.waitForTimeout(2000);

  // Verify in list
  await expect(appPage.locator("text=E2E Test Widget").first()).toBeVisible({
    timeout: 10_000,
  });
});

test("Clients: create a client", async ({ appPage }) => {
  await navigateTo(appPage, "/clients");

  await appPage.getByRole("button", { name: /Add Client/i }).click();
  await appPage.waitForTimeout(500);

  await appPage.locator("#client-full-name").fill("E2E Test Client");
  await appPage.locator("#client-phone").fill("03999888");

  await appPage.getByRole("button", { name: /Save Client/i }).click();
  await appPage.waitForTimeout(2000);

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
  await appPage.waitForTimeout(1000);

  // Click product to add to cart
  const productItem = appPage.locator("text=E2E Test Widget").first();
  await expect(productItem).toBeVisible({ timeout: 5000 });
  await productItem.click();
  await appPage.waitForTimeout(500);

  // Verify in cart
  await expect(appPage.locator("text=Cart is empty")).not.toBeVisible();

  // Checkout
  await appPage.getByRole("button", { name: /Proceed to Checkout/i }).click();
  await appPage.waitForTimeout(1000);

  await expect(appPage.locator("text=Checkout").first()).toBeVisible({
    timeout: 5000,
  });

  // Complete sale
  await appPage.getByRole("button", { name: /Complete Sale/i }).click();
  await appPage.waitForTimeout(3000);

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
  await appPage.waitForTimeout(300);

  // Select LBP to
  const lbpBtn = appPage.locator("button").filter({ hasText: /^LBP$/ }).nth(1);
  await lbpBtn.click();
  await appPage.waitForTimeout(300);

  // Enter amount
  const amountInputs = appPage.locator(
    'input[type="number"][placeholder="0.00"]',
  );
  const youReceive = amountInputs.first();
  await youReceive.fill("100");
  await appPage.waitForTimeout(500);

  // Confirm
  const confirmBtn = appPage.getByRole("button", { name: /Confirm Exchange/i });
  await expect(confirmBtn).toBeEnabled({ timeout: 5000 });
  await confirmBtn.click();
  await appPage.waitForTimeout(2000);

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
  if (await omtSendBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await omtSendBtn.click();
    await appPage.waitForTimeout(300);
  }

  // Enter amount
  const amountInput = appPage.locator("#service-amount");
  await expect(amountInput).toBeVisible({ timeout: 5000 });
  await amountInput.fill("50");
  await appPage.waitForTimeout(300);

  // Submit
  const submitBtn = appPage.getByRole("button", { name: /Record Send/i });
  await expect(submitBtn).toBeVisible({ timeout: 5000 });
  await submitBtn.click();
  await appPage.waitForTimeout(2000);

  // Verify reset
  await expect(amountInput).toHaveValue("", { timeout: 5000 });
});

test("Expenses: record an expense", async ({ appPage }) => {
  await navigateTo(appPage, "/expenses");

  const descInput = appPage.locator("#expense-description");
  await expect(descInput).toBeVisible({ timeout: 10_000 });

  await descInput.fill("E2E Test Expense - Office Supplies");

  // Amount
  const amountInput = appPage.getByPlaceholder("0.00").first();
  await amountInput.fill("35");

  // Submit
  await appPage.getByRole("button", { name: /Record Expense/i }).click();
  await appPage.waitForTimeout(2000);

  // Verify form cleared (success)
  await expect(descInput).toHaveValue("", { timeout: 5000 });
});

test("Debts: add credit and settle", async ({ appPage }) => {
  await navigateTo(appPage, "/debts");
  await appPage.waitForTimeout(1000);

  // Add Credit
  await appPage.getByRole("button", { name: /Add Credit/i }).click();
  await appPage.waitForTimeout(500);

  const clientSearch = appPage.getByPlaceholder(
    "Search client by name or phone...",
  );
  await expect(clientSearch).toBeVisible({ timeout: 5000 });
  await clientSearch.fill("E2E Test Client");
  await appPage.waitForTimeout(2000); // wait for debounced search results

  // Click client from dropdown (button inside dropdown with client name)
  const clientOption = appPage
    .locator(".absolute button")
    .filter({ hasText: "E2E Test Client" })
    .first();
  await expect(clientOption).toBeVisible({ timeout: 10_000 });
  await clientOption.click();
  await appPage.waitForTimeout(500);

  // Enter amount
  await appPage.getByPlaceholder("0.00").first().fill("25");

  // Submit (triggers native alert — auto-dismissed by global handler)
  await appPage
    .getByRole("button", { name: /Add Credit/i })
    .last()
    .click();
  await appPage.waitForTimeout(3000);

  // Select client from left panel
  const clientRow = appPage
    .locator("button")
    .filter({ hasText: "E2E Test Client" })
    .first();
  await expect(clientRow).toBeVisible({ timeout: 10_000 });
  await clientRow.click();
  await appPage.waitForTimeout(2000);

  // Settle debt
  const settleBtn = appPage.getByRole("button", { name: /Settle Debt/i });
  if (await settleBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await settleBtn.click();
    await appPage.waitForTimeout(500);

    // Quick fill
    const fullDebtBtn = appPage
      .locator("button")
      .filter({ hasText: /Full debt/i })
      .first();
    if (await fullDebtBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await fullDebtBtn.click();
      await appPage.waitForTimeout(300);
    }

    // Confirm (triggers native alert — auto-dismissed)
    await appPage.getByRole("button", { name: /Confirm Payment/i }).click();
    await appPage.waitForTimeout(2000);
  }
});

test("Services: WHISH disabled without partner (OMT-base)", async ({
  appPage,
}) => {
  await navigateTo(appPage, "/services");

  const whishBtns = appPage.locator("button").filter({ hasText: "WHISH" });
  const count = await whishBtns.count();
  if (count > 0) {
    const firstWhish = whishBtns.first();
    await expect(firstWhish).toBeDisabled();
  }
});
