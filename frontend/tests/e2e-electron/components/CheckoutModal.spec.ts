/**
 * S49–S52: CheckoutModal component tests
 *
 * Covers POS and Maintenance checkout flows:
 * - Assign client mid-checkout
 * - Payment auto-switches to CUSTOMER_ACCOUNT
 * - Partial payment creates debt
 * - Transaction time override is persisted
 */

import {
  test,
  expect,
  seedClient,
  seedProduct,
  describeElectronDeath,
} from "../fixtures.js";
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

    await expect(
      appPage.locator('[data-testid="client-dropdown"]'),
    ).toBeVisible({ timeout: 5000 });
    await appPage.locator('[data-testid^="client-option-"]').first().click();

    // After selection the name populates the input's value (not a text node).
    await expect(clientSearch).toHaveValue(clientName, { timeout: 5000 });

    await appPage.keyboard.press("Escape");
    await expect(
      appPage.locator('[data-testid="checkout-modal"]'),
    ).not.toBeVisible({ timeout: 5000 });
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

    await expect(
      appPage.locator('[data-testid="client-dropdown"]'),
    ).toBeVisible({ timeout: 5000 });
    await appPage.locator('[data-testid^="client-option-"]').first().click();

    // CUSTOMER_ACCOUNT should auto-switch after client is selected.
    // The payment method is rendered as a <select>; check its value.
    const paymentSelect = appPage
      .locator('[data-testid="checkout-modal"] select')
      .first();
    await expect(paymentSelect).toHaveValue("CUSTOMER_ACCOUNT", {
      timeout: 5000,
    });

    await appPage.keyboard.press("Escape");
    await expect(
      appPage.locator('[data-testid="checkout-modal"]'),
    ).not.toBeVisible({ timeout: 5000 });
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

    await expect(
      appPage.locator('[data-testid="client-dropdown"]'),
    ).toBeVisible({ timeout: 5000 });
    await appPage.locator('[data-testid^="client-option-"]').first().click();

    // CUSTOMER_ACCOUNT is auto-selected when a client is picked; verify it
    const paymentSelect = appPage
      .locator('[data-testid="checkout-modal"] select')
      .first();
    await expect(paymentSelect).toHaveValue("CUSTOMER_ACCOUNT", {
      timeout: 5000,
    });

    // Diagnostic: buffer renderer crash / console / page errors BEFORE the
    // click so the cause survives if the Electron page detaches during sale
    // processing. This test flaked once with a bare "Target page closed" —
    // the poll below fired an appPage.evaluate the instant the click returned,
    // hammering IPC while the sale was still committing, and captured no cause.
    // (app.spec.ts added the same buffer for the same CUSTOMER_ACCOUNT flow.)
    // A pure main-process crash won't appear here — its stack is printed by the
    // harness as `[electron] …` stderr lines.
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

    // Complete the sale
    await expect(checkoutPO.completeBtn).toBeVisible({ timeout: 5000 });
    await checkoutPO.complete();

    // Wait for the UI success signal (cart cleared) BEFORE touching the DB, so
    // we don't poll window.api mid-commit. If the sale instead fails/crashes,
    // surface the buffered diagnostics rather than a bare page-closed error.
    try {
      await expect(appPage.locator("text=Cart is empty")).toBeVisible({
        timeout: 12_000,
      });
    } catch (err) {
      throw new Error(
        `Complete Sale did not clear the cart (CUSTOMER_ACCOUNT). ` +
          `pageCrashed=${pageCrashed}; ` +
          `${await describeElectronDeath()}; ` +
          `pageErrors=${JSON.stringify(pageErrors)}; ` +
          `consoleErrors=${JSON.stringify(consoleErrors.slice(-8))}; ` +
          `original=${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Verify debt was created for this client. The sale IPC has already
    // returned (cart cleared above), so poll until the debtor row is queryable
    // — a small safety margin against the debt_ledger read racing the commit.
    await expect
      .poll(
        () =>
          appPage.evaluate(
            (cId) =>
              window.api.debt
                .getDebtors()
                .then((debtors) => debtors.some((d) => d.id === cId))
                .catch(() => false),
            clientId,
          ),
        { timeout: 5000 },
      )
      .toBe(true);
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
    await expect(appPage.locator("text=Cart is empty")).toBeVisible({
      timeout: 10_000,
    });
  });

  // -------------------------------------------------------------------------
  // S53: Split-mode currency switch converts the payment line's amount.
  // CheckoutModal was migrated onto the shared MultiPaymentInput (@liratek/ui)
  // — pre-migration, switching a line's currency left the raw number
  // unconverted (e.g. a $10 line became "10 LBP" instead of ~890,000 LBP).
  // -------------------------------------------------------------------------
  test("S53: switching a payment line's currency converts its amount by the exchange rate — POS", async ({
    appPage,
  }) => {
    const p3Id = await seedProduct(appPage, {
      name: `CurrencySwitchProd-${Date.now()}`,
      cost_price: 3,
      sell_price: 10,
      quantity: 10,
    });

    await goToPOSCheckout(appPage, p3Id);

    const checkoutPO = new CheckoutModalPO(appPage);
    await checkoutPO.expectOpen();

    const modal = appPage.locator('[data-testid="checkout-modal"]');
    const rateInput = modal.getByTestId("payment-exchange-rate");
    await expect(rateInput).toBeVisible({ timeout: 5000 });
    const rateRaw = await rateInput.inputValue();
    const rate = parseFloat(rateRaw.replace(/,/g, ""));
    expect(rate).toBeGreaterThan(0);

    const amountInput = modal
      .locator('[data-testid^="payment-amount-"]')
      .first();
    await expect(amountInput).toHaveValue("10");

    const currencySelect = modal
      .locator('[data-testid^="payment-currency-"]')
      .first();
    await currencySelect.selectOption("LBP");

    const expectedLbp = Math.round(10 * rate).toLocaleString("en-US");
    await expect(amountInput).toHaveValue(expectedLbp);

    await appPage.keyboard.press("Escape");
    await checkoutPO.expectClosed();
  });

  // -------------------------------------------------------------------------
  // S54: Editing the discount decrements the auto-filled payment amount.
  // Pre-migration, the amount only auto-filled once (on open) and never
  // re-synced when the discount changed afterward.
  // -------------------------------------------------------------------------
  test("S54: setting a discount decrements the auto-filled payment amount — POS", async ({
    appPage,
  }) => {
    const p4Id = await seedProduct(appPage, {
      name: `DiscountDecrementProd-${Date.now()}`,
      cost_price: 5,
      sell_price: 20,
      quantity: 10,
    });

    await goToPOSCheckout(appPage, p4Id);

    const checkoutPO = new CheckoutModalPO(appPage);
    await checkoutPO.expectOpen();

    const modal = appPage.locator('[data-testid="checkout-modal"]');
    const amountInput = modal
      .locator('[data-testid^="payment-amount-"]')
      .first();
    await expect(amountInput).toHaveValue("20");

    await modal.getByTestId("checkout-discount-input").fill("5");

    // Pre-fix, this would still read "20" — the auto-sync effect only ran
    // once, before the discount field existed as a live re-trigger.
    await expect(amountInput).toHaveValue("15");

    await appPage.keyboard.press("Escape");
    await checkoutPO.expectClosed();
  });

  // -------------------------------------------------------------------------
  // S55: The "Waive" button clears a sub-$1 remaining shortfall and lets an
  // otherwise-blocked, clientless sale complete. Pre-migration there was no
  // such button — an underpaid, clientless sale could only be completed by
  // manually typing the exact remaining cents into the amount field.
  // -------------------------------------------------------------------------
  test("S55: waiving a sub-$1 remaining balance completes the sale without a client — POS", async ({
    appPage,
  }) => {
    const p5Id = await seedProduct(appPage, {
      name: `WaiveRemainingProd-${Date.now()}`,
      cost_price: 3,
      sell_price: 10,
      quantity: 10,
    });

    await goToPOSCheckout(appPage, p5Id);

    const checkoutPO = new CheckoutModalPO(appPage);
    await checkoutPO.expectOpen();

    const modal = appPage.locator('[data-testid="checkout-modal"]');
    const amountInput = modal
      .locator('[data-testid^="payment-amount-"]')
      .first();
    await amountInput.fill("9.75");

    // Underpaid by $0.25 with no client attached: completion must be
    // blocked (a debt cannot be booked without a chargeable client), so the
    // modal stays open.
    await checkoutPO.complete();
    await expect(checkoutPO.modal).toBeVisible({ timeout: 2000 });

    const waiveBtn = modal.getByTestId("waive-remaining");
    await expect(waiveBtn).toBeVisible({ timeout: 5000 });
    await waiveBtn.click();

    await expect(modal.getByTestId("checkout-discount-input")).toHaveValue(
      "0.25",
    );

    await checkoutPO.complete();
    await expect(appPage.locator("text=Cart is empty")).toBeVisible({
      timeout: 10_000,
    });
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
    const checkoutBtn = appPage
      .locator("button", { hasText: /Proceed to Checkout/i })
      .first();
    await expect(checkoutBtn).toBeVisible({ timeout: 5000 });
    await checkoutBtn.click();
    await checkoutPO.expectOpen();

    // Close modal
    await appPage.keyboard.press("Escape");
    await expect(
      appPage.locator('[data-testid="checkout-modal"]'),
    ).not.toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // S56 (Maintenance): CheckoutModal is shared between POS and Maintenance —
  // the migrated shared MultiPaymentInput payment UI must complete a
  // Maintenance job too, not just a POS sale.
  // -------------------------------------------------------------------------
  test("S56 (Maintenance): completes a job through the shared payment UI", async ({
    appPage,
  }) => {
    const checkoutPO = new CheckoutModalPO(appPage);

    await goToMaintenancePage(appPage);

    const deviceInput = appPage.locator("#maintenance-device-name").first();
    await expect(deviceInput).toBeVisible({ timeout: 5000 });
    await deviceInput.fill(`iPhone MPI-${Date.now()}`);

    const issueInput = appPage.locator("#maintenance-issue").first();
    await issueInput.fill("Battery replacement");

    const priceInput = appPage.locator("#maintenance-price").first();
    await priceInput.fill("30");

    const checkoutBtn = appPage
      .locator("button", { hasText: /Proceed to Checkout/i })
      .first();
    await checkoutBtn.click();
    await checkoutPO.expectOpen();

    const modal = appPage.locator('[data-testid="checkout-modal"]');
    await expect(modal.getByTestId("multi-payment-input")).toBeVisible({
      timeout: 5000,
    });
    const amountInput = modal
      .locator('[data-testid^="payment-amount-"]')
      .first();
    await expect(amountInput).toHaveValue("30");

    await checkoutPO.complete();
    await expect(
      appPage.locator('[data-testid="checkout-modal"]'),
    ).not.toBeVisible({ timeout: 10_000 });
  });
});
