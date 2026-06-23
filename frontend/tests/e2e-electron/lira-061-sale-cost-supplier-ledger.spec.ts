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

// Per-scenario costs/prices kept distinct so a glance at the DB row tells you
// which scenario produced it. Correctness still rests on captured deltas, not
// on these absolute amounts (shared, ordered per-worker DB).
const IPICK_COST_USD = 90;
const IPICK_PRICE_USD = 100;
const WHISH_COST_USD = 90;
const WHISH_PRICE_USD = 100;
const SETTLE_COST_USD = 80; // Katsh SEND used by the per-transaction settle test
const SETTLE_PRICE_USD = 95;
const PAYDOWN_COST_USD = 50; // iPick SEND used by the cumulative pay-down test
const PAYDOWN_PRICE_USD = 70;

type LedgerRow = {
  id: number;
  entry_type: string;
  amount_usd: number;
  amount_lbp: number;
};

type UnsettledRow = { id: number; amount: number; commission: number };

type SupplierBalanceRow = {
  supplier_id: number;
  total_usd: number;
  total_lbp: number;
};

// recharge.getDrawerBalances() — name-keyed array covering ALL drawers
// (General, Katsh, iPick, Whish_App, ...). Fields are usdBalance / lbpBalance
// (NOT usd / lbp). This is the ONLY way to read provider drawers; the
// dashboard.getDrawerBalances() shape exposes only generalDrawer + omtDrawer.
type ProviderDrawerRow = {
  name: string;
  usdBalance: number;
  lbpBalance: number;
};

type SuccessEnvelope = { success?: boolean; id?: number; error?: string };

type SupplierApi = {
  api: {
    omt: {
      // electron.d.ts is stale for this channel — pass the rich payload and
      // read the {success,id} envelope.
      addTransaction: (data: Record<string, unknown>) => Promise<unknown>;
    };
    recharge: {
      getDrawerBalances: () => Promise<ProviderDrawerRow[]>;
    };
    suppliers: {
      list: (
        search?: string,
        includeInactive?: boolean,
      ) => Promise<Array<{ id: number; provider: string | null }>>;
      // RAW array, newest-first (ORDER BY created_at DESC).
      getLedger: (supplierId: number, limit?: number) => Promise<LedgerRow[]>;
      // RAW array of per-supplier balances (positive = we owe the supplier).
      getBalances: (includeInactive?: boolean) => Promise<SupplierBalanceRow[]>;
      // RAW array. For cost/price SEND rows: amount = cost, commission = 0.
      getUnsettledTransactions: (provider: string) => Promise<UnsettledRow[]>;
      // {success,...} envelope. drawer_name omitted from electron.d.ts but
      // accepted by SupplierSettleSchema; the repo debits it for the net pay.
      settleTransactions: (data: {
        supplier_id: number;
        financial_service_ids: number[];
        amount_usd: number;
        amount_lbp: number;
        commission_usd: number;
        commission_lbp: number;
        drawer_name: string;
        note?: string;
        payments?: Array<{
          method: string;
          currency_code: string;
          amount: number;
        }>;
      }) => Promise<SuccessEnvelope>;
      // {success,...} envelope. PAY → negative PAYMENT row + drawer debit.
      recordCashflow: (data: {
        supplier_id: number;
        direction: "PAY" | "RECEIVE";
        payments: Array<{
          method: string;
          currency_code: string;
          amount: number;
        }>;
        note?: string;
      }) => Promise<SuccessEnvelope>;
    };
  };
};

test.describe("LIRA-061 — cost/price SEND books SALE_COST in supplier ledger", () => {
  test("Katsh SEND writes SALE_COST (not TOP_UP) and is settleable", async ({
    appPage,
  }) => {
    // Baseline: Katsh's existing TOP_UP count. Other specs over the shared worker
    // DB (e.g. lira-056's supplier-credit top-up) legitimately add Katsh TOP_UP
    // rows, so assert THIS SEND adds none (it must book SALE_COST) — a delta, not
    // a global "zero TOP_UP" absolute.
    const topUpBefore = await appPage.evaluate(async () => {
      const w = window as unknown as SupplierApi;
      const suppliers = await w.api.suppliers.list("", true);
      const katsh = suppliers.find((s) => s.provider === "Katsh");
      if (!katsh) return 0;
      const ledger = await w.api.suppliers.getLedger(katsh.id, 100);
      return ledger.filter((l) => l.entry_type === "TOP_UP").length;
    });

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

      const ledger = await w.api.suppliers.getLedger(katsh.id, 100);
      const unsettled = await w.api.suppliers.getUnsettledTransactions("Katsh");

      return {
        found: true,
        entryTypes: ledger.map((l) => l.entry_type),
        newest: ledger[0] ?? null,
        topUpCount: ledger.filter((l) => l.entry_type === "TOP_UP").length,
        unsettledCount: unsettled.length,
        unsettledAmounts: unsettled.map((u) => ({
          amount: u.amount,
          commission: u.commission,
        })),
      } as const;
    });

    expect(result.found).toBe(true);
    if (!result.found) return;

    // The auto entry must be SALE_COST, never the old TOP_UP label: this SEND
    // booked a SALE_COST and added NO new TOP_UP (count unchanged vs baseline).
    expect(result.entryTypes).toContain("SALE_COST");
    expect(result.topUpCount).toBe(topUpBefore);
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

  // ───────────────────────────────────────────────────────────────────────────
  // Gap scenarios (LIRA-061 plan): iPick SEND, the per-transaction settle path,
  // the cumulative pay-down path, and the Whish App SEND (the WISH_APP/WHISH_APP
  // bug, now fixed via the rename + migration v105 — a real green test).
  //
  // Shared per-worker DB, ordered execution → every assertion is a DELTA against
  // a baseline snapshotted IMMEDIATELY before the action, never an absolute
  // total or getLedger[0]. Provider drawers are read ONLY via
  // recharge.getDrawerBalances() (name-keyed, usdBalance). Captured ids target a
  // specific row; entry types are read as strings.
  // ───────────────────────────────────────────────────────────────────────────

  test("iPick SEND books SALE_COST: iPick drawer −cost, General +price, settleable", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(
      async ({ cost, price, itemKey }) => {
        const w = window as unknown as SupplierApi;

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

        const supplierBalBefore = balUsd(
          await w.api.suppliers.getBalances(true),
          ipick.id,
        );

        const ledgerBefore = await w.api.suppliers.getLedger(ipick.id, 200);
        const ledgerIdsBefore = new Set(ledgerBefore.map((l) => l.id));
        const saleCostCountBefore = ledgerBefore.filter(
          (l) => l.entry_type === "SALE_COST",
        ).length;
        const topUpCountBefore = ledgerBefore.filter(
          (l) => l.entry_type === "TOP_UP",
        ).length;
        const unsettledBefore = (
          await w.api.suppliers.getUnsettledTransactions("iPick")
        ).length;

        // ── Action: iPick cost/price SEND via the omt:add-transaction channel ─
        const created = (await w.api.omt.addTransaction({
          provider: "iPick",
          serviceType: "SEND",
          amount: price,
          currency: "USD",
          commission: 0,
          cost,
          price,
          paidByMethod: "CASH",
          itemKey,
        })) as SuccessEnvelope;

        // ── Re-read after ────────────────────────────────────────────────────
        const drawersAfter = await w.api.recharge.getDrawerBalances();
        const ipickDrawerAfter = drawerUsd(drawersAfter, "iPick");
        const generalAfter = drawerUsd(drawersAfter, "General");

        const supplierBalAfter = balUsd(
          await w.api.suppliers.getBalances(true),
          ipick.id,
        );

        const ledgerAfter = await w.api.suppliers.getLedger(ipick.id, 200);
        const saleCostCountAfter = ledgerAfter.filter(
          (l) => l.entry_type === "SALE_COST",
        ).length;
        const topUpCountAfter = ledgerAfter.filter(
          (l) => l.entry_type === "TOP_UP",
        ).length;
        // Target THIS run's new ledger row by id-set diff (never index 0).
        const newRows = ledgerAfter.filter((l) => !ledgerIdsBefore.has(l.id));
        const newRow = newRows.length === 1 ? newRows[0] : null;

        const unsettledAfter =
          await w.api.suppliers.getUnsettledTransactions("iPick");
        // Target a row whose net pay equals THIS sale's cost (not index 0).
        const saleCostUnsettled = unsettledAfter.find(
          (u) => Math.abs(u.amount - cost) < 0.01 && u.commission === 0,
        );

        return {
          found: true,
          ok: created?.success ?? true,
          error: created?.error ?? null,
          ipickDrawerDelta:
            Math.round((ipickDrawerAfter - ipickDrawerBefore) * 100) / 100,
          generalDelta: Math.round((generalAfter - generalBefore) * 100) / 100,
          supplierBalDelta:
            Math.round((supplierBalAfter - supplierBalBefore) * 100) / 100,
          saleCostAdded: saleCostCountAfter - saleCostCountBefore,
          topUpAdded: topUpCountAfter - topUpCountBefore,
          newRowCount: newRows.length,
          newRowType: newRow?.entry_type ?? null,
          newRowUsd: newRow?.amount_usd ?? null,
          unsettledAdded: unsettledAfter.length - unsettledBefore,
          hasSaleCostUnsettled: !!saleCostUnsettled,
        } as const;
      },
      {
        cost: IPICK_COST_USD,
        price: IPICK_PRICE_USD,
        itemKey: "lira-061-e2e-ipick-send",
      },
    );

    expect(result.found).toBe(true);
    if (!result.found) return;

    expect(result.error).toBeNull();
    expect(result.ok).not.toBe(false);

    // Exactly one new ledger row, and it is the SALE_COST (never TOP_UP).
    expect(result.newRowCount).toBe(1);
    expect(result.saleCostAdded).toBe(1);
    expect(result.topUpAdded).toBe(0);
    expect(result.newRowType).toBe("SALE_COST");
    expect(result.newRowUsd).toBeCloseTo(IPICK_COST_USD, 2);

    // Money invariant: iPick drawer pays the cost, General receives the price.
    expect(result.ipickDrawerDelta).toBeCloseTo(-IPICK_COST_USD, 2);
    expect(result.generalDelta).toBeCloseTo(IPICK_PRICE_USD, 2);

    // Owed balance rose by the cost; the row is settleable.
    expect(result.supplierBalDelta).toBeCloseTo(IPICK_COST_USD, 2);
    expect(result.unsettledAdded).toBe(1);
    expect(result.hasSaleCostUnsettled).toBe(true);
  });

  test("per-transaction settle: captured row leaves the unsettled list, balance nets to baseline", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(
      async ({ cost, price, itemKey }) => {
        const w = window as unknown as SupplierApi;

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

        // ── Step 1: create a fresh Katsh SEND to settle ──────────────────────
        const idsBefore = new Set(
          (await w.api.suppliers.getUnsettledTransactions("Katsh")).map(
            (u) => u.id,
          ),
        );
        const created = (await w.api.omt.addTransaction({
          provider: "Katsh",
          serviceType: "SEND",
          amount: price,
          currency: "USD",
          commission: 0,
          cost,
          price,
          paidByMethod: "CASH",
          itemKey,
        })) as SuccessEnvelope;
        if (created?.success === false) {
          return {
            found: true,
            createOk: false,
            error: created.error,
          } as const;
        }

        // Capture the NEW unsettled row (id not present before, net pay = cost).
        const unsettledNow =
          await w.api.suppliers.getUnsettledTransactions("Katsh");
        const target = unsettledNow.find(
          (u) =>
            !idsBefore.has(u.id) &&
            Math.abs(u.amount - cost) < 0.01 &&
            u.commission === 0,
        );
        if (!target) {
          return { found: true, createOk: true, captured: false } as const;
        }

        // ── Snapshot baseline IMMEDIATELY before the settle action ───────────
        const generalBefore = drawerUsd(
          await w.api.recharge.getDrawerBalances(),
          "General",
        );
        const balBefore = balUsd(
          await w.api.suppliers.getBalances(true),
          katsh.id,
        );
        const ledgerBefore = await w.api.suppliers.getLedger(katsh.id, 200);
        const ledgerIdsBefore = new Set(ledgerBefore.map((l) => l.id));
        const settlementCountBefore = ledgerBefore.filter(
          (l) => l.entry_type === "SETTLEMENT",
        ).length;

        // ── Action: settle exactly that row, net pay = cost, no commission ───
        const settled = await w.api.suppliers.settleTransactions({
          supplier_id: katsh.id,
          financial_service_ids: [target.id],
          amount_usd: cost,
          amount_lbp: 0,
          commission_usd: 0,
          commission_lbp: 0,
          drawer_name: "General",
          note: "lira-061-e2e-settle",
          payments: [{ method: "CASH", currency_code: "USD", amount: cost }],
        });

        // ── Re-read after ────────────────────────────────────────────────────
        const generalAfter = drawerUsd(
          await w.api.recharge.getDrawerBalances(),
          "General",
        );
        const balAfter = balUsd(
          await w.api.suppliers.getBalances(true),
          katsh.id,
        );
        const ledgerAfter = await w.api.suppliers.getLedger(katsh.id, 200);
        const settlementCountAfter = ledgerAfter.filter(
          (l) => l.entry_type === "SETTLEMENT",
        ).length;
        // Target THIS settle's new ledger row by id-set diff (never index 0).
        const newRows = ledgerAfter.filter((l) => !ledgerIdsBefore.has(l.id));
        const newRow = newRows.length === 1 ? newRows[0] : null;

        const stillUnsettled = (
          await w.api.suppliers.getUnsettledTransactions("Katsh")
        ).some((u) => u.id === target.id);

        return {
          found: true,
          createOk: true,
          captured: true,
          ok: settled?.success ?? true,
          error: settled?.error ?? null,
          generalDelta: Math.round((generalAfter - generalBefore) * 100) / 100,
          balDelta: Math.round((balAfter - balBefore) * 100) / 100,
          settlementAdded: settlementCountAfter - settlementCountBefore,
          newRowCount: newRows.length,
          newRowType: newRow?.entry_type ?? null,
          newRowUsd: newRow?.amount_usd ?? null,
          stillUnsettled,
        } as const;
      },
      {
        cost: SETTLE_COST_USD,
        price: SETTLE_PRICE_USD,
        itemKey: "lira-061-e2e-katsh-settle",
      },
    );

    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.createOk).toBe(true);
    expect(result.captured).toBe(true);
    if (!result.captured) return;

    expect(result.error).toBeNull();
    expect(result.ok).not.toBe(false);

    // Exactly one new ledger row — a SETTLEMENT for the negative net pay.
    expect(result.newRowCount).toBe(1);
    expect(result.settlementAdded).toBe(1);
    expect(result.newRowType).toBe("SETTLEMENT");
    expect(result.newRowUsd).toBeCloseTo(-SETTLE_COST_USD, 2);

    // General paid out the net amount; the SALE_COST (+cost) is netted by the
    // SETTLEMENT (−cost) so the supplier balance returns to its pre-settle base.
    expect(result.generalDelta).toBeCloseTo(-SETTLE_COST_USD, 2);
    expect(result.balDelta).toBeCloseTo(-SETTLE_COST_USD, 2);

    // settlement_id is stamped → the row drops out of the unsettled list.
    expect(result.stillUnsettled).toBe(false);
  });

  test("cumulative pay-down via recordCashflow PAY: PAYMENT row, balance back to baseline", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(
      async ({ cost, price, itemKey }) => {
        const w = window as unknown as SupplierApi;

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

        // ── Baseline BEFORE the SEND: where the balance must return to ───────
        const baselineBal = balUsd(
          await w.api.suppliers.getBalances(true),
          ipick.id,
        );

        // ── Step 1: a fresh iPick SEND raises the owed balance by its cost ───
        const created = (await w.api.omt.addTransaction({
          provider: "iPick",
          serviceType: "SEND",
          amount: price,
          currency: "USD",
          commission: 0,
          cost,
          price,
          paidByMethod: "CASH",
          itemKey,
        })) as SuccessEnvelope;
        if (created?.success === false) {
          return {
            found: true,
            createOk: false,
            error: created.error,
          } as const;
        }

        const afterSendBal = balUsd(
          await w.api.suppliers.getBalances(true),
          ipick.id,
        );

        // ── Snapshot IMMEDIATELY before the pay-down action ──────────────────
        const generalBefore = drawerUsd(
          await w.api.recharge.getDrawerBalances(),
          "General",
        );
        const ledgerBefore = await w.api.suppliers.getLedger(ipick.id, 200);
        const ledgerIdsBefore = new Set(ledgerBefore.map((l) => l.id));
        const paymentCountBefore = ledgerBefore.filter(
          (l) => l.entry_type === "PAYMENT",
        ).length;

        // ── Action: pay the supplier down by exactly the cost (CASH/General) ─
        // recordCashflow PAY → one negative PAYMENT ledger row + General debit.
        // It does NOT stamp settlement_id, so we assert the balance, not
        // disappearance from the unsettled list.
        const paid = await w.api.suppliers.recordCashflow({
          supplier_id: ipick.id,
          direction: "PAY",
          payments: [{ method: "CASH", currency_code: "USD", amount: cost }],
          note: "lira-061-e2e-paydown",
        });

        // ── Re-read after ────────────────────────────────────────────────────
        const generalAfter = drawerUsd(
          await w.api.recharge.getDrawerBalances(),
          "General",
        );
        const finalBal = balUsd(
          await w.api.suppliers.getBalances(true),
          ipick.id,
        );
        const ledgerAfter = await w.api.suppliers.getLedger(ipick.id, 200);
        const paymentCountAfter = ledgerAfter.filter(
          (l) => l.entry_type === "PAYMENT",
        ).length;
        // Target THIS pay-down's new ledger row by id-set diff (never index 0).
        const newRows = ledgerAfter.filter((l) => !ledgerIdsBefore.has(l.id));
        const payRow = newRows.find((l) => l.entry_type === "PAYMENT") ?? null;

        return {
          found: true,
          createOk: true,
          ok: paid?.success ?? true,
          error: paid?.error ?? null,
          sendRaisedBy: Math.round((afterSendBal - baselineBal) * 100) / 100,
          payDownBalDelta: Math.round((finalBal - afterSendBal) * 100) / 100,
          balVsBaseline: Math.round((finalBal - baselineBal) * 100) / 100,
          generalDelta: Math.round((generalAfter - generalBefore) * 100) / 100,
          paymentAdded: paymentCountAfter - paymentCountBefore,
          payRowType: payRow?.entry_type ?? null,
          payRowUsd: payRow?.amount_usd ?? null,
        } as const;
      },
      {
        cost: PAYDOWN_COST_USD,
        price: PAYDOWN_PRICE_USD,
        itemKey: "lira-061-e2e-ipick-paydown",
      },
    );

    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.createOk).toBe(true);

    expect(result.error).toBeNull();
    expect(result.ok).not.toBe(false);

    // The SEND first raised the owed balance by its cost…
    expect(result.sendRaisedBy).toBeCloseTo(PAYDOWN_COST_USD, 2);

    // …then a negative PAYMENT row brought it back down by the same cost.
    expect(result.paymentAdded).toBe(1);
    expect(result.payRowType).toBe("PAYMENT");
    expect(result.payRowUsd).toBeCloseTo(-PAYDOWN_COST_USD, 2);
    expect(result.payDownBalDelta).toBeCloseTo(-PAYDOWN_COST_USD, 2);

    // Net of this scenario: the owed balance returns to its pre-SEND baseline,
    // and General paid out the cash (PAY hits General, not the iPick drawer).
    expect(result.balVsBaseline).toBeCloseTo(0, 2);
    expect(result.generalDelta).toBeCloseTo(-PAYDOWN_COST_USD, 2);
  });

  test("Whish App SEND books SALE_COST (WISH_APP→WHISH_APP fix): Whish_App drawer −cost, General +price, settleable", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(
      async ({ cost, price, itemKey }) => {
        const w = window as unknown as SupplierApi;

        const drawerUsd = (rows: ProviderDrawerRow[], name: string): number =>
          rows.find((d) => d.name === name)?.usdBalance ?? 0;
        const balUsd = (
          rows: SupplierBalanceRow[],
          supplierId: number,
        ): number =>
          rows.find((b) => b.supplier_id === supplierId)?.total_usd ?? 0;

        // The WHISH_APP supplier is is_system=1 (not partner-gated), so it
        // resolves on the include-inactive list even on this OMT-base setup.
        const whishApp = (await w.api.suppliers.list("", true)).find(
          (s) => s.provider === "WHISH_APP",
        );
        if (!whishApp) return { found: false } as const;

        // ── Snapshot baseline IMMEDIATELY before the action ──────────────────
        const drawersBefore = await w.api.recharge.getDrawerBalances();
        // Raw drawer name is "Whish_App" (NOT "Whish App").
        const whishDrawerBefore = drawerUsd(drawersBefore, "Whish_App");
        const generalBefore = drawerUsd(drawersBefore, "General");

        const supplierBalBefore = balUsd(
          await w.api.suppliers.getBalances(true),
          whishApp.id,
        );

        const ledgerBefore = await w.api.suppliers.getLedger(whishApp.id, 200);
        const ledgerIdsBefore = new Set(ledgerBefore.map((l) => l.id));
        const saleCostCountBefore = ledgerBefore.filter(
          (l) => l.entry_type === "SALE_COST",
        ).length;
        const topUpCountBefore = ledgerBefore.filter(
          (l) => l.entry_type === "TOP_UP",
        ).length;
        const unsettledBefore = (
          await w.api.suppliers.getUnsettledTransactions("WHISH_APP")
        ).length;

        // ── Action: Whish App cost/price SEND (provider spelled WHISH_APP) ───
        const created = (await w.api.omt.addTransaction({
          provider: "WHISH_APP",
          serviceType: "SEND",
          amount: price,
          currency: "USD",
          commission: 0,
          cost,
          price,
          paidByMethod: "CASH",
          itemKey,
        })) as SuccessEnvelope;

        // ── Re-read after ────────────────────────────────────────────────────
        const drawersAfter = await w.api.recharge.getDrawerBalances();
        const whishDrawerAfter = drawerUsd(drawersAfter, "Whish_App");
        const generalAfter = drawerUsd(drawersAfter, "General");

        const supplierBalAfter = balUsd(
          await w.api.suppliers.getBalances(true),
          whishApp.id,
        );

        const ledgerAfter = await w.api.suppliers.getLedger(whishApp.id, 200);
        const saleCostCountAfter = ledgerAfter.filter(
          (l) => l.entry_type === "SALE_COST",
        ).length;
        const topUpCountAfter = ledgerAfter.filter(
          (l) => l.entry_type === "TOP_UP",
        ).length;
        // Target THIS run's new ledger row by id-set diff (never index 0).
        const newRows = ledgerAfter.filter((l) => !ledgerIdsBefore.has(l.id));
        const newRow = newRows.length === 1 ? newRows[0] : null;

        const unsettledAfter =
          await w.api.suppliers.getUnsettledTransactions("WHISH_APP");
        const saleCostUnsettled = unsettledAfter.find(
          (u) => Math.abs(u.amount - cost) < 0.01 && u.commission === 0,
        );

        return {
          found: true,
          ok: created?.success ?? true,
          error: created?.error ?? null,
          whishDrawerDelta:
            Math.round((whishDrawerAfter - whishDrawerBefore) * 100) / 100,
          generalDelta: Math.round((generalAfter - generalBefore) * 100) / 100,
          supplierBalDelta:
            Math.round((supplierBalAfter - supplierBalBefore) * 100) / 100,
          saleCostAdded: saleCostCountAfter - saleCostCountBefore,
          topUpAdded: topUpCountAfter - topUpCountBefore,
          newRowCount: newRows.length,
          newRowType: newRow?.entry_type ?? null,
          newRowUsd: newRow?.amount_usd ?? null,
          unsettledAdded: unsettledAfter.length - unsettledBefore,
          hasSaleCostUnsettled: !!saleCostUnsettled,
        } as const;
      },
      {
        cost: WHISH_COST_USD,
        price: WHISH_PRICE_USD,
        itemKey: "lira-061-e2e-whish-app-send",
      },
    );

    expect(result.found).toBe(true);
    if (!result.found) return;

    expect(result.error).toBeNull();
    expect(result.ok).not.toBe(false);

    // The WISH_APP→WHISH_APP fix means the SALE_COST write now lands (it was
    // silently swallowed before): exactly one new SALE_COST row, never TOP_UP.
    expect(result.newRowCount).toBe(1);
    expect(result.saleCostAdded).toBe(1);
    expect(result.topUpAdded).toBe(0);
    expect(result.newRowType).toBe("SALE_COST");
    expect(result.newRowUsd).toBeCloseTo(WHISH_COST_USD, 2);

    // Money invariant: Whish_App drawer pays the cost, General receives price.
    expect(result.whishDrawerDelta).toBeCloseTo(-WHISH_COST_USD, 2);
    expect(result.generalDelta).toBeCloseTo(WHISH_PRICE_USD, 2);

    // Owed balance rose by the cost; the row is settleable in the Settle tab.
    expect(result.supplierBalDelta).toBeCloseTo(WHISH_COST_USD, 2);
    expect(result.unsettledAdded).toBe(1);
    expect(result.hasSaleCostUnsettled).toBe(true);
  });
});

// Keep a typed reference to Page so the import is always used even if the
// assertions above are trimmed in a future edit.
export type _SaleCostSpecPage = Page;
