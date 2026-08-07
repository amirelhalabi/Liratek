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
import { getCurrentTenantId } from "../db/tenantContext.js";
import { buildCounterpartyMetadata } from "../validators/counterparty.js";
import { allocateFifo } from "../utils/fifoCoverage.js";
import { getUsdLbpSellRate } from "../utils/exchangeRate.js";
import {
  applyDrawerDelta,
  insertPaymentRow,
  buildCounterpartyDiscountPosting,
  resolveStampedExchangeRate,
} from "./moneyPosting.js";

/** CQ-10 — a discount/write-off amount bundled with a settlement, or posted
 *  standalone. amount_usd/amount_lbp are the FORGIVEN amounts (always
 *  treated as positive magnitudes regardless of sign supplied). */
export interface CounterpartyDiscountData {
  amount_usd: number;
  amount_lbp: number;
  reason?: string;
}

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
  /** T3 keep-change: kept (not returned) change per currency. Stamped as
   *  profit on the DEBT_REPAYMENT transaction (the generic void negates the
   *  stamp); the caller already excluded these from amount_usd/amount_lbp. */
  kept_change_usd?: number;
  kept_change_lbp?: number;
  transaction_time?: string;
  /** CQ-10 — bundled discount: "owed X, paid Y, discount Z". Posts its OWN
   *  'Debt Discount' ledger row + COUNTERPARTY_DISCOUNT transaction (see
   *  DebtRepository._postDebtDiscount) with the SAME FIFO coverage steps a
   *  repayment gets, applied to its own (separate) budget. */
  discount?: CounterpartyDiscountData;
  /**
   * The USD→LBP rate MultiPaymentInput actually converted the operator's
   * TENDER at (the payment sheet's editable rate field — same
   * `repayModalRate` state the Debts page feeds into both the repayment and
   * cash-out modals). Owner decision (2026-08-08, repro: buy 89,000 vs. sell
   * 90,000): used to stamp `transactions.exchange_rate` via
   * `resolveStampedExchangeRate` (moneyPosting.ts) — preferred when within
   * `TENDER_RATE_BAND_PCT` (±10%) of the server sell rate
   * (`getUsdLbpSellRate`), else falls back to the server rate SILENTLY
   * (never throws — this repository has no `reconcileLegs` hard-reject for
   * repayments/cash-outs to weaken). Omitted → unchanged legacy behavior,
   * stamps the server sell rate exactly as before.
   */
  tender_exchange_rate?: number;
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
        `SELECT market_rate, buy_rate, sell_rate, is_stronger FROM exchange_rates WHERE to_code = ? AND tenant_id = ? LIMIT 1`,
      )
      .get(toCode, getCurrentTenantId()) as
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
   * CQ-8: cheap client-name lookup for the `counterparty` metadata contract
   * (every counterparty money transaction stamps a human-readable name).
   * Falls back to a placeholder rather than throwing — a missing/deleted
   * client must never block a repayment/cash-entry write.
   */
  private _getClientName(clientId: number): string {
    const row = this.db
      .prepare(`SELECT full_name FROM clients WHERE id = ? AND tenant_id = ?`)
      .get(clientId, getCurrentTenantId()) as { full_name: string } | undefined;
    return row?.full_name ?? `Client #${clientId}`;
  }

  /**
   * Get all clients with their debt totals (grouped)
   */
  findAllDebtors(): DebtorSummary[] {
    // Use exchange rate to convert LBP portion into USD for consistent totals
    const rate = this.getExchangeRate("USD", "LBP");
    const tenantId = getCurrentTenantId();

    const stmt = this.db.prepare(`
      SELECT
        c.id,
        c.full_name,
        c.phone_number,
        ROUND(COALESCE(SUM(dl.amount_usd), 0) + (COALESCE(SUM(dl.amount_lbp), 0) / ?), 2) as total_debt,
        ROUND(COALESCE(SUM(dl.amount_usd), 0), 2) as total_debt_usd,
        ROUND(COALESCE(SUM(dl.amount_lbp), 0), 2) as total_debt_lbp
      FROM debt_ledger dl
      JOIN clients c ON dl.client_id = c.id AND c.tenant_id = dl.tenant_id
      WHERE dl.tenant_id = ?
      GROUP BY c.id
      ORDER BY total_debt DESC
    `);
    return stmt.all(rate, tenantId) as DebtorSummary[];
  }

  /**
   * Get debt history for a specific client
   * Default: most recent first (DESC)
   */
  findClientHistory(clientId: number): DebtLedgerEntity[] {
    const stmt = this.db.prepare(`
      SELECT ${this.getColumns()} FROM debt_ledger
      WHERE client_id = ? AND tenant_id = ?
      ORDER BY created_at DESC
    `);
    return stmt.all(clientId, getCurrentTenantId()) as DebtLedgerEntity[];
  }

  /**
   * Get total debt for a specific client
   */
  getClientDebtTotal(clientId: number): number {
    const rate = this.getExchangeRate("USD", "LBP");

    const stmt = this.db.prepare(
      `SELECT ROUND(COALESCE(SUM(amount_usd), 0) + (COALESCE(SUM(amount_lbp), 0) / ?), 2) as total
       FROM debt_ledger
       WHERE client_id = ? AND tenant_id = ?`,
    );
    const result = stmt.get(rate, clientId, getCurrentTenantId()) as {
      total: number | null;
    };
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
    const tenantId = getCurrentTenantId();
    return this.transaction(() => {
      // 1. Insert debt ledger entry
      const stmt = this.db.prepare(`
        INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, note, created_by, tenant_id, created_at)
        VALUES (?, 'Repayment', ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
      `);

      // Store as negative values to signify a reduction in debt
      const result = stmt.run(
        data.client_id,
        -data.amount_usd,
        -data.amount_lbp,
        data.note || null,
        data.created_by,
        tenantId,
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

      // Owner decision (2026-08-08, repro: buy 89,000 vs. sell 90,000): the
      // `transactions.exchange_rate` stamp should reflect what the operator
      // actually tendered, when that's a plausible edit — within
      // `TENDER_RATE_BAND_PCT` of the server sell rate. Outside that band (or
      // absent), falls back to the server rate SILENTLY (never throws — see
      // `CreateRepaymentData.tender_exchange_rate`'s doc). This repository has
      // no `reconcileLegs` anchor to preserve for repayments — nothing else
      // depends on this rate here.
      const recordExchangeRate = resolveStampedExchangeRate(
        getUsdLbpSellRate(this.db),
        data.tender_exchange_rate,
      );

      // Create unified transaction row
      const clientName = this._getClientName(data.client_id);
      const txnId = getTransactionRepository().createTransaction({
        type: TRANSACTION_TYPES.DEBT_REPAYMENT,
        source_table: "debt_ledger",
        source_id: repaymentId,
        user_id: data.created_by,
        amount_usd: data.amount_usd,
        amount_lbp: data.amount_lbp,
        // T3 keep-change: the kept extra is the ONLY profit a repayment books
        // ("Other / kept change" profits line). Stamped at create time so the
        // generic void's stamp negation reverses it symmetrically.
        profit_usd: data.kept_change_usd || 0,
        profit_lbp: data.kept_change_lbp || 0,
        client_id: data.client_id,
        // note 14 — thin-summary enrichment: client's name appended after
        // the existing "Debt Repayment: $X + Y LBP" prefix.
        summary: `Debt Repayment: $${data.amount_usd} + ${data.amount_lbp} LBP — ${clientName}`,
        exchange_rate: recordExchangeRate,
        metadata_json: {
          paid_by: primaryMethod,
          legs: paymentLegs.length > 1 ? paymentLegs : undefined,
          // CQ-8 counterparty contract: a repayment is the customer handing
          // cash INTO the shop. CQ-10: a bundled discount is annotated onto
          // this SAME transaction's metadata (informational — the money-and-
          // profit effect lives on the separate COUNTERPARTY_DISCOUNT row
          // posted below).
          counterparty: buildCounterpartyMetadata({
            kind: "client",
            id: data.client_id,
            name: clientName,
            flow: "IN",
            method: primaryMethod,
            ledgerEntryId: repaymentId,
            discount: data.discount
              ? {
                  amount_usd: Math.abs(data.discount.amount_usd || 0),
                  amount_lbp: Math.abs(data.discount.amount_lbp || 0),
                  reason: data.discount.reason,
                }
              : undefined,
          }),
        },
        transaction_time: data.transaction_time,
      });

      // Link debt_ledger row to unified transaction
      this.db
        .prepare(
          `UPDATE debt_ledger SET transaction_id = ? WHERE id = ? AND tenant_id = ?`,
        )
        .run(txnId, repaymentId, tenantId);

      // 2. Record payment entries for drawer tracking / 3. Update drawer
      // balances — via the shared moneyPosting helpers (CQ-3).
      const insertPayment = {
        run: (
          transactionId: number,
          method: string,
          drawerName: string,
          currencyCode: string,
          amount: number,
          note: string | null,
          createdBy: number,
          tenant: number,
        ) =>
          insertPaymentRow(this.db, {
            transactionId,
            method,
            drawerName,
            currencyCode,
            amount,
            note,
            createdBy,
            tenantId: tenant,
          }),
      };
      const upsertBalance = {
        run: (
          drawerName: string,
          currencyCode: string,
          delta: number,
          tenant: number,
        ) =>
          applyDrawerDelta(this.db, {
            drawerName,
            currencyCode,
            delta,
            tenantId: tenant,
          }),
      };

      // Determine if this repayment settles a Service Debt — if so, funds must
      // flow to the originating provider's cash drawer, not just stay in
      // General. Primary Cash Drawer plan §0 decision #8 / §1
      // (docs/plans/todo_plans/PRIMARY_CASH_DRAWER_PLAN.md): under the new
      // model `OMT_System`/`Whish_System` IS the shop's physical primary
      // cash drawer (PCD) at the money-transfer counter, not a spendable
      // float inside the provider's own books — so a client repaying an
      // OMT/WHISH service debt later moves that share of cash physically
      // into the PCD. The mechanism below (verified 2026-07-30, kept as-is —
      // see plan §3 Phase C) already targets that same drawer name; only
      // this comment and the note strings the RESERVE pair stamps change to
      // describe a cash move into the counter drawer, not a "settlement
      // reserve" (there is no settlement/float to reserve against anymore).
      // Routing is PER CURRENCY and capped at the client's remaining
      // OUTSTANDING service debt in that currency:
      //   - Original 'Service Debt' rows keep their positive amounts forever
      //     (repayments are separate negative rows), so the old "oldest
      //     Service Debt row with amount_usd > 0 EVER" lookup routed EVERY
      //     later repayment — even one settling an unrelated debt long after
      //     the service was repaid — into the provider drawer, for the FULL
      //     leg. Outstanding = SUM(Service Debt in ccy) − SUM(already routed
      //     to that provider's system drawer in ccy), over ACTIVE rows only.
      //     'Refund Reversal' rows are summed in too: a REFUND leaves the
      //     original FINANCIAL_SERVICE txn ACTIVE and books a negative
      //     reversal against the same transaction_id, so without it a
      //     refunded service debt would keep routing repayments forever.
      //     (The financial_services JOIN keeps sale/recharge reversals out.)
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
             AND t.tenant_id = dl.tenant_id
           JOIN financial_services fs ON fs.id = t.source_id
             AND fs.tenant_id = dl.tenant_id
           WHERE dl.client_id = ?
             AND dl.transaction_type IN ('Service Debt', 'Refund Reversal')
             AND fs.provider IN ('OMT', 'WHISH')
             AND dl.tenant_id = ?
           GROUP BY fs.provider
           ORDER BY oldest_at ASC`,
        )
        .all(data.client_id, tenantId) as Array<{
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
           JOIN transactions t ON t.id = p.transaction_id AND t.tenant_id = p.tenant_id
           WHERE t.client_id = ?
             AND t.type = ?
             AND t.status = 'ACTIVE'
             AND p.drawer_name IN ('OMT_System', 'Whish_System')
             AND p.amount > 0
             AND p.tenant_id = ?
           GROUP BY p.drawer_name`,
        )
        .all(
          data.client_id,
          TRANSACTION_TYPES.DEBT_REPAYMENT,
          tenantId,
        ) as Array<{
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
          tenantId,
        );
        upsertBalance.run(legDrawer, legCurrency, leg.amount, tenantId);

        // For Service Debt: move cash from the payment drawer → the
        // provider's primary cash drawer (PCD), capped per currency at the
        // remaining OUTSTANDING service debt — a leg that also covers
        // non-service debt only routes its service share. Only
        // drawer-affecting legs can fund this move (a CUSTOMER_ACCOUNT/
        // GIFT_CARD leg moves no cash, so nothing to route). For non-cash
        // legs (WHISH, OMT wallet), the move comes out of the wallet drawer;
        // for CASH legs it comes out of General.
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
              `Move to ${providerSystemDrawer} cash drawer (${routingProvider} service debt)`,
              data.created_by,
              tenantId,
            );
            upsertBalance.run(legDrawer, legCurrency, -routeAmount, tenantId);

            insertPayment.run(
              txnId,
              // Non-null: providerSystemDrawer and routingProvider are always
              // set together (see the loop above that assigns both).
              routingProvider!,
              providerSystemDrawer,
              legCurrency,
              routeAmount,
              `Debt repayment: cash into ${providerSystemDrawer}`,
              data.created_by,
              tenantId,
            );
            upsertBalance.run(
              providerSystemDrawer,
              legCurrency,
              routeAmount,
              tenantId,
            );
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
            transactionId: txnId,
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
            tenantId,
          );
          upsertBalance.run(drawer, r.currencyCode, -amt, tenantId);
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
      const usdRemainder = this._markSalesPaidFIFO(
        data.client_id,
        totalUSD || data.amount_usd,
      );

      // DBT-1 (owner decision 2026-07-14): client-account SERVICE profit is
      // real only once the client repays. Whatever the repayment did NOT
      // consume on sales (plus the full LBP side — sale debts are
      // USD-denominated) FIFO-covers the client's module-debt charge rows;
      // ProfitRepository's notDebtPending gate reads the coverage. One
      // repayment budget, applied once: sales first (existing behavior,
      // unchanged), services with the remainder.
      this._coverServiceDebtsFIFO(
        data.client_id,
        usdRemainder,
        totalLBP || data.amount_lbp,
      );

      // CQ-10 — bundled discount: posted AFTER the repayment's own coverage
      // so the discount's FIFO budget only touches whatever the cash portion
      // left open (same open rows, a second/remaining pass — never the same
      // dollars applied twice).
      if (
        data.discount &&
        (data.discount.amount_usd > 0 || data.discount.amount_lbp > 0)
      ) {
        this._postDebtDiscount(
          data.client_id,
          data.discount,
          data.created_by,
          data.transaction_time,
        );
      }

      return { id: repaymentId };
    });
  }

  /**
   * CQ-10 — post ONE COUNTERPARTY_DISCOUNT transaction (+ its owning
   * 'Debt Discount' debt_ledger row) for a client whose debt is partly or
   * fully forgiven. Used by BOTH entry paths: bundled (called from inside
   * addRepayment's transaction) and standalone (writeOffDebt, its own
   * transaction). Mirrors addRepayment's own post-ledger coverage steps
   * (_markSalesPaidFIFO then _coverServiceDebtsFIFO) so a discount opens the
   * SAME profit-recognition gates a cash repayment would.
   *
   * amount_usd/amount_lbp = 0 (no cash moved — keeps cash-flow reports
   * clean); profit_usd/profit_lbp = NEGATIVE the forgiven amount (D1: the
   * shop forgives a receivable, a real cost).
   */
  private _postDebtDiscount(
    clientId: number,
    discount: CounterpartyDiscountData,
    createdBy: number,
    transactionTime?: string,
  ): number {
    const tenantId = getCurrentTenantId();
    const amountUsd = Math.abs(discount.amount_usd || 0);
    const amountLbp = Math.abs(discount.amount_lbp || 0);

    const stmt = this.db.prepare(`
      INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, note, created_by, tenant_id, created_at)
      VALUES (?, 'Debt Discount', ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
    `);
    const result = stmt.run(
      clientId,
      -amountUsd,
      -amountLbp,
      discount.reason || null,
      createdBy,
      tenantId,
      transactionTime ?? null,
    );
    const ledgerId = Number(result.lastInsertRowid);

    const clientName = this._getClientName(clientId);
    // CQ-5: the signed profit + counterparty metadata shape (D1 — forgiving
    // a receivable is booked "as if paid", flow IN) is now the ONE shared
    // helper every counterparty discount posts through (see moneyPosting.ts).
    const posting = buildCounterpartyDiscountPosting({
      kind: "client",
      ledgerEntryId: ledgerId,
      counterpartyId: clientId,
      counterpartyName: clientName,
      amountUsd,
      amountLbp,
      discountDirection: "forgiven",
      reason: discount.reason,
    });
    const txnId = getTransactionRepository().createTransaction({
      type: TRANSACTION_TYPES.COUNTERPARTY_DISCOUNT,
      source_table: "debt_ledger",
      source_id: ledgerId,
      user_id: createdBy,
      amount_usd: 0,
      amount_lbp: 0,
      profit_usd: posting.profit_usd,
      profit_lbp: posting.profit_lbp,
      client_id: clientId,
      summary: `Discount: $${amountUsd.toFixed(2)}${amountLbp ? ` + ${amountLbp.toLocaleString()} LBP` : ""} forgiven — ${clientName}`,
      metadata_json: posting.metadata_json,
      transaction_time: transactionTime,
    });

    this.db
      .prepare(
        `UPDATE debt_ledger SET transaction_id = ? WHERE id = ? AND tenant_id = ?`,
      )
      .run(txnId, ledgerId, tenantId);

    // Same coverage shape as a repayment (DBT-1): sales absorb first via
    // _markSalesPaidFIFO, the remainder covers module-debt charge rows via
    // _coverServiceDebtsFIFO — otherwise a forgiven balance would leave
    // deferred profit stuck behind an uncovered charge row forever.
    const usdRemainder = this._markSalesPaidFIFO(clientId, amountUsd);
    this._coverServiceDebtsFIFO(clientId, usdRemainder, amountLbp);

    return txnId;
  }

  /**
   * CQ-10 (D4: admin-only, enforced by the caller) — standalone write-off: no
   * settlement attached, just forgive part of what a client owes. Validation
   * (positive amount, does not exceed the outstanding balance per currency)
   * lives in DebtService.writeOffDebt — this method only posts the row.
   */
  writeOffDebt(data: {
    client_id: number;
    amount_usd: number;
    amount_lbp: number;
    reason?: string;
    created_by: number;
    transaction_time?: string;
  }): { id: number } {
    return this.transaction(() => {
      const txnId = this._postDebtDiscount(
        data.client_id,
        {
          amount_usd: data.amount_usd,
          amount_lbp: data.amount_lbp,
          reason: data.reason,
        },
        data.created_by,
        data.transaction_time,
      );
      return { id: txnId };
    });
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * When a client repays debt, attribute the USD amount to their oldest unpaid
   * sales (FIFO) by incrementing `sales.paid_usd`. This ensures profit is
   * recognized once a sale is fully paid.
   *
   * Returns the UNCONSUMED remainder so `_coverServiceDebtsFIFO` can apply it
   * to service charge rows (DBT-1) — the same dollars are never applied twice.
   */
  private _markSalesPaidFIFO(clientId: number, repaymentUsd: number): number {
    if (repaymentUsd <= 0) return 0;
    const tenantId = getCurrentTenantId();

    // Find the client's unpaid sales, oldest first
    const unpaidSales = this.db
      .prepare(
        `SELECT s.id, s.final_amount_usd, s.paid_usd,
                COALESCE(s.paid_lbp, 0) AS paid_lbp,
                COALESCE(NULLIF(s.exchange_rate_snapshot, 0), 1) AS rate
         FROM sales s
         JOIN transactions t ON t.source_table = 'sales' AND t.source_id = s.id
           AND t.tenant_id = s.tenant_id
         WHERE t.client_id = ? AND s.status = 'completed'
           AND (s.paid_usd + COALESCE(s.paid_lbp, 0) / COALESCE(NULLIF(s.exchange_rate_snapshot, 0), 1)) < s.final_amount_usd - 0.05
           AND s.tenant_id = ?
         ORDER BY s.created_at ASC`,
      )
      .all(clientId, tenantId) as {
      id: number;
      final_amount_usd: number;
      paid_usd: number;
      paid_lbp: number;
      rate: number;
    }[];

    const updateStmt = this.db.prepare(
      `UPDATE sales SET paid_usd = paid_usd + ? WHERE id = ? AND tenant_id = ?`,
    );

    // CQ-2 — shared FIFO allocator; epsilon 0.01 matches this site's original
    // loop tolerance exactly (the SQL filter above uses a separate, larger
    // 0.05 threshold to decide which sales are still "open" at all).
    const takes = allocateFifo(
      unpaidSales.map((sale) => ({
        id: sale.id,
        outstanding:
          sale.final_amount_usd - (sale.paid_usd + sale.paid_lbp / sale.rate),
      })),
      repaymentUsd,
      0.01,
    );
    let consumed = 0;
    for (const t of takes) {
      updateStmt.run(t.take, t.id, tenantId);
      consumed += t.take;
    }
    return Math.max(0, repaymentUsd - consumed);
  }

  /**
   * DBT-1 — repayment coverage for MODULE-debt charge rows (Recharge/Service/
   * Custom Service/Loto/Maintenance Debt; 'Sale Debt' is excluded — sales
   * recognize via `sales.paid_usd` above). FIFO per client, per currency
   * column, oldest first, bumping covered_usd/covered_lbp (v129).
   * ProfitRepository's notDebtPending fragment treats the source transaction
   * as realized only when its charge row is fully covered in BOTH currencies.
   * Refunded charge rows are skipped (their source is excluded from profit
   * anyway, and covering them would waste repayment budget).
   */
  private _coverServiceDebtsFIFO(
    clientId: number,
    repaymentUsd: number,
    repaymentLbp: number,
  ): void {
    let remainingUsd = Math.max(0, repaymentUsd);
    let remainingLbp = Math.max(0, repaymentLbp);
    if (remainingUsd <= 0.005 && remainingLbp <= 1) return;
    const tenantId = getCurrentTenantId();

    const open = this.db
      .prepare(
        `SELECT id, COALESCE(amount_usd, 0) AS amount_usd,
                COALESCE(amount_lbp, 0) AS amount_lbp,
                covered_usd, covered_lbp
         FROM debt_ledger
         WHERE client_id = ? AND tenant_id = ?
           AND transaction_type IN ('Recharge Debt', 'Service Debt', 'Custom Service Debt', 'Loto Debt', 'Maintenance Debt')
           AND COALESCE(is_refunded, 0) = 0
           AND (covered_usd < COALESCE(amount_usd, 0) - 0.005
                OR covered_lbp < COALESCE(amount_lbp, 0) - 1)
         ORDER BY created_at ASC, id ASC`,
      )
      .all(clientId, tenantId) as Array<{
      id: number;
      amount_usd: number;
      amount_lbp: number;
      covered_usd: number;
      covered_lbp: number;
    }>;

    const upd = this.db.prepare(
      `UPDATE debt_ledger SET covered_usd = ?, covered_lbp = ? WHERE id = ? AND tenant_id = ?`,
    );

    // CQ-2 — dual-currency site: the shared single-currency allocator is
    // called TWICE (once per currency, over the same open rows, in the same
    // order) and the two independent results are merged into ONE UPDATE per
    // row — matching this site's original single UPDATE statement shape.
    // Each currency's allocation is fully independent math (the original
    // loop only ever coupled the two via a shared row list + a shared
    // "either currency due" write-gate, never via a shared budget), so
    // running two independent passes yields the same per-row take values.
    const usdTakes = allocateFifo(
      open.map((row) => ({
        id: row.id,
        outstanding: row.amount_usd - row.covered_usd,
      })),
      remainingUsd,
      0.005,
    );
    const lbpTakes = allocateFifo(
      open.map((row) => ({
        id: row.id,
        outstanding: row.amount_lbp - row.covered_lbp,
      })),
      remainingLbp,
      1,
    );
    const usdById = new Map(usdTakes.map((t) => [t.id, t.take]));
    const lbpById = new Map(lbpTakes.map((t) => [t.id, t.take]));

    for (const row of open) {
      const takeUsd = usdById.get(row.id) ?? 0;
      const takeLbp = lbpById.get(row.id) ?? 0;
      if (takeUsd > 0 || takeLbp > 0) {
        upd.run(
          row.covered_usd + takeUsd,
          row.covered_lbp + takeLbp,
          row.id,
          tenantId,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Credit Operations
  // ---------------------------------------------------------------------------

  /**
   * Add a credit entry (shop owes customer). Stored as NEGATIVE amounts.
   *
   * Rule 20: when this credit is a side effect of an enclosing unified
   * transaction (change returned as store credit, a RECEIVE cashed out to
   * CUSTOMER_ACCOUNT, a Binance/app-wallet payout kept on account, etc.),
   * callers MUST pass `transactionId` — the same convention
   * `bookClientDebtCharge` (moneyPosting.ts) uses for module-charge rows.
   * Without it, `TransactionRepository._cancelDebt` has no way to find and
   * reverse this row on void/refund, and the customer keeps the credit for
   * free (owner-reported real-money leak). Standalone/manual credits (the
   * Debts-page "add credit" action, voucher redemption with no originating
   * transaction) correctly omit it — they have no transaction to link to and
   * are never touched by the generic reversal.
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
    /** The unified transaction this credit is a side effect of (see method
     *  doc). Omit for standalone/manual credits with no originating
     *  transaction. */
    transactionId?: number;
  }): { id: number } {
    const stmt = this.db.prepare(`
      INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, transaction_id, note, created_by, session_id, tenant_id, created_at)
      VALUES (?, 'CREDIT_DEPOSIT', ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
    `);
    const result = stmt.run(
      data.clientId,
      -Math.abs(data.amountUsd),
      -Math.abs(data.amountLbp),
      data.transactionId ?? null,
      data.note || null,
      data.createdBy,
      data.sessionId ?? null,
      getCurrentTenantId(),
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
      INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, note, created_by, tenant_id, created_at)
      VALUES (?, 'CREDIT_USED', ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
    `);
    const result = stmt.run(
      data.clientId,
      Math.abs(data.amountUsd),
      Math.abs(data.amountLbp),
      data.note || null,
      data.createdBy,
      getCurrentTenantId(),
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
    /** See `CreateRepaymentData.tender_exchange_rate`'s doc — same
     *  payment-sheet rate concept, same `resolveStampedExchangeRate` stamp
     *  rule, applied here for CREDIT_CASH_OUT. */
    tender_exchange_rate?: number;
  }): { id: number } {
    const tenantId = getCurrentTenantId();
    return this.transaction(() => {
      const stmt = this.db.prepare(`
        INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, note, created_by, tenant_id, created_at)
        VALUES (?, 'CREDIT_USED', ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
      `);
      const result = stmt.run(
        data.client_id,
        Math.abs(data.amount_usd),
        Math.abs(data.amount_lbp),
        data.note || "Credit cash out",
        data.created_by,
        tenantId,
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

      // See addRepayment's identical comment — same owner decision, same
      // non-throwing stamp rule, no reconcileLegs anchor to preserve here.
      const recordExchangeRate = resolveStampedExchangeRate(
        getUsdLbpSellRate(this.db),
        data.tender_exchange_rate,
      );

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
        exchange_rate: recordExchangeRate,
        metadata_json: {
          legs: legs.length > 1 ? legs : undefined,
          paid_by: legs.length === 1 ? legs[0].method : "SPLIT",
          // CQ-8 counterparty contract: the shop pays the customer their
          // held credit OUT of the drawer.
          counterparty: buildCounterpartyMetadata({
            kind: "client",
            id: data.client_id,
            name: this._getClientName(data.client_id),
            flow: "OUT",
            method: legs.length === 1 ? legs[0].method : "SPLIT",
            ledgerEntryId: ledgerId,
          }),
        },
        transaction_time: data.transaction_time,
      });

      this.db
        .prepare(
          `UPDATE debt_ledger SET transaction_id = ? WHERE id = ? AND tenant_id = ?`,
        )
        .run(txnId, ledgerId, tenantId);

      const insertPayment = {
        run: (
          transactionId: number,
          method: string,
          drawerName: string,
          currencyCode: string,
          amount: number,
          note: string | null,
          createdBy: number,
          tenant: number,
        ) =>
          insertPaymentRow(this.db, {
            transactionId,
            method,
            drawerName,
            currencyCode,
            amount,
            note,
            createdBy,
            tenantId: tenant,
          }),
      };
      const upsertBalance = {
        run: (
          drawerName: string,
          currencyCode: string,
          delta: number,
          tenant: number,
        ) =>
          applyDrawerDelta(this.db, {
            drawerName,
            currencyCode,
            delta,
            tenantId: tenant,
          }),
      };

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
          tenantId,
        );
        upsertBalance.run(drawer, leg.currencyCode, -amt, tenantId);
      }

      return { id: ledgerId };
    });
  }

  /**
   * Manual account cash entry from the Accounts (Debts) page — the till-moving
   * counterpart of the old, till-less addCredit.
   *
   *  - direction "credit": the customer HANDS the shop cash → drawer(s) IN, a
   *    NEGATIVE 'CREDIT_DEPOSIT' debt_ledger row (shop owes customer), and a
   *    CREDIT_CASH_IN unified transaction.
   *  - direction "debt": the shop GIVES the customer cash (a cash advance) →
   *    drawer(s) OUT, a POSITIVE 'Manual Debt' debt_ledger row (customer owes
   *    shop), and a DEBT_CASH_OUT unified transaction.
   *
   * The unified transaction amount is always positive/abs for both directions —
   * direction lives in the IN/OUT badge, never the amount sign (matches
   * DEBT_REPAYMENT / CREDIT_CASH_OUT). No profit is stamped (pure liability
   * movement). This is NOT a repayment, so _markSalesPaidFIFO is deliberately
   * NOT called.
   *
   * LIRA-080 — `move_cash` (default true, preserving the above byte-for-byte
   * when the caller omits it): false posts a PAPER entry — the SAME
   * debt_ledger row (CREDIT_DEPOSIT/Manual Debt, same sign), but the wrapping
   * transaction is ACCOUNT_ADJUSTMENT with NO payments row / drawer delta
   * (mirrors PartnerRepository.recordAdjustmentTransaction's PARTNER_ADJUSTMENT
   * — same "visible, no-cash" contract, same signed-amount convention for
   * report-readability since there's no IN/OUT badge to carry direction).
   * `data.payments` is ignored on the paper path — a toggle-off entry never
   * moves cash regardless of what legs the caller supplies.
   *
   * Do NOT fold this into addCredit: that method is a pure ledger write reused
   * by internal change-returned-as-credit callers whose parent transaction
   * already booked the cash — moving the drawer there would double-count.
   */
  addAccountCashEntry(data: {
    direction: "credit" | "debt";
    client_id: number;
    amount_usd: number;
    amount_lbp: number;
    payments?: RepaymentPaymentLine[];
    note?: string | null;
    created_by: number;
    transaction_time?: string;
    move_cash?: boolean;
  }): { id: number } {
    const tenantId = getCurrentTenantId();
    const isCredit = data.direction === "credit";
    const moveCash = data.move_cash !== false;
    const ledgerSign = isCredit ? -1 : 1;
    const drawerSign = isCredit ? 1 : -1;
    const ledgerType = isCredit ? "CREDIT_DEPOSIT" : "Manual Debt";
    const defaultNote = isCredit ? "Account credit" : "Cash advance (debt)";
    return this.transaction(() => {
      const stmt = this.db.prepare(`
        INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, note, created_by, tenant_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
      `);
      const result = stmt.run(
        data.client_id,
        ledgerType,
        ledgerSign * Math.abs(data.amount_usd),
        ledgerSign * Math.abs(data.amount_lbp),
        data.note || defaultNote,
        data.created_by,
        tenantId,
        data.transaction_time ?? null,
      );
      const ledgerId = Number(result.lastInsertRowid);

      // Default to CASH legs matching the entry PER CURRENCY when none given.
      // A USD-only default would silently skip the LBP drawer movement.
      // Never consulted on the paper (move_cash: false) path.
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
        type: moveCash
          ? isCredit
            ? TRANSACTION_TYPES.CREDIT_CASH_IN
            : TRANSACTION_TYPES.DEBT_CASH_OUT
          : TRANSACTION_TYPES.ACCOUNT_ADJUSTMENT,
        source_table: "debt_ledger",
        source_id: ledgerId,
        user_id: data.created_by,
        // Cash-moved: always positive/abs, direction lives in the type.
        // Paper: SIGNED (ledgerSign) so the report stays readable even though
        // there's no IN/OUT badge to carry direction (matches
        // PARTNER_ADJUSTMENT's convention).
        amount_usd: moveCash
          ? Math.abs(data.amount_usd)
          : ledgerSign * Math.abs(data.amount_usd),
        amount_lbp: moveCash
          ? Math.abs(data.amount_lbp)
          : ledgerSign * Math.abs(data.amount_lbp),
        client_id: data.client_id,
        summary: moveCash
          ? isCredit
            ? `Account Credit: $${Math.abs(data.amount_usd)} + ${Math.abs(
                data.amount_lbp,
              )} LBP`
            : `Cash Advance (Debt): $${Math.abs(
                data.amount_usd,
              )} + ${Math.abs(data.amount_lbp)} LBP`
          : isCredit
            ? `Account Credit (paper, no cash moved): $${Math.abs(
                data.amount_usd,
              )} + ${Math.abs(data.amount_lbp)} LBP`
            : `Cash Advance (Debt, paper, no cash moved): $${Math.abs(
                data.amount_usd,
              )} + ${Math.abs(data.amount_lbp)} LBP`,
        metadata_json: {
          legs: moveCash && legs.length > 1 ? legs : undefined,
          paid_by: moveCash
            ? legs.length === 1
              ? legs[0].method
              : "SPLIT"
            : undefined,
          // CQ-8 counterparty contract: "credit" = customer hands the shop
          // cash (IN); "debt" = shop hands the customer a cash advance (OUT).
          // Paper entries keep the same flow direction (no cash moved either
          // way) — method: 'LEDGER' is the documented journal-only marker
          // (no payments leg), same as PARTNER_ADJUSTMENT.
          counterparty: buildCounterpartyMetadata({
            kind: "client",
            id: data.client_id,
            name: this._getClientName(data.client_id),
            flow: isCredit ? "IN" : "OUT",
            method: moveCash
              ? legs.length === 1
                ? legs[0].method
                : "SPLIT"
              : "LEDGER",
            ledgerEntryId: ledgerId,
          }),
        },
        transaction_time: data.transaction_time,
      });

      this.db
        .prepare(
          `UPDATE debt_ledger SET transaction_id = ? WHERE id = ? AND tenant_id = ?`,
        )
        .run(txnId, ledgerId, tenantId);

      // Paper path: no payments row, no drawer delta — stop here.
      if (!moveCash) {
        return { id: ledgerId };
      }

      const insertPayment = {
        run: (
          transactionId: number,
          method: string,
          drawerName: string,
          currencyCode: string,
          amount: number,
          note: string | null,
          createdBy: number,
          tenant: number,
        ) =>
          insertPaymentRow(this.db, {
            transactionId,
            method,
            drawerName,
            currencyCode,
            amount,
            note,
            createdBy,
            tenantId: tenant,
          }),
      };
      const upsertBalance = {
        run: (
          drawerName: string,
          currencyCode: string,
          delta: number,
          tenant: number,
        ) =>
          applyDrawerDelta(this.db, {
            drawerName,
            currencyCode,
            delta,
            tenantId: tenant,
          }),
      };

      for (const leg of legs) {
        const amt = Math.abs(leg.amount);
        if (amt <= 0 || !isDrawerAffectingMethod(leg.method)) continue;
        const drawer = paymentMethodToDrawerName(leg.method);
        insertPayment.run(
          txnId,
          leg.method,
          drawer,
          leg.currencyCode,
          drawerSign * amt,
          data.note || defaultNote,
          data.created_by,
          tenantId,
        );
        upsertBalance.run(drawer, leg.currencyCode, drawerSign * amt, tenantId);
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
      WHERE client_id = ? AND tenant_id = ?
    `);
    const result = stmt.get(clientId, getCurrentTenantId()) as
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
      INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, note, created_by, tenant_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(REPLACE(SUBSTR(?, 1, 19), 'T', ' '), CURRENT_TIMESTAMP))
    `);
    const result = stmt.run(
      data.client_id,
      data.transaction_type,
      data.amount_usd,
      data.amount_lbp,
      data.note,
      data.created_by,
      getCurrentTenantId(),
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
            AND (? IS NULL OR created_at = REPLACE(SUBSTR(?, 1, 19), 'T', ' '))
            AND tenant_id = ?`,
      )
      .get(
        data.client_id,
        data.transaction_type,
        data.amount_usd,
        data.amount_lbp,
        data.note,
        data.created_at ?? null,
        data.created_at ?? null,
        getCurrentTenantId(),
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
    const tenantId = getCurrentTenantId();

    const totalDebtResult = this.db
      .prepare(
        `
      SELECT
        ROUND(COALESCE(SUM(amount_usd), 0) + (COALESCE(SUM(amount_lbp), 0) / ?), 2) as totalDebt,
        ROUND(COALESCE(SUM(amount_usd), 0), 2) as totalDebtUsd,
        ROUND(COALESCE(SUM(amount_lbp), 0), 2) as totalDebtLbp
      FROM debt_ledger
      WHERE tenant_id = ?
    `,
      )
      .get(rate, tenantId) as {
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
      JOIN clients c ON dl.client_id = c.id AND c.tenant_id = dl.tenant_id
      WHERE dl.tenant_id = ?
      GROUP BY dl.client_id
      HAVING total_debt > 0.01
      ORDER BY total_debt DESC
      LIMIT ?
    `,
      )
      .all(rate, tenantId, topN) as TopDebtor[];

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
    values.push(getCurrentTenantId());

    this.db
      .prepare(
        `UPDATE debt_ledger SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`,
      )
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
