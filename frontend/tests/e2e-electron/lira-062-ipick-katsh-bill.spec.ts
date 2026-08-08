/**
 * E2E: LIRA-062 — iPick / Katsh: Bills Section
 *
 * ORIGINAL (pre-plan) behaviour: every BILL hardcoded a −20,000 LBP
 * SUPPLIER_PAYS_US credit AT CREATION. `docs/plans/todo_plans/
 * COMMISSION_AT_SETTLEMENT_PLAN.md` Phase 1 removed that: a fresh iPick/
 * Katsh BILL is now born `commission_model = 1` (AT_SETTLEMENT) —
 * `FinancialServiceRepository.createTransaction`'s `commissionModel` stamp
 * (gated on `service_type === "BILL"`, `FinancialServiceRepository.ts:1047`)
 * and its legacy −20,000 booking gate (`commissionModel === 0 &&
 * !skipSecondarySupplierLedger`, `:3337`) both key off it — so a NEW bill
 * books NOTHING at creation. It joins the unsettled queue instead
 * (`isPendingSupplierSettlement` / `PENDING_SETTLEMENT_SQL`, same file
 * `:679-709`) and the real commission is entered later, at supplier
 * settlement (`SupplierRepository.settleTransactions` →
 * `_bookCommissionAtSettlement`), proven end-to-end by
 * `lira-089-bill-commission-settlement.spec.ts`.
 *
 * This spec now validates, per provider:
 *   1. A BILL is submitted via IPC — service_type = 'BILL'.
 *   2. NO SUPPLIER_PAYS_US commission credit posts at creation: the
 *      supplier's ledger balance is unchanged by the action (delta = 0) and
 *      no NEW "BILL commission from <provider>" entry appears.
 *   3. The row is born `commission_model = 1`, `settlement_id IS NULL`, and
 *      has joined the unsettled queue (`bill_count` in
 *      `suppliers:unsettled-summary` goes up by exactly 1).
 *   4. (Katsh only) The Bill card still renders in the Recharge/Katsh tab —
 *      the money-model change doesn't touch the UI.
 *
 * Uses the shared Electron instance / accumulating DB (rule 15): every money
 * assertion is a delta snapshotted immediately before the action, and the
 * bill's own financial_services row is found by the id `omt.addTransaction`
 * itself returns — never by list position or "newest row".
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

const BILL_AMOUNT_LBP = 50_000;

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
      ) => Promise<
        Array<{ id: number; name: string; provider: string | null }>
      >;
      getBalances: (
        includeInactive?: boolean,
      ) => Promise<Array<{ supplier_id: number; total_lbp: number }>>;
      getLedger: (
        supplierId: number,
        limit?: number,
      ) => Promise<
        Array<{
          entry_type: string;
          amount_usd: number;
          amount_lbp: number;
          note: string;
        }>
      >;
      getUnsettledTransactions: (provider: string) => Promise<
        Array<{
          id: number;
          service_type: string;
          amount: number;
          currency: string;
          commission_model: number;
          settlement_id: number | null;
        }>
      >;
      getUnsettledSummary: () => Promise<
        Array<{ provider: string; count: number; bill_count: number }>
      >;
    };
  };
};

test.describe("LIRA-062 — Katsh/iPick Bill card", () => {
  test("Katsh BILL: books no commission credit at creation, born commission_model=1 in the unsettled queue", async ({
    appPage,
  }) => {
    // ── Baselines, immediately before the action (rule 15) ──────────────────
    const katsh = await appPage.evaluate(async () => {
      const w = window as unknown as WindowApi;
      return (await w.api.suppliers.list("", true)).find(
        (s) => s.provider === "Katsh",
      );
    });
    expect(katsh, "Katsh supplier not found").toBeTruthy();
    const katshId = katsh!.id;

    const balBefore = await appPage.evaluate(async (id) => {
      const w = window as unknown as WindowApi;
      return (
        (await w.api.suppliers.getBalances(true)).find(
          (b) => b.supplier_id === id,
        )?.total_lbp ?? 0
      );
    }, katshId);

    const legacyCreditsBefore = await appPage.evaluate(async (id) => {
      const w = window as unknown as WindowApi;
      return (await w.api.suppliers.getLedger(id, 500)).filter(
        (l) =>
          l.entry_type === "SUPPLIER_PAYS_US" &&
          (l.note ?? "").includes("BILL commission from Katsh"),
      ).length;
    }, katshId);

    const billCountBefore = await appPage.evaluate(async () => {
      const w = window as unknown as WindowApi;
      return (
        (await w.api.suppliers.getUnsettledSummary()).find(
          (s) => s.provider === "Katsh",
        )?.bill_count ?? 0
      );
    });

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
    expect(created.id, "addTransaction did not return an id").toBeTruthy();
    const billId = created.id!;

    // ── 2. NO commission credit posted at creation ──────────────────────────
    // Supplier ledger balance delta = 0 covers ANY new booking, not just the
    // old literal −20,000 shape.
    const balAfter = await appPage.evaluate(async (id) => {
      const w = window as unknown as WindowApi;
      return (
        (await w.api.suppliers.getBalances(true)).find(
          (b) => b.supplier_id === id,
        )?.total_lbp ?? 0
      );
    }, katshId);
    expect(balAfter - balBefore).toBe(0);

    const legacyCreditsAfter = await appPage.evaluate(async (id) => {
      const w = window as unknown as WindowApi;
      return (await w.api.suppliers.getLedger(id, 500)).filter(
        (l) =>
          l.entry_type === "SUPPLIER_PAYS_US" &&
          (l.note ?? "").includes("BILL commission from Katsh"),
      ).length;
    }, katshId);
    expect(legacyCreditsAfter - legacyCreditsBefore).toBe(0);

    // ── 3. Born commission_model=1, in the unsettled queue ──────────────────
    const billRow = await appPage.evaluate(
      async (args: { provider: string; id: number }) => {
        const w = window as unknown as WindowApi;
        const rows = await w.api.suppliers.getUnsettledTransactions(
          args.provider,
        );
        return rows.find((r) => r.id === args.id) ?? null;
      },
      { provider: "Katsh", id: billId },
    );
    expect(
      billRow,
      "new BILL row not found in the unsettled queue",
    ).toBeTruthy();
    expect(billRow!.service_type).toBe("BILL");
    expect(billRow!.commission_model).toBe(1);
    expect(billRow!.settlement_id).toBeNull();

    const billCountAfter = await appPage.evaluate(async () => {
      const w = window as unknown as WindowApi;
      return (
        (await w.api.suppliers.getUnsettledSummary()).find(
          (s) => s.provider === "Katsh",
        )?.bill_count ?? 0
      );
    });
    expect(billCountAfter - billCountBefore).toBe(1);

    // ── 4. Verify the Bill card renders on the Recharge / Katsh tab ─────────
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
    const lbpToggle = appPage
      .locator("button")
      .filter({ hasText: /^LBP$/ })
      .first();
    await expect(lbpToggle).toBeVisible({ timeout: 5_000 });
  });

  test("iPick BILL: books no commission credit at creation, born commission_model=1 in the unsettled queue", async ({
    appPage,
  }) => {
    const ipick = await appPage.evaluate(async () => {
      const w = window as unknown as WindowApi;
      return (await w.api.suppliers.list("", true)).find(
        (s) => s.provider === "iPick",
      );
    });
    expect(ipick, "iPick supplier not found").toBeTruthy();
    const ipickId = ipick!.id;

    const balBefore = await appPage.evaluate(async (id) => {
      const w = window as unknown as WindowApi;
      return (
        (await w.api.suppliers.getBalances(true)).find(
          (b) => b.supplier_id === id,
        )?.total_lbp ?? 0
      );
    }, ipickId);

    const legacyCreditsBefore = await appPage.evaluate(async (id) => {
      const w = window as unknown as WindowApi;
      return (await w.api.suppliers.getLedger(id, 500)).filter(
        (l) =>
          l.entry_type === "SUPPLIER_PAYS_US" &&
          (l.note ?? "").includes("BILL commission from iPick"),
      ).length;
    }, ipickId);

    const billCountBefore = await appPage.evaluate(async () => {
      const w = window as unknown as WindowApi;
      return (
        (await w.api.suppliers.getUnsettledSummary()).find(
          (s) => s.provider === "iPick",
        )?.bill_count ?? 0
      );
    });

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
    expect(created.id, "addTransaction did not return an id").toBeTruthy();
    const billId = created.id!;

    const balAfter = await appPage.evaluate(async (id) => {
      const w = window as unknown as WindowApi;
      return (
        (await w.api.suppliers.getBalances(true)).find(
          (b) => b.supplier_id === id,
        )?.total_lbp ?? 0
      );
    }, ipickId);
    expect(balAfter - balBefore).toBe(0);

    const legacyCreditsAfter = await appPage.evaluate(async (id) => {
      const w = window as unknown as WindowApi;
      return (await w.api.suppliers.getLedger(id, 500)).filter(
        (l) =>
          l.entry_type === "SUPPLIER_PAYS_US" &&
          (l.note ?? "").includes("BILL commission from iPick"),
      ).length;
    }, ipickId);
    expect(legacyCreditsAfter - legacyCreditsBefore).toBe(0);

    const billRow = await appPage.evaluate(
      async (args: { provider: string; id: number }) => {
        const w = window as unknown as WindowApi;
        const rows = await w.api.suppliers.getUnsettledTransactions(
          args.provider,
        );
        return rows.find((r) => r.id === args.id) ?? null;
      },
      { provider: "iPick", id: billId },
    );
    expect(
      billRow,
      "new BILL row not found in the unsettled queue",
    ).toBeTruthy();
    expect(billRow!.service_type).toBe("BILL");
    expect(billRow!.commission_model).toBe(1);
    expect(billRow!.settlement_id).toBeNull();

    const billCountAfter = await appPage.evaluate(async () => {
      const w = window as unknown as WindowApi;
      return (
        (await w.api.suppliers.getUnsettledSummary()).find(
          (s) => s.provider === "iPick",
        )?.bill_count ?? 0
      );
    });
    expect(billCountAfter - billCountBefore).toBe(1);
  });
});

// Keep a typed reference to Page so the import is always used.
export type _BillSpecPage = Page;
