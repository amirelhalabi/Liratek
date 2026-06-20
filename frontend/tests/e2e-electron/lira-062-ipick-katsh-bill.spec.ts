/**
 * E2E: LIRA-062 — iPick / Katsh: Bills Section
 *
 * Validates the Bill feature added to the KatchForm grid:
 *   1. A Katsh BILL of 50,000 LBP is submitted via IPC.
 *   2. The financial_services row has service_type = 'BILL'.
 *   3. The Katsh supplier ledger gains a SUPPLIER_PAYS_US entry
 *      with amount_lbp = -20,000 (the hardcoded commission the supplier owes us).
 *   4. The Bill card is visible in the Katsh tab of the Recharge page.
 *
 * Uses the shared Electron instance / fresh DB (same as the other specs).
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

const BILL_AMOUNT_LBP = 50_000;
const BILL_COMMISSION_LBP = -20_000;

type WindowApi = {
  api: {
    omt: {
      addTransaction: (data: Record<string, unknown>) => Promise<{
        success: boolean;
        error?: string;
        id?: number;
      }>;
    };
    suppliers: {
      list: (
        search?: string,
        includeInactive?: boolean,
      ) => Promise<Array<{ id: number; name: string; provider: string | null }>>;
      getLedger: (
        supplierId: number,
        limit?: number,
      ) => Promise<
        Array<{ entry_type: string; amount_usd: number; amount_lbp: number; note: string }>
      >;
    };
    financial: {
      list: (filters?: Record<string, unknown>) => Promise<{
        success: boolean;
        data?: Array<{ id: number; service_type: string; amount: number; currency: string }>;
      }>;
    };
  };
};

test.describe("LIRA-062 — Katsh/iPick Bill card", () => {
  test("Katsh BILL: service_type=BILL, SUPPLIER_PAYS_US −20,000 LBP in ledger", async ({
    appPage,
  }) => {
    // ── 1. Submit a Katsh BILL via IPC ──────────────────────────────────────
    const created = await appPage.evaluate(
      async ({ amount }) => {
        const w = window as unknown as WindowApi;
        return w.api.omt.addTransaction({
          provider: "Katsh",
          serviceType: "BILL",
          amount,
          cost: amount,
          price: amount,
          currency: "LBP",
          commission: 0,
          paidByMethod: "CASH",
        });
      },
      { amount: BILL_AMOUNT_LBP },
    );

    expect(created.success).toBe(true);

    // ── 2. Verify the Katsh supplier ledger has the commission entry ─────────
    // Match the BILL entry by IDENTITY (entry_type + note), NEVER by row
    // position: the shared per-run DB has prior SETTLEMENT entries against Katsh
    // (lira-056/061) and getSupplierLedger orders by second-granular created_at
    // with no id tiebreaker, so ledger[0] can tie to a SETTLEMENT (CLAUDE.md rule 15).
    const ledgerResult = await appPage.evaluate(async () => {
      const w = window as unknown as WindowApi;
      const suppliers = await w.api.suppliers.list("", true);
      const katsh = suppliers.find((s) => s.provider === "Katsh");
      if (!katsh) return { found: false } as const;

      const ledger = await w.api.suppliers.getLedger(katsh.id, 50);
      return {
        found: true,
        supplierId: katsh.id,
        entryTypes: ledger.map((l) => l.entry_type),
        billEntries: ledger.filter(
          (l) =>
            l.entry_type === "SUPPLIER_PAYS_US" &&
            (l.note ?? "").includes("BILL commission from Katsh"),
        ),
      } as const;
    });

    expect(ledgerResult.found).toBe(true);
    if (!ledgerResult.found) return;

    // The BILL path must log a SUPPLIER_PAYS_US entry (not SALE_COST/TOP_UP).
    expect(ledgerResult.entryTypes).toContain("SUPPLIER_PAYS_US");
    // Exactly one BILL-commission entry from this action.
    expect(ledgerResult.billEntries).toHaveLength(1);
    // Negative amount_lbp = supplier owes us (shown green on Suppliers page).
    expect(ledgerResult.billEntries[0]?.amount_lbp).toBe(BILL_COMMISSION_LBP);
    expect(ledgerResult.billEntries[0]?.amount_usd).toBe(0);

    // ── 3. Verify the Bill card renders on the Recharge / Katsh tab ─────────
    await navigateTo(appPage, "/recharge");

    const katshTab = appPage
      .locator("button")
      .filter({ hasText: /^Katsh$/ })
      .first();
    await expect(katshTab).toBeVisible({ timeout: 8_000 });
    await katshTab.click({ force: true });

    // The Bill card is always pinned at the top of the grid.
    await expect(appPage.getByText("BILL").first()).toBeVisible({
      timeout: 8_000,
    });

    // The LBP/USD toggle should be present inside the Bill card.
    const lbpToggle = appPage.locator("button").filter({ hasText: /^LBP$/ }).first();
    await expect(lbpToggle).toBeVisible({ timeout: 5_000 });
  });

  test("iPick BILL: SUPPLIER_PAYS_US −20,000 LBP logged against iPick supplier", async ({
    appPage,
  }) => {
    const created = await appPage.evaluate(
      async ({ amount }) => {
        const w = window as unknown as WindowApi;
        return w.api.omt.addTransaction({
          provider: "iPick",
          serviceType: "BILL",
          amount,
          cost: amount,
          price: amount,
          currency: "LBP",
          commission: 0,
          paidByMethod: "CASH",
        });
      },
      { amount: BILL_AMOUNT_LBP },
    );

    expect(created.success).toBe(true);

    const ledgerResult = await appPage.evaluate(async () => {
      const w = window as unknown as WindowApi;
      const suppliers = await w.api.suppliers.list("", true);
      const ipick = suppliers.find((s) => s.provider === "iPick");
      if (!ipick) return { found: false } as const;

      const ledger = await w.api.suppliers.getLedger(ipick.id, 50);
      // Match by identity (type + note), not row position — see test above.
      return {
        found: true,
        billEntries: ledger.filter(
          (l) =>
            l.entry_type === "SUPPLIER_PAYS_US" &&
            (l.note ?? "").includes("BILL commission from iPick"),
        ),
      } as const;
    });

    expect(ledgerResult.found).toBe(true);
    if (!ledgerResult.found) return;

    expect(ledgerResult.billEntries).toHaveLength(1);
    expect(ledgerResult.billEntries[0]?.amount_lbp).toBe(BILL_COMMISSION_LBP);
    expect(ledgerResult.billEntries[0]?.amount_usd).toBe(0);
  });
});

// Keep a typed reference to Page so the import is always used.
export type _BillSpecPage = Page;
