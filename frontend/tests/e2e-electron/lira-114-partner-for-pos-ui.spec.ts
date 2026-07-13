/**
 * E2E: LIRA-114 (PFT-2b) — the POS checkout's "For Partner" control drives
 * the FOR-partner sale path (built in PFT-2 / ddae06f, proven core-side by
 * lira-113) end to end through the REAL UI: toggle the control on, pick a
 * partner from the dropdown, pay part of the total in cash, complete — the
 * unpaid remainder must land on the PARTNER's ledger (never a client's
 * debt_ledger, and never CUSTOMER_ACCOUNT), and voiding the sale must net the
 * partner back to exactly 0.
 *
 * Unlike lira-113 (which calls window.api.sales.process directly to prove the
 * CORE routing), this spec proves the FRONTEND control itself threads
 * partnerId/partnerMode from the modal into that same payload. The intended
 * rule-17 revert target is CheckoutModal.tsx's getPaymentData() spread
 * (`...(forPartner && selectedPartnerId ? { partnerId, partnerMode: "FOR" }
 * : {})`) — drop ONLY that spread and the toggle/selector stay fully
 * clickable, but the payload silently omits partnerId/partnerMode. The sale
 * then falls into the client-debt branch with client_id === null and
 * SalesRepository throws "Cannot create debt for anonymous client" — the
 * sale never commits, so the partner-balance-delta assertion below reads 0
 * instead of 60 (THE failing-first assertion; proof recorded in the plan by
 * whoever verifies this change).
 *
 * ≥2 active partners are seeded on purpose: PartnerSelector renders a real
 * dropdown only when there are 2+ partners in the list — with exactly one it
 * collapses to an inert "Partner: <name>" label with no click target, which
 * would leave selectedPartnerId permanently null and block completion in
 * BOTH pre- and post-fix code (a false negative, not a proof).
 */

import { test, expect, navigateTo, seedProduct } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

type Api = {
  api: {
    partners: {
      create: (d: {
        name: string;
        phone?: string;
      }) => Promise<{ success: boolean; data?: { id: number }; error?: string }>;
      getBalance: (partnerId: number) => Promise<{ usd: number; lbp: number }>;
    };
    transactions: {
      getRecent: (
        limit: number,
      ) => Promise<Array<{ id: number; type: string; summary: string | null }>>;
      void: (id: number) => Promise<{ success: boolean; error?: string }>;
    };
    recharge: {
      getDrawerBalances: () => Promise<
        Array<{ name: string; usdBalance: number }>
      >;
    };
  };
};

async function generalUsd(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const w = window as unknown as Api;
    const rows = await w.api.recharge.getDrawerBalances();
    return rows.find((d) => d.name === "General")?.usdBalance ?? 0;
  });
}

async function partnerUsd(page: Page, partnerId: number): Promise<number> {
  return page.evaluate(async (id) => {
    const w = window as unknown as Api;
    return (await w.api.partners.getBalance(id)).usd;
  }, partnerId);
}

test.describe("LIRA-114 — POS checkout 'For Partner' control drives the FOR-partner sale end to end", () => {
  test("toggle on, pick partner via UI, pay $40 of $100 in cash — $60 remainder books to the partner; void nets it to 0", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const PRODUCT_NAME = `L114 Partner Widget ${ts}`;
    const PARTNER_NAME = `L114 Target Partner ${ts}`;
    const DECOY_NAME = `L114 Decoy Partner ${ts}`;

    // cost 60, sell 100; paying $40 cash leaves the shop's $60 unpaid.
    await seedProduct(appPage, {
      name: PRODUCT_NAME,
      cost_price: 60,
      sell_price: 100,
      quantity: 5,
    });

    // ≥2 active partners — see file header for why exactly-one breaks the UI.
    const setup = await appPage.evaluate(
      async ({ partnerName, decoyName }) => {
        const w = window as unknown as Api;
        const decoy = await w.api.partners.create({ name: decoyName });
        const target = await w.api.partners.create({
          name: partnerName,
          phone: `L114${Date.now()}`.slice(0, 12),
        });
        return {
          ok: decoy.success && target.success,
          error: decoy.error ?? target.error ?? null,
          partnerId: target.data?.id ?? 0,
        };
      },
      { partnerName: PARTNER_NAME, decoyName: DECOY_NAME },
    );
    expect(setup.error).toBeNull();
    expect(setup.ok).toBe(true);
    const partnerId = setup.partnerId;
    expect(partnerId).toBeGreaterThan(0);

    const partnerBalBefore = await partnerUsd(appPage, partnerId);
    const drawerBefore = await generalUsd(appPage);

    // ── Drive the real checkout UI ──────────────────────────────────────
    await navigateTo(appPage, "/pos");
    const searchInput = appPage.getByPlaceholder(
      "Search products by name or barcode...",
    );
    await expect(searchInput).toBeVisible({ timeout: 10_000 });
    await searchInput.fill(PRODUCT_NAME);
    const productItem = appPage.locator(`text=${PRODUCT_NAME}`).first();
    await expect(productItem).toBeVisible({ timeout: 5_000 });
    await productItem.click();

    await appPage
      .getByRole("button", { name: /Proceed to Checkout/i })
      .click();
    const modal = appPage.locator('[data-testid="checkout-modal"]');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Toggle "For Partner" on.
    const partnerToggle = modal.locator(
      '[data-testid="checkout-for-partner-toggle"]',
    );
    await expect(partnerToggle).toBeVisible({ timeout: 5_000 });
    await partnerToggle.click();

    // Pick the target partner from the dropdown (2+ partners → the real
    // Select renders, not the single-partner inline label).
    const partnerPicker = modal.getByRole("button", { name: "Select partner" });
    await expect(partnerPicker).toBeVisible({ timeout: 5_000 });
    await partnerPicker.click();
    await appPage
      .getByRole("option", { name: PARTNER_NAME, exact: true })
      .click();

    // Pay $40 cash — MultiPaymentInput defaults to a single CASH/USD line
    // pre-filled with the full $100; overwrite it to leave the $60 remainder.
    const amountInput = modal
      .locator('[data-testid^="payment-amount-"]')
      .first();
    await amountInput.click();
    await amountInput.fill("40");

    // No customer entered — the remainder must never try to become a client
    // debt; it must route to the partner selected above.
    await modal.locator('[data-testid="checkout-complete-btn"]').click();

    // Success closes the modal; a pre-fix failure leaves it open with an
    // error toast instead — either way, give the IPC round-trip time to
    // settle before reading balances (reading immediately risks a race).
    await expect(modal).toBeHidden({ timeout: 10_000 }).catch(() => {});

    const partnerBalAfter = await partnerUsd(appPage, partnerId);
    const drawerAfterSale = await generalUsd(appPage);

    // THE failing-first assertion (rule 17) — see file header.
    expect(partnerBalAfter - partnerBalBefore).toBeCloseTo(60, 2);
    // The drawer still takes the $40 cash the customer paid.
    expect(drawerAfterSale - drawerBefore).toBeCloseTo(40, 2);

    // Reversal symmetry (rule 20, generically guarded by lira-113): voiding
    // the SALE must net the partner back to exactly 0.
    const netted = await appPage.evaluate(
      async ({ name, partnerId, partnerBalBefore }) => {
        const w = window as unknown as Api;
        const row = (await w.api.transactions.getRecent(100)).find(
          (t) => t.type === "SALE" && (t.summary ?? "").includes(name),
        );
        const voided = row
          ? await w.api.transactions.void(row.id)
          : { success: false, error: "sale txn not found" };
        const after = (await w.api.partners.getBalance(partnerId)).usd;
        return {
          ok: voided.success,
          error: voided.error ?? null,
          netPartnerDelta: after - partnerBalBefore,
        };
      },
      { name: PRODUCT_NAME, partnerId, partnerBalBefore },
    );

    expect(netted.error).toBeNull();
    expect(netted.ok).toBe(true);
    expect(netted.netPartnerDelta).toBeCloseTo(0, 2);

    // And the drawer gives the $40 cash back on void.
    const drawerAfterVoid = await generalUsd(appPage);
    expect(drawerAfterVoid - drawerBefore).toBeCloseTo(0, 2);
  });
});
