/**
 * E2E: LIRA-059 — Suppliers bidirectional balance + supplier-pays-us
 *
 * The Suppliers ledger must support BOTH directions of cash movement, each
 * landing in the General drawer (NOT the provider's own stock drawer — that was
 * the original bug) and each moving the running balance by the right sign:
 *
 *   - PAY      (shop pays the supplier)  → one PAYMENT ledger row (negative),
 *               General drawer DEBITED, balance goes DOWN.
 *   - RECEIVE  (supplier pays the shop)  → one SUPPLIER_PAYS_US ledger row
 *               (positive — requires the migration-v103 CHECK to accept it),
 *               General drawer CREDITED, balance goes UP.
 *
 * Overpaying a positive balance must drive it NEGATIVE ("they owe you").
 * Manually-created suppliers are Companies/Products (is_system=0); a seeded
 * provider supplier is a System provider (is_system=1).
 *
 * Driven through real main-process IPC (window.api.suppliers.*), shared
 * per-worker DB. Every assertion is a DELTA snapshotted immediately before its
 * action, and targets a specific entry_type / captured supplier id — never an
 * absolute total nor getLedger index 0.
 *
 *   - recordCashflow / addLedgerEntry / create return { success, id?, error? }.
 *   - getLedger / getBalances / list return RAW arrays.
 *   - Provider drawers are NOT touched here (PAY/RECEIVE route CASH → General),
 *     so the General drawer is read via dashboard.getDrawerBalances().
 *
 * Base system = OMT (completeSetup), so the OMT supplier is on the default list
 * and is a non-gated cost/price provider — safe to assert on. WHISH base is
 * partner-gated on an OMT-base setup and is never asserted on here.
 */

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

// Distinctive marker so the manually-created supplier never collides with a
// sibling spec's row in the shared DB.
const COMPANY_SUPPLIER_NAME = "E2E-059 Bidir Company — 9c4f2";

type SupplierRow = {
  id: number;
  name: string;
  provider: string | null;
  is_system: number;
};

type LedgerRow = {
  id: number;
  entry_type: string;
  amount_usd: number;
  amount_lbp: number;
};

type BalanceRow = {
  supplier_id: number;
  total_usd: number;
  total_lbp: number;
};

type Envelope = { success: boolean; id?: number; error?: string };

type Api = {
  api: {
    suppliers: {
      list: (
        search?: string,
        includeInactive?: boolean,
      ) => Promise<SupplierRow[]>;
      getBalances: (includeInactive?: boolean) => Promise<BalanceRow[]>;
      getLedger: (supplierId: number, limit?: number) => Promise<LedgerRow[]>;
      create: (data: {
        name: string;
        contact_name?: string;
        phone?: string;
        note?: string;
      }) => Promise<Envelope>;
      addLedgerEntry: (data: {
        supplier_id: number;
        entry_type: "TOP_UP" | "PAYMENT" | "ADJUSTMENT";
        amount_usd: number;
        amount_lbp: number;
        note?: string;
      }) => Promise<Envelope>;
      recordCashflow: (data: {
        supplier_id: number;
        direction: "PAY" | "RECEIVE";
        payments: Array<{
          method: string;
          currency_code: string;
          amount: number;
        }>;
        note?: string;
      }) => Promise<Envelope>;
    };
    dashboard: {
      getDrawerBalances: () => Promise<{
        generalDrawer?: { usd?: number; lbp?: number };
        omtDrawer?: { usd?: number; lbp?: number };
      }>;
    };
  };
};

test.describe("LIRA-059 — supplier bidirectional cashflow", () => {
  test("PAY (CASH) pays down a positive OMT balance: PAYMENT ledger row, General −$100, balance −$100", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(async () => {
      const w = window as unknown as Api;

      const generalUsd = (
        raw: { generalDrawer?: { usd?: number } } | null,
      ): number => raw?.generalDrawer?.usd ?? 0;
      const balUsd = (rows: BalanceRow[], id: number): number =>
        rows.find((b) => b.supplier_id === id)?.total_usd ?? 0;

      // Resolve the seeded OMT system supplier (base system → on default list,
      // non-gated). includeInactive so resolution is robust.
      const suppliers = await w.api.suppliers.list("", true);
      const omt = suppliers.find((s) => s.provider === "OMT");
      if (!omt) return { found: false } as const;

      // Seed a positive owed balance with NO drawer effect (addLedgerEntry with
      // no drawer_name → ledger row only).
      const seed = await w.api.suppliers.addLedgerEntry({
        supplier_id: omt.id,
        entry_type: "TOP_UP",
        amount_usd: 100,
        amount_lbp: 0,
        note: "LIRA-059 PAY scenario seed",
      });

      // Snapshot baselines IMMEDIATELY before the action under test.
      const beforeGeneral = generalUsd(
        await w.api.dashboard.getDrawerBalances(),
      );
      const beforeBalance = balUsd(await w.api.suppliers.getBalances(true), omt.id);

      // PAY $100 CASH/USD → General debited, ledger PAYMENT (negative).
      const pay = await w.api.suppliers.recordCashflow({
        supplier_id: omt.id,
        direction: "PAY",
        payments: [{ method: "CASH", currency_code: "USD", amount: 100 }],
        note: "LIRA-059 PAY $100",
      });

      const afterGeneral = generalUsd(
        await w.api.dashboard.getDrawerBalances(),
      );
      const afterBalance = balUsd(await w.api.suppliers.getBalances(true), omt.id);

      // Find the PAYMENT row this action created (target by captured cashflow id
      // when available; else by the newest PAYMENT row).
      const ledger = await w.api.suppliers.getLedger(omt.id, 100);
      const paymentRow =
        (pay.id != null && ledger.find((l) => l.id === pay.id)) ||
        ledger.find((l) => l.entry_type === "PAYMENT") ||
        null;

      return {
        found: true as const,
        seedOk: seed.success,
        payOk: pay.success,
        payError: pay.error ?? null,
        generalDelta: Math.round((afterGeneral - beforeGeneral) * 100) / 100,
        balanceDelta: Math.round((afterBalance - beforeBalance) * 100) / 100,
        paymentRowType: paymentRow?.entry_type ?? null,
        paymentRowUsd: paymentRow?.amount_usd ?? null,
      };
    });

    expect(result.found).toBe(true);
    if (!result.found) return;

    expect(result.seedOk).toBe(true);
    expect(result.payError).toBeNull();
    expect(result.payOk).toBe(true);

    // The captured cashflow row is a PAYMENT stored as NEGATIVE.
    expect(result.paymentRowType).toBe("PAYMENT");
    expect(result.paymentRowUsd).toBeCloseTo(-100, 2);

    // PAY hits the GENERAL drawer (not the provider drawer — the original bug):
    // General falls by exactly $100 and the balance pays down by exactly $100.
    expect(result.generalDelta).toBeCloseTo(-100, 2);
    expect(result.balanceDelta).toBeCloseTo(-100, 2);
  });

  test("RECEIVE (supplier pays us): SUPPLIER_PAYS_US +$30 ledger row, General +$30, balance +$30", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(async () => {
      const w = window as unknown as Api;

      const generalUsd = (
        raw: { generalDrawer?: { usd?: number } } | null,
      ): number => raw?.generalDrawer?.usd ?? 0;
      const balUsd = (rows: BalanceRow[], id: number): number =>
        rows.find((b) => b.supplier_id === id)?.total_usd ?? 0;

      const suppliers = await w.api.suppliers.list("", true);
      const omt = suppliers.find((s) => s.provider === "OMT");
      if (!omt) return { found: false } as const;

      // Snapshot baselines immediately before the action.
      const beforeGeneral = generalUsd(
        await w.api.dashboard.getDrawerBalances(),
      );
      const beforeBalance = balUsd(await w.api.suppliers.getBalances(true), omt.id);

      // RECEIVE $30 CASH/USD → supplier pays us; General credited, ledger
      // SUPPLIER_PAYS_US (positive — proves the migration-v103 CHECK at runtime).
      const recv = await w.api.suppliers.recordCashflow({
        supplier_id: omt.id,
        direction: "RECEIVE",
        payments: [{ method: "CASH", currency_code: "USD", amount: 30 }],
        note: "LIRA-059 RECEIVE $30",
      });

      const afterGeneral = generalUsd(
        await w.api.dashboard.getDrawerBalances(),
      );
      const afterBalance = balUsd(await w.api.suppliers.getBalances(true), omt.id);

      const ledger = await w.api.suppliers.getLedger(omt.id, 100);
      const receiveRow =
        (recv.id != null && ledger.find((l) => l.id === recv.id)) ||
        ledger.find((l) => l.entry_type === "SUPPLIER_PAYS_US") ||
        null;

      return {
        found: true as const,
        recvOk: recv.success,
        recvError: recv.error ?? null,
        generalDelta: Math.round((afterGeneral - beforeGeneral) * 100) / 100,
        balanceDelta: Math.round((afterBalance - beforeBalance) * 100) / 100,
        receiveRowType: receiveRow?.entry_type ?? null,
        receiveRowUsd: receiveRow?.amount_usd ?? null,
      };
    });

    expect(result.found).toBe(true);
    if (!result.found) return;

    expect(result.recvError).toBeNull();
    expect(result.recvOk).toBe(true);

    // The captured row is SUPPLIER_PAYS_US stored POSITIVE — runtime proof the
    // v103 CHECK accepts the new entry_type.
    expect(result.receiveRowType).toBe("SUPPLIER_PAYS_US");
    expect(result.receiveRowUsd).toBeCloseTo(30, 2);

    // RECEIVE credits the GENERAL drawer and raises the balance by exactly $30.
    expect(result.generalDelta).toBeCloseTo(30, 2);
    expect(result.balanceDelta).toBeCloseTo(30, 2);
  });

  test("overpay drives a fresh supplier balance NEGATIVE (they owe you): +$50 TOP_UP then PAY $70 → −$20", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(
      async (companyName: string) => {
        const w = window as unknown as Api;

        const balUsd = (rows: BalanceRow[], id: number): number =>
          rows.find((b) => b.supplier_id === id)?.total_usd ?? 0;

        // Fresh manually-created supplier (Companies/Products, is_system=0) so
        // the negative-balance assertion is isolated from the shared OMT row.
        const created = await w.api.suppliers.create({
          name: companyName,
          note: "LIRA-059 overpay scenario",
        });
        if (!created.success || created.id == null) {
          return { created: false, error: created.error ?? null } as const;
        }
        const supplierId = created.id;

        // Pre-seed baseline (a brand-new supplier has 0, but snapshot anyway so
        // the assertion is a delta, never an absolute).
        const baselineBalance = balUsd(
          await w.api.suppliers.getBalances(true),
          supplierId,
        );

        // Seed +$50 owed (no drawer effect), then PAY $70 (overpay).
        const seed = await w.api.suppliers.addLedgerEntry({
          supplier_id: supplierId,
          entry_type: "TOP_UP",
          amount_usd: 50,
          amount_lbp: 0,
          note: "LIRA-059 overpay seed +$50",
        });
        const pay = await w.api.suppliers.recordCashflow({
          supplier_id: supplierId,
          direction: "PAY",
          payments: [{ method: "CASH", currency_code: "USD", amount: 70 }],
          note: "LIRA-059 overpay PAY $70",
        });

        const finalBalance = balUsd(
          await w.api.suppliers.getBalances(true),
          supplierId,
        );

        return {
          created: true as const,
          seedOk: seed.success,
          payOk: pay.success,
          payError: pay.error ?? null,
          baselineBalance,
          finalBalance,
          balanceDelta: Math.round((finalBalance - baselineBalance) * 100) / 100,
        };
      },
      COMPANY_SUPPLIER_NAME,
    );

    expect(result.created).toBe(true);
    if (!result.created) return;

    expect(result.seedOk).toBe(true);
    expect(result.payError).toBeNull();
    expect(result.payOk).toBe(true);

    // +$50 owed, then PAY $70 → net delta of −$20 from the pre-seed baseline,
    // and the final balance is strictly below it ("they owe you" / green).
    expect(result.balanceDelta).toBeCloseTo(-20, 2);
    expect(result.finalBalance).toBeLessThan(result.baselineBalance);
  });

  test("Companies/Products vs System split: created supplier is_system=0, OMT provider is_system=1", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(
      async (companyName: string) => {
        const w = window as unknown as Api;

        // The supplier created in the overpay scenario above is a
        // Companies/Products row; resolve it (includeInactive for robustness).
        const all = await w.api.suppliers.list("", true);
        const company = all.find((s) => s.name === companyName) ?? null;
        const omt = all.find((s) => s.provider === "OMT") ?? null;

        return {
          companyFound: company != null,
          companyIsSystem: company?.is_system ?? null,
          companyProvider: company?.provider ?? null,
          omtFound: omt != null,
          omtIsSystem: omt?.is_system ?? null,
        };
      },
      COMPANY_SUPPLIER_NAME,
    );

    expect(result.companyFound).toBe(true);
    expect(result.omtFound).toBe(true);

    // A manually-created supplier is a non-system Companies/Products entry…
    expect(result.companyIsSystem).toBe(0);
    expect(result.companyProvider).toBeNull();
    // …while a seeded provider supplier is a System provider (cannot be deleted).
    expect(result.omtIsSystem).toBe(1);
  });
});

// Keep a typed reference to Page so the import is always used.
export type _SupplierCashflowSpecPage = Page;
