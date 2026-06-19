/**
 * E2E: LIRA-056 — KATSH/iPick supplier-credit top-up + settle (no source-drawer deduction)
 *
 * A Katsh / iPick drawer can be funded on supplier credit: the provider extends
 * us credit, so the provider drawer goes UP by the amount and we now OWE the
 * supplier — but NO other (source) drawer is debited. This is the core
 * regression guarded here: a supplier top-up must NOT pull cash out of the
 * General drawer.
 *
 * Flow under test (driven through real main-process IPC):
 *   1. Katsh top-up — recharge.topUpFromSupplier({provider:'Katsh', amount, currency})
 *        → Katsh provider drawer +amount
 *        → General drawer UNCHANGED   (key no-deduction invariant)
 *        → supplier_ledger gains a positive TOP_UP row (we owe the supplier)
 *        → supplier balance +amount
 *   2. Settle — suppliers.addLedgerEntry({entry_type:'PAYMENT', amount_usd, drawer_name:'General'})
 *        → General drawer -amount  (cash leaves General to pay the supplier)
 *        → supplier_ledger gains a negative PAYMENT row
 *        → supplier balance nets back to its pre-top-up baseline
 *   3. iPick top-up — same as #1 for iPick, proving the provider→drawer map and
 *      the no-deduction invariant hold for the second supplier-credit provider.
 *
 * Cross-cutting rules honoured:
 *   - Shared per-worker DB → every assertion is a DELTA against a baseline
 *     snapshotted IMMEDIATELY before the action (never absolute totals).
 *   - Provider drawers (Katsh / iPick) are ONLY readable via
 *     recharge.getDrawerBalances() (name-keyed array; usdBalance / lbpBalance).
 *     dashboard.getDrawerBalances() exposes only generalDrawer + omtDrawer.
 *   - Supplier balances are targeted by captured supplier_id (never index 0).
 *   - recharge.topUpFromSupplier / suppliers.addLedgerEntry return {success,...};
 *     suppliers.getLedger / getBalances return RAW arrays. Both shapes handled.
 *   - Unique amounts per scenario reduce confusion across the ordered, shared DB,
 *     but correctness rests on the captured baseline deltas, not absolute totals.
 */

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

const KATSH_TOPUP_USD = 100;
const IPICK_TOPUP_USD = 100;

// ── Local API surface (electron.d.ts types are partial — cast window) ─────────
type SupplierLedgerRow = {
  entry_type: string;
  amount_usd: number;
  amount_lbp: number;
};

type SupplierBalanceRow = {
  supplier_id: number;
  total_usd: number;
  total_lbp: number;
};

type ProviderDrawerRow = {
  name: string;
  usdBalance: number;
  lbpBalance: number;
};

type SuccessEnvelope = { success?: boolean; error?: string };

type Api = {
  api: {
    recharge: {
      // recharge.getDrawerBalances() — name-keyed array covering ALL drawers
      // (General, Katsh, iPick, ...). usdBalance / lbpBalance (NOT usd / lbp).
      getDrawerBalances: () => Promise<ProviderDrawerRow[]>;
      topUpFromSupplier: (data: {
        provider: "iPick" | "Katsh";
        amount: number;
        currency: "USD" | "LBP";
      }) => Promise<SuccessEnvelope>;
    };
    suppliers: {
      list: (
        search?: string,
        includeInactive?: boolean,
      ) => Promise<Array<{ id: number; provider: string | null }>>;
      // RAW array, newest-first.
      getLedger: (
        supplierId: number,
        limit?: number,
      ) => Promise<SupplierLedgerRow[]>;
      // RAW array of per-supplier balances.
      getBalances: (
        includeInactive?: boolean,
      ) => Promise<SupplierBalanceRow[]>;
      // entry_type union + drawer_name (electron.d.ts omits drawer_name — the
      // handler/schema accept it and the repo debits that drawer for PAYMENT).
      addLedgerEntry: (data: {
        supplier_id: number;
        entry_type: "TOP_UP" | "PAYMENT" | "ADJUSTMENT";
        amount_usd: number;
        amount_lbp: number;
        note?: string;
        drawer_name?: string;
      }) => Promise<SuccessEnvelope>;
    };
  };
};

// Shared inline reader helpers, redefined inside each evaluate (self-contained).
// Documented here for intent; the real copies live in the evaluate bodies.

test.describe("LIRA-056 — supplier-credit top-up + settle (no source-drawer deduction)", () => {
  test("Katsh top-up funds provider drawer on credit, leaving General untouched", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(
      async ({ amount }) => {
        const w = window as unknown as Api;

        const drawerUsd = (rows: ProviderDrawerRow[], name: string): number =>
          rows.find((d) => d.name === name)?.usdBalance ?? 0;
        const balUsd = (
          rows: SupplierBalanceRow[],
          supplierId: number,
        ): number =>
          rows.find((b) => b.supplier_id === supplierId)?.total_usd ?? 0;

        const katsh = (await w.api.suppliers.list("", true)).find(
          (s) => s.provider === "Katsh",
        );
        if (!katsh) return { found: false } as const;

        // ── Snapshot baseline IMMEDIATELY before the action ──────────────────
        const drawersBefore = await w.api.recharge.getDrawerBalances();
        const katshDrawerBefore = drawerUsd(drawersBefore, "Katsh");
        const generalBefore = drawerUsd(drawersBefore, "General");

        const balancesBefore = await w.api.suppliers.getBalances(true);
        const supplierBalBefore = balUsd(balancesBefore, katsh.id);

        const ledgerBefore = await w.api.suppliers.getLedger(katsh.id, 200);
        const topUpCountBefore = ledgerBefore.filter(
          (l) => l.entry_type === "TOP_UP",
        ).length;

        // ── Action: top up Katsh on supplier credit ──────────────────────────
        const res = await w.api.recharge.topUpFromSupplier({
          provider: "Katsh",
          amount,
          currency: "USD",
        });

        // ── Re-read after ────────────────────────────────────────────────────
        const drawersAfter = await w.api.recharge.getDrawerBalances();
        const katshDrawerAfter = drawerUsd(drawersAfter, "Katsh");
        const generalAfter = drawerUsd(drawersAfter, "General");

        const balancesAfter = await w.api.suppliers.getBalances(true);
        const supplierBalAfter = balUsd(balancesAfter, katsh.id);

        const ledgerAfter = await w.api.suppliers.getLedger(katsh.id, 200);
        const topUpCountAfter = ledgerAfter.filter(
          (l) => l.entry_type === "TOP_UP",
        ).length;
        const newest = ledgerAfter[0] ?? null;

        return {
          found: true,
          ok: res?.success ?? true,
          error: res?.error ?? null,
          katshDrawerDelta:
            Math.round((katshDrawerAfter - katshDrawerBefore) * 100) / 100,
          generalDelta:
            Math.round((generalAfter - generalBefore) * 100) / 100,
          supplierBalDelta:
            Math.round((supplierBalAfter - supplierBalBefore) * 100) / 100,
          topUpAdded: topUpCountAfter - topUpCountBefore,
          newestType: newest?.entry_type ?? null,
          newestUsd: newest?.amount_usd ?? null,
        } as const;
      },
      { amount: KATSH_TOPUP_USD },
    );

    expect(result.found).toBe(true);
    if (!result.found) return;

    expect(result.error).toBeNull();
    expect(result.ok).not.toBe(false);

    // Provider drawer rose by exactly the top-up amount…
    expect(result.katshDrawerDelta).toBeCloseTo(KATSH_TOPUP_USD, 2);
    // …and NO source drawer was deducted — General is untouched (the regression).
    expect(result.generalDelta).toBeCloseTo(0, 2);

    // Exactly one new positive TOP_UP ledger row (we now owe the supplier).
    expect(result.topUpAdded).toBe(1);
    expect(result.newestType).toBe("TOP_UP");
    expect(result.newestUsd).toBeCloseTo(KATSH_TOPUP_USD, 2);

    // Supplier balance rose by the credit amount (positive = we owe them).
    expect(result.supplierBalDelta).toBeCloseTo(KATSH_TOPUP_USD, 2);
  });

  test("Settling the Katsh credit debits General and nets the ledger back to baseline", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(
      async ({ amount }) => {
        const w = window as unknown as Api;

        const drawerUsd = (rows: ProviderDrawerRow[], name: string): number =>
          rows.find((d) => d.name === name)?.usdBalance ?? 0;
        const balUsd = (
          rows: SupplierBalanceRow[],
          supplierId: number,
        ): number =>
          rows.find((b) => b.supplier_id === supplierId)?.total_usd ?? 0;

        const katsh = (await w.api.suppliers.list("", true)).find(
          (s) => s.provider === "Katsh",
        );
        if (!katsh) return { found: false } as const;

        // ── Snapshot baseline IMMEDIATELY before the settle action ───────────
        const drawersBefore = await w.api.recharge.getDrawerBalances();
        const generalBefore = drawerUsd(drawersBefore, "General");
        const katshDrawerBefore = drawerUsd(drawersBefore, "Katsh");

        const balancesBefore = await w.api.suppliers.getBalances(true);
        const supplierBalBefore = balUsd(balancesBefore, katsh.id);

        const ledgerBefore = await w.api.suppliers.getLedger(katsh.id, 200);
        const paymentCountBefore = ledgerBefore.filter(
          (l) => l.entry_type === "PAYMENT",
        ).length;

        // ── Action: settle the credit by paying the supplier from General ────
        // entry_type PAYMENT is stored as a negative ledger row; with a
        // drawer_name the repo debits that drawer by the (negative) amount.
        const res = await w.api.suppliers.addLedgerEntry({
          supplier_id: katsh.id,
          entry_type: "PAYMENT",
          amount_usd: amount,
          amount_lbp: 0,
          drawer_name: "General",
          note: "lira-056-e2e-katsh-settle",
        });

        // ── Re-read after ────────────────────────────────────────────────────
        const drawersAfter = await w.api.recharge.getDrawerBalances();
        const generalAfter = drawerUsd(drawersAfter, "General");
        const katshDrawerAfter = drawerUsd(drawersAfter, "Katsh");

        const balancesAfter = await w.api.suppliers.getBalances(true);
        const supplierBalAfter = balUsd(balancesAfter, katsh.id);

        const ledgerAfter = await w.api.suppliers.getLedger(katsh.id, 200);
        const paymentCountAfter = ledgerAfter.filter(
          (l) => l.entry_type === "PAYMENT",
        ).length;
        const newest = ledgerAfter[0] ?? null;

        return {
          found: true,
          ok: res?.success ?? true,
          error: res?.error ?? null,
          generalDelta:
            Math.round((generalAfter - generalBefore) * 100) / 100,
          katshDrawerDelta:
            Math.round((katshDrawerAfter - katshDrawerBefore) * 100) / 100,
          supplierBalDelta:
            Math.round((supplierBalAfter - supplierBalBefore) * 100) / 100,
          paymentAdded: paymentCountAfter - paymentCountBefore,
          newestType: newest?.entry_type ?? null,
          newestUsd: newest?.amount_usd ?? null,
        } as const;
      },
      { amount: KATSH_TOPUP_USD },
    );

    expect(result.found).toBe(true);
    if (!result.found) return;

    expect(result.error).toBeNull();
    expect(result.ok).not.toBe(false);

    // Cash leaves General to pay the supplier — General DOWN by the amount.
    expect(result.generalDelta).toBeCloseTo(-KATSH_TOPUP_USD, 2);
    // Settling a credit does NOT touch the provider drawer.
    expect(result.katshDrawerDelta).toBeCloseTo(0, 2);

    // Exactly one new PAYMENT ledger row, stored as a NEGATIVE amount.
    expect(result.paymentAdded).toBe(1);
    expect(result.newestType).toBe("PAYMENT");
    expect(result.newestUsd).toBeCloseTo(-KATSH_TOPUP_USD, 2);

    // The PAYMENT cancels the earlier TOP_UP → balance moves back DOWN by the
    // amount (nets the credit to its pre-top-up baseline).
    expect(result.supplierBalDelta).toBeCloseTo(-KATSH_TOPUP_USD, 2);
  });

  test("iPick top-up funds provider drawer on credit, leaving General untouched", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(
      async ({ amount }) => {
        const w = window as unknown as Api;

        const drawerUsd = (rows: ProviderDrawerRow[], name: string): number =>
          rows.find((d) => d.name === name)?.usdBalance ?? 0;
        const balUsd = (
          rows: SupplierBalanceRow[],
          supplierId: number,
        ): number =>
          rows.find((b) => b.supplier_id === supplierId)?.total_usd ?? 0;

        const ipick = (await w.api.suppliers.list("", true)).find(
          (s) => s.provider === "iPick",
        );
        if (!ipick) return { found: false } as const;

        // ── Snapshot baseline IMMEDIATELY before the action ──────────────────
        const drawersBefore = await w.api.recharge.getDrawerBalances();
        const ipickDrawerBefore = drawerUsd(drawersBefore, "iPick");
        const generalBefore = drawerUsd(drawersBefore, "General");

        const balancesBefore = await w.api.suppliers.getBalances(true);
        const supplierBalBefore = balUsd(balancesBefore, ipick.id);

        const ledgerBefore = await w.api.suppliers.getLedger(ipick.id, 200);
        const topUpCountBefore = ledgerBefore.filter(
          (l) => l.entry_type === "TOP_UP",
        ).length;

        // ── Action: top up iPick on supplier credit ──────────────────────────
        const res = await w.api.recharge.topUpFromSupplier({
          provider: "iPick",
          amount,
          currency: "USD",
        });

        // ── Re-read after ────────────────────────────────────────────────────
        const drawersAfter = await w.api.recharge.getDrawerBalances();
        const ipickDrawerAfter = drawerUsd(drawersAfter, "iPick");
        const generalAfter = drawerUsd(drawersAfter, "General");

        const balancesAfter = await w.api.suppliers.getBalances(true);
        const supplierBalAfter = balUsd(balancesAfter, ipick.id);

        const ledgerAfter = await w.api.suppliers.getLedger(ipick.id, 200);
        const topUpCountAfter = ledgerAfter.filter(
          (l) => l.entry_type === "TOP_UP",
        ).length;
        const newest = ledgerAfter[0] ?? null;

        return {
          found: true,
          ok: res?.success ?? true,
          error: res?.error ?? null,
          ipickDrawerDelta:
            Math.round((ipickDrawerAfter - ipickDrawerBefore) * 100) / 100,
          generalDelta:
            Math.round((generalAfter - generalBefore) * 100) / 100,
          supplierBalDelta:
            Math.round((supplierBalAfter - supplierBalBefore) * 100) / 100,
          topUpAdded: topUpCountAfter - topUpCountBefore,
          newestType: newest?.entry_type ?? null,
          newestUsd: newest?.amount_usd ?? null,
        } as const;
      },
      { amount: IPICK_TOPUP_USD },
    );

    expect(result.found).toBe(true);
    if (!result.found) return;

    expect(result.error).toBeNull();
    expect(result.ok).not.toBe(false);

    // Provider drawer rose by exactly the top-up amount…
    expect(result.ipickDrawerDelta).toBeCloseTo(IPICK_TOPUP_USD, 2);
    // …and General is untouched — no source-drawer deduction (the regression).
    expect(result.generalDelta).toBeCloseTo(0, 2);

    // Exactly one new positive TOP_UP ledger row.
    expect(result.topUpAdded).toBe(1);
    expect(result.newestType).toBe("TOP_UP");
    expect(result.newestUsd).toBeCloseTo(IPICK_TOPUP_USD, 2);

    // Supplier balance rose by the credit amount.
    expect(result.supplierBalDelta).toBeCloseTo(IPICK_TOPUP_USD, 2);
  });
});

// Keep a typed reference to Page so the import is always used.
export type _SupplierCreditTopUpSpecPage = Page;
