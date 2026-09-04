/**
 * E2E: LIRA-159 — `FinancialServiceRepository.getUnsettledSummaryByProvider`
 * (`suppliers:unsettled-summary`, the Suppliers Settle-tab's own feeding
 * projection). `pending_commission_usd`/`_lbp` are now LEGACY-only
 * (`commission_model = 0`, via the shared `embeddedCommission` fragment) —
 * 0 for a provider whose unsettled rows are all post-cutover
 * (`commission_model = 1`), because a model-1 row's own `commission` column
 * is a creation-time ESTIMATE settlement never corrects (owner decision D6),
 * so reporting it as a pending DOLLAR figure was never honest. The new
 * `awaiting_settlement_count` field is the model-1 counterpart — a COUNT,
 * never a dollar amount (owner decision D15), since a model-1 row's real
 * commission is unknowable until the operator enters it at settlement.
 *
 * `count` (every unsettled row for the provider, either model) is UNCHANGED
 * — this file proves that explicitly too, since it is the one field a
 * LEGACY-vs-AT_SETTLEMENT split could plausibly have broken by accident.
 *
 * Every OMT SEND/RECEIVE row is born `commission_model = 1`
 * (`FinancialServiceRepository.ts` ~:1496, `isOmtWhishTransfer`) — "a
 * post-cutover OMT row" (the ticket's own phrase) needs no special setup,
 * a plain OMT SEND created via raw IPC already qualifies.
 *
 * Rule 15 (shared accumulating DB): this file never asserts an absolute
 * `getUnsettledSummary()` figure — earlier specs (lira-131 in particular)
 * leave their own unsettled OMT rows behind by design (they test fee
 * mechanics, not settlement, and never settle what they create), so OMT's
 * row in this projection is never at any predictable absolute value by the
 * time this file runs. Every assertion below is a DELTA on the OMT row,
 * matched by `provider === "OMT"` (never by index — `getUnsettledSummary()`
 * returns one row per provider, `GROUP BY provider`, in no guaranteed
 * order), snapshotted immediately before/after this file's own single
 * create/settle action.
 *
 * `amount_usd`/`amount_lbp` are 0 in the raw `settleTransactions` call for
 * the same reason `lira-159-monthly-pl-settled-commission.spec.ts` documents
 * at length in its own header: that pair is the settlement's own net-pay
 * bookkeeping figure, orthogonal to `commission_usd`/`commission_lbp` (which
 * is the only thing this file's own assertions read), and passing 0/0 keeps
 * `owesCash` false so no `payments[]` leg is required — correctly scoping
 * this IPC-driven test to the ONE axis it exists to prove.
 */

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

const ts = Date.now();

type SupplierRow = { id: number; provider: string | null };
type AddTransactionResult = { success?: boolean; id?: number; error?: string };
type SettleResult = { success?: boolean; id?: number; error?: string };
type UnsettledSummaryRow = {
  provider: string;
  count: number;
  awaiting_settlement_count: number;
  pending_commission_usd: number;
  pending_commission_lbp: number;
};

type Api = {
  api: {
    omt: {
      addTransaction: (d: Record<string, unknown>) => Promise<AddTransactionResult>;
    };
    suppliers: {
      list: (
        search?: string,
        includeInactive?: boolean,
      ) => Promise<SupplierRow[]>;
      getUnsettledSummary: () => Promise<UnsettledSummaryRow[]>;
      settleTransactions: (data: {
        supplier_id: number;
        financial_service_ids: number[];
        amount_usd: number;
        amount_lbp: number;
        commission_usd: number;
        commission_lbp: number;
        entry_mode?: "LUMP" | "RATE";
        note?: string;
      }) => Promise<SettleResult>;
    };
  };
};

/** The OMT row of `getUnsettledSummary()`, defaulted to all-zero when OMT
 *  has no unsettled rows at all at snapshot time (the projection only
 *  returns providers with at least one unsettled row — `GROUP BY provider`
 *  over `WHERE is_settled = 0`) — matching the `?? 0` convention every other
 *  delta-based spec in this suite uses for a possibly-absent baseline row. */
async function omtSummary(page: Page): Promise<UnsettledSummaryRow> {
  const row = await page.evaluate(async () => {
    const w = window as unknown as Api;
    const rows = await w.api.suppliers.getUnsettledSummary();
    return rows.find((r) => r.provider === "OMT") ?? null;
  });
  return {
    provider: "OMT",
    count: row?.count ?? 0,
    awaiting_settlement_count: row?.awaiting_settlement_count ?? 0,
    pending_commission_usd: row?.pending_commission_usd ?? 0,
    pending_commission_lbp: row?.pending_commission_lbp ?? 0,
  };
}

test.describe("LIRA-159 — unsettled summary: awaiting_settlement_count is a count, never a dollar figure", () => {
  test("a post-cutover OMT row: awaiting_settlement_count +1, count +1, pending_commission_usd unchanged; settling returns awaiting_settlement_count to baseline", async ({
    appPage,
  }) => {
    const AMOUNT = 500 + (ts % 300) + 0.61;
    const CREATION_ESTIMATE = 0.45;

    const before = await omtSummary(appPage);

    const createRes = await appPage.evaluate(
      async (args: { amount: number; commission: number }) => {
        const w = window as unknown as Api;
        return w.api.omt.addTransaction({
          provider: "OMT",
          serviceType: "SEND",
          amount: args.amount,
          currency: "USD",
          commission: args.commission,
          omtServiceType: "INTRA",
          paidByMethod: "CASH",
        });
      },
      { amount: AMOUNT, commission: CREATION_ESTIMATE },
    );
    expect(createRes.error ?? null).toBeNull();
    expect(createRes.success).not.toBe(false);
    expect(createRes.id, "addTransaction did not return an id").toBeTruthy();
    const rowId = createRes.id!;

    const afterCreate = await omtSummary(appPage);

    expect(
      afterCreate.awaiting_settlement_count - before.awaiting_settlement_count,
      "a fresh model-1 OMT row must increment awaiting_settlement_count by exactly 1",
    ).toBe(1);
    expect(
      afterCreate.count - before.count,
      "count (both models combined) is unchanged behaviour — still +1",
    ).toBe(1);
    expect(
      afterCreate.pending_commission_usd - before.pending_commission_usd,
      "a model-1 row's creation-time estimate must NOT be reported as a pending dollar figure",
    ).toBeCloseTo(0, 2);

    // ── Settle it — awaiting_settlement_count must return to baseline ──────
    const supplier = await appPage.evaluate(async () => {
      const w = window as unknown as Api;
      return (await w.api.suppliers.list("", true)).find(
        (s) => s.provider === "OMT",
      );
    });
    expect(supplier, "OMT supplier not found").toBeTruthy();

    const settleRes = await appPage.evaluate(
      async (args: { supplierId: number; rowId: number }) => {
        const w = window as unknown as Api;
        return w.api.suppliers.settleTransactions({
          supplier_id: args.supplierId,
          financial_service_ids: [args.rowId],
          amount_usd: 0,
          amount_lbp: 0,
          commission_usd: 2.0, // deliberately != CREATION_ESTIMATE — irrelevant to this file's own assertions, see lira-159-monthly-pl-settled-commission.spec.ts for that axis
          commission_lbp: 0,
          entry_mode: "LUMP",
          note: "LIRA-159 e2e unsettled-summary settlement",
        });
      },
      { supplierId: supplier!.id, rowId },
    );
    expect(settleRes.error ?? null).toBeNull();
    expect(settleRes.success).toBe(true);

    const afterSettle = await omtSummary(appPage);

    expect(
      afterSettle.awaiting_settlement_count - before.awaiting_settlement_count,
      "settling the row must return awaiting_settlement_count to its pre-action value",
    ).toBe(0);
    // Bonus consistency check (not explicitly required by the ticket, but a
    // natural corollary): a settled row also drops out of `count` itself
    // (`WHERE is_settled = 0`), so the whole row nets back to baseline.
    expect(afterSettle.count - before.count).toBe(0);
  });
});

// Keep a typed reference to Page so the import is always used.
export type _Lira159UnsettledSummarySpecPage = Page;
