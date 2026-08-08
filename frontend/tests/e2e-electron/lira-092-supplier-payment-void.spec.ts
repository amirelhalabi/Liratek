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
 * (LOTO_CASH_PRIZE / LOTO_SETTLEMENT / LOTO_MONTHLY_FEE, RECHARGE_TOPUP,
 * REFUND) are gated in the repository, so raw IPC cannot corrupt them either.
 *
 * 2026-07-28: LOTO (ticket sales) moved OUT of
 * NON_REVERSIBLE_TRANSACTION_TYPES — TransactionRepository now owns a
 * dedicated guard/reversal pair for it (_assertLotoTicketVoidable /
 * _reverseLotoSupplierLedger): an unsettled ticket is voidable from raw IPC
 * AND the Transactions table UI now offers it a Void button; a ticket whose
 * checkpoint has already settled is still blocked, with a named-settlement
 * error. See packages/core/src/repositories/__tests__/LotoTicketReversal.test.ts
 * for the create+reverse+nets-to-0 coverage; LOTO_CASH_PRIZE is unchanged
 * (still gated below — no reversal owner exists for it).
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
        ticket_number?: string;
      }) => Promise<{
        success?: boolean;
        ticket?: { id: number };
        error?: string;
      }>;
      cashPrize: {
        create: (data: {
          prize_amount: number;
          prize_date?: string;
          ticket_number?: string;
        }) => Promise<{
          success?: boolean;
          prize?: { id: number };
          error?: string;
        }>;
      };
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

  test("LOTO_CASH_PRIZE transactions are gated from raw void (blocking beats corrupting)", async ({
    appPage,
  }) => {
    // 2026-07-28: a plain ticket-sale LOTO transaction is no longer gated —
    // TransactionRepository now owns a dedicated guard/reversal pair for it
    // (_assertLotoTicketVoidable / _reverseLotoSupplierLedger; an unsettled
    // ticket voids cleanly). LOTO_CASH_PRIZE has no reversal owner and
    // stays non-reversible, so it's the type that still proves "the gate
    // works" (blocking beats corrupting) here.
    const result = await appPage.evaluate(async () => {
      const w = window as unknown as Api;

      const prizeRes = await w.api.loto.cashPrize.create({
        prize_amount: 12_345,
        prize_date: "2026-07-28",
        ticket_number: `L092-CASH-PRIZE-${Date.now()}`,
      });
      const prizeId = prizeRes.prize?.id ?? null;

      const recent = await w.api.transactions.getRecent(50, {
        source_table: "loto_cash_prizes",
      });
      const list = (
        Array.isArray(recent)
          ? recent
          : ((recent as { transactions?: unknown[] })?.transactions ?? [])
      ) as Array<{ id: number; source_id?: number | null; type?: string }>;
      const txn = list.find(
        (t) => t.source_id === prizeId && t.type === "LOTO_CASH_PRIZE",
      );
      if (!txn) throw new Error("LOTO_CASH_PRIZE transaction not found");

      const voidRes = await w.api.transactions.void(txn.id);
      return {
        prizeOk: prizeRes.success === true,
        voidOk: voidRes?.success === true,
        voidError: voidRes?.error ?? null,
      };
    });

    expect(result.prizeOk).toBe(true);
    // Still non-reversible: the void must be refused.
    expect(result.voidOk).toBe(false);
    expect(result.voidError).toMatch(/cannot be voided/i);
  });

  // Owner requirement (2026-07-04): void/refund lives in the TRANSACTIONS
  // TABLE only — prove the button path works end-to-end there. Updated
  // 2026-07-28: a Loto TICKET SALE row now offers Void/Refund too (LOTO
  // moved out of NON_REVERSIBLE_TRANSACTION_TYPES) — proven alongside the
  // pre-existing OMT App Send round trip.
  test("void works from the Transactions table UI; a loto ticket row now offers Void/Refund", async ({
    appPage,
  }) => {
    // Create an actionable transaction with a unique amount (identity match),
    // plus a Loto ticket sale with a unique ticket_number (identity match for
    // the loto assertion below — never a `/Loto/i` substring or `.first()`:
    // LOTO_CASH_PRIZE ("Loto Prize"), LOTO_SETTLEMENT ("Loto Settlement") and
    // LOTO_MONTHLY_FEE ("Loto Monthly Fee") all match that regex too, and
    // this shared e2e DB accumulates rows of every kind across specs run in
    // order — rule 15).
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

      const lotoTicketNumber = `L092-VOIDBTN-${Date.now()}`;
      const lotoRes = (await w.api.loto.sell({
        sale_amount: 50_000,
        commission_rate: 0.05,
        payment_method: "CASH",
        currency: "LBP",
        ticket_number: lotoTicketNumber,
      })) as { success?: boolean; error?: string };

      return {
        ok: res?.success === true,
        error: res?.error ?? null,
        id: res?.id ?? null,
        generalUsdBefore: before.generalDrawer.usd,
        lotoOk: lotoRes?.success === true,
        lotoError: lotoRes?.error ?? null,
        lotoTicketNumber,
      };
    });
    expect(created.error).toBeNull();
    expect(created.ok).toBe(true);
    expect(created.lotoError).toBeNull();
    expect(created.lotoOk).toBe(true);

    // Bounce through "/" first (README "Assertion discipline" / LIRA-111) —
    // a viewer already parked on /audit from an earlier spec does not
    // remount on a same-route hash nav, so the table can show a stale list.
    await navigateTo(appPage, "/");
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
          appPage.evaluate(
            async (args: { fsId: number; before: number }) => {
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
            },
            { fsId: created.id!, before: created.generalUsdBefore },
          ),
        { timeout: 10_000 },
      )
      .toBe("VOIDED|0.00");

    // The Loto ticket-sale row (matched by its unique ticket_number, not a
    // `/Loto/i` substring — see the comment above `created`) now offers
    // BOTH Void and Refund: isReversibleRow (actionGating.ts) renders both
    // buttons together whenever ACTIONABLE_TYPES.has(row.type) is true, the
    // row isn't VOIDED, isn't itself a REFUND, and hasn't already been
    // refunded — "LOTO" satisfies all four for a fresh, unsettled ticket.
    const lotoRow = appPage
      .locator("tbody tr")
      .filter({ hasText: created.lotoTicketNumber });
    await expect(lotoRow).toBeVisible({ timeout: 10_000 });
    await expect(lotoRow.getByRole("button", { name: /^Void$/ })).toHaveCount(
      1,
    );
    await expect(lotoRow.getByRole("button", { name: /^Refund$/ })).toHaveCount(
      1,
    );
  });
});
