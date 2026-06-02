import type { Page } from "@playwright/test";
import { navigateTo } from "../fixtures.js";

/**
 * Close all active customer sessions via direct API call, then wait for the
 * React SessionContext to reflect the change.
 *
 * The session:close IPC closes the record in the DB immediately, but the
 * React SessionContext polls the backend on an interval — the component's
 * `activeSession` stays truthy until the next poll fires.  We wait for the
 * session FAB button to switch from "*active session*" to "Start Customer
 * Session" as confirmation that the context has been updated, so any Custom
 * Services / Maintenance submit that checks `if (activeSession)` will
 * correctly take the direct-DB path rather than the session-cart path.
 */
export async function closeAllActiveSessions(page: Page): Promise<void> {
  await page
    .evaluate(async () => {
      try {
        const result = await window.api.session.getActiveSessions();
        const sessions: { id: number }[] = Array.isArray(result)
          ? result
          : ((result as { sessions?: { id: number }[] }).sessions ?? []);
        for (const s of sessions) {
          await window.api.session.close(s.id, "test-cleanup").catch(() => {});
        }
      } catch {
        // ignore — no active sessions or API not ready
      }
    })
    .catch(() => {});

  // Wait up to 6s for the React SessionContext to re-poll and reflect the
  // close. The FAB title changes from "*active session(s)*" to
  // "Start Customer Session" once activeSession becomes null.
  const noSessionFab = page.locator('button[title="Start Customer Session"]');
  await noSessionFab.waitFor({ state: "visible", timeout: 6000 }).catch(
    async () => {
      // FAB not visible on this particular page — fall back to a fixed wait
      // that covers a typical 2-3s poll interval with margin.
      await page.waitForTimeout(3000);
    },
  );
}

/**
 * Navigate to the Expenses page (form is always visible on that page).
 */
export async function goToExpensesForm(page: Page): Promise<void> {
  await navigateTo(page, "/expenses");
}

/**
 * Navigate to the Custom Services page (form is always visible on that page).
 */
export async function goToCustomServicesForm(page: Page): Promise<void> {
  await navigateTo(page, "/custom-services");
}

/**
 * Navigate to the Debts page and open the repayment modal for a specific client.
 * Clicks the "Settle Debt" / "Cash Out" button visible in the client detail panel.
 *
 * @param clientId - The id of the client whose debt row to click
 */
export async function goToDebtsRepayModal(
  page: Page,
  clientId: number,
): Promise<void> {
  await navigateTo(page, "/debts");
  // Click the debtor list button for this client.
  // The debtor rows are rendered as <button> elements — we find the one
  // whose data attributes or text contain the client id.
  // Fallback: click first "Settle Debt" or "Cash Out" button in the list.
  const clientRow = page
    .locator(`button[data-client-id="${clientId}"]`)
    .first();
  const hasRow = await clientRow
    .isVisible({ timeout: 2000 })
    .catch(() => false);
  if (hasRow) {
    await clientRow.click();
  } else {
    // Try by iterating debtor rows (they don't have data-client-id by default,
    // so look for text content matching client name fetched via evaluate).
    const clientName = await page
      .evaluate(
        (id) => window.api.clients.get(id).then((c) => c?.full_name ?? ""),
        clientId,
      )
      .catch(() => "");
    if (clientName) {
      await page.locator("button", { hasText: clientName }).first().click();
    }
  }
  await page.waitForTimeout(500);
  // Now click the "Settle Debt" or "Cash Out" action button in the detail panel
  const settleBtn = page
    .locator("button", { hasText: /Settle Debt|Cash Out/i })
    .first();
  await settleBtn.click();
  await page.waitForTimeout(500);
}

/**
 * Navigate to the Loto page (Sell Ticket tab is the default view).
 */
export async function goToLotoTicketForm(page: Page): Promise<void> {
  await navigateTo(page, "/loto");
}

/**
 * Navigate to the Maintenance page.
 */
export async function goToMaintenancePage(page: Page): Promise<void> {
  await navigateTo(page, "/maintenance");
}

/**
 * Navigate to the POS page, search for a product by id, add it to the cart,
 * then open the checkout modal.
 *
 * @param productId - The id of the product to add to the cart
 */
export async function goToPOSCheckout(
  page: Page,
  productId: number,
): Promise<void> {
  await navigateTo(page, "/pos");

  // Fetch the product name so we can search for it
  const productName = await page
    .evaluate(
      (id) =>
        window.api.inventory.getProduct(id).then((p) => p?.name ?? ""),
      productId,
    )
    .catch(() => "");

  if (productName) {
    // Type into the product search input
    const searchInput = page
      .locator('input[placeholder*="Search"], input[placeholder*="search"]')
      .first();
    await searchInput.fill(productName);
    await page.waitForTimeout(500);

    // Click the first matching product result
    const productBtn = page
      .locator("button", { hasText: productName })
      .first();
    const visible = await productBtn
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    if (visible) {
      await productBtn.click();
      await page.waitForTimeout(300);
    }
  }

  // Click "Proceed to Checkout"
  await page
    .locator("button", { hasText: /Proceed to Checkout/i })
    .first()
    .click();
  await page.waitForTimeout(500);
}

/**
 * Navigate to the Recharge page and click the specified provider tab.
 *
 * @param tab - Which tab to activate: 'telecom' | 'financial' | 'katch' | 'crypto'
 */
export async function goToRechargeForm(
  page: Page,
  tab: "telecom" | "financial" | "katch" | "crypto",
): Promise<void> {
  await navigateTo(page, "/recharge");

  const tabLabels: Record<typeof tab, string | RegExp> = {
    telecom: /Telecom|MTC|Alfa/i,
    financial: /Financial|OMT|Whish/i,
    katch: /Katch|Katsh/i,
    crypto: /Crypto|Binance/i,
  };

  const label = tabLabels[tab];
  const tabBtn = page.locator("button", { hasText: label }).first();
  const visible = await tabBtn.isVisible({ timeout: 2000 }).catch(() => false);
  if (visible) {
    // force:true bypasses overlay interception that can occur when a session
    // modal was just closed and the header z-layer hasn't fully settled
    await tabBtn.click({ force: true });
    await page.waitForTimeout(300);
  }
}

/**
 * Navigate to the Inventory / Products page.
 */
export async function goToInventoryPage(page: Page): Promise<void> {
  await navigateTo(page, "/products");
}

/**
 * Navigate to the Custom Sessions page.
 */
export async function goToSessionsPage(page: Page): Promise<void> {
  await navigateTo(page, "/customer-sessions");
}
