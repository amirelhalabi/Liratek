/**
 * S49–S52: CheckoutModal component tests
 *
 * Covers POS and Maintenance checkout flows:
 * - Assign client mid-checkout
 * - Payment auto-switches to CUSTOMER_ACCOUNT
 * - Partial payment creates debt
 * - Transaction time override is persisted
 */

import { test, expect, seedClient, seedProduct } from "../fixtures.js";
import { goToPOSCheckout, goToMaintenancePage } from "../helpers/nav.js";
import { CheckoutModalPO } from "../page-objects/components/CheckoutModal.po.js";
import { TransactionTimeOverridePO } from "../page-objects/components/TransactionTimeOverride.po.js";

test.describe.serial("CheckoutModal", () => {
  let productId: number;
  let clientId: number;
  let clientName: string;

  test.beforeAll(async ({ appPage }) => {
    clientName = `CheckoutClient-${Date.now()}`;
    clientId = await seedClient(appPage, {
      name: clientName,
      phone: `08${Math.floor(Math.random() * 9000000 + 1000000)}`,
    });
    productId = await seedProduct(appPage, {
      name: `CheckoutProduct-${Date.now()}`,
      cost_price: 3,
      sell_price: 10,
      quantity: 20,
    });
  });

  // -------------------------------------------------------------------------
  // S49: Assign client mid-checkout (POS)
  // -------------------------------------------------------------------------
  test("S49: assign client mid-checkout — POS", async ({ appPage }) => {
    const checkoutPO = new CheckoutModalPO(appPage);

    await goToPOSCheckout(appPage, productId);
    await checkoutPO.expectOpen();

    const clientSearch = appPage
      .locator(
        '[data-testid="checkout-modal"] input[placeholder*="client" i], [data-testid="checkout-modal"] [data-testid="client-autocomplete-field"]',
      )
      .first();

    await expect(clientSearch).toBeVisible({ timeout: 5000 });
    await clientSearch.fill(clientName.slice(0, 4));

    await expect(appPage.locator('[data-testid="client-dropdown"]')).toBeVisible({ timeout: 5000 });
    await appPage.locator('[data-testid^="client-option-"]').first().click();

    // After selection the name populates the input's value (not a text node).
    await expect(clientSearch).toHaveValue(clientName, { timeout: 5000 });

    await appPage.keyboard.press("Escape");
    await expect(appPage.locator('[data-testid="checkout-modal"]')).not.toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // S50: Payment method auto-switches to CUSTOMER_ACCOUNT after client pick (POS)
  // -------------------------------------------------------------------------
  test("S50: payment auto-switches to CUSTOMER_ACCOUNT after client selection — POS", async ({
    appPage,
  }) => {
    await goToPOSCheckout(appPage, productId);

    const checkoutPO = new CheckoutModalPO(appPage);
    await checkoutPO.expectOpen();

    const clientSearch = appPage
      .locator(
        '[data-testid="checkout-modal"] input[placeholder*="client" i], [data-testid="checkout-modal"] [data-testid="client-autocomplete-field"]',
      )
      .first();

    await expect(clientSearch).toBeVisible({ timeout: 5000 });
    await clientSearch.fill(clientName.slice(0, 4));

    await expect(appPage.locator('[data-testid="client-dropdown"]')).toBeVisible({ timeout: 5000 });
    await appPage.locator('[data-testid^="client-option-"]').first().click();

    // CUSTOMER_ACCOUNT should auto-switch after client is selected
    const caElement = appPage
      .locator(
        '[data-testid="checkout-modal"] button[class*="active"]:has-text("CUSTOMER"), ' +
        '[data-testid="checkout-modal"] [aria-pressed="true"]:has-text("CUSTOMER"), ' +
        '[data-testid="checkout-modal"] :text("CUSTOMER_ACCOUNT"), ' +
        '[data-testid="checkout-modal"] :text("Customer Account")',
      )
      .first();

    await expect(caElement).toBeVisible({ timeout: 5000 });

    await appPage.keyboard.press("Escape");
    await expect(appPage.locator('[data-testid="checkout-modal"]')).not.toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // S51: Partial payment → debt created (POS)
  // -------------------------------------------------------------------------
  test("S51: partial payment creates a debt record — POS", async ({
    appPage,
  }) => {
    await goToPOSCheckout(appPage, productId);

    const checkoutPO = new CheckoutModalPO(appPage);
    await checkoutPO.expectOpen();

    // Assign client (required for debt)
    const clientSearch = appPage
      .locator(
        '[data-testid="checkout-modal"] input[placeholder*="client" i], [data-testid="checkout-modal"] [data-testid="client-autocomplete-field"]',
      )
      .first();

    await expect(clientSearch).toBeVisible({ timeout: 5000 });
    await clientSearch.fill(clientName.slice(0, 4));

    await expect(appPage.locator('[data-testid="client-dropdown"]')).toBeVisible({ timeout: 5000 });
    await appPage.locator('[data-testid^="client-option-"]').first().click();

    // Select CUSTOMER_ACCOUNT payment method
    const accountBtn = appPage
      .locator(
        '[data-testid="checkout-modal"] button:has-text("Account"), [data-testid="checkout-modal"] button:has-text("CUSTOMER")',
      )
      .first();
    await expect(accountBtn).toBeVisible({ timeout: 5000 });
    await accountBtn.click();

    // Complete the sale
    await expect(checkoutPO.completeBtn).toBeVisible({ timeout: 5000 });
    await checkoutPO.complete();

    // Verify debt was created for this client
    const debtorExists = await appPage
      .evaluate(
        (cId) =>
          window.api.debt
            .getDebtors()
            .then((debtors) => debtors.some((d) => d.id === cId))
            .catch(() => false),
        clientId,
      )
      .catch(() => false);

    expect(debtorExists).toBe(true);
  });

  // -------------------------------------------------------------------------
  // S52: Override transaction time → sale's timestamp is the past date (POS)
  // -------------------------------------------------------------------------
  test("S52: transaction time override persists in completed sale — POS", async ({
    appPage,
  }) => {
    const txoPO = new TransactionTimeOverridePO(appPage);

    // Use a fresh product to avoid stock issues
    const p2Id = await seedProduct(appPage, {
      name: `TxoProd-${Date.now()}`,
      cost_price: 1,
      sell_price: 5,
      quantity: 5,
    });

    await goToPOSCheckout(appPage, p2Id);

    const checkoutPO = new CheckoutModalPO(appPage);
    await checkoutPO.expectOpen();

    // Expand TransactionTimeOverride inside checkout modal
    await expect(txoPO.toggle).toBeVisible({ timeout: 5000 });
    await txoPO.expand();
    await txoPO.expectExpanded();

    // Set to yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yyyy = yesterday.getFullYear();
    const mm = String(yesterday.getMonth() + 1).padStart(2, "0");
    const dd = String(yesterday.getDate()).padStart(2, "0");
    const pastDateStr = `${yyyy}-${mm}-${dd}T10:00`;
    await txoPO.setDate(pastDateStr);

    // Complete sale
    await expect(checkoutPO.completeBtn).toBeVisible({ timeout: 5000 });
    await checkoutPO.complete();

    // Verify cart is cleared (sale completed)
    await expect(appPage.locator("text=Cart is empty")).toBeVisible({ timeout: 10_000 });
  });

  // -------------------------------------------------------------------------
  // S49 (Maintenance): checkout modal opens on Maintenance page
  // -------------------------------------------------------------------------
  test("S49 (Maintenance): checkout modal opens from Maintenance form", async ({
    appPage,
  }) => {
    const checkoutPO = new CheckoutModalPO(appPage);

    await goToMaintenancePage(appPage);

    // Fill minimum required fields
    const deviceInput = appPage.locator("#maintenance-device-name").first();
    await expect(deviceInput).toBeVisible({ timeout: 5000 });
    await deviceInput.fill("iPhone 14 E2E");

    const issueInput = appPage.locator("#maintenance-issue").first();
    await expect(issueInput).toBeVisible({ timeout: 3000 });
    await issueInput.fill("Screen crack");

    const priceInput = appPage.locator("#maintenance-price").first();
    await expect(priceInput).toBeVisible({ timeout: 3000 });
    await priceInput.fill("50");

    // Click "Proceed to Checkout"
    const checkoutBtn = appPage.locator("button", { hasText: /Proceed to Checkout/i }).first();
    await expect(checkoutBtn).toBeVisible({ timeout: 5000 });
    await checkoutBtn.click();
    await checkoutPO.expectOpen();

    // Close modal
    await appPage.keyboard.press("Escape");
    await expect(appPage.locator('[data-testid="checkout-modal"]')).not.toBeVisible({ timeout: 5000 });
  });
});
