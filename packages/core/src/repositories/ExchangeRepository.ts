/**
 * Exchange Repository
 *
 * Handles all exchange_transactions table operations.
 * Supports per-leg rate and profit tracking (v30+).
 */

import { BaseRepository } from "./BaseRepository.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import {
  applyDrawerDelta,
  insertPaymentRow,
  assertPartnerIdRequired,
  reconcileLegs,
  expectedTotalIn,
} from "./moneyPosting.js";
import { getPartnerRepository } from "./PartnerRepository.js";
import {
  partitionLegs,
  isDrawerAffectingMethod,
  paymentMethodToDrawerName,
} from "../utils/payments.js";
import { getUsdLbpSellRate } from "../utils/exchangeRate.js";

// =============================================================================
// Entity Types
// =============================================================================

export interface ExchangeTransactionEntity {
  id: number;
  type: string;
  from_currency: string;
  to_currency: string;
  amount_in: number;
  amount_out: number;
  rate: number;
  base_rate: number | null;
  profit_usd: number | null;
  // Leg tracking (v30+)
  leg1_rate: number | null;
  leg1_market_rate: number | null;
  leg1_profit_usd: number | null;
  leg2_rate: number | null;
  leg2_market_rate: number | null;
  leg2_profit_usd: number | null;
  via_currency: string | null;
  client_name: string | null;
  note: string | null;
  created_at: string;
  created_by: number | null;
  edited_by: string | null;
  edited_at: string | null;
}

export interface CreateExchangeData {
  fromCurrency: string;
  toCurrency: string;
  amountIn: number;
  amountOut: number;
  // Leg 1 (always present)
  leg1Rate: number;
  leg1MarketRate: number;
  leg1ProfitUsd: number;
  // Leg 2 (cross-currency only)
  leg2Rate?: number;
  leg2MarketRate?: number;
  leg2ProfitUsd?: number;
  viaCurrency?: string; // 'USD' for cross-currency, undefined for direct
  // Totals
  totalProfitUsd: number;
  clientName?: string;
  note?: string;
  fromCurrencyName?: string;
  toCurrencyName?: string;
  transaction_time?: string;
  /**
   * LIRA-081 (PFT-R, "partner stands in for the customer" — the model every
   * other FOR_% flow uses): a "for partner" exchange takes NO counter cash
   * from a walk-in customer. The partner owes exactly what a customer would
   * have paid — `amountIn` of `fromCurrency` — settled later on the Partners
   * page. The shop still disburses `amountOut` of `toCurrency` for real (the
   * value genuinely leaves the till); only the customer-paid IN leg is
   * replaced by the partner debt. This is what makes the stamped
   * `totalProfitUsd` real once the partner settles: the shop's net cash
   * position after create+settle is byte-identical to a normal walk-in
   * exchange of the same amounts (proven by
   * ExchangeRepository.forPartner.test.ts).
   */
  partnerId?: number;
  /** Only "FOR" is valid for exchanges — the partner analog of a walk-in customer. */
  partnerMode?: "FOR";
  /**
   * Split payout (owner-requested 2026-07-30): how the shop pays the
   * customer's `amountOut`, across several legs (e.g. $100 + 11,050,000 LBP
   * for one 20,000,000 LBP payout). Reconciled hard-reject against
   * `amountOut` in `toCurrency` (S2); each leg debits its OWN drawer in its
   * OWN currency (§4 / lira-074). Omitted → the single-lump fallback.
   * USD/LBP target only; IN legs only; drawer methods only; never combined
   * with `partnerMode: "FOR"`.
   */
  payments?: Array<{
    method: string;
    currencyCode: string;
    amount: number;
    direction?: "IN" | "OUT";
  }>;
  /**
   * The USD→LBP rate the payment sheet ACTUALLY converted the payout legs at
   * (the exchange's own effective rate, or the operator's edit of the sheet's
   * header field) — reconciliation compares at THIS rate so a legitimate
   * spread doesn't false-reject (lira-095).
   */
  tender_exchange_rate?: number;
}

// =============================================================================
// Exchange Repository Class
// =============================================================================

export class ExchangeRepository extends BaseRepository<ExchangeTransactionEntity> {
  constructor() {
    super("exchange_transactions", { softDelete: false });
  }

  protected getColumns(): string {
    return [
      "id",
      "type",
      "from_currency",
      "to_currency",
      "amount_in",
      "amount_out",
      "rate",
      "base_rate",
      "profit_usd",
      "leg1_rate",
      "leg1_market_rate",
      "leg1_profit_usd",
      "leg2_rate",
      "leg2_market_rate",
      "leg2_profit_usd",
      "via_currency",
      "client_name",
      "note",
      "created_at",
      "created_by",
      "edited_by",
      "edited_at",
    ].join(", ");
  }

  // ---------------------------------------------------------------------------
  // Transaction Operations
  // ---------------------------------------------------------------------------

  /**
   * Create a new exchange transaction with full leg tracking.
   */
  createTransaction(data: CreateExchangeData): { id: number } {
    const drawerName = "General";
    const createdBy = 1;
    const note = data.note ?? null;

    // Derive type for display: SELL if customer receives USD, BUY otherwise
    const BASE_CURRENCY = "USD";
    const type = data.toCurrency === BASE_CURRENCY ? "SELL" : "BUY";

    // For backward compat: store leg1 rate as the top-level rate field
    const rate = data.leg1Rate;
    const baseRate = data.leg1MarketRate;
    const profitUsd = data.totalProfitUsd;

    return this.db.transaction(() => {
      const tenantId = getCurrentTenantId();

      // LIRA-081 (PFT-R): a "for partner" exchange takes no counter cash —
      // the partner stands in for the walk-in customer. Guarded before any
      // row is written (throwing here rolls back the whole db.transaction).
      const isForPartner = data.partnerMode === "FOR";
      if (isForPartner) {
        assertPartnerIdRequired(data.partnerId);
        // Partner debt lives in partner_ledger (USD/LBP/USDT buckets only —
        // getBalance/getBalanceBreakdown sum exactly those three). fromCurrency
        // becomes the ledger currency below, so it must be one of the two the
        // shop actually carries partner debt in (mirrors FinancialServiceRepository's
        // "Partner debt must be USD or LBP" rule for FOR_OMT_SEND/FOR_BINANCE_SEND).
        if (data.fromCurrency !== "USD" && data.fromCurrency !== "LBP") {
          throw new Error(
            "Partner debt must be USD or LBP — pick a USD/LBP source currency",
          );
        }
      }

      // Auto-register currencies that don't exist (e.g. API currencies like GBP, AED)
      const ensureCurrency = this.db.prepare(
        `INSERT OR IGNORE INTO currencies (code, name, symbol, decimal_places, is_active, tenant_id)
         VALUES (?, ?, ?, 2, 1, ?)`,
      );
      const ensureDrawer = this.db.prepare(
        `INSERT OR IGNORE INTO currency_drawers (currency_code, drawer_name, tenant_id)
         VALUES (?, 'General', ?)`,
      );

      ensureCurrency.run(
        data.fromCurrency,
        data.fromCurrencyName ?? data.fromCurrency,
        data.fromCurrency,
        tenantId,
      );
      ensureDrawer.run(data.fromCurrency, tenantId);
      ensureCurrency.run(
        data.toCurrency,
        data.toCurrencyName ?? data.toCurrency,
        data.toCurrency,
        tenantId,
      );
      ensureDrawer.run(data.toCurrency, tenantId);

      const result = this.db
        .prepare(
          `INSERT INTO exchange_transactions (
            type, from_currency, to_currency,
            amount_in, amount_out, rate, base_rate, profit_usd,
            leg1_rate, leg1_market_rate, leg1_profit_usd,
            leg2_rate, leg2_market_rate, leg2_profit_usd,
            via_currency, client_name, note, tenant_id, created_at
          ) VALUES (
            ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP)
          )`,
        )
        .run(
          type,
          data.fromCurrency,
          data.toCurrency,
          data.amountIn,
          data.amountOut,
          rate,
          baseRate,
          profitUsd,
          data.leg1Rate,
          data.leg1MarketRate,
          data.leg1ProfitUsd,
          data.leg2Rate ?? null,
          data.leg2MarketRate ?? null,
          data.leg2ProfitUsd ?? null,
          data.viaCurrency ?? null,
          data.clientName ?? null,
          note,
          tenantId,
          data.transaction_time ?? null,
        );

      const id = Number(result.lastInsertRowid);

      // Compute amount_usd and amount_lbp for the unified transactions ledger.
      // amount_usd: represents USD flow (negative = outflow, positive = inflow)
      // amount_lbp: represents LBP flow
      // For non-USD/non-LBP currencies (e.g. EUR), we only track the USD leg value.
      let amount_usd = 0;
      let amount_lbp = 0;

      if (data.fromCurrency === BASE_CURRENCY) {
        // USD → X: customer gives USD, shop receives USD (inflow)
        amount_usd = data.amountIn;
      } else if (data.toCurrency === BASE_CURRENCY) {
        // X → USD: customer receives USD, shop gives USD (outflow)
        amount_usd = -data.amountOut;
      } else if (data.fromCurrency === "LBP") {
        // LBP → X (cross-currency): customer gives LBP, shop receives LBP (inflow)
        amount_lbp = data.amountIn;
        amount_usd = data.leg1ProfitUsd; // net profit in USD (informational)
      } else if (data.toCurrency === "LBP") {
        // X → LBP (cross-currency): customer receives LBP, shop gives LBP (outflow)
        amount_lbp = -data.amountOut;
        amount_usd = -(data.leg1ProfitUsd ?? 0); // informational
      }
      // EUR → USD or USD → EUR already handled by the USD cases above.
      // EUR → LBP or LBP → EUR handled by LBP cases above.

      const txnId = getTransactionRepository().createTransaction({
        type: TRANSACTION_TYPES.EXCHANGE,
        source_table: "exchange_transactions",
        source_id: id,
        user_id: createdBy,
        amount_usd,
        amount_lbp,
        profit_usd: profitUsd,
        exchange_rate: rate,
        // Rule 11: the (optional) client name must reach the unified row —
        // without it every exchange showed "—" in the transactions table
        // even when a name was entered (lira-094 sweep).
        // For-partner exchanges label the row with the partner (owner ask,
        // matches Recharge/Loto: the transactions table shows "<partner> [partner]").
        client_name:
          isForPartner && data.partnerId
            ? `${getPartnerRepository().getById(data.partnerId)?.name ?? `#${data.partnerId}`} [partner]`
            : (data.clientName ?? null),
        summary: `Exchange: ${data.amountIn} ${data.fromCurrency} → ${data.amountOut} ${data.toCurrency}${data.viaCurrency ? ` (via ${data.viaCurrency})` : ""}`,
        metadata_json: {
          type,
          from_currency: data.fromCurrency,
          to_currency: data.toCurrency,
          amount_in: data.amountIn,
          amount_out: data.amountOut,
          leg1_rate: data.leg1Rate,
          leg2_rate: data.leg2Rate ?? null,
          via_currency: data.viaCurrency ?? null,
          total_profit_usd: data.totalProfitUsd,
        },
        transaction_time: data.transaction_time,
      });

      // Inflow: customer gives fromCurrency → shop drawer increases.
      // LIRA-081: skipped entirely in for-partner mode — there is no walk-in
      // customer handing over cash; the partner owes it instead (booked below).
      if (!isForPartner) {
        const fromDelta = Math.abs(data.amountIn);
        insertPaymentRow(this.db, {
          transactionId: txnId,
          method: "CASH",
          drawerName,
          currencyCode: data.fromCurrency,
          amount: fromDelta,
          note,
          createdBy,
          tenantId,
        });
        applyDrawerDelta(this.db, {
          drawerName,
          currencyCode: data.fromCurrency,
          delta: fromDelta,
          tenantId,
        });
      }

      // Outflow: shop gives toCurrency to customer → shop drawer decreases.
      // Real regardless of partner mode — this value genuinely leaves the till.
      const payoutLegs = (data.payments ?? []).filter(
        (p) => Math.abs(p.amount) > 0,
      );
      if (payoutLegs.length > 0) {
        // Split payout (owner-requested 2026-07-30): the shop pays the
        // customer's amountOut across several lines (e.g. $100 +
        // 11,050,000 LBP for one 20,000,000 LBP payout). Same shape as the
        // app-wallet RECEIVE payout fixed the same day: reconcile hard-reject
        // FIRST (S2 — a mis-keyed split throws inside this db.transaction and
        // rolls everything back), then post EACH leg in its OWN currency
        // (§4 / lira-074). Guards up front:
        if (isForPartner) {
          throw new Error(
            "A partner exchange takes no payout legs — the shop's disbursement books as the single outflow",
          );
        }
        // reconcileLegs is USD/LBP-native (expectedTotalIn maps any non-LBP
        // currency to the USD bucket) — an exotic-target split would
        // reconcile against the wrong denomination, so it is rejected here;
        // the frontend only offers the sheet for USD/LBP targets.
        if (data.toCurrency !== "USD" && data.toCurrency !== "LBP") {
          throw new Error(
            "A split payout requires a USD or LBP target currency",
          );
        }
        const { outLegs } = partitionLegs(payoutLegs);
        if (outLegs.length > 0) {
          throw new Error(
            "An exchange payout has no return legs — send IN legs only",
          );
        }
        for (const leg of payoutLegs) {
          // CUSTOMER_ACCOUNT (store credit) needs a client_id, which
          // exchange_transactions does not carry; GIFT_CARD and other
          // non-drawer methods would silently unbalance the till.
          if (!isDrawerAffectingMethod(leg.method)) {
            throw new Error(
              `Payout method "${leg.method}" is not supported for exchanges — use a cash/wallet method`,
            );
          }
        }

        reconcileLegs({
          inLegs: payoutLegs,
          expectedTotals: expectedTotalIn(
            Math.abs(data.amountOut),
            data.toCurrency,
          ),
          // Band anchor only — the stamped `rate` is the from→to exchange
          // rate (possibly EUR-per-USD etc.), NOT a USD↔LBP rate, so the
          // server sell rate anchors the ±10% tender-rate sanity band here.
          exchangeRate: getUsdLbpSellRate(this.db),
          tenderExchangeRate: data.tender_exchange_rate,
          context: "Exchange payout",
        });

        for (const leg of payoutLegs) {
          const legAmount = Math.abs(leg.amount);
          const legDrawer = paymentMethodToDrawerName(leg.method);
          insertPaymentRow(this.db, {
            transactionId: txnId,
            method: leg.method,
            drawerName: legDrawer,
            currencyCode: leg.currencyCode,
            amount: -legAmount,
            note: note ?? `Paid to customer (exchange payout)`,
            createdBy,
            tenantId,
          });
          applyDrawerDelta(this.db, {
            drawerName: legDrawer,
            currencyCode: leg.currencyCode,
            delta: -legAmount,
            tenantId,
          });
        }
      } else {
        // No structured legs (legacy/scripted callers, partner mode, exotic
        // target currencies): the single-lump fallback, unchanged.
        const toDelta = -Math.abs(data.amountOut);
        insertPaymentRow(this.db, {
          transactionId: txnId,
          method: "CASH",
          drawerName,
          currencyCode: data.toCurrency,
          amount: toDelta,
          note,
          createdBy,
          tenantId,
        });
        applyDrawerDelta(this.db, {
          drawerName,
          currencyCode: data.toCurrency,
          delta: toDelta,
          tenantId,
        });
      }

      // LIRA-081 (PFT-R): the partner owes exactly what a walk-in customer
      // would have paid — amountIn, in fromCurrency (already guarded above to
      // be USD or LBP). Once the partner settles this FOR_EXCHANGE row, the
      // shop's net cash position (General −toCurrency at creation, +fromCurrency
      // at settlement) is byte-identical to a normal walk-in exchange, which is
      // what makes the stamped profitUsd real only after settlement (PFT-6
      // deferral — see notPartnerPending("exchange_transactions", ...) in
      // ProfitRepository).
      if (isForPartner) {
        getPartnerRepository().addLedgerEntry({
          partner_id: data.partnerId as number,
          transaction_type: "FOR_EXCHANGE",
          reference_table: "exchange_transactions",
          reference_id: id,
          amount: Math.abs(data.amountIn),
          currency: data.fromCurrency,
          direction: "DEBIT",
          user_id: createdBy,
          notes:
            note ??
            `Exchange ${data.amountIn} ${data.fromCurrency} → ${data.amountOut} ${data.toCurrency}`,
          created_at: data.transaction_time ?? undefined,
        });
      }

      return { id };
    })();
  }

  // ---------------------------------------------------------------------------
  // Query Operations
  // ---------------------------------------------------------------------------

  /**
   * Get recent exchange history (last N transactions)
   */
  getHistory(limit: number = 50): ExchangeTransactionEntity[] {
    return this.db
      .prepare(
        `SELECT ${this.getColumns()} FROM exchange_transactions
         WHERE tenant_id = ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(getCurrentTenantId(), limit) as ExchangeTransactionEntity[];
  }

  /**
   * Get today's exchange transactions
   */
  getTodayTransactions(): ExchangeTransactionEntity[] {
    return this.db
      .prepare(
        `SELECT ${this.getColumns()} FROM exchange_transactions
         WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime')
           AND tenant_id = ?
         ORDER BY created_at DESC`,
      )
      .all(getCurrentTenantId()) as ExchangeTransactionEntity[];
  }

  /**
   * Get exchange statistics for today
   */
  getTodayStats(): { totalIn: number; totalOut: number; count: number } {
    const result = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(amount_in), 0)  AS total_in,
           COALESCE(SUM(amount_out), 0) AS total_out,
           COUNT(*)                      AS count
         FROM exchange_transactions
         WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime')
           AND tenant_id = ?`,
      )
      .get(getCurrentTenantId()) as {
      total_in: number;
      total_out: number;
      count: number;
    };
    return {
      totalIn: result.total_in,
      totalOut: result.total_out,
      count: result.count,
    };
  }

  /**
   * Update non-financial metadata on an exchange transaction.
   * Only metadata fields are allowed — financial data is immutable.
   */
  updateMetadata(
    id: number,
    data: { client_name?: string; note?: string },
    editedBy: string,
  ): ExchangeTransactionEntity | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const fields: string[] = [];
    const values: unknown[] = [];

    if (data.client_name !== undefined) {
      fields.push("client_name = ?");
      values.push(data.client_name);
    }
    if (data.note !== undefined) {
      fields.push("note = ?");
      values.push(data.note);
    }

    if (fields.length === 0) return existing;

    fields.push("edited_by = ?", "edited_at = CURRENT_TIMESTAMP");
    values.push(editedBy);
    values.push(id);

    this.db
      .prepare(
        `UPDATE exchange_transactions SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`,
      )
      .run(...values, getCurrentTenantId());

    return this.findById(id);
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let exchangeRepositoryInstance: ExchangeRepository | null = null;

export function getExchangeRepository(): ExchangeRepository {
  if (!exchangeRepositoryInstance) {
    exchangeRepositoryInstance = new ExchangeRepository();
  }
  return exchangeRepositoryInstance;
}

/** Reset the singleton (for testing) */
export function resetExchangeRepository(): void {
  exchangeRepositoryInstance = null;
}
