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

import {
  test,
  expect,
  navigateTo,
  describeElectronDeath,
  seedClient,
  seedProduct,
} from "./fixtures";

// Tests share sequential state (product + client created in earlier tests).
// Retries would relaunch Electron fresh, losing that state — disable them.
// Exception: the "Debts: add sale debt and settle" describe below seeds its
// own data and re-enables retries — see the comment there.
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

  // Enter amount — DecimalInput renders type="text", not type="number"
  const amountInputs = appPage.locator('input[placeholder="0.00"]');
  const youReceive = amountInputs.first();
  await youReceive.fill("100");

  // Confirm — two steps since the split-payout feature (commit 237f460).
  // A USD/LBP target sets `canSplitPayout`, so the page button reads
  // "Proceed to Payout" and opens the PaymentSheet; "Confirm Exchange" now
  // only renders for an exotic target (EUR etc.) or for-partner mode. Do NOT
  // "fix" this back to a single click.
  const proceedBtn = appPage.getByRole("button", {
    name: /Proceed to Payout/i,
  });
  await expect(proceedBtn).toBeEnabled({ timeout: 5000 });
  await proceedBtn.click();

  // The payout sheet slides in — confirm the disbursement from there. Its
  // button is labelled "Pay <amount> <currency>" and is gated only on
  // isSubmitting, so an unedited (single seeded leg) sheet confirms as-is.
  await expect(
    appPage.getByRole("heading", { name: /Confirm Payout/i }),
  ).toBeVisible({ timeout: 5000 });
  const payBtn = appPage.getByRole("button", { name: /^Pay\s/i });
  await expect(payBtn).toBeEnabled({ timeout: 5000 });
  await payBtn.click();

  // Verify cleared
  await expect(youReceive).toHaveValue("", { timeout: 10_000 });
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
  const amountInput = appPage
    .locator('[data-testid^="payment-amount-"]')
    .first();
  await amountInput.click();
  await amountInput.fill("35");

  // Submit
  await appPage.getByRole("button", { name: /Record Expense/i }).click();

  // Verify form cleared (success)
  await expect(descInput).toHaveValue("", { timeout: 5000 });
});

// This flow intermittently loses the Electron page target at the Complete Sale
// click ("Target page ... closed" while the main process stays alive — see the
// describeElectronDeath() diagnostics). Unlike its siblings, this test seeds
// its OWN client + product, so a retry on a fresh worker (fresh DB) still has
// its data — which lets us re-enable retries here despite the file-level
// retries: 0 above, absorbing the environmental death the same way the rest of
// the suite does.
test.describe("Debts (self-seeded)", () => {
  test.describe.configure({ retries: 2 });

  test("Debts: add sale debt and settle", async ({ appPage }) => {
    const debtClientName = `DebtClient-${Date.now()}`;
    const debtProductName = `DebtWidget-${Date.now()}`;
    await seedClient(appPage, {
      name: debtClientName,
      phone: `09${Math.floor(Math.random() * 9000000 + 1000000)}`,
    });
    await seedProduct(appPage, {
      name: debtProductName,
      cost_price: 3,
      sell_price: 10,
      quantity: 5,
    });

    // Create a debt by completing a POS sale on Customer Account
    await navigateTo(appPage, "/pos");

    const searchInput = appPage.getByPlaceholder(
      "Search products by name or barcode...",
    );
    await expect(searchInput).toBeVisible({ timeout: 10_000 });
    await searchInput.fill(debtProductName);
    await expect(
      appPage.locator(`text=${debtProductName}`).first(),
    ).toBeVisible({
      timeout: 10_000,
    });
    await appPage.locator(`text=${debtProductName}`).first().click();
    await expect(appPage.locator("text=Cart is empty")).not.toBeVisible();

    await appPage.getByRole("button", { name: /Proceed to Checkout/i }).click();
    await expect(appPage.locator('[data-testid="checkout-modal"]')).toBeVisible(
      {
        timeout: 5000,
      },
    );

    // Assign the seeded client — payment auto-switches to Customer Account
    const clientField = appPage.locator(
      '[data-testid="checkout-modal"] [data-testid="client-autocomplete-field"]',
    );
    await expect(clientField).toBeVisible({ timeout: 5000 });
    await clientField.fill(debtClientName.slice(0, 16));
    await expect(
      appPage.locator('[data-testid="client-dropdown"]'),
    ).toBeVisible({
      timeout: 5000,
    });
    await appPage.locator('[data-testid^="client-option-"]').first().click();

    // Wait for the CUSTOMER_ACCOUNT auto-switch effect to commit before
    // completing the sale, so the Complete Sale click cannot race the async
    // payment-method switch (CheckoutModal auto-selects CUSTOMER_ACCOUNT once
    // a client is set). The POS modal's method picker is a plain <select> (no
    // testid) — target the one that offers a CUSTOMER_ACCOUNT option and wait
    // for it to be selected.
    await expect(
      appPage
        .locator('[data-testid="checkout-modal"] select')
        .filter({ has: appPage.locator('option[value="CUSTOMER_ACCOUNT"]') })
        .first(),
    ).toHaveValue("CUSTOMER_ACCOUNT", { timeout: 5000 });

    // Diagnostic: buffer renderer crash / console / page errors BEFORE the
    // click so the cause survives even if the Electron page detaches (a main-
    // OR renderer-process crash closes the page). A pure main-process crash
    // won't appear here — its stack is printed by the harness as
    // `[electron] …` stderr lines.
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    let pageCrashed = false;
    appPage.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    appPage.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)));
    appPage.on("crash", () => {
      pageCrashed = true;
    });

    // Complete sale on Customer Account
    await appPage.getByRole("button", { name: /Complete Sale/i }).click();

    try {
      // The modal stays open ONLY when handleCompleteSale hits a failure — it
      // shows a "Sale failed: <error>" / validation / "unexpected error" alert
      // and does NOT clear the cart. Race the success signal against that
      // alert.
      const cartEmpty = appPage.locator("text=Cart is empty");
      const failureAlert = appPage.locator('[role="alert"]').filter({
        hasText: /fail|error|debt|disabled|required|phone|anonymous/i,
      });
      await Promise.race([
        cartEmpty
          .waitFor({ state: "visible", timeout: 12_000 })
          .catch(() => {}),
        failureAlert
          .first()
          .waitFor({ state: "visible", timeout: 12_000 })
          .catch(() => {}),
      ]);
      if (
        await failureAlert
          .first()
          .isVisible()
          .catch(() => false)
      ) {
        const msg = (await failureAlert.allTextContents().catch(() => [])).join(
          " | ",
        );
        throw new Error(`alert: "${msg}"`);
      }
      await expect(cartEmpty).toBeVisible({ timeout: 8_000 });
    } catch (err) {
      throw new Error(
        `Complete Sale did not complete on CUSTOMER_ACCOUNT. ` +
          `pageCrashed=${pageCrashed}; ` +
          `${await describeElectronDeath()}; ` +
          `pageErrors=${JSON.stringify(pageErrors)}; ` +
          `consoleErrors=${JSON.stringify(consoleErrors.slice(-8))}; ` +
          `original=${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Navigate to Debts and settle
    await navigateTo(appPage, "/debts");
    // Wait for the debtor list to finish loading before clicking — avoids
    // detach-on-click when the list re-renders during the initial data fetch.
    await appPage.waitForLoadState("networkidle", { timeout: 10_000 });

    const clientRow = appPage
      .locator("button")
      .filter({ hasText: debtClientName })
      .first();
    await expect(clientRow).toBeVisible({ timeout: 10_000 });
    await clientRow.click();

    const settleBtn = appPage.getByRole("button", { name: /Settle Debt/i });
    await expect(settleBtn).toBeVisible({ timeout: 10_000 });
    await settleBtn.click();

    // The payment form opens pre-seeded with the full per-currency position
    // (the separate "Full debt" quick-fill button was removed — it wrote page
    // state the payment form never displayed).
    await expect(
      appPage.locator('[data-testid^="payment-amount-"]').first(),
    ).not.toHaveValue("", { timeout: 5000 });

    // Confirm (triggers native alert — auto-dismissed)
    await appPage.getByRole("button", { name: /Confirm Payment/i }).click();
  });
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
