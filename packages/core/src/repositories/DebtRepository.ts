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
  isDrawerAffectingMethod,
  partitionLegs,
} from "../utils/payments.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";

/** A single payment leg for multi-payment repayments */
export interface RepaymentPaymentLine {
  method: string;
  currencyCode: string;
  amount: number;
  /** IN (customer pays, default) or OUT (shop returns change to customer). */
  direction?: "IN" | "OUT";
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
  edited_by: string | null;
  edited_at: string | null;
  /** Set on 'Session Debt' rows — the basket this charge belongs to
   *  (customer_session_transactions.session_id). Null for every other type. */
  session_id: number | null;
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
  transaction_time?: string;
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
    return "id, client_id, transaction_type, amount_usd, amount_lbp, transaction_id, note, created_at, created_by, edited_by, edited_at, session_id";
  }

  // ---------------------------------------------------------------------------
  // Debtor Queries
  // ---------------------------------------------------------------------------

  /**
   * Get the current exchange rate for USD→LBP conversions.
   * Computes effective sell rate using sell_rate column directly.
   * Falls back to 89500 if no rate found (logs warning instead of throwing).
   */
  private getExchangeRate(fromCode = "USD", toCode = "LBP"): number {
    const rateResult = this.db
      .prepare(
        `SELECT market_rate, buy_rate, sell_rate, is_stronger FROM exchange_rates WHERE to_code = ? LIMIT 1`,
      )
      .get(toCode) as
      | {
          market_rate: number;
          buy_rate: number;
          sell_rate: number;
          is_stronger: number;
        }
      | undefined;

    if (!rateResult) {
      console.warn(
        `No exchange rate found for ${fromCode}→${toCode}, falling back to 89500`,
      );
      return 89500;
    }

    // Use sell_rate (customer gives us this rate)
    return rateResult.sell_rate;
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
        INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, note, created_by, created_at)
        VALUES (?, 'Repayment', ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
      `);

      // Store as negative values to signify a reduction in debt
      const result = stmt.run(
        data.client_id,
        -data.amount_usd,
        -data.amount_lbp,
        data.note || null,
        data.created_by,
        data.transaction_time ?? null,
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

      // Split customer-paid (IN) legs from shop-returned change (OUT) legs.
      const { inLegs, outLegs: returnLegs } = partitionLegs(paymentLegs);

      // Compute NET total (IN − OUT) per currency for transaction summary &
      // FIFO attribution — overpaid change is not applied to the debt.
      const sumByCurrency = (
        legs: RepaymentPaymentLine[],
        ccy: string,
      ): number =>
        legs
          .filter((l) => l.currencyCode === ccy)
          .reduce((s, l) => s + Math.abs(l.amount), 0);
      const totalUSD =
        sumByCurrency(inLegs, "USD") - sumByCurrency(returnLegs, "USD");
      const totalLBP =
        sumByCurrency(inLegs, "LBP") - sumByCurrency(returnLegs, "LBP");

      // Derive primary method label for metadata (first leg, or SPLIT)
      const uniqueMethods = [...new Set(inLegs.map((l) => l.method))];
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
        transaction_time: data.transaction_time,
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

      // Determine if this repayment settles a Service Debt — if so, funds must
      // flow to the originating provider's system drawer, not just stay in
      // General. Routing is PER CURRENCY and capped at the client's remaining
      // OUTSTANDING service debt in that currency:
      //   - Original 'Service Debt' rows keep their positive amounts forever
      //     (repayments are separate negative rows), so the old "oldest
      //     Service Debt row with amount_usd > 0 EVER" lookup routed EVERY
      //     later repayment — even one settling an unrelated debt long after
      //     the service was repaid — into the provider drawer, for the FULL
      //     leg. Outstanding = SUM(Service Debt in ccy) − SUM(already routed
      //     to that provider's system drawer in ccy), over ACTIVE rows only.
      //   - Kept strictly per-currency (a USD service debt routes only USD
      //     legs, LBP only LBP): converting through the sell rate reopened
      //     already-settled debts whenever the rate moved and booked
      //     fractional LBP no till can hold.
      // Note: on a DB upgraded from the buggy version, prior over-routing can
      // push outstanding below zero; it clamps to 0 (no routing), which is the
      // safe direction — money simply stays in General.
      const serviceDebtsByProvider = this.db
        .prepare(
          `SELECT fs.provider,
                  COALESCE(SUM(dl.amount_usd), 0) AS debt_usd,
                  COALESCE(SUM(dl.amount_lbp), 0) AS debt_lbp,
                  MIN(dl.created_at) AS oldest_at
           FROM debt_ledger dl
           JOIN transactions t ON t.id = dl.transaction_id
             AND t.source_table = 'financial_services'
             AND t.status = 'ACTIVE'
           JOIN financial_services fs ON fs.id = t.source_id
           WHERE dl.client_id = ?
             AND dl.transaction_type = 'Service Debt'
             AND fs.provider IN ('OMT', 'WHISH')
           GROUP BY fs.provider
           ORDER BY oldest_at ASC`,
        )
        .all(data.client_id) as Array<{
        provider: "OMT" | "WHISH";
        debt_usd: number;
        debt_lbp: number;
      }>;

      const routedByDrawer = this.db
        .prepare(
          `SELECT p.drawer_name,
                  COALESCE(SUM(CASE WHEN p.currency_code = 'USD' THEN p.amount ELSE 0 END), 0) AS routed_usd,
                  COALESCE(SUM(CASE WHEN p.currency_code = 'LBP' THEN p.amount ELSE 0 END), 0) AS routed_lbp
           FROM payments p
           JOIN transactions t ON t.id = p.transaction_id
           WHERE t.client_id = ?
             AND t.type = ?
             AND t.status = 'ACTIVE'
             AND p.drawer_name IN ('OMT_System', 'Whish_System')
             AND p.amount > 0
           GROUP BY p.drawer_name`,
        )
        .all(data.client_id, TRANSACTION_TYPES.DEBT_REPAYMENT) as Array<{
        drawer_name: string;
        routed_usd: number;
        routed_lbp: number;
      }>;

      // Pick the provider (oldest service debt first) that still has an
      // outstanding amount to route in either currency.
      let providerSystemDrawer: string | null = null;
      let routingProvider: string | null = null;
      let outstandingUsd = 0;
      let outstandingLbp = 0;
      for (const sd of serviceDebtsByProvider) {
        const drawer = sd.provider === "OMT" ? "OMT_System" : "Whish_System";
        const routed = routedByDrawer.find((r) => r.drawer_name === drawer);
        const ou = sd.debt_usd - (routed?.routed_usd ?? 0);
        const ol = sd.debt_lbp - (routed?.routed_lbp ?? 0);
        if (ou > 0.01 || ol > 0.5) {
          providerSystemDrawer = drawer;
          routingProvider = sd.provider;
          outstandingUsd = Math.max(0, ou);
          outstandingLbp = Math.max(0, ol);
          break;
        }
      }

      // Cap total routing per currency at the NET amount the shop actually
      // kept (gross IN − change OUT): an overpayment handed back as change
      // must not route more than was retained. totalUSD/totalLBP are that net.
      let routeRemainingUsd = Math.min(outstandingUsd, Math.max(0, totalUSD));
      let routeRemainingLbp = Math.min(outstandingLbp, Math.max(0, totalLBP));

      // Process each customer-paid (IN) leg independently
      for (const leg of inLegs) {
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

        // For Service Debt: transfer from payment drawer → provider system
        // drawer, capped per currency at the remaining OUTSTANDING service
        // debt — a leg that also covers non-service debt only routes its
        // service share. Only drawer-affecting legs can fund a reserve (a
        // CUSTOMER_ACCOUNT/GIFT_CARD leg moves no cash, so nothing to route).
        // For non-cash legs (WHISH, OMT wallet), the RESERVE comes out of the
        // wallet drawer; for CASH legs it comes out of General.
        if (providerSystemDrawer && isDrawerAffectingMethod(leg.method)) {
          const remaining =
            legCurrency === "USD" ? routeRemainingUsd : routeRemainingLbp;
          const threshold = legCurrency === "USD" ? 0.01 : 0.5;
          if (remaining > threshold) {
            const routeAmount = Math.min(leg.amount, remaining);
            if (legCurrency === "USD") routeRemainingUsd -= routeAmount;
            else routeRemainingLbp -= routeAmount;

            insertPayment.run(
              txnId,
              "RESERVE",
              legDrawer,
              legCurrency,
              -routeAmount,
              `Reserve for ${routingProvider} settlement`,
              data.created_by,
            );
            upsertBalance.run(legDrawer, legCurrency, -routeAmount);

            insertPayment.run(
              txnId,
              routingProvider,
              providerSystemDrawer,
              legCurrency,
              routeAmount,
              `Debt repayment → ${providerSystemDrawer}`,
              data.created_by,
            );
            upsertBalance.run(providerSystemDrawer, legCurrency, routeAmount);
          }
        }
      }

      // Return (OUT) legs: overpaid change handed back via a chosen method, or
      // kept as store credit. Debits the method's drawer, or deposits credit.
      for (const r of returnLegs) {
        const amt = Math.abs(r.amount);
        if (amt <= 0) continue;
        if (r.method === "CUSTOMER_ACCOUNT") {
          this.addCredit({
            clientId: data.client_id,
            amountUsd: r.currencyCode === "USD" ? amt : 0,
            amountLbp: r.currencyCode === "LBP" ? amt : 0,
            note: "Change returned",
            createdBy: String(data.created_by),
            ...(data.transaction_time
              ? { transactionTime: data.transaction_time }
              : {}),
          });
        } else if (isDrawerAffectingMethod(r.method)) {
          const drawer = paymentMethodToDrawerName(r.method);
          insertPayment.run(
            txnId,
            r.method,
            drawer,
            r.currencyCode,
            -amt,
            "Change returned",
            data.created_by,
          );
          upsertBalance.run(drawer, r.currencyCode, -amt);
        }
      }

      // 4. Mark originating sales as paid (FIFO — oldest unpaid sale first)
      //    so that profit is recognized once fully paid.
      //    Use net totalUSD (IN − OUT) for accurate attribution; when no USD
      //    was physically tendered (LBP-only tender against USD debt) fall
      //    back to amount_usd — the caller-converted USD reduction.
      //    KNOWN GAP: mixed tender (USD + LBP legs against USD debt) uses
      //    only the USD-leg total, under-attributing the LBP-converted share;
      //    amount_usd can't be used outright because with change legs it
      //    overstates the net kept (see lira-096). Sale debts are
      //    USD-denominated (SalesRepository), so pure-LBP debts never feed
      //    this path.
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
  // Credit Operations
  // ---------------------------------------------------------------------------

  /**
   * Add a credit entry (shop owes customer). Stored as NEGATIVE amounts.
   */
  addCredit(data: {
    clientId: number;
    amountUsd: number;
    amountLbp: number;
    note: string;
    createdBy: string;
    transactionTime?: string;
    /** Set when the credit belongs to a customer-session basket (e.g. a
     *  cash-out settled to the customer's account). Drives the Debts-page
     *  eye button that opens the basket breakdown; null for every other
     *  credit. */
    sessionId?: number;
  }): { id: number } {
    const stmt = this.db.prepare(`
      INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, note, created_by, session_id, created_at)
      VALUES (?, 'CREDIT_DEPOSIT', ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
    `);
    const result = stmt.run(
      data.clientId,
      -Math.abs(data.amountUsd),
      -Math.abs(data.amountLbp),
      data.note || null,
      data.createdBy,
      data.sessionId ?? null,
      data.transactionTime ?? null,
    );
    return { id: Number(result.lastInsertRowid) };
  }

  /**
   * Use credit (consume credit balance). Stored as POSITIVE amounts.
   */
  useCredit(data: {
    clientId: number;
    amountUsd: number;
    amountLbp: number;
    note: string;
    createdBy: string;
    transactionTime?: string;
  }): { id: number } {
    const stmt = this.db.prepare(`
      INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, note, created_by, created_at)
      VALUES (?, 'CREDIT_USED', ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
    `);
    const result = stmt.run(
      data.clientId,
      Math.abs(data.amountUsd),
      Math.abs(data.amountLbp),
      data.note || null,
      data.createdBy,
      data.transactionTime ?? null,
    );
    return { id: Number(result.lastInsertRowid) };
  }

  /**
   * Cash out a client's credit: the shop PAYS the customer their credit.
   * Books a POSITIVE CREDIT_USED ledger row (brings the negative balance
   * toward zero), a CREDIT_CASH_OUT unified transaction, and DEBITS each
   * payout leg's drawer in its own currency — the mirror image of a
   * repayment. amount_usd/amount_lbp are the credit reduction (LBP legs
   * pre-converted by the caller); payments[] are the physical payout legs.
   */
  cashOutCredit(data: {
    client_id: number;
    amount_usd: number;
    amount_lbp: number;
    payments?: RepaymentPaymentLine[];
    note?: string | null;
    created_by: number;
    transaction_time?: string;
  }): { id: number } {
    return this.transaction(() => {
      const stmt = this.db.prepare(`
        INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, note, created_by, created_at)
        VALUES (?, 'CREDIT_USED', ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
      `);
      const result = stmt.run(
        data.client_id,
        Math.abs(data.amount_usd),
        Math.abs(data.amount_lbp),
        data.note || "Credit cash out",
        data.created_by,
        data.transaction_time ?? null,
      );
      const ledgerId = Number(result.lastInsertRowid);

      // Payout legs: default to CASH legs matching the reduction PER
      // CURRENCY. A USD-only default silently skipped the drawer debit on an
      // LBP cash-out with no explicit legs (credit reduced, till untouched).
      const legs: RepaymentPaymentLine[] =
        data.payments && data.payments.length > 0
          ? data.payments
          : [
              ...(Math.abs(data.amount_usd) > 0
                ? [
                    {
                      method: "CASH",
                      currencyCode: "USD",
                      amount: Math.abs(data.amount_usd),
                    },
                  ]
                : []),
              ...(Math.abs(data.amount_lbp) > 0
                ? [
                    {
                      method: "CASH",
                      currencyCode: "LBP",
                      amount: Math.abs(data.amount_lbp),
                    },
                  ]
                : []),
            ];

      const txnId = getTransactionRepository().createTransaction({
        type: TRANSACTION_TYPES.CREDIT_CASH_OUT,
        source_table: "debt_ledger",
        source_id: ledgerId,
        user_id: data.created_by,
        amount_usd: Math.abs(data.amount_usd),
        amount_lbp: Math.abs(data.amount_lbp),
        client_id: data.client_id,
        summary: `Credit Cash Out: $${Math.abs(data.amount_usd)} + ${Math.abs(
          data.amount_lbp,
        )} LBP`,
        metadata_json: {
          legs: legs.length > 1 ? legs : undefined,
          paid_by: legs.length === 1 ? legs[0].method : "SPLIT",
        },
        transaction_time: data.transaction_time,
      });

      this.db
        .prepare(`UPDATE debt_ledger SET transaction_id = ? WHERE id = ?`)
        .run(txnId, ledgerId);

      const insertPayment = this.db.prepare(`
        INSERT INTO payments (
          transaction_id, method, drawer_name, currency_code, amount, note, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const upsertBalance = this.db.prepare(`
        INSERT INTO drawer_balances (drawer_name, currency_code, balance)
        VALUES (?, ?, ?)
        ON CONFLICT(drawer_name, currency_code) DO UPDATE SET
          balance = drawer_balances.balance + excluded.balance,
          updated_at = CURRENT_TIMESTAMP
      `);

      for (const leg of legs) {
        const amt = Math.abs(leg.amount);
        if (amt <= 0 || !isDrawerAffectingMethod(leg.method)) continue;
        const drawer = paymentMethodToDrawerName(leg.method);
        insertPayment.run(
          txnId,
          leg.method,
          drawer,
          leg.currencyCode,
          -amt,
          data.note || "Credit cash out",
          data.created_by,
        );
        upsertBalance.run(drawer, leg.currencyCode, -amt);
      }

      return { id: ledgerId };
    });
  }

  /**
   * Get net balance for a client.
   * Positive = client owes shop (debt). Negative = shop owes client (credit).
   */
  getClientBalance(clientId: number): {
    balance_usd: number;
    balance_lbp: number;
  } {
    const stmt = this.db.prepare(`
      SELECT
        ROUND(COALESCE(SUM(amount_usd), 0), 2) as balance_usd,
        ROUND(COALESCE(SUM(amount_lbp), 0), 2) as balance_lbp
      FROM debt_ledger
      WHERE client_id = ?
    `);
    const result = stmt.get(clientId) as
      | { balance_usd: number; balance_lbp: number }
      | undefined;
    return {
      balance_usd: result?.balance_usd ?? 0,
      balance_lbp: result?.balance_lbp ?? 0,
    };
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
    // Normalize any ISO caller date ('2024-01-05T00:00:00.000Z') to the
    // CURRENT_TIMESTAMP format ('YYYY-MM-DD HH:MM:SS') — ISO strings sort
    // above every space-format row of the same day (A6). For an already
    // SQLite-format string the SUBSTR+REPLACE is a no-op.
    const stmt = this.db.prepare(`
      INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, note, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, COALESCE(REPLACE(SUBSTR(?, 1, 19), 'T', ' '), CURRENT_TIMESTAMP))
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

  /**
   * How many identical imported rows already exist — same client, type,
   * amounts, note, and (normalized) date. Used to make the Excel debt import
   * idempotent with MULTISET semantics: a file can legitimately contain N
   * identical entries (e.g. two Alfa cards at 600,000 LBP on the same day),
   * so re-imports must skip exactly as many occurrences as already exist and
   * import any surplus — a boolean exists-check would under-import.
   */
  countIdenticalRawEntries(data: {
    client_id: number;
    transaction_type: string;
    amount_usd: number;
    amount_lbp: number;
    note: string | null;
    created_at?: string;
  }): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as n FROM debt_ledger
          WHERE client_id = ?
            AND transaction_type = ?
            AND amount_usd = ?
            AND amount_lbp = ?
            AND COALESCE(note, '') = COALESCE(?, '')
            AND (? IS NULL OR created_at = REPLACE(SUBSTR(?, 1, 19), 'T', ' '))`,
      )
      .get(
        data.client_id,
        data.transaction_type,
        data.amount_usd,
        data.amount_lbp,
        data.note,
        data.created_at ?? null,
        data.created_at ?? null,
      ) as { n: number };
    return row.n;
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

  /**
   * Update non-financial metadata on a debt ledger entry.
   * Only metadata fields are allowed — financial data is immutable.
   */
  updateMetadata(
    id: number,
    data: { note?: string },
    editedBy: string,
  ): DebtLedgerEntity | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const fields: string[] = [];
    const values: unknown[] = [];

    if (data.note !== undefined) {
      fields.push("note = ?");
      values.push(data.note);
    }

    if (fields.length === 0) return existing;

    fields.push("edited_by = ?", "edited_at = CURRENT_TIMESTAMP");
    values.push(editedBy);
    values.push(id);

    this.db
      .prepare(`UPDATE debt_ledger SET ${fields.join(", ")} WHERE id = ?`)
      .run(...values);

    return this.findById(id);
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
