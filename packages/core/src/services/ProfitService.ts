/**
 * Profit Service
 *
 * Comprehensive profit analytics across all revenue modules:
 * - Product sales (sold price - cost price)
 * - Financial services (commission)
 * - Recharges - MTC/Alfa (price - cost)
 * - Custom services (price - cost)
 * - Maintenance (price - cost)
 * - Expenses (deducted from profit)
 *
 * Supports filtering by date range, module, payment method, and user.
 *
 * All SQL lives in ProfitRepository (cross-entity reporting repo). This service
 * keeps only assembly, per-currency aggregation/summing, currency-splitting and
 * business decisions — it never touches the database.
 */

import {
  getProfitRepository,
  type ProfitRepository,
} from "../repositories/ProfitRepository.js";
import logger from "../utils/logger.js";

// =============================================================================
// Types
// =============================================================================

export interface ProfitByModule {
  module: string;
  label: string;
  revenue_usd: number;
  revenue_lbp: number;
  cost_usd: number;
  cost_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  count: number;
}

export interface ProfitByDate {
  date: string;
  revenue_usd: number;
  revenue_lbp: number;
  cost_usd: number;
  cost_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  expenses_usd: number;
  expenses_lbp: number;
  net_profit_usd: number;
  net_profit_lbp: number;
}

export interface ProfitByPaymentMethod {
  method: string;
  total_usd: number;
  total_lbp: number;
  count: number;
  /** For commission rows: the pending amount not yet realized */
  pending_commission_usd?: number;
  /** 1 = realized/settled, 0 = pending settlement */
  is_settled?: number;
  /** 1 = all entries are debt repayment pass-throughs (no profit generated) */
  is_debt_repayment_only?: number;
}

export interface ProfitByUser {
  user_id: number;
  username: string;
  revenue_usd: number;
  revenue_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  transaction_count: number;
  /** Pending profit from unsettled OMT/WHISH commissions for this cashier */
  pending_profit_usd: number;
}

export interface ProfitSummary {
  period: string;
  sales: {
    revenue_usd: number;
    cost_usd: number;
    profit_usd: number;
    count: number;
  };
  financial_services: {
    revenue_usd: number;
    revenue_lbp: number;
    commission_usd: number;
    commission_lbp: number;
    pending_commission_usd: number;
    pending_commission_lbp: number;
    /** Payment-method fees kept by the shop (immediate profit, PM_FEE rows) */
    pm_fee_usd: number;
    pm_fee_lbp: number;
    count: number;
  };
  mobile_services: {
    revenue_usd: number;
    revenue_lbp: number;
    cost_usd: number;
    cost_lbp: number;
    profit_usd: number;
    profit_lbp: number;
    count: number;
  };
  custom_services: {
    revenue_usd: number;
    revenue_lbp: number;
    cost_usd: number;
    cost_lbp: number;
    profit_usd: number;
    profit_lbp: number;
    count: number;
  };
  recharges: {
    revenue_usd: number;
    revenue_lbp: number;
    cost_usd: number;
    cost_lbp: number;
    profit_usd: number;
    profit_lbp: number;
    count: number;
  };
  maintenance: {
    revenue_usd: number;
    revenue_lbp: number;
    cost_usd: number;
    cost_lbp: number;
    profit_usd: number;
    profit_lbp: number;
    count: number;
  };
  loto: {
    revenue_lbp: number;
    profit_lbp: number;
    count: number;
  };
  exchange: {
    revenue_usd: number;
    profit_usd: number;
    count: number;
  };
  /** T3 keep-change on debt repayments — kept change stamped on
   *  DEBT_REPAYMENT transactions ("Other / kept change" line; owner decision
   *  2026-07-13, docs/plans/done_plans/T3_KEEP_CHANGE_PLAN.md KC-2). */
  debt_repayments: {
    profit_usd: number;
    profit_lbp: number;
    count: number;
  };
  /** CQ-10 (D1) — signed profit from counterparty discounts/write-offs across
   *  all three ledgers (debt/supplier/partner): a forgiven receivable is
   *  negative, a received discount is positive. NETTED into totals below
   *  (same treatment as debt_repayments) — a discount is a real P&L event,
   *  not just a footnote. */
  discounts: { usd: number; lbp: number };
  /** LIRA-137 fix (BILL_COMMISSION_SETTLEMENT_PLAN.md) — bills-only
   *  settlement commission (Katsh/iPick BILL rows), profit-only (no
   *  revenue/cost pair) and stamped directly on the SUPPLIER_SETTLEMENT
   *  transaction at settlement. NETTED into totals below (same immediate-
   *  recognition treatment as debt_repayments/discounts — the commission
   *  arrives directly into the provider drawer at settlement, so no
   *  partner-/debt-pending gate applies to it, unlike financial_services
   *  commission). Exactly 0 for every other settlement shape (legacy
   *  commission_model = 0, or a non-bills new-model batch). */
  supplier_commission: { profit_usd: number; profit_lbp: number; count: number };
  expenses: { total_usd: number; total_lbp: number; count: number };
  totals: {
    gross_revenue_usd: number;
    gross_revenue_lbp: number;
    total_cost_usd: number;
    total_cost_lbp: number;
    gross_profit_usd: number;
    gross_profit_lbp: number;
    net_profit_usd: number;
    net_profit_lbp: number;
  };
  /** Deferred-profit visibility (owner ask 2026-07-14): profit already
   *  stamped on a transaction but currently STRANDED behind an uncovered
   *  partner settlement (PFT-6) or client-debt repayment (DBT-1). Additive
   *  visibility only — NOT netted into `totals` above (those already exclude
   *  it via the same partner/debt gates). */
  deferred: {
    partner_profit_usd: number;
    partner_profit_lbp: number;
    client_debt_profit_usd: number;
    client_debt_profit_lbp: number;
  };
}

export interface ProfitByClient {
  client_id: number | null;
  client_name: string;
  client_phone: string | null;
  revenue_usd: number;
  revenue_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  transaction_count: number;
  /** Pending profit from unsettled commissions linked to this client */
  pending_profit_usd: number;
}

export interface PendingProfitRow {
  sale_id: number;
  created_at: string;
  client_name: string;
  client_phone: string;
  total_amount_usd: number;
  paid_usd: number;
  outstanding_usd: number;
  potential_profit_usd: number;
  items_summary: string;
}

export interface UnsettledCommissionRow {
  id: number;
  provider: string;
  omt_service_type: string | null;
  amount: number;
  currency: string;
  commission: number;
  omt_fee: number | null;
  created_at: string;
}

// =============================================================================
// Service
// =============================================================================

export class ProfitService {
  private repo: ProfitRepository;

  constructor(repo: ProfitRepository = getProfitRepository()) {
    this.repo = repo;
  }

  /**
   * Overall profit summary for a date range.
   */
  getSummary(from: string, to: string): ProfitSummary {
    try {
      const fromDt = `${from} 00:00:00`;
      const toDt = `${to} 23:59:59`;

      // 1. Sales — revenue + cost from sale_items; profit from unified ledger.
      const salesRevCost = this.repo.getSalesRevCost(fromDt, toDt);
      const salesProfitRow = this.repo.getSalesProfit(fromDt, toDt);

      const sales = {
        revenue_usd: salesRevCost.revenue_usd,
        cost_usd: salesRevCost.cost_usd,
        profit_usd: salesProfitRow.profit_usd,
        count: salesRevCost.count,
      };

      // 2. Financial services (OMT, WHISH, OMT_APP, WHISH_APP, BINANCE) — settled.
      const finRows = this.repo.getFinancialSettledByCurrency(fromDt, toDt);

      const finSvc = {
        revenue_usd: 0,
        revenue_lbp: 0,
        commission_usd: 0,
        commission_lbp: 0,
        pending_commission_usd: 0,
        pending_commission_lbp: 0,
        pm_fee_usd: 0,
        pm_fee_lbp: 0,
        count: 0,
      };
      for (const row of finRows) {
        if (row.currency === "LBP") {
          finSvc.revenue_lbp += row.revenue;
          finSvc.commission_lbp += row.commission;
        } else {
          finSvc.revenue_usd += row.revenue;
          finSvc.commission_usd += row.commission;
        }
        finSvc.count += row.count;
      }

      // Pending (unsettled) commissions.
      const pendingRows = this.repo.getFinancialPendingByCurrency(fromDt, toDt);
      for (const row of pendingRows) {
        if (row.currency === "LBP") {
          finSvc.pending_commission_lbp += row.commission;
          finSvc.revenue_lbp += row.revenue;
        } else {
          finSvc.pending_commission_usd += row.commission;
          finSvc.revenue_usd += row.revenue;
        }
        finSvc.count += row.count;
      }

      // Payment-method fees — immediate shop profit kept in the wallet drawer,
      // recorded as PM_FEE payment rows but previously never counted anywhere.
      for (const row of this.repo.getPmFeeTotals(fromDt, toDt)) {
        if (row.currency_code === "LBP") {
          finSvc.pm_fee_lbp += row.total;
        } else {
          finSvc.pm_fee_usd += row.total;
        }
      }

      // 2b. Mobile services (iPick, Katsh, BOB) — cost/price flow.
      const mobileRows = this.repo.getMobileServicesByCurrency(fromDt, toDt);

      const mobileSvc = {
        revenue_usd: 0,
        revenue_lbp: 0,
        cost_usd: 0,
        cost_lbp: 0,
        profit_usd: 0,
        profit_lbp: 0,
        count: 0,
      };
      for (const row of mobileRows) {
        if (row.currency === "LBP") {
          mobileSvc.revenue_lbp += row.revenue;
          mobileSvc.cost_lbp += row.cost;
          mobileSvc.profit_lbp += row.profit;
        } else {
          mobileSvc.revenue_usd += row.revenue;
          mobileSvc.cost_usd += row.cost;
          mobileSvc.profit_usd += row.profit;
        }
        mobileSvc.count += row.count;
      }

      // 3. Recharges (MTC/Alfa).
      const rechargeRows = this.repo.getRechargesByCurrency(fromDt, toDt);

      const recharges = {
        revenue_usd: 0,
        revenue_lbp: 0,
        cost_usd: 0,
        cost_lbp: 0,
        profit_usd: 0,
        profit_lbp: 0,
        count: 0,
      };
      for (const row of rechargeRows) {
        if (row.currency_code === "LBP") {
          recharges.revenue_lbp += row.revenue;
          recharges.cost_lbp += row.cost;
          recharges.profit_lbp += row.profit;
        } else {
          recharges.revenue_usd += row.revenue;
          recharges.cost_usd += row.cost;
          recharges.profit_usd += row.profit;
        }
        recharges.count += row.count;
      }

      // 4. Custom services.
      const custom = this.repo.getCustomServicesTotals(fromDt, toDt);

      // 5. Maintenance.
      const maint = this.repo.getMaintenanceTotals(fromDt, toDt);

      // 5b. Loto ticket commissions (LBP).
      const loto = this.repo.getLotoTotals(fromDt, toDt);

      // 6. Exchange profit (v30+: sum leg profits).
      const exchange = this.repo.getExchangeTotals(fromDt, toDt);

      // Kept change stamped on debt repayments (T3 KC-2) — the only profit
      // source on DEBT_REPAYMENT rows; REFUND rows net a voided repayment out.
      const debtRepayments = this.repo.getDebtRepaymentProfit(fromDt, toDt);

      // CQ-10 (D1) — signed profit from counterparty discounts/write-offs
      // (debt/supplier/partner alike — one unified transaction type).
      const discountTotals = this.repo.getCounterpartyDiscountTotals(
        fromDt,
        toDt,
      );
      const discounts = {
        usd: discountTotals.profit_usd,
        lbp: discountTotals.profit_lbp,
      };

      // LIRA-137 fix (BILL_COMMISSION_SETTLEMENT_PLAN.md) — bills-only
      // settlement commission (profit-only, immediate recognition — same
      // treatment as debtRepayments/discounts above).
      const supplierCommission = this.repo.getSupplierCommissionTotals(
        fromDt,
        toDt,
      );

      // 7. Expenses.
      const expenses = this.repo.getExpenseTotals(fromDt, toDt);

      // Deferred profit (PFT-6 partner + DBT-1 client-debt) — visibility
      // only; NOT netted into gross_profit_*/net_profit_* below, which
      // already exclude it via the same partner/debt gates.
      const deferred = this.repo.getDeferredProfit(fromDt, toDt);

      // Totals
      const grossRevenueUsd =
        sales.revenue_usd +
        finSvc.revenue_usd +
        recharges.revenue_usd +
        custom.revenue_usd +
        maint.revenue_usd +
        exchange.revenue_usd +
        mobileSvc.revenue_usd;
      const grossRevenueLbp =
        finSvc.revenue_lbp +
        recharges.revenue_lbp +
        custom.revenue_lbp +
        maint.revenue_lbp +
        loto.revenue_lbp +
        mobileSvc.revenue_lbp;
      const totalCostUsd =
        sales.cost_usd +
        recharges.cost_usd +
        custom.cost_usd +
        maint.cost_usd +
        mobileSvc.cost_usd;
      const totalCostLbp =
        recharges.cost_lbp +
        custom.cost_lbp +
        maint.cost_lbp +
        mobileSvc.cost_lbp;
      const grossProfitUsd =
        sales.profit_usd +
        finSvc.commission_usd +
        finSvc.pm_fee_usd +
        recharges.profit_usd +
        custom.profit_usd +
        maint.profit_usd +
        exchange.profit_usd +
        mobileSvc.profit_usd +
        debtRepayments.profit_usd +
        discounts.usd +
        supplierCommission.profit_usd;
      const grossProfitLbp =
        finSvc.commission_lbp +
        finSvc.pm_fee_lbp +
        recharges.profit_lbp +
        custom.profit_lbp +
        maint.profit_lbp +
        loto.profit_lbp +
        mobileSvc.profit_lbp +
        debtRepayments.profit_lbp +
        discounts.lbp +
        supplierCommission.profit_lbp;

      return {
        period: `${from} to ${to}`,
        sales,
        financial_services: finSvc,
        mobile_services: mobileSvc,
        recharges,
        custom_services: custom,
        maintenance: maint,
        loto,
        exchange,
        debt_repayments: debtRepayments,
        discounts,
        supplier_commission: supplierCommission,
        expenses,
        totals: {
          gross_revenue_usd: grossRevenueUsd,
          gross_revenue_lbp: grossRevenueLbp,
          total_cost_usd: totalCostUsd,
          total_cost_lbp: totalCostLbp,
          gross_profit_usd: grossProfitUsd,
          gross_profit_lbp: grossProfitLbp,
          net_profit_usd: grossProfitUsd - expenses.total_usd,
          net_profit_lbp: grossProfitLbp - expenses.total_lbp,
        },
        deferred,
      };
    } catch (error) {
      logger.error({ error }, "ProfitService.getSummary error");
      throw error;
    }
  }

  /**
   * Profit breakdown by module/source type.
   */
  getByModule(from: string, to: string): ProfitByModule[] {
    try {
      const fromDt = `${from} 00:00:00`;
      const toDt = `${to} 23:59:59`;

      const results: ProfitByModule[] = [];

      // Sales
      const salesRevCost = this.repo.getSalesRevCost(fromDt, toDt);
      const salesProfit = this.repo.getSalesProfit(fromDt, toDt);
      if (salesRevCost.count > 0) {
        results.push({
          module: "SALE",
          label: "Product Sales",
          revenue_usd: salesRevCost.revenue_usd,
          revenue_lbp: 0,
          cost_usd: salesRevCost.cost_usd,
          cost_lbp: 0,
          profit_usd: salesProfit.profit_usd,
          profit_lbp: 0,
          count: salesRevCost.count,
        });
      }

      // Financial services by provider — settled only.
      const finRows = this.repo.getFinancialSettledByProvider(fromDt, toDt);
      for (const row of finRows) {
        results.push({
          module: `FINANCIAL_SERVICE_${row.provider}`,
          label: row.provider,
          revenue_usd: row.revenue_usd,
          revenue_lbp: row.revenue_lbp,
          cost_usd: 0,
          cost_lbp: 0,
          profit_usd: row.profit_usd,
          profit_lbp: row.profit_lbp,
          count: row.count,
        });
      }

      // Custom services.
      const customRow = this.repo.getCustomServicesTotals(fromDt, toDt);
      if (customRow.count > 0) {
        results.push({
          module: "CUSTOM_SERVICE",
          label: "Custom Services",
          revenue_usd: customRow.revenue_usd,
          revenue_lbp: customRow.revenue_lbp,
          cost_usd: customRow.cost_usd,
          cost_lbp: customRow.cost_lbp,
          profit_usd: customRow.profit_usd,
          profit_lbp: customRow.profit_lbp,
          count: customRow.count,
        });
      }

      // Recharges by carrier.
      const rechargeRows = this.repo.getRechargesByCarrier(fromDt, toDt);
      for (const row of rechargeRows) {
        results.push({
          module: `RECHARGE_${row.carrier}`,
          label: `${row.carrier} Recharges`,
          revenue_usd: row.revenue_usd,
          revenue_lbp: row.revenue_lbp,
          cost_usd: row.cost_usd,
          cost_lbp: row.cost_lbp,
          profit_usd: row.profit_usd,
          profit_lbp: row.profit_lbp,
          count: row.count,
        });
      }

      // Maintenance.
      const maintRow = this.repo.getMaintenanceTotals(fromDt, toDt);
      if (maintRow.count > 0) {
        results.push({
          module: "MAINTENANCE",
          label: "Maintenance",
          revenue_usd: maintRow.revenue_usd,
          revenue_lbp: maintRow.revenue_lbp,
          cost_usd: maintRow.cost_usd,
          cost_lbp: maintRow.cost_lbp,
          profit_usd: maintRow.profit_usd,
          profit_lbp: maintRow.profit_lbp,
          count: maintRow.count,
        });
      }

      // Loto ticket commissions (LBP). Loto is a commission service like
      // OMT/WHISH: revenue = ticket face value, cost = 0, profit = commission.
      // (The ticket face passes through to the loto provider; only the
      // commission is the shop's margin — same convention as the FS rows above.)
      const lotoRow = this.repo.getLotoTotals(fromDt, toDt);
      if (lotoRow.count > 0) {
        results.push({
          module: "LOTO",
          label: "Loto Tickets",
          revenue_usd: 0,
          revenue_lbp: lotoRow.revenue_lbp,
          cost_usd: 0,
          cost_lbp: 0,
          profit_usd: 0,
          profit_lbp: lotoRow.profit_lbp,
          count: lotoRow.count,
        });
      }

      // Payment-method fees (immediate shop profit on wallet payments).
      const pmFeeRows = this.repo.getPmFeeTotals(fromDt, toDt);
      const pmFeeUsd = pmFeeRows
        .filter((r) => r.currency_code !== "LBP")
        .reduce((s, r) => s + r.total, 0);
      const pmFeeLbp = pmFeeRows
        .filter((r) => r.currency_code === "LBP")
        .reduce((s, r) => s + r.total, 0);
      const pmFeeCount = pmFeeRows.reduce((s, r) => s + r.count, 0);
      if (pmFeeCount > 0 && (pmFeeUsd !== 0 || pmFeeLbp !== 0)) {
        results.push({
          module: "PM_FEE",
          label: "Payment Method Fees",
          revenue_usd: pmFeeUsd,
          revenue_lbp: pmFeeLbp,
          cost_usd: 0,
          cost_lbp: 0,
          profit_usd: pmFeeUsd,
          profit_lbp: pmFeeLbp,
          count: pmFeeCount,
        });
      }

      // Exchange (v30+: sum leg profits)
      const exchangeRow = this.repo.getExchangeTotals(fromDt, toDt);
      if (exchangeRow.count > 0) {
        results.push({
          module: "EXCHANGE",
          label: "Currency Exchange",
          revenue_usd: exchangeRow.revenue_usd, // USD equivalent of all exchanges
          revenue_lbp: 0,
          cost_usd: exchangeRow.revenue_usd - exchangeRow.profit_usd, // Revenue - Profit = Cost
          cost_lbp: 0,
          profit_usd: exchangeRow.profit_usd,
          profit_lbp: 0,
          count: exchangeRow.count,
        });
      }

      return results.sort((a, b) => b.profit_usd - a.profit_usd);
    } catch (error) {
      logger.error({ error }, "ProfitService.getByModule error");
      return [];
    }
  }

  /**
   * Daily profit breakdown for a date range (for charts).
   */
  getByDate(from: string, to: string): ProfitByDate[] {
    try {
      const fromDt = `${from} 00:00:00`;
      const toDt = `${to} 23:59:59`;

      return this.repo.getByDate(from, to, fromDt, toDt);
    } catch (error) {
      logger.error({ error }, "ProfitService.getByDate error");
      return [];
    }
  }

  /**
   * Profit breakdown by payment method.
   *
   * Shows only real customer-facing payment methods (CASH, CARD, etc.).
   * Excludes internal system flows: OMT, WHISH, RESERVE, COMMISSION drawer entries.
   *
   * Financial service commissions are shown as a separate "Commission" row:
   *   - Realized commission (is_settled = 1 AND not partner-pending AND not
   *     debt-pending — LIRA-108, same gates as the Summary per-currency view)
   *     → shown as positive profit
   *   - Pending commission (is_settled = 0, pre-recognition — no counterparty
   *     gates by design) → shown separately with status. A settled but
   *     partner-/debt-pending commission appears in NEITHER row here; it
   *     surfaces in the deferred-profit bucket until settlement/repayment.
   */
  getByPaymentMethod(from: string, to: string): ProfitByPaymentMethod[] {
    try {
      const fromDt = `${from} 00:00:00`;
      const toDt = `${to} 23:59:59`;

      const paymentRows = this.repo.getPaymentMethodRows(fromDt, toDt);
      const realizedCommission = this.repo.getRealizedCommissionTotals(
        fromDt,
        toDt,
      );
      const pendingCommission = this.repo.getPendingCommissionTotals(
        fromDt,
        toDt,
      );

      const results: ProfitByPaymentMethod[] = [...paymentRows];

      if (realizedCommission.count > 0) {
        results.push({
          method: "Commission (Settled)",
          total_usd: realizedCommission.total_usd,
          total_lbp: realizedCommission.total_lbp,
          count: realizedCommission.count,
          pending_commission_usd: 0,
          is_settled: 1,
        });
      }

      if (pendingCommission.count > 0) {
        // Build per-provider pending commission details for the label
        const pendingByProvider = this.repo.getPendingCommissionByProvider(
          fromDt,
          toDt,
        );

        const providerLabel = pendingByProvider
          .map((p) => `${p.provider} $${p.total_usd.toFixed(2)}`)
          .join(", ");

        results.push({
          method: `Commission Pending Settlement (${providerLabel || "OMT/WHISH"})`,
          total_usd: 0, // not yet in hand — shown as pending
          total_lbp: 0,
          count: pendingCommission.count,
          pending_commission_usd: pendingCommission.total_usd,
          is_settled: 0,
        });
      }

      return results.sort((a, b) => b.total_usd - a.total_usd);
    } catch (error) {
      logger.error({ error }, "ProfitService.getByPaymentMethod error");
      return [];
    }
  }

  /**
   * Profit breakdown by user/cashier.
   */
  getByUser(from: string, to: string): ProfitByUser[] {
    try {
      const fromDt = `${from} 00:00:00`;
      const toDt = `${to} 23:59:59`;

      return this.repo.getByUser(fromDt, toDt);
    } catch (error) {
      logger.error({ error }, "ProfitService.getByUser error");
      return [];
    }
  }

  /**
   * Top clients by profit generated.
   */
  getByClient(from: string, to: string, limit = 20): ProfitByClient[] {
    try {
      const fromDt = `${from} 00:00:00`;
      const toDt = `${to} 23:59:59`;

      return this.repo.getByClient(fromDt, toDt, limit);
    } catch (error) {
      logger.error({ error }, "ProfitService.getByClient error");
      return [];
    }
  }

  /**
   * Pending profit from sales with outstanding debt.
   * These are completed sales where the customer hasn't fully paid yet.
   * Profit is deferred until the sale is fully paid.
   */
  getPendingProfit(
    from: string,
    to: string,
  ): {
    rows: PendingProfitRow[];
    totals: {
      total_outstanding_usd: number;
      total_pending_profit_usd: number;
      count: number;
    };
    unsettled_commissions: UnsettledCommissionRow[];
    unsettled_totals: {
      total_pending_commission_usd: number;
      total_pending_commission_lbp: number;
      count: number;
    };
  } {
    try {
      const fromDt = `${from} 00:00:00`;
      const toDt = `${to} 23:59:59`;

      // Pending sales profit (debt not yet paid)
      const rows = this.repo.getPendingSaleProfit(fromDt, toDt);

      const totals = {
        total_outstanding_usd: rows.reduce(
          (sum, r) => sum + r.outstanding_usd,
          0,
        ),
        total_pending_profit_usd: rows.reduce(
          (sum, r) => sum + r.potential_profit_usd,
          0,
        ),
        count: rows.length,
      };

      // Unsettled financial service commissions (RECEIVE rows not yet settled with supplier)
      const unsettled_commissions = this.repo.getUnsettledCommissions(
        fromDt,
        toDt,
      );

      const unsettled_totals = {
        total_pending_commission_usd: unsettled_commissions
          .filter((r) => r.currency !== "LBP")
          .reduce((s, r) => s + r.commission, 0),
        total_pending_commission_lbp: unsettled_commissions
          .filter((r) => r.currency === "LBP")
          .reduce((s, r) => s + r.commission, 0),
        count: unsettled_commissions.length,
      };

      return { rows, totals, unsettled_commissions, unsettled_totals };
    } catch (error) {
      logger.error({ error }, "ProfitService.getPendingProfit error");
      return {
        rows: [],
        totals: {
          total_outstanding_usd: 0,
          total_pending_profit_usd: 0,
          count: 0,
        },
        unsettled_commissions: [],
        unsettled_totals: {
          total_pending_commission_usd: 0,
          total_pending_commission_lbp: 0,
          count: 0,
        },
      };
    }
  }
}

// =============================================================================
// Singleton
// =============================================================================

let profitServiceInstance: ProfitService | null = null;

export function getProfitService(): ProfitService {
  if (!profitServiceInstance) {
    profitServiceInstance = new ProfitService();
  }
  return profitServiceInstance;
}

export function resetProfitService(): void {
  profitServiceInstance = null;
}
