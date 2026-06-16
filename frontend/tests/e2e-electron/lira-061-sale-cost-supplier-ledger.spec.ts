/**
 * E2E: LIRA-061 — Cost/price-flow SEND books a settleable SALE_COST, not TOP_UP
 *
 * Reproduces and guards the bug where a SALE through a cost/price provider
 * (Katsh / iPick, and the SEND side of Whish App / OMT App) auto-wrote a
 * `TOP_UP` entry into the supplier ledger — looking identical to a manual
 * supplier top-up and never appearing in the Settle tab.
 *
 * Flow under test (driven through real main-process IPC, then verified in the UI):
 *   1. Create a Katsh SEND with cost < price via window.api.omt.addTransaction.
 *   2. Read the Katsh supplier ledger via window.api.suppliers.getLedger and
 *      assert the newest auto entry is entry_type = 'SALE_COST' (never 'TOP_UP'),
 *      with amount_usd = the sale cost.
 *   3. Assert the row surfaces in window.api.suppliers.getUnsettledTransactions
 *      for "Katsh" (so it is reconcilable in the Settle tab).
 *   4. Open the Suppliers page, select Katsh, and confirm the ledger renders a
 *      distinct "SALE COST" badge.
 *
 * Uses the shared Electron instance / fresh DB (same as the other specs).
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

const COST_USD = 90;
const PRICE_USD = 100;

type SupplierApi = {
  api: {
    omt: {
      addTransaction: (data: Record<string, unknown>) => Promise<unknown>;
    };
    suppliers: {
      list: (
        search?: string,
        includeInactive?: boolean,
      ) => Promise<Array<{ id: number; provider: string | null }>>;
      getLedger: (
        supplierId: number,
        limit?: number,
      ) => Promise<
        Array<{ entry_type: string; amount_usd: number; amount_lbp: number }>
      >;
      getUnsettledTransactions: (
        provider: string,
      ) => Promise<Array<{ id: number; amount: number; commission: number }>>;
    };
  };
};

test.describe("LIRA-061 — cost/price SEND books SALE_COST in supplier ledger", () => {
  test("Katsh SEND writes SALE_COST (not TOP_UP) and is settleable", async ({
    appPage,
  }) => {
    // ── 1. Create a Katsh cost/price SEND via IPC ────────────────────────────
    const created = await appPage.evaluate(
      async ({ cost, price }) => {
        const w = window as unknown as SupplierApi;
        return w.api.omt.addTransaction({
          provider: "Katsh",
          serviceType: "SEND",
          amount: price,
          currency: "USD",
          commission: 0,
          cost,
          price,
          paidByMethod: "CASH",
          itemKey: "lira-061-e2e",
        });
      },
      { cost: COST_USD, price: PRICE_USD },
    );
    // addTransaction returns the standard { success, ... } envelope
    expect((created as { success?: boolean })?.success ?? true).not.toBe(false);

    // ── 2 + 3. Verify the ledger entry and the unsettled list via IPC ────────
    const result = await appPage.evaluate(async () => {
      const w = window as unknown as SupplierApi;
      const suppliers = await w.api.suppliers.list("", true);
      const katsh = suppliers.find((s) => s.provider === "Katsh");
      if (!katsh) return { found: false } as const;

      const ledger = await w.api.suppliers.getLedger(katsh.id, 50);
      const unsettled =
        await w.api.suppliers.getUnsettledTransactions("Katsh");

      return {
        found: true,
        entryTypes: ledger.map((l) => l.entry_type),
        newest: ledger[0] ?? null,
        hasTopUp: ledger.some((l) => l.entry_type === "TOP_UP"),
        unsettledCount: unsettled.length,
        unsettledAmounts: unsettled.map((u) => ({
          amount: u.amount,
          commission: u.commission,
        })),
      } as const;
    });

    expect(result.found).toBe(true);
    if (!result.found) return;

    // The auto entry must be SALE_COST, never the old TOP_UP label.
    expect(result.entryTypes).toContain("SALE_COST");
    expect(result.hasTopUp).toBe(false);
    expect(result.newest?.entry_type).toBe("SALE_COST");
    expect(result.newest?.amount_usd).toBeCloseTo(COST_USD, 2);

    // It must be settleable — surfaced in the Settle tab's source query,
    // projected so net pay (amount − commission) equals the sale cost.
    expect(result.unsettledCount).toBeGreaterThan(0);
    const saleCostRow = result.unsettledAmounts.find(
      (u) => Math.abs(u.amount - COST_USD) < 0.01,
    );
    expect(saleCostRow).toBeTruthy();
    expect(saleCostRow?.commission).toBe(0);

    // ── 4. Verify the distinct badge renders on the Suppliers page ───────────
    await navigateTo(appPage, "/suppliers");

    const katshBtn = appPage
      .locator("button")
      .filter({ hasText: /Katsh/ })
      .first();
    await expect(katshBtn).toBeVisible({ timeout: 10_000 });
    await katshBtn.click();

    // The ledger history renders a distinct "SALE COST" badge for the new row.
    await expect(appPage.getByText("SALE COST").first()).toBeVisible({
      timeout: 10_000,
    });
  });
});

// Keep a typed reference to Page so the import is always used even if the
// assertions above are trimmed in a future edit.
export type _SaleCostSpecPage = Page;
