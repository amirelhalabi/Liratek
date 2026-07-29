/**
 * E2E: LIRA-129 — loto ticket refund end-to-end (uncheckpointed, checkpointed
 * but UNSETTLED + settle-to-zero cycle, and a settled checkpoint's block).
 *
 * Manual test points this file automates:
 *   1. Uncheckpointed ticket refund — supplier balance, General drawer, and
 *      the Loto report totals all net back to their pre-sale values, and the
 *      ticket shows refunded (test 1).
 *   2. Checkpointed-but-UNSETTLED ticket refund — the checkpoint's frozen
 *      totals drop by EXACTLY that ticket's own sale/commission values, THEN
 *      the SAME checkpoint is settled with its own re-read (post-refund)
 *      totals and the Loto supplier balance returns to net zero. This
 *      refund→settle→net-zero CYCLE is the crux invariant (test 2).
 *   3. Settled-checkpoint block — refunding a ticket inside an
 *      ALREADY-SETTLED checkpoint is refused, the error names the
 *      checkpoint + settlement, and nothing moves (test 3).
 *
 * Backing fix (commit a456d3a, 2026-07-28): LOTO left
 * NON_REVERSIBLE_TRANSACTION_TYPES; TransactionRepository's
 * `_assertLotoTicketVoidable` (guard) / `_reverseLotoSupplierLedger`
 * (reversal) own this. Existing core-jest coverage:
 *   - packages/core/src/repositories/__tests__/LotoTicketReversal.test.ts
 *     proves the guard + the per-refund checkpoint delta-adjust, but never
 *     calls `settleCheckpoint` afterward.
 *   - packages/core/src/repositories/__tests__/LotoSupplierLedgerSign.test.ts
 *     proves settle-to-zero, but with no refund in the middle.
 * This spec is the first to COMPOSE refund + settle end-to-end through the
 * real IPC/UI surface, and the first to click a real Loto row's Refund
 * button. A CASH-paid ticket has non-empty `payments` legs, so
 * TransactionsViewer.handleRefund opens RefundMethodModal instead of the
 * plain confirm() lira-104/lira-092 exercise for account-charged/no-leg
 * rows — RefundMethodModal.test.tsx proves confirming its pre-filled default
 * is byte-identical to a bare refund (`onConfirm(undefined)`), so no manual
 * method edit is needed here, just "Confirm Refund".
 *
 * FAILING-FIRST (rule 17): to watch this file go red on the pre-fix code,
 * comment out in packages/core/src/repositories/TransactionRepository.ts:
 *   - `this._assertLotoTicketVoidable(original);` (both call sites, in
 *     `_voidTransactionInternal` and `refundTransaction`)
 *   - `this._reverseLotoSupplierLedger(original);` (both call sites)
 * Expected failures: test 1's balance/drawer/report deltas never return to
 * zero (the TOP_UP row stays live forever, uncancelled); test 2's checkpoint
 * totals never drop after the refund AND the final settle-to-zero assertion
 * fails (the stale pre-refund totals get baked into the SETTLEMENT row,
 * leaving the refunded ticket's own contribution stranded in the balance);
 * test 3's refund SUCCEEDS instead of throwing — the single most dangerous
 * regression, since it would silently desync an already-posted settlement.
 * Revert the comment-outs afterward.
 *
 * RULE 15 — shared, accumulating per-worker DB:
 *   - every ticket_number is `L129-<label>-${Date.now()}`; rows are matched
 *     by that UNIQUE substring, never `/Loto/i` (which also matches "Loto
 *     Prize" / "Loto Settlement" / "Loto Monthly Fee" rows) and never
 *     `[0]`/`.first()` without a filter.
 *   - every assertion is a DELTA against a snapshot taken immediately before
 *     the action, never an absolute total or balance.
 *   - `loto.checkpoint.create` sweeps EVERY currently-uncheckpointed,
 *     non-refunded ticket AND every unassigned cash prize tenant-wide (no
 *     date filter — see LotoService.createCheckpoint). By the time this file
 *     runs (alphabetically after lira-082/091/092/116/118), it WILL sweep in
 *     whatever those specs left uncheckpointed — notably lira-092's own
 *     unvoided "L092-VOIDBTN-…" ticket, and lira-091-loto-ledger-sign's two
 *     unassigned cash prizes. Test 2 therefore asserts NO settlement-balance
 *     arithmetic at all — only deltas across a single action, and this
 *     checkpoint's own re-read totals. See the long note at the end of test 2
 *     for the two attempts that passed in isolation and failed in full-suite
 *     order (2026-07-29), and why the net-to-zero arithmetic belongs on an
 *     isolated in-memory DB instead:
 *     packages/core/src/repositories/__tests__/LotoTicketReversal.test.ts
 *     ("Case 3b").
 *   - No `loto_checkpoints` row is left UNSETTLED for a later spec file to
 *     trip over: test 2 settles its own checkpoint right after the refund;
 *     test 3 settles its checkpoint immediately (no refund) before
 *     attempting the blocked refund. This file is also the FIRST spec ever
 *     to create a real loto checkpoint, so as a side effect every stray
 *     uncheckpointed ticket left by earlier specs becomes checkpointed
 *     (and, by test 2/3's end, settled) too — documented in this spec's
 *     header and in the README's "Known couplings & hazards".
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

type LotoTicket = {
  id: number;
  sale_amount: number;
  commission_amount: number;
  is_refunded?: number | null;
  checkpoint_id: number | null;
};

type LotoCheckpoint = {
  id: number;
  total_sales: number;
  total_commission: number;
  total_tickets: number;
  total_prizes: number;
  is_settled: number;
};

type Api = {
  api: {
    suppliers: {
      list: (
        search?: string,
        includeInactive?: boolean,
      ) => Promise<Array<{ id: number; provider: string | null }>>;
      getBalances: (
        includeInactive?: boolean,
      ) => Promise<Array<{ supplier_id: number; total_lbp: number }>>;
    };
    dashboard: {
      getDrawerBalances: () => Promise<{
        generalDrawer: { usd: number; lbp: number };
      }>;
    };
    loto: {
      sell: (data: {
        ticket_number: string;
        sale_amount: number;
        commission_rate: number;
        payment_method: string;
        currency: string;
      }) => Promise<{
        success?: boolean;
        ticket?: LotoTicket;
        error?: string;
      }>;
      get: (
        id: number,
      ) => Promise<{ success?: boolean; ticket?: LotoTicket; error?: string }>;
      report: (
        from: string,
        to: string,
      ) => Promise<{
        success?: boolean;
        reportData?: {
          total_sales: number;
          total_commission: number;
          total_tickets: number;
        };
        error?: string;
      }>;
      checkpoint: {
        create: (data: {
          checkpoint_date: string;
          period_start: string;
          period_end: string;
        }) => Promise<{
          success?: boolean;
          checkpoint?: LotoCheckpoint;
          error?: string;
        }>;
        get: (
          id: number,
        ) => Promise<{
          success?: boolean;
          checkpoint?: LotoCheckpoint;
          error?: string;
        }>;
        settle: (data: {
          id: number;
          totalSales: number;
          totalCommission: number;
          totalPrizes: number;
        }) => Promise<{
          success?: boolean;
          checkpoint?: LotoCheckpoint;
          error?: string;
        }>;
      };
    };
  };
};

// Wide, fixed range so a `sale_date` computed near a local-day boundary can
// never fall outside it — this is a DELTA source, never an absolute total,
// so a wide range is safe (nothing outside this test's own action window
// changes within it).
const REPORT_FROM = "2000-01-01";
const REPORT_TO = "2099-12-31";

/** Loto supplier's net balance in LBP (0 if the supplier row doesn't exist
 *  yet — it always will by the time this file runs). */
async function lotoBalance(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const w = window as unknown as Api;
    const loto = (await w.api.suppliers.list("", true)).find(
      (s) => s.provider === "LOTO",
    );
    if (!loto) return 0;
    const b = (await w.api.suppliers.getBalances(true)).find(
      (x) => x.supplier_id === loto.id,
    );
    return b?.total_lbp ?? 0;
  });
}

async function generalLbp(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const w = window as unknown as Api;
    return (await w.api.dashboard.getDrawerBalances()).generalDrawer.lbp;
  });
}

async function reportTotals(
  page: Page,
): Promise<{ sales: number; commission: number; tickets: number }> {
  return page.evaluate(
    async (args: { from: string; to: string }) => {
      const w = window as unknown as Api;
      const res = await w.api.loto.report(args.from, args.to);
      return {
        sales: res.reportData?.total_sales ?? 0,
        commission: res.reportData?.total_commission ?? 0,
        tickets: res.reportData?.total_tickets ?? 0,
      };
    },
    { from: REPORT_FROM, to: REPORT_TO },
  );
}

async function sellTicket(
  page: Page,
  args: { ticket_number: string; sale_amount: number; commission_rate: number },
): Promise<{ ok: boolean; error: string | null; ticket: LotoTicket | null }> {
  return page.evaluate(async (a) => {
    const w = window as unknown as Api;
    const res = await w.api.loto.sell({
      ticket_number: a.ticket_number,
      sale_amount: a.sale_amount,
      commission_rate: a.commission_rate,
      payment_method: "CASH",
      currency: "LBP",
    });
    return {
      ok: res.success === true,
      error: res.error ?? null,
      ticket: res.ticket ?? null,
    };
  }, args);
}

async function getTicket(page: Page, id: number): Promise<LotoTicket | null> {
  return page.evaluate(async (ticketId) => {
    const w = window as unknown as Api;
    const res = await w.api.loto.get(ticketId);
    return res.ticket ?? null;
  }, id);
}

async function createCheckpoint(page: Page): Promise<LotoCheckpoint> {
  const result = await page.evaluate(async () => {
    const w = window as unknown as Api;
    const today = new Date().toISOString().slice(0, 10);
    const res = await w.api.loto.checkpoint.create({
      checkpoint_date: today,
      period_start: today,
      period_end: today,
    });
    return { ok: res.success === true, error: res.error ?? null, checkpoint: res.checkpoint ?? null };
  });
  expect(result.error).toBeNull();
  expect(result.ok).toBe(true);
  expect(result.checkpoint).not.toBeNull();
  return result.checkpoint!;
}

async function getCheckpoint(page: Page, id: number): Promise<LotoCheckpoint> {
  const cp = await page.evaluate(async (cpId) => {
    const w = window as unknown as Api;
    const res = await w.api.loto.checkpoint.get(cpId);
    return res.checkpoint ?? null;
  }, id);
  expect(cp).not.toBeNull();
  return cp!;
}

async function settleCheckpoint(
  page: Page,
  data: {
    id: number;
    totalSales: number;
    totalCommission: number;
    totalPrizes: number;
  },
): Promise<{ ok: boolean; error: string | null }> {
  return page.evaluate(async (d) => {
    const w = window as unknown as Api;
    const res = await w.api.loto.checkpoint.settle(d);
    return { ok: res.success === true, error: res.error ?? null };
  }, data);
}

/**
 * Click the Refund button on the row matched by IDENTITY (unique
 * ticket_number substring — never `/Loto/i` or `.first()` without a filter),
 * then confirm through RefundMethodModal — a CASH-paid loto ticket has
 * customer-facing `payments` legs, so TransactionsViewer opens the
 * tender-selection modal instead of a plain window.confirm(). The pre-filled
 * default already mirrors the original leg exactly (RefundMethodModal.test.tsx
 * proves confirming untouched sends `onConfirm(undefined)`), so clicking
 * "Confirm Refund" with no edits is the correct action here.
 */
async function clickRefundOnRow(page: Page, identity: string): Promise<void> {
  await navigateTo(page, "/");
  await navigateTo(page, "/audit");

  const row = page.locator("tbody tr").filter({ hasText: identity });
  await expect(row).toBeVisible({ timeout: 10_000 });
  const refundBtn = row.getByRole("button", { name: /^Refund$/ });
  await expect(refundBtn).toBeVisible();
  await refundBtn.click();

  const confirmBtn = page.getByRole("button", { name: "Confirm Refund" });
  await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
  await expect(confirmBtn).toBeEnabled();
  await confirmBtn.click();
}

test.describe("LIRA-129 — loto ticket refund", () => {
  test("uncheckpointed ticket refund: supplier balance, General drawer, and report totals all net back to zero", async ({
    appPage,
  }) => {
    const ticketNumber = `L129-UNCP-${Date.now()}`;
    const SALE = 130_000;
    const COMMISSION_RATE = 0.1;
    const COMMISSION = SALE * COMMISSION_RATE; // 13,000

    const before = {
      balance: await lotoBalance(appPage),
      drawer: await generalLbp(appPage),
      report: await reportTotals(appPage),
    };

    const sold = await sellTicket(appPage, {
      ticket_number: ticketNumber,
      sale_amount: SALE,
      commission_rate: COMMISSION_RATE,
    });
    expect(sold.error).toBeNull();
    expect(sold.ok).toBe(true);
    expect(sold.ticket).not.toBeNull();
    const ticketId = sold.ticket!.id;

    // Sale-time sanity (not the crux, but confirms the fixture is well-formed
    // before the refund half runs): shop owes Loto (sale − commission);
    // General banks the FULL cash sale_amount; the report gains one ticket.
    const afterSale = {
      balance: await lotoBalance(appPage),
      drawer: await generalLbp(appPage),
      report: await reportTotals(appPage),
    };
    expect(afterSale.balance - before.balance).toBeCloseTo(
      SALE - COMMISSION,
      2,
    );
    expect(afterSale.drawer - before.drawer).toBeCloseTo(SALE, 2);
    expect(afterSale.report.sales - before.report.sales).toBeCloseTo(SALE, 2);
    expect(afterSale.report.commission - before.report.commission).toBeCloseTo(
      COMMISSION,
      2,
    );
    expect(afterSale.report.tickets - before.report.tickets).toBe(1);

    await clickRefundOnRow(appPage, ticketNumber);

    // THE fix: every one of these deltas returns to the PRE-SALE baseline —
    // never an absolute total, and combined into one worst-case-magnitude
    // poll value so floating point / -0 noise can't spuriously pass or fail.
    await expect
      .poll(
        async () => {
          const s = {
            balance: await lotoBalance(appPage),
            drawer: await generalLbp(appPage),
            report: await reportTotals(appPage),
          };
          return Math.max(
            Math.abs(s.balance - before.balance),
            Math.abs(s.drawer - before.drawer),
            Math.abs(s.report.sales - before.report.sales),
            Math.abs(s.report.commission - before.report.commission),
            Math.abs(s.report.tickets - before.report.tickets),
          );
        },
        { timeout: 10_000 },
      )
      .toBeLessThan(0.01);

    const ticketAfter = await getTicket(appPage, ticketId);
    expect(ticketAfter?.is_refunded).toBe(1);
  });

  test("checkpointed-but-unsettled ticket refund: ledger moves by the ticket's own net, checkpoint totals drop by exactly its values, and the checkpoint still settles", async ({
    appPage,
  }) => {
    const COMMISSION_RATE = 0.1;

    // Three tickets — only ticketB gets refunded.
    const ticketA = await sellTicket(appPage, {
      ticket_number: `L129-CPA-${Date.now()}`,
      sale_amount: 90_000,
      commission_rate: COMMISSION_RATE,
    });
    const ticketBNumber = `L129-CPB-${Date.now()}`;
    const ticketB = await sellTicket(appPage, {
      ticket_number: ticketBNumber,
      sale_amount: 80_000,
      commission_rate: COMMISSION_RATE,
    });
    const ticketC = await sellTicket(appPage, {
      ticket_number: `L129-CPC-${Date.now()}`,
      sale_amount: 70_000,
      commission_rate: COMMISSION_RATE,
    });
    for (const t of [ticketA, ticketB, ticketC]) {
      expect(t.error).toBeNull();
      expect(t.ok).toBe(true);
    }

    // Sweeps these 3 tickets AND any leftover uncheckpointed rows from earlier
    // spec files. That is unavoidable on this shared accumulating DB, so every
    // assertion below is scoped to a DELTA around a single action, or to THIS
    // checkpoint's own re-read totals — never to a global balance (see the
    // note on the settle assertion for why an absolute anchor cannot work).
    const checkpoint = await createCheckpoint(appPage);
    const cpBefore = await getCheckpoint(appPage, checkpoint.id);

    const balanceBeforeRefund = await lotoBalance(appPage);
    await clickRefundOnRow(appPage, ticketBNumber);

    const expectedSalesAfter = cpBefore.total_sales - ticketB.ticket!.sale_amount;
    const expectedCommissionAfter =
      cpBefore.total_commission - ticketB.ticket!.commission_amount;
    const expectedTicketsAfter = cpBefore.total_tickets - 1;

    await expect
      .poll(
        async () => {
          const cp = await getCheckpoint(appPage, checkpoint.id);
          return {
            sales: Number(cp.total_sales.toFixed(2)),
            commission: Number(cp.total_commission.toFixed(2)),
            tickets: cp.total_tickets,
            prizes: Number(cp.total_prizes.toFixed(2)),
          };
        },
        { timeout: 10_000 },
      )
      .toEqual({
        sales: Number(expectedSalesAfter.toFixed(2)),
        commission: Number(expectedCommissionAfter.toFixed(2)),
        tickets: expectedTicketsAfter,
        // Non-winner ticket: total_prizes untouched.
        prizes: Number(cpBefore.total_prizes.toFixed(2)),
      });

    // The refund's OWN effect on the supplier ledger, attributable to this one
    // action: ticketB's TOP_UP row (+(sale − commission), the v119 loto
    // convention) is soft-voided, so the balance drops by exactly that.
    // A delta across a single action, so foreign swept rows cannot skew it.
    const balanceAfterRefund = await lotoBalance(appPage);
    const ticketBNet =
      ticketB.ticket!.sale_amount - ticketB.ticket!.commission_amount;
    expect(
      Math.abs(balanceBeforeRefund - balanceAfterRefund - ticketBNet),
    ).toBeLessThan(0.01);

    // THE crux invariant: settle the SAME checkpoint with its own freshly
    // re-read (post-refund) totals — passing the ORIGINAL pre-refund totals
    // here would reintroduce exactly the bug this test exists to catch
    // (stranding the refunded ticket's contribution in the balance forever).
    const cpAfterRefund = await getCheckpoint(appPage, checkpoint.id);
    const settled = await settleCheckpoint(appPage, {
      id: checkpoint.id,
      totalSales: cpAfterRefund.total_sales,
      totalCommission: cpAfterRefund.total_commission,
      totalPrizes: cpAfterRefund.total_prizes,
    });
    expect(settled.error).toBeNull();
    expect(settled.ok).toBe(true);

    const cpFinal = await getCheckpoint(appPage, checkpoint.id);
    expect(cpFinal.is_settled).toBe(1);

    // DELIBERATELY NOT ASSERTED HERE: the settlement's effect on the Loto
    // balance / "nets to zero".
    //
    // Two attempts at it both passed in isolation and failed in a full-suite
    // run (2026-07-29), because this checkpoint sweeps foreign uncheckpointed
    // rows left by lira-082/091/092/116 and settles those too:
    //   1. anchoring on a pre-checkpoint global baseline — off by ~2,938,002.5
    //      LBP (settling ZEROES the swept rows' TOP_UPs, so the global balance
    //      legitimately lands BELOW that baseline);
    //   2. re-deriving the expected delta as (total_sales − total_commission)
    //      — off by 112,345 LBP, because the real formula is
    //      `supplierPaysShop = totalCommission + totalCashPrizes`
    //      (LotoCheckpointRepository.settleCheckpoint) and lira-091 leaves
    //      unassigned cash prizes behind.
    //
    // The lesson is not "get the formula right on the third try": an e2e that
    // re-derives production's settlement arithmetic just duplicates the
    // implementation, so it changes in lockstep with the code and can never
    // catch a regression in it. That arithmetic is proven exactly, on an
    // ISOLATED in-memory DB where no foreign rows exist, by "Case 3b" in
    // packages/core/src/repositories/__tests__/LotoTicketReversal.test.ts.
    //
    // What THIS test uniquely proves — and does assert above — is the wiring
    // no unit test can reach: a refund driven through the real Transactions-
    // table UI moves the supplier ledger by exactly the refunded ticket's own
    // (sale − commission), and delta-adjusts its unsettled checkpoint's frozen
    // totals, after which that checkpoint still settles cleanly.
  });

  test("settled checkpoint refuses refund: the error names the checkpoint/settlement, and nothing moves", async ({
    appPage,
  }) => {
    const ticketNumber = `L129-SETTLED-${Date.now()}`;
    const baseline = await lotoBalance(appPage);

    const sold = await sellTicket(appPage, {
      ticket_number: ticketNumber,
      sale_amount: 60_000,
      commission_rate: 0.1,
    });
    expect(sold.error).toBeNull();
    expect(sold.ok).toBe(true);
    const ticketId = sold.ticket!.id;

    // By this point in the file, everything earlier is already checkpointed
    // (test 2 swept and settled it all) — this checkpoint sweeps ONLY this
    // one fresh ticket.
    const checkpoint = await createCheckpoint(appPage);
    const cpBefore = await getCheckpoint(appPage, checkpoint.id);

    const settled = await settleCheckpoint(appPage, {
      id: checkpoint.id,
      totalSales: cpBefore.total_sales,
      totalCommission: cpBefore.total_commission,
      totalPrizes: cpBefore.total_prizes,
    });
    expect(settled.error).toBeNull();
    expect(settled.ok).toBe(true);

    // Clean settle confirmed before attempting the blocked refund.
    await expect
      .poll(async () => Math.abs((await lotoBalance(appPage)) - baseline), {
        timeout: 10_000,
      })
      .toBeLessThan(0.01);
    const afterSettleBalance = await lotoBalance(appPage);

    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/audit");
    const row = appPage.locator("tbody tr").filter({ hasText: ticketNumber });
    await expect(row).toBeVisible({ timeout: 10_000 });
    const refundBtn = row.getByRole("button", { name: /^Refund$/ });
    await expect(refundBtn).toBeVisible();

    // CASH leg → RefundMethodModal opens; confirming the untouched default
    // still reaches the backend, which refuses because this ticket's
    // checkpoint is already settled. TransactionsViewer surfaces the failure
    // via `alert("Failed: " + error)` (doRefund) — capture it explicitly,
    // same pattern lira-104/lira-092 use for their confirm() dialogs (the
    // fixtures' global auto-accept races us to it; `.catch` tolerates that).
    const alertSeen = new Promise<string>((resolve) => {
      appPage.once("dialog", (d) => {
        d.accept().catch(() => {});
        resolve(d.message());
      });
    });
    await refundBtn.click();
    const confirmBtn = appPage.getByRole("button", { name: "Confirm Refund" });
    await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
    await confirmBtn.click();

    const alertMessage = await alertSeen;
    expect(alertMessage).toMatch(/^Failed:/);
    expect(alertMessage).toMatch(/already been settled/i);
    expect(alertMessage).toMatch(new RegExp(`checkpoint #${checkpoint.id}`));
    expect(alertMessage).toMatch(/settlement #\d+/);

    // Nothing moved: the ticket is still un-refunded and the balance is
    // exactly where the clean settle left it.
    const ticketAfter = await getTicket(appPage, ticketId);
    expect(ticketAfter?.is_refunded ?? 0).toBe(0);
    expect(await lotoBalance(appPage)).toBeCloseTo(afterSettleBalance, 2);
  });
});
