/**
 * Financial Repository
 *
 * Handles cross-table financial aggregation for P&L and Commissions.
 */

import { BaseRepository } from "./BaseRepository.js";
import { DatabaseError } from "../utils/errors.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { activeExpense, dateRange, notRefunded, getProfitRepository } from "./ProfitRepository.js";
import { monthBounds } from "../utils/localDate.js";

export interface MonthlyPL {
  month: string;
  salesProfitUSD: number;
  serviceCommissionsUSD: number;
  serviceCommissionsLBP: number;
  /** Per-currency commission breakdown (dynamic) */
  serviceCommissionsByCurrency: Record<string, number>;
  expensesUSD: number;
  expensesLBP: number;
  netProfitUSD: number;
  netProfitLBP: number;
}

export class FinancialRepository extends BaseRepository<{ id: number }> {
  constructor() {
    super("sales", { softDelete: false }); // Base table doesn't matter much for aggregations
  }

  // Override getColumns() - This repository uses aggregations, not direct selects
  protected getColumns(): string {
    return "id"; // Minimal since this repo only does aggregations
  }

  /**
   * Get list of all drawer names from drawer_balances
   */
  getDrawerNames(): string[] {
    try {
      const rows = this.db
        .prepare(
          `SELECT DISTINCT drawer_name FROM drawer_balances WHERE tenant_id = ? ORDER BY drawer_name`,
        )
        .all(getCurrentTenantId()) as { drawer_name: string }[];
      return rows.map((r) => r.drawer_name);
    } catch (error) {
      throw new DatabaseError("Failed to get drawer names", { cause: error });
    }
  }

  /**
   * Get Monthly P&L Aggregation
   * @param month format 'YYYY-MM'
   *
   * LIRA-159 (D1) — the commission arms are COMPOSED from
   * `ProfitRepository.getRealizedCommissionTotals` (legacy, `commission_model
   * = 0`) + `ProfitRepository.getSupplierCommissionTotals` (settlement-day,
   * `commission_model = 1`) rather than a third hand-rolled
   * `SUM(financial_services.commission)` query. Two reasons this is
   * composition and not a rewrite-in-place:
   *
   *  - **Correctness**: for a `commission_model = 1` row, the row's own
   *    `commission` column is a creation-time ESTIMATE that settlement
   *    overrides and never writes back (owner decision D6 — no stamp-back).
   *    Summing it directly (the old query) reported a number that was never
   *    true, and never decayed even after the underlying transaction was
   *    voided (no refund gate at all). Composing the two repository methods
   *    means this tile inherits their correct gating for free.
   *  - **Single source of truth**: `getRealizedCommissionTotals` and
   *    `getSupplierCommissionTotals` are already the definition of
   *    "commission recognised in this period" that the Profits page uses. A
   *    third copy of that SQL is exactly the divergence class LIRA-108
   *    fixed once already — composing removes a whole class of future
   *    disagreement instead of adding a third site to keep in lockstep
   *    (rule 14).
   *
   * **Recognition basis change (deliberate):** a model-1 (AT_SETTLEMENT) row's
   * commission now appears in the month it is SETTLED, never the month the
   * underlying OMT/WHISH/BILL transaction happened (owner decisions D7/D10,
   * cash basis) — the same switch LIRA-158 made for the Closing snapshot. A
   * legacy (model-0) row's commission is recognised once supplier-settled
   * AND counterparty-clear (not partner-pending, not debt-pending).
   *
   * **Deliberately does NOT mirror `ClosingRepository.getDailyStatsSnapshot`'s
   * `finProfitLegacy`** — that query is missing `notPartnerPending`/
   * `notDebtPending`, a documented KNOWN GAP
   * (`constants/__tests__/profitRecognition.guard.test.ts` ~:592-610,
   * ticketed as LIRA-160). `getRealizedCommissionTotals` carries both gates,
   * so composing here avoids importing that gap into the Dashboard tile.
   *
   * **Per-currency is mandatory**, not incidental: this tile feeds
   * `netProfitLBP`, so both arms are summed in BOTH currencies. A USD-only
   * mirror of Closing's arm would silently drop LBP commission for every
   * settled model-1 batch.
   *
   * `serviceCommissionsByCurrency` now always carries exactly the `USD` and
   * `LBP` keys (both composed methods bucket `currency != 'LBP'` into USD,
   * matching every other reporting surface's convention) — previously it
   * carried one key per literal `financial_services.currency` value, so a
   * hypothetical third currency got its own key. Verified 2026-09-04: this
   * field has no reader anywhere in the app (only its own declaration and
   * the mirrored `packages/ui` type), so this fold changes nothing on
   * screen.
   *
   * The sales arm remains USD-only (pre-existing — `netProfitLBP` never
   * included sales profit; not changed here) and gains a refund gate
   * (`notRefunded`) it was missing: a voided sale item was inflating this
   * tile forever, the same class of bug the commission arms had. It
   * deliberately does NOT add Closing's fully-paid predicate
   * (`s.paid_usd + … >= s.final_amount_usd - 0.05`) — that is a separate
   * recognition question, out of scope for this fix.
   */
  getMonthlyPL(month: string): MonthlyPL {
    // Hoisted OUTSIDE the try: `monthBounds` throws `ValidationError` for a
    // malformed `month` (e.g. "2026-13", "garbage"). That's a caller error,
    // not a database error — if this line sat inside the try below, the
    // catch would rewrap it as `DatabaseError("Failed to aggregate monthly
    // P&L")`, misreporting a bad-input problem as a backend failure and
    // burying the real cause in `cause`. Do not move it back in.
    const { fromDt, toDt } = monthBounds(month);
    try {
      const tenantId = getCurrentTenantId();

      // 1. Sales Profit (Gross Profit from Products)
      const salesResult = this.db
        .prepare(
          `
        SELECT
          COALESCE(SUM(si.sold_price_usd - si.cost_price_snapshot_usd), 0) as profit
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        WHERE s.status = 'completed'
          AND ${dateRange("s.created_at")}
          AND ${notRefunded("si")}
          AND si.tenant_id = ?
          AND s.tenant_id = ?
      `,
        )
        .get(fromDt, toDt, tenantId, tenantId) as { profit: number };

      // 2. Service Commissions (OMT, Whish, etc.) — composed from the two
      // gated ProfitRepository arms rather than a raw SUM(commission) over
      // financial_services (see the method doc comment above for why).
      const profits = getProfitRepository();
      const legacy = profits.getRealizedCommissionTotals(fromDt, toDt);
      const settlement = profits.getSupplierCommissionTotals(fromDt, toDt);
      const commissionUsd = legacy.total_usd + settlement.profit_usd;
      const commissionLbp = legacy.total_lbp + settlement.profit_lbp;
      const serviceCommissionsByCurrency: Record<string, number> = {
        USD: commissionUsd,
        LBP: commissionLbp,
      };

      // 3. Expenses — gated to status='active' AND not-refunded (rule 14's
      // shared `activeExpense` predicate), else a voided/refunded expense
      // (either of the two doors — see `activeExpense`'s doc) keeps
      // deflating this month's net profit forever even after its drawer leg
      // was reversed (rule 20).
      const expensesResult = this.db
        .prepare(
          `
        SELECT
          COALESCE(SUM(amount_usd), 0) as expenses_usd,
          COALESCE(SUM(amount_lbp), 0) as expenses_lbp
        FROM expenses
        WHERE ${dateRange("expense_date")}
          AND tenant_id = ?
          AND ${activeExpense()}
      `,
        )
        .get(fromDt, toDt, tenantId) as {
        expenses_usd: number;
        expenses_lbp: number;
      };

      // Per-currency net profit: income - expenses, independently
      const netProfitUSD =
        salesResult.profit + commissionUsd - expensesResult.expenses_usd;
      const netProfitLBP = commissionLbp - expensesResult.expenses_lbp;

      return {
        month,
        salesProfitUSD: salesResult.profit,
        serviceCommissionsUSD: commissionUsd,
        serviceCommissionsLBP: commissionLbp,
        serviceCommissionsByCurrency,
        expensesUSD: expensesResult.expenses_usd,
        expensesLBP: expensesResult.expenses_lbp,
        netProfitUSD,
        netProfitLBP,
      };
    } catch (error) {
      throw new DatabaseError("Failed to aggregate monthly P&L", {
        cause: error,
      });
    }
  }
}

let financialRepositoryInstance: FinancialRepository | null = null;

export function getFinancialRepository(): FinancialRepository {
  if (!financialRepositoryInstance) {
    financialRepositoryInstance = new FinancialRepository();
  }
  return financialRepositoryInstance;
}
