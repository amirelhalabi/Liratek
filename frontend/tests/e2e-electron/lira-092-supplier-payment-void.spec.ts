/**
 * E2E: LIRA-092 — voiding a supplier payment restores the supplier balance
 *
 * Pre-fix, voiding a SUPPLIER_PAYMENT transaction reversed the cash drawer but
 * left its supplier_ledger row counting toward the balance forever — the
 * supplier balance permanently understated the shop's debt (found by the B6b
 * adversarial validation; affects ALL suppliers).
 *
 * Fix: migration v120 soft-void flag; TransactionRepository flags the ledger
 * row; balance/pool aggregates exclude flagged rows. Non-reversible types
 * (LOTO*, SUPPLIER_SETTLEMENT, RECHARGE_TOPUP, REFUND) are gated in the
 * repository, so raw IPC cannot corrupt them either.
 *
 * IPC-driven, delta-asserted per the shared-DB rules.
 */

import { test, expect, navigateTo } from "./fixtures";

test.describe.configure({ retries: 0 });

type Api = {
  api: {
    suppliers: {
      list: (
        search?: string,
        includeInactive?: boolean,
      ) => Promise<Array<{ id: number; provider: string | null }>>;
      getBalances: (
        includeInactive?: boolean,
      ) => Promise<Array<{ supplier_id: number; total_usd: number }>>;
      getLedger: (
        supplierId: number,
        limit?: number,
      ) => Promise<Array<{ id: number; is_refunded?: number }>>;
      addLedgerEntry: (data: {
        supplier_id: number;
        entry_type: string;
        amount_usd: number;
        amount_lbp: number;
        note?: string;
        drawer_name?: string;
      }) => Promise<{ id?: number; success?: boolean; error?: string }>;
    };
    transactions: {
      getRecent: (
        limit?: number,
        filters?: Record<string, unknown>,
      ) => Promise<unknown>;
      void: (
        id: number,
      ) => Promise<{ success?: boolean; reversalId?: number; error?: string }>;
    };
    loto: {
      sell: (data: {
        sale_amount: number;
        commission_rate?: number;
        payment_method?: string;
        currency?: string;
      }) => Promise<{
        success?: boolean;
        ticket?: { id: number };
        error?: string;
      }>;
    };
    dashboard: {
      getDrawerBalances: () => Promise<{
        generalDrawer: { usd: number; lbp: number };
      }>;
    };
  };
};

test.describe("LIRA-092 — supplier-payment void reversal", () => {
  test("voiding a supplier payment restores the supplier balance AND the drawer; ledger row flagged", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(async () => {
      const w = window as unknown as Api;

      const omt = (await w.api.suppliers.list("", true)).find(
        (s) => s.provider === "OMT",
      );
      if (!omt) throw new Error("OMT supplier not found");

      const balance = async () =>
        (await w.api.suppliers.getBalances(true)).find(
          (x) => x.supplier_id === omt.id,
        )?.total_usd ?? 0;
      const drawerUsd = async () =>
        (await w.api.dashboard.getDrawerBalances()).generalDrawer.usd;

      const baseline = await balance();
      const drawerBaseline = await drawerUsd();

      // Pay the supplier $60 cash from the General till.
      const paid = await w.api.suppliers.addLedgerEntry({
        supplier_id: omt.id,
        entry_type: "PAYMENT",
        amount_usd: 60,
        amount_lbp: 0,
        drawer_name: "General",
        note: "L092 payment to void",
      });
      const ledgerId = paid.id ?? null;
      const afterPay = await balance();
      const drawerAfterPay = await drawerUsd();

      // Find the SUPPLIER_PAYMENT txn by identity (source link), never [0].
      const recent = await w.api.transactions.getRecent(50, {
        source_table: "supplier_ledger",
      });
      const list = (
        Array.isArray(recent)
          ? recent
          : ((recent as { transactions?: unknown[] })?.transactions ?? [])
      ) as Array<{ id: number; source_id?: number | null }>;
      const txn = list.find((t) => t.source_id === ledgerId);
      if (!txn) throw new Error("SUPPLIER_PAYMENT transaction not found");

      const voidRes = await w.api.transactions.void(txn.id);

      const afterVoid = await balance();
      const drawerAfterVoid = await drawerUsd();
      const ledgerRow = (await w.api.suppliers.getLedger(omt.id, 200)).find(
        (r) => r.id === ledgerId,
      );

      return {
        ledgerId,
        payDelta: afterPay - baseline,
        drawerPayDelta: drawerAfterPay - drawerBaseline,
        voidOk: voidRes?.success === true,
        voidError: voidRes?.error ?? null,
        balanceRestoredDelta: afterVoid - baseline,
        drawerRestoredDelta: drawerAfterVoid - drawerBaseline,
        rowFlagged: ledgerRow?.is_refunded ?? 0,
      };
    });

    expect(result.ledgerId).not.toBeNull();
    // The payment reduced what the shop owes by 60 and the till by 60.
    expect(result.payDelta).toBeCloseTo(-60, 2);
    expect(result.drawerPayDelta).toBeCloseTo(-60, 2);

    expect(result.voidError).toBeNull();
    expect(result.voidOk).toBe(true);

    // Pre-fix: drawer restored but the balance stayed −60 (debt understated).
    expect(result.balanceRestoredDelta).toBeCloseTo(0, 2);
    expect(result.drawerRestoredDelta).toBeCloseTo(0, 2);
    expect(result.rowFlagged).toBe(1);
  });

  test("LOTO transactions are gated from raw void (blocking beats corrupting)", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(async () => {
      const w = window as unknown as Api;

      const sold = await w.api.loto.sell({
        sale_amount: 100_000,
        commission_rate: 0.05,
        payment_method: "CASH",
        currency: "LBP",
      });
      const ticketId = sold.ticket?.id ?? null;

      const recent = await w.api.transactions.getRecent(50, {
        source_table: "loto_tickets",
      });
      const list = (
        Array.isArray(recent)
          ? recent
          : ((recent as { transactions?: unknown[] })?.transactions ?? [])
      ) as Array<{ id: number; source_id?: number | null; type?: string }>;
      const txn = list.find(
        (t) => t.source_id === ticketId && t.type === "LOTO",
      );
      if (!txn) throw new Error("LOTO transaction not found");

      const voidRes = await w.api.transactions.void(txn.id);
      return {
        sellOk: sold.success === true,
        voidOk: voidRes?.success === true,
        voidError: voidRes?.error ?? null,
      };
    });

    expect(result.sellOk).toBe(true);
    // Pre-fix: the void succeeded and left the loto ledger/checkpoints stale.
    expect(result.voidOk).toBe(false);
    expect(result.voidError).toMatch(/cannot be voided/i);
  });

  // Owner requirement (2026-07-04): void/refund lives in the TRANSACTIONS
  // TABLE only — prove the button path works end-to-end there, and that loto
  // rows offer no such action.
  test("void works from the Transactions table UI; loto rows offer no Void button", async ({
    appPage,
  }) => {
    // Create an actionable transaction with a unique amount (identity match).
    const created = await appPage.evaluate(async () => {
      const w = window as unknown as Api;
      const before = await w.api.dashboard.getDrawerBalances();
      const res = (await (
        w.api as unknown as {
          omt: {
            addTransaction: (d: Record<string, unknown>) => Promise<{
              success?: boolean;
              id?: number;
              error?: string;
            }>;
          };
        }
      ).omt.addTransaction({
        provider: "OMT_APP",
        serviceType: "SEND",
        amount: 13.37,
        currency: "USD",
        commission: 0,
        paidByMethod: "CASH",
      })) as { success?: boolean; id?: number; error?: string };
      return {
        ok: res?.success === true,
        error: res?.error ?? null,
        id: res?.id ?? null,
        generalUsdBefore: before.generalDrawer.usd,
      };
    });
    expect(created.error).toBeNull();
    expect(created.ok).toBe(true);

    await navigateTo(appPage, "/audit");

    // The OMT App Send row (matched by identity: label + unique amount)
    // must offer a Void button — and clicking it voids the transaction.
    const row = appPage
      .locator("tbody tr")
      .filter({ hasText: "OMT App Send" })
      .filter({ hasText: "13.37" })
      .first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    const voidBtn = row.getByRole("button", { name: /^Void$/ });
    await expect(voidBtn).toBeVisible();
    // The click fires "Void this transaction? This cannot be undone." —
    // answer it EXPLICITLY with OK (accept): voiding is this test's purpose.
    // Owner-confirmed 2026-07-04 after sighting the popup linger in a run;
    // the .catch tolerates the fixtures' global accept racing us to it.
    const confirmSeen = new Promise<string>((resolve) => {
      appPage.once("dialog", (d) => {
        d.accept().catch(() => {});
        resolve(d.message());
      });
    });
    await voidBtn.click();
    expect(await confirmSeen).toMatch(/Void this transaction/i);

    // The void took effect: the txn is VOIDED and the General USD drawer is
    // back to its pre-transaction level (net delta 0 across create + void).
    // NOTE: omt.addTransaction returns the financial_services row id — the
    // unified transaction is matched via source_id, never by that id directly.
    await expect
      .poll(
        async () =>
          appPage.evaluate(async (args: { fsId: number; before: number }) => {
            const w = window as unknown as Api;
            const recent = await w.api.transactions.getRecent(50, {
              source_table: "financial_services",
            });
            const list = (
              Array.isArray(recent)
                ? recent
                : ((recent as { transactions?: unknown[] })?.transactions ??
                  [])
            ) as Array<{
              id: number;
              source_id?: number | null;
              type?: string;
              status?: string;
              reverses_id?: number | null;
            }>;
            // The void writes a same-type reversal row (reverses_id set, newer)
            // for the same source — match the ORIGINAL only.
            const txn = list.find(
              (t) =>
                t.source_id === args.fsId &&
                t.type === "FINANCIAL_SERVICE" &&
                !t.reverses_id,
            );
            const after = await w.api.dashboard.getDrawerBalances();
            return `${txn?.status ?? "missing"}|${(after.generalDrawer.usd - args.before).toFixed(2)}`;
          }, { fsId: created.id!, before: created.generalUsdBefore }),
        { timeout: 10_000 },
      )
      .toBe("VOIDED|0.00");

    // A loto row shows NO Void/Refund buttons (LOTO is not actionable).
    const lotoRow = appPage
      .locator("tbody tr")
      .filter({ hasText: /Loto/i })
      .first();
    await expect(lotoRow).toBeVisible({ timeout: 10_000 });
    await expect(
      lotoRow.getByRole("button", { name: /^(Void|Refund)$/ }),
    ).toHaveCount(0);
  });
});
