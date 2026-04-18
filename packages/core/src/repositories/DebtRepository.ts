/**
 * Debt Repository
 *
 * Handles all debt_ledger table operations.
 * Uses BaseRepository for common functionality.
 */

import { BaseRepository } from "./BaseRepository.js";
import { DatabaseError } from "../utils/errors.js";
import {
  paymentMethodToDrawerName,
  isNonCashDrawerMethod,
} from "../utils/payments.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";

/** A single payment leg for multi-payment repayments */
export interface RepaymentPaymentLine {
  method: string;
  currencyCode: string;
  amount: number;
}

// Maps transaction_type stored in debt_ledger to the system drawer that should
// receive the repayment funds (the drawer that tracks the provider debt)
const SERVICE_DEBT_SYSTEM_DRAWER: Record<string, string> = {
  "Service Debt": "", // resolved dynamically from originating financial_service
  "Recharge Debt": "General", // recharge cost was paid from General
  "Sale Debt": "", // no system drawer — sale profit recognised on full payment
  Repayment: "", // repayment rows themselves
};

// =============================================================================
// Entity Types
// =============================================================================

export interface DebtLedgerEntity {
  id: number;
  client_id: number;
  transaction_id: number | null;
  transaction_type: string;
  amount_usd: number;
  amount_lbp: number;
  note: string | null;
  created_at: string;
  created_by: number | null;
}

export interface DebtorSummary {
  id: number;
  full_name: string;
  phone_number: string;
  total_debt: number;
  total_debt_usd: number;
  total_debt_lbp: number;
}

export interface TopDebtor {
  full_name: string;
  total_debt: number;
  total_debt_usd: number;
  total_debt_lbp: number;
}

export interface DebtSummary {
  totalDebt: number;
  totalDebtUsd: number;
  totalDebtLbp: number;
  topDebtors: TopDebtor[];
}

export interface CreateRepaymentData {
  client_id: number;
  amount_usd: number;
  amount_lbp: number;
  note?: string | null;
  created_by: number;
  paid_by_method?: string;
  /** Optional multi-payment legs. When provided, overrides paid_by_method for
   *  drawer routing. Each leg is processed independently with per-leg RESERVE
   *  routing for Service Debt (e.g. WHISH leg → Whish_App → Whish_System). */
  payments?: RepaymentPaymentLine[];
}

// =============================================================================
// Debt Repository Class
// =============================================================================

export class DebtRepository extends BaseRepository<DebtLedgerEntity> {
  constructor() {
    super("debt_ledger", { softDelete: false });
  }

  // Override getColumns() to use explicit columns instead of SELECT *
  protected getColumns(): string {
    return "id, client_id, transaction_type, amount_usd, amount_lbp, transaction_id, note, created_at, created_by";
  }

  // ---------------------------------------------------------------------------
  // Debtor Queries
  // ---------------------------------------------------------------------------

  /**
   * Get the current exchange rate for USD→LBP conversions.
   * Computes effective sell rate using: market_rate + is_stronger * delta
   * Falls back to 89500 if no rate found (logs warning instead of throwing).
   */
  private getExchangeRate(fromCode = "USD", toCode = "LBP"): number {
    const rateResult = this.db
      .prepare(
        `SELECT market_rate, delta, is_stronger FROM exchange_rates WHERE to_code = ? LIMIT 1`,
      )
      .get(toCode) as
      | { market_rate: number; delta: number; is_stronger: number }
      | undefined;

    if (!rateResult) {
      console.warn(
        `No exchange rate found for ${fromCode}→${toCode}, falling back to 89500`,
      );
      return 89500;
    }

    // Compute effective sell rate: market_rate + is_stronger * delta (GIVE_USD = +1)
    const effectiveRate =
      rateResult.market_rate + rateResult.is_stronger * rateResult.delta;
    return effectiveRate;
  }

  /**
   * Get all clients with their debt totals (grouped)
   */
  findAllDebtors(): DebtorSummary[] {
    // Use exchange rate to convert LBP portion into USD for consistent totals
    const rate = this.getExchangeRate("USD", "LBP");

    const stmt = this.db.prepare(`
      SELECT 
        c.id, 
        c.full_name, 
        c.phone_number,
        ROUND(COALESCE(SUM(dl.amount_usd), 0) + (COALESCE(SUM(dl.amount_lbp), 0) / ?), 2) as total_debt,
        ROUND(COALESCE(SUM(dl.amount_usd), 0), 2) as total_debt_usd,
        ROUND(COALESCE(SUM(dl.amount_lbp), 0), 2) as total_debt_lbp
      FROM debt_ledger dl
      JOIN clients c ON dl.client_id = c.id
      GROUP BY c.id
      ORDER BY total_debt DESC
    `);
    return stmt.all(rate) as DebtorSummary[];
  }

  /**
   * Get debt history for a specific client
   * Default: most recent first (DESC)
   */
  findClientHistory(clientId: number): DebtLedgerEntity[] {
    const stmt = this.db.prepare(`
      SELECT ${this.getColumns()} FROM debt_ledger 
      WHERE client_id = ? 
      ORDER BY created_at DESC
    `);
    return stmt.all(clientId) as DebtLedgerEntity[];
  }

  /**
   * Get total debt for a specific client
   */
  getClientDebtTotal(clientId: number): number {
    const rate = this.getExchangeRate("USD", "LBP");

    const stmt = this.db.prepare(
      `SELECT ROUND(COALESCE(SUM(amount_usd), 0) + (COALESCE(SUM(amount_lbp), 0) / ?), 2) as total 
       FROM debt_ledger 
       WHERE client_id = ?`,
    );
    const result = stmt.get(rate, clientId) as { total: number | null };
    return result?.total || 0;
  }

  // ---------------------------------------------------------------------------
  // Repayment Operations
  // ---------------------------------------------------------------------------

  /**
   * Add a repayment entry (stored as negative values to reduce debt)
   * Wrapped in transaction to ensure atomicity with payments and drawer updates
   */
  addRepayment(data: CreateRepaymentData): { id: number } {
    return this.transaction(() => {
      // 1. Insert debt ledger entry
      const stmt = this.db.prepare(`
        INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, note, created_by)
        VALUES (?, 'Repayment', ?, ?, ?, ?)
      `);

      // Store as negative values to signify a reduction in debt
      const result = stmt.run(
        data.client_id,
        -data.amount_usd,
        -data.amount_lbp,
        data.note || null,
        data.created_by,
      );

      const repaymentId = Number(result.lastInsertRowid);

      // Build payment legs: if multi-payment provided, use them; otherwise fall
      // back to the legacy single-method path using amount_usd / amount_lbp.
      const paymentLegs: RepaymentPaymentLine[] =
        data.payments && data.payments.length > 0
          ? data.payments
          : [
              ...(data.amount_usd > 0
                ? [
                    {
                      method: data.paid_by_method || "CASH",
                      currencyCode: "USD",
                      amount: data.amount_usd,
                    },
                  ]
                : []),
              ...(data.amount_lbp > 0
                ? [
                    {
                      method: data.paid_by_method || "CASH",
                      currencyCode: "LBP",
                      amount: data.amount_lbp,
                    },
                  ]
                : []),
            ];

      // Compute total USD equivalent for transaction summary & FIFO attribution
      const totalUSD = paymentLegs
        .filter((l) => l.currencyCode === "USD")
        .reduce((s, l) => s + l.amount, 0);
      const totalLBP = paymentLegs
        .filter((l) => l.currencyCode === "LBP")
        .reduce((s, l) => s + l.amount, 0);

      // Derive primary method label for metadata (first leg, or SPLIT)
      const uniqueMethods = [...new Set(paymentLegs.map((l) => l.method))];
      const primaryMethod =
        uniqueMethods.length === 1 ? uniqueMethods[0] : "SPLIT";

      // Create unified transaction row
      const txnId = getTransactionRepository().createTransaction({
        type: TRANSACTION_TYPES.DEBT_REPAYMENT,
        source_table: "debt_ledger",
        source_id: repaymentId,
        user_id: data.created_by,
        amount_usd: data.amount_usd,
        amount_lbp: data.amount_lbp,
        client_id: data.client_id,
        summary: `Debt Repayment: $${data.amount_usd} + ${data.amount_lbp} LBP`,
        metadata_json: {
          paid_by: primaryMethod,
          legs: paymentLegs.length > 1 ? paymentLegs : undefined,
        },
      });

      // Link debt_ledger row to unified transaction
      this.db
        .prepare(`UPDATE debt_ledger SET transaction_id = ? WHERE id = ?`)
        .run(txnId, repaymentId);

      // 2. Record payment entries for drawer tracking
      const insertPayment = this.db.prepare(`
        INSERT INTO payments (
          transaction_id, method, drawer_name, currency_code, amount, note, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      // 3. Update drawer balances
      const upsertBalance = this.db.prepare(`
        INSERT INTO drawer_balances (drawer_name, currency_code, balance)
        VALUES (?, ?, ?)
        ON CONFLICT(drawer_name, currency_code) DO UPDATE SET
          balance = drawer_balances.balance + excluded.balance,
          updated_at = CURRENT_TIMESTAMP
      `);

      // Determine if this repayment is for a Service Debt — if so, funds must
      // flow to the originating provider's system drawer, not just stay in General.
      // Look up the oldest unrepaid Service Debt entry for this client to find the provider.
      const originatingDebt = this.db
        .prepare(
          `SELECT dl.transaction_type, dl.transaction_id,
                  fs.provider
           FROM debt_ledger dl
           LEFT JOIN transactions t ON t.id = dl.transaction_id
           LEFT JOIN financial_services fs ON fs.id = t.source_id
             AND t.source_table = 'financial_services'
           WHERE dl.client_id = ?
             AND dl.amount_usd > 0
             AND dl.transaction_type = 'Service Debt'
           ORDER BY dl.created_at ASC
           LIMIT 1`,
        )
        .get(data.client_id) as
        | {
            transaction_type: string;
            transaction_id: number | null;
            provider: string | null;
          }
        | undefined;

      // System drawer to credit when settling a Service Debt
      const providerSystemDrawer =
        originatingDebt?.provider === "OMT"
          ? "OMT_System"
          : originatingDebt?.provider === "WHISH"
            ? "Whish_System"
            : null;

      // Process each payment leg independently
      for (const leg of paymentLegs) {
        if (leg.amount <= 0) continue;

        const legDrawer = paymentMethodToDrawerName(leg.method);
        const legCurrency = leg.currencyCode;
        const legNote = data.note || "Debt repayment";

        // Credit inbound payment to the leg's drawer
        insertPayment.run(
          txnId,
          leg.method,
          legDrawer,
          legCurrency,
          leg.amount,
          legNote,
          data.created_by,
        );
        upsertBalance.run(legDrawer, legCurrency, leg.amount);

        // For Service Debt: transfer from payment drawer → provider system drawer.
        // For non-cash legs (WHISH, OMT wallet), the RESERVE comes out of the
        // wallet drawer; for CASH legs it comes out of General — same as original.
        if (providerSystemDrawer) {
          insertPayment.run(
            txnId,
            "RESERVE",
            legDrawer,
            legCurrency,
            -leg.amount,
            `Reserve for ${originatingDebt?.provider} settlement`,
            data.created_by,
          );
          upsertBalance.run(legDrawer, legCurrency, -leg.amount);

          insertPayment.run(
            txnId,
            originatingDebt!.provider!,
            providerSystemDrawer,
            legCurrency,
            leg.amount,
            `Debt repayment → ${providerSystemDrawer}`,
            data.created_by,
          );
          upsertBalance.run(providerSystemDrawer, legCurrency, leg.amount);
        }
      }

      // 4. Mark originating sales as paid (FIFO — oldest unpaid sale first)
      //    so that profit is recognized once fully paid.
      //    Use totalUSD from legs (USD legs only) for accurate attribution.
      this._markSalesPaidFIFO(data.client_id, totalUSD || data.amount_usd);

      return { id: repaymentId };
    });
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * When a client repays debt, attribute the USD amount to their oldest unpaid
   * sales (FIFO) by incrementing `sales.paid_usd`. This ensures profit is
   * recognized once a sale is fully paid.
   */
  private _markSalesPaidFIFO(clientId: number, repaymentUsd: number): void {
    if (repaymentUsd <= 0) return;

    // Find the client's unpaid sales, oldest first
    const unpaidSales = this.db
      .prepare(
        `SELECT s.id, s.final_amount_usd, s.paid_usd,
                COALESCE(s.paid_lbp, 0) AS paid_lbp,
                COALESCE(NULLIF(s.exchange_rate_snapshot, 0), 1) AS rate
         FROM sales s
         JOIN transactions t ON t.source_table = 'sales' AND t.source_id = s.id
         WHERE t.client_id = ? AND s.status = 'completed'
           AND (s.paid_usd + COALESCE(s.paid_lbp, 0) / COALESCE(NULLIF(s.exchange_rate_snapshot, 0), 1)) < s.final_amount_usd - 0.05
         ORDER BY s.created_at ASC`,
      )
      .all(clientId) as {
      id: number;
      final_amount_usd: number;
      paid_usd: number;
      paid_lbp: number;
      rate: number;
    }[];

    let remaining = repaymentUsd;
    const updateStmt = this.db.prepare(
      `UPDATE sales SET paid_usd = paid_usd + ? WHERE id = ?`,
    );

    for (const sale of unpaidSales) {
      if (remaining <= 0.01) break;
      const paidInUsd = sale.paid_usd + sale.paid_lbp / sale.rate;
      const outstanding = sale.final_amount_usd - paidInUsd;
      const apply = Math.min(remaining, outstanding);
      if (apply > 0.01) {
        updateStmt.run(apply, sale.id);
        remaining -= apply;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Bulk Import
  // ---------------------------------------------------------------------------

  /**
   * Insert a raw debt_ledger entry (for Excel import).
   * No drawer logic, no transaction row — just the ledger entry.
   */
  insertRawEntry(data: {
    client_id: number;
    transaction_type: string;
    amount_usd: number;
    amount_lbp: number;
    note: string | null;
    created_by: number;
    created_at?: string;
  }): number {
    const stmt = this.db.prepare(`
      INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, note, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
    `);
    const result = stmt.run(
      data.client_id,
      data.transaction_type,
      data.amount_usd,
      data.amount_lbp,
      data.note,
      data.created_by,
      data.created_at ?? null,
    );
    return Number(result.lastInsertRowid);
  }

  // ---------------------------------------------------------------------------
  // Dashboard Queries
  // ---------------------------------------------------------------------------

  /**
   * Get debt summary for dashboard (total debt + top debtors)
   */
  getDebtSummary(topN: number = 5): DebtSummary {
    // Total debt receivable
    const rate = this.getExchangeRate("USD", "LBP");

    const totalDebtResult = this.db
      .prepare(
        `
      SELECT 
        ROUND(COALESCE(SUM(amount_usd), 0) + (COALESCE(SUM(amount_lbp), 0) / ?), 2) as totalDebt,
        ROUND(COALESCE(SUM(amount_usd), 0), 2) as totalDebtUsd,
        ROUND(COALESCE(SUM(amount_lbp), 0), 2) as totalDebtLbp
      FROM debt_ledger
    `,
      )
      .get(rate) as {
      totalDebt: number | null;
      totalDebtUsd: number | null;
      totalDebtLbp: number | null;
    };

    // Top N debtors (only those with positive debt)
    const topDebtors = this.db
      .prepare(
        `
      SELECT 
        c.full_name,
        ROUND(COALESCE(SUM(dl.amount_usd), 0) + (COALESCE(SUM(dl.amount_lbp), 0) / ?), 2) as total_debt,
        ROUND(COALESCE(SUM(dl.amount_usd), 0), 2) as total_debt_usd,
        ROUND(COALESCE(SUM(dl.amount_lbp), 0), 2) as total_debt_lbp
      FROM debt_ledger dl
      JOIN clients c ON dl.client_id = c.id
      GROUP BY dl.client_id
      HAVING total_debt > 0.01
      ORDER BY total_debt DESC
      LIMIT ?
    `,
      )
      .all(rate, topN) as TopDebtor[];

    return {
      totalDebt: totalDebtResult?.totalDebt || 0,
      totalDebtUsd: totalDebtResult?.totalDebtUsd || 0,
      totalDebtLbp: totalDebtResult?.totalDebtLbp || 0,
      topDebtors,
    };
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let debtRepositoryInstance: DebtRepository | null = null;

export function getDebtRepository(): DebtRepository {
  if (!debtRepositoryInstance) {
    debtRepositoryInstance = new DebtRepository();
  }
  return debtRepositoryInstance;
}

/** Reset the singleton (for testing) */
export function resetDebtRepository(): void {
  debtRepositoryInstance = null;
}
