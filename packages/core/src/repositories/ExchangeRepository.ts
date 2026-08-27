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
import { getRateRepository } from "./RateRepository.js";
import { getExchangeLotRepository } from "./ExchangeLotRepository.js";
import { isLotTrackedCurrency } from "../constants/exchangeLotPolicy.js";
import { exchangeLogger } from "../utils/logger.js";
import { marketRateToUsdPerUnit } from "../utils/lotMarketRate.js";

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
  /** LIRA-131: set by `TransactionRepository._markSourceRefunded` when the
   *  unified transaction sourced from this row is voided/refunded —
   *  `exchange_transactions` is in its supported-tables whitelist. Was
   *  written by the reversal path but never projected here, so the
   *  Exchange history modal's existing "Refunded" badge (`exchange/pages
   *  /Exchange/components/HistoryModal.tsx`, gated on `tx.is_refunded`)
   *  stayed dormant. */
  is_refunded: number;
  refunded_at: string | null;
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

/**
 * EXCHANGE_LOT_SETTLEMENT.md Phase 3 — return shape of `createTransaction`.
 * `realizedProfitUsd`/`lotCoveredQty`/`lotMarketQty` are present ONLY when a
 * to-side FIFO consume happened (an exotic `toCurrency`) — a pure acquire
 * (BUY, no exotic disbursement) or a currency pair that never touches a lot
 * (USD<->LBP) leaves them undefined. The frontend's `session.linkTransaction`
 * must use `realizedProfitUsd` (the SERVER-authoritative number), never its
 * own pre-submit preview (FEATURE_GUIDE §13 walkthrough item 9).
 */
export interface CreateExchangeResult {
  id: number;
  /**
   * The FINAL `profit_usd` persisted on this exchange's
   * `exchange_transactions` row — re-read from the row itself right before
   * returning (never recomputed in memory), so it reflects the
   * lot-adjusted UPDATE (`_applyExchangeLotEffects`) when one ran, or the
   * client-submitted `totalProfitUsd` verbatim when it didn't. ALWAYS
   * present, unlike `realizedProfitUsd` below (only set on a to-side FIFO
   * consume) — this is the one number every caller should stamp as "what
   * this exchange actually booked".
   */
  bookedProfitUsd: number;
  realizedProfitUsd?: number;
  lotCoveredQty?: number;
  lotMarketQty?: number;
}

// =============================================================================
// Exchange Repository Class
// =============================================================================

export class ExchangeRepository extends BaseRepository<ExchangeTransactionEntity> {
  constructor() {
    super("exchange_transactions", { softDelete: false });
  }

  // LIRA-131: is_refunded/refunded_at are written by
  // TransactionRepository._markSourceRefunded on void/refund but were never
  // projected here, so a refunded exchange silently read back as an
  // ordinary live row. getHistory()/findById()/findAll() all share this one
  // method (used by both the IPC `exchange:get-history` handler and the
  // REST `GET /api/exchange/history` route via ExchangeService.getHistory
  // -> repo.getHistory), so this one change fixes the read path identically
  // for desktop and web (rule 19).
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
      "is_refunded",
      "refunded_at",
    ].join(", ");
  }

  // ---------------------------------------------------------------------------
  // Transaction Operations
  // ---------------------------------------------------------------------------

  /**
   * Create a new exchange transaction with full leg tracking.
   */
  createTransaction(data: CreateExchangeData): CreateExchangeResult {
    const drawerName = "General";
    const createdBy = this.resolveFallbackUserId();
    const note = data.note ?? null;

    // Derive type for display: SELL if customer receives USD, BUY otherwise
    const BASE_CURRENCY = "USD";
    const type = data.toCurrency === BASE_CURRENCY ? "SELL" : "BUY";

    // For backward compat: store leg1 rate as the top-level rate field
    const rate = data.leg1Rate;
    const baseRate = data.leg1MarketRate;
    // EXCHANGE_LOT_SETTLEMENT.md Phase 3: reassigned below to the lot-adjusted
    // total ONLY when a leg is lot-tracked (`_applyExchangeLotEffects` runs
    // after the INSERT below, once `id` exists) — a pure USD<->LBP exchange
    // never reassigns this, so its unified `transactions.profit_usd` stays
    // byte-identical to today.
    let profitUsd = data.totalProfitUsd;

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

      // GENERAL_DRAWER_UNRESTRICTED.md item 9: General's countable currency set
      // is DERIVED (constants/drawerCurrencyPolicy.ts is the ONE owner — see
      // `isUnrestrictedDrawer`/`UNRESTRICTED_DRAWER_BASE_CURRENCIES` there and
      // `CurrencyRepository.getCountableCurrenciesForDrawer`), not read from
      // `currency_drawers`. An `INSERT OR IGNORE INTO currency_drawers` used to
      // live here as a second, redundant owner of that policy (rule 14) — the
      // `drawer_balances` row `applyDrawerDelta` writes below is what makes a
      // brand-new currency (e.g. GBP) countable/visible for General; no
      // `currency_drawers` row is needed or written for it any more.
      ensureCurrency.run(
        data.fromCurrency,
        data.fromCurrencyName ?? data.fromCurrency,
        data.fromCurrency,
        tenantId,
      );
      ensureCurrency.run(
        data.toCurrency,
        data.toCurrencyName ?? data.toCurrency,
        data.toCurrency,
        tenantId,
      );

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

      // EXCHANGE_LOT_SETTLEMENT.md Phase 3 — cost-basis lot engine hook. Must
      // run AFTER the INSERT above (needs `id` to key
      // exchange_lots.source_id / exchange_lot_settlements.settled_by_id) and
      // BEFORE the unified `transactions` row below (so the SAME lot-adjusted
      // numbers this returns can be stamped on both rows — rule 14, never
      // compute the realized profit twice). `acquiredAt` is read back from
      // the row just inserted rather than re-deriving it, so a lot's
      // acquisition timestamp is byte-identical to the exchange's own
      // `created_at` (SQLite format) regardless of whether `transaction_time`
      // was supplied.
      const acquiredAt = this.findById(id)!.created_at;
      const lotEffects = this._applyExchangeLotEffects(id, data, acquiredAt);
      if (lotEffects.touched) {
        // Overwrite the leg profit columns this exact INSERT just wrote —
        // the acquire leg's spread profit is REPLACED by 0 (Q8) and/or the
        // consume leg's spread profit is REPLACED by its realized FIFO
        // profit; every OTHER column (amounts, rates, via_currency, ...)
        // stays exactly what the INSERT above wrote. A currency pair that
        // never touches a lot (USD<->LBP) never reaches this branch at all —
        // `lotEffects.touched` is false — so that row is never UPDATEd,
        // proving the byte-identical-today guarantee at the SQL level, not
        // just "the values happen to match".
        profitUsd = lotEffects.leg1ProfitUsd + (lotEffects.leg2ProfitUsd ?? 0);
        this.db
          .prepare(
            `UPDATE exchange_transactions
             SET leg1_profit_usd = ?, leg2_profit_usd = ?, profit_usd = ?
             WHERE id = ? AND tenant_id = ?`,
          )
          .run(
            lotEffects.leg1ProfitUsd,
            lotEffects.leg2ProfitUsd,
            profitUsd,
            id,
            tenantId,
          );
      }

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
        // Deliberately the CLIENT's original leg1ProfitUsd, not the
        // lot-adjusted value: this field is an informational cash-flow
        // proxy on the unified row, not the profit-recognition surface
        // (ProfitRepository's EXCHANGE_LEG_PROFIT reads
        // exchange_transactions.leg1_profit_usd/leg2_profit_usd directly,
        // which DID just get the lot-adjusted stamp above). fromCurrency is
        // LBP here, which is never lot-tracked, so leg1ProfitUsd was never
        // touched by `_applyExchangeLotEffects` regardless — this branch
        // stays byte-identical to pre-Phase-3 behavior by construction.
        amount_usd = data.leg1ProfitUsd; // net profit in USD (informational)
      } else if (data.toCurrency === "LBP") {
        // X → LBP (cross-currency): customer receives LBP, shop gives LBP (outflow)
        amount_lbp = -data.amountOut;
        // Same "informational, not profit-recognition" note as the LBP→X
        // branch above — EXCEPT here fromCurrency (X) MAY be exotic, in
        // which case `_applyExchangeLotEffects` already replaced the REAL
        // leg1_profit_usd with 0 (Q8) on the exchange_transactions row
        // itself. This proxy intentionally still reads the client's
        // original (pre-lot) leg1ProfitUsd — out of EXCHANGE_LOT_SETTLEMENT
        // .md's scope, which only names exchange_transactions.profit_usd,
        // the unified row's profit_usd, and metadata_json as needing the
        // adjusted values.
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
          // Deliberately the CLIENT's original submitted total, kept
          // unchanged — the 3 keys below are ADDED alongside it (never
          // replacing it) so a lot-touched row's metadata still shows what
          // was proposed vs. what was actually realized.
          total_profit_usd: data.totalProfitUsd,
          // EXCHANGE_LOT_SETTLEMENT.md Phase 3: only present when a lot leg
          // exists (`lotEffects.touched`) — a pure USD<->LBP row's
          // metadata_json stays byte-identical to pre-Phase-3 (no new keys
          // at all) since this spreads an empty object in that case.
          ...(lotEffects.touched
            ? {
                realized_profit_usd: lotEffects.realizedProfitUsd ?? 0,
                lot_covered_qty: lotEffects.lotCoveredQty ?? 0,
                lot_market_qty: lotEffects.lotMarketQty ?? 0,
              }
            : {}),
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

      // Re-read the row's profit_usd inside this SAME db.transaction, right
      // before returning, rather than trusting the in-memory `profitUsd`
      // variable — the robust choice: whatever is actually PERSISTED (the
      // lot-adjusted UPDATE above when `lotEffects.touched`, or the
      // client-inserted value verbatim when it didn't) is what every caller
      // should treat as "what this exchange booked". `profit_usd` is always
      // written by the INSERT above (never NULL), so the `?? profitUsd`
      // fallback only guards the type, it never masks a real gap.
      const bookedProfitUsd = this.findById(id)!.profit_usd ?? profitUsd;

      // EXCHANGE_LOT_SETTLEMENT.md Phase 3: the SERVER-computed realized
      // profit surfaces ONLY when a to-side consume actually happened —
      // `lotEffects.realizedProfitUsd` is `undefined` for a pure acquire
      // (BUY, nothing sold) or a non-lot-touched pair (USD<->LBP), and this
      // spreads to nothing in both cases (CreateExchangeResult's doc).
      return {
        id,
        bookedProfitUsd,
        ...(lotEffects.realizedProfitUsd !== undefined
          ? {
              realizedProfitUsd: lotEffects.realizedProfitUsd,
              lotCoveredQty: lotEffects.lotCoveredQty ?? 0,
              lotMarketQty: lotEffects.lotMarketQty ?? 0,
            }
          : {}),
      };
    })();
  }

  // ---------------------------------------------------------------------------
  // EXCHANGE_LOT_SETTLEMENT.md Phase 3 — cost-basis lot engine hooks
  // ---------------------------------------------------------------------------

  /**
   * Per-leg cost-basis lot hook, called once per exchange right after its
   * `exchange_transactions` row exists (`id` keys `exchange_lots.source_id` /
   * `exchange_lot_settlements.settled_by_id`) and before the unified
   * `transactions` row is written, so the caller can stamp the SAME numbers
   * this returns onto BOTH rows (rule 14 — never compute the lot-adjusted
   * profit twice).
   *
   * Direction (EXCHANGE_LOT_SETTLEMENT.md "Direction semantics" — get this
   * right, it was inverted once already): `from_currency` exotic -> the shop
   * ACQUIRES it (opens a lot, qty = amountIn); `to_currency` exotic -> the
   * shop DISBURSES it (FIFO-consumes open lots, qty = amountOut). USD and
   * LBP (`isLotTrackedCurrency` false) are exempt and keep booking through
   * the untouched spread model on whichever leg they sit on — evaluated
   * INDEPENDENTLY per side, so a cross exchange can acquire on leg1 while
   * leg2 keeps its spread profit, consume on leg2 while leg1 keeps its
   * spread profit, or do both (exotic-to-exotic).
   *
   * Acquire always lands on `leg1` (leg1's `from` side IS `data.fromCurrency`
   * in both the direct and the cross shape — `calculateExchange` never
   * builds a leg1 any other way). Consume lands on `leg1` for a DIRECT
   * USD->exotic trade (the only leg there is) and on `leg2` for a CROSS
   * X->exotic trade (leg2 is always USD->toCurrency in the cross shape).
   *
   * Returns `touched: false` (every profit field left at its ORIGINAL
   * client-sent value, `realizedProfitUsd` left `undefined`) when NEITHER
   * side is exotic — the USD<->LBP path that must stay byte-identical.
   */
  private _applyExchangeLotEffects(
    id: number,
    data: CreateExchangeData,
    acquiredAt: string,
  ): {
    touched: boolean;
    leg1ProfitUsd: number;
    leg2ProfitUsd: number | null;
    realizedProfitUsd?: number;
    lotCoveredQty?: number;
    lotMarketQty?: number;
  } {
    const lotRepo = getExchangeLotRepository();
    let leg1ProfitUsd = data.leg1ProfitUsd;
    let leg2ProfitUsd = data.leg2ProfitUsd ?? null;
    let realizedProfitUsd: number | undefined;
    let lotCoveredQty: number | undefined;
    let lotMarketQty: number | undefined;
    let touched = false;

    const isCross = data.viaCurrency != null;
    const acquireNeeded = isLotTrackedCurrency(data.fromCurrency);
    const consumeNeeded = isLotTrackedCurrency(data.toCurrency);

    if (!acquireNeeded && !consumeNeeded) {
      // USD<->LBP — neither side is exotic. Never even attempt a rate
      // lookup here; this is the byte-identical-to-today path.
      return { touched: false, leg1ProfitUsd, leg2ProfitUsd };
    }

    // Cross exchanges need ONE USD notional (the internal "leg1 -> USD ->
    // leg2" passthrough) shared by BOTH sides — computed once via
    // `_crossUsdNotional`'s anchor-priority rule, so acquire and consume
    // never independently re-derive two DIFFERENT numbers for what is
    // physically the SAME internal USD amount. `null` means neither side
    // has a configured `exchange_rates` row at all (a feed-only exotic
    // traded against another feed-only exotic, or a data-integrity gap) —
    // Q6's "never block" spirit applies here too: skip lot tracking for
    // THIS exchange entirely rather than crash or corrupt a guess, leaving
    // every profit field at its original client-sent value.
    let crossUsdNotional: number | null = null;
    if (isCross) {
      crossUsdNotional = this._crossUsdNotional(data);
      if (crossUsdNotional === null) {
        exchangeLogger.warn(
          {
            exchangeId: id,
            fromCurrency: data.fromCurrency,
            toCurrency: data.toCurrency,
          },
          `lot tracking skipped: no configured exchange_rates row for either ${data.fromCurrency} or ${data.toCurrency} — configure a rate to enable cost-basis tracking`,
        );
        return { touched: false, leg1ProfitUsd, leg2ProfitUsd };
      }
    }

    // --- Acquire: from_currency exotic -> shop buys it, opens a lot. ---
    if (acquireNeeded) {
      touched = true;
      // Direct exotic->USD: the whole trade IS this conversion, so
      // amount_out is already USD — dividing the two trusted amounts the
      // drawers already move by needs no exchange_rates lookup at all, and
      // no rounding drift is possible between the lot's cost and the actual
      // USD movement (they're the exact same division).
      // Cross (exotic->Y via USD): amount_out is in Y, not USD, so the lot's
      // cost is this leg's SHARE of the shared crossUsdNotional (U) per unit
      // acquired.
      const unitCostUsd = isCross
        ? (crossUsdNotional as number) / data.amountIn
        : data.amountOut / data.amountIn;

      lotRepo.createLot({
        currencyCode: data.fromCurrency,
        sourceType: "EXCHANGE_BUY",
        sourceTable: "exchange_transactions",
        sourceId: id,
        qty: data.amountIn,
        unitCostUsd,
        acquiredAt,
      });
      // Q8 — a buy earns nothing until it is sold; the spread profit the OLD
      // model would have stamped on this leg is replaced entirely.
      leg1ProfitUsd = 0;
    }

    // --- Consume: to_currency exotic -> shop disburses it, settles FIFO. ---
    if (consumeNeeded) {
      touched = true;
      // Direct USD->exotic: amountIn (USD) / amountOut (exotic) IS the
      // executed USD-per-unit price — two already-trusted amounts, no rate
      // lookup needed.
      // Cross (X->exotic via USD): the proceeds are this leg's SHARE of the
      // same shared crossUsdNotional (U) per unit disbursed.
      const unitProceedsUsd = isCross
        ? (crossUsdNotional as number) / data.amountOut
        : data.amountIn / data.amountOut;

      const marketUnitCostUsd = this._marketUnitCostUsd(
        data.toCurrency,
        unitProceedsUsd,
      );

      const consumeResult = lotRepo.consumeFifo({
        currencyCode: data.toCurrency,
        qty: data.amountOut,
        unitProceedsUsd,
        settledByTable: "exchange_transactions",
        settledById: id,
        marketUnitCostUsd,
      });

      realizedProfitUsd = consumeResult.realizedProfitUsd;
      lotCoveredQty = consumeResult.coveredQty;
      lotMarketQty = consumeResult.marketQty;

      // Q9 — realized profit lands on the SELL leg, dated by the sell (this
      // exact row), which is exactly this leg's own profit column: leg1 for
      // a direct USD->exotic trade, leg2 for a cross X->exotic trade.
      if (isCross) {
        leg2ProfitUsd = realizedProfitUsd;
      } else {
        leg1ProfitUsd = realizedProfitUsd;
      }
    }

    return {
      touched,
      leg1ProfitUsd,
      leg2ProfitUsd,
      realizedProfitUsd,
      lotCoveredQty,
      lotMarketQty,
    };
  }

  /**
   * The shared internal USD notional (U) for a CROSS exchange's "from ->
   * USD -> to" passthrough — computed ONCE and reused by both the acquire
   * and the consume side (`_applyExchangeLotEffects`), so they never
   * independently re-derive two different numbers for what is physically
   * the SAME internal USD amount.
   *
   * Anchor priority — LBP FIRST, never the exotic side first:
   * 1. `from_currency === 'LBP'`: U = amountIn's USD value at the executed
   *    `leg1Rate`, via LBP's own `exchange_rates` row (LBP has carried a
   *    seeded rate row since v59 — the one currency this can always trust).
   * 2. `to_currency === 'LBP'`: U = amountOut's USD value at the executed
   *    `leg2Rate`, same LBP-row trust.
   * 3. Exotic <-> exotic (neither side LBP): try the FROM side's own
   *    `exchange_rates` row first (matches the acquire leg's natural
   *    direction), then the TO side's; `null` only when NEITHER has one.
   *
   * LBP is preferred over the exotic side even when the exotic side's own
   * row happens to exist, because LBP's row is unconditionally reliable —
   * this is what lets a real everyday trade like LBP->GBP (customer pays
   * LBP for GBP) keep working when GBP is a feed-only currency
   * `ExchangeRepository.createTransaction`'s own `ensureCurrency` registers
   * into `currencies` (General's drawer visibility comes from the
   * `drawer_balances` row `applyDrawerDelta` writes, not from a
   * `currency_drawers` row — see item 9's comment above) but NEVER
   * `exchange_rates` (that table only holds currencies an operator manually
   * configured a buy/sell spread for) — the desktop form's main path,
   * `addDirectTransaction`, computes such a currency's leg rates from a live
   * feed, not this table.
   *
   * This method's null-vs-non-null ANSWER (not its math — this stays the
   * one place that resolves the actual USD amount) is mirrored by the pure
   * predicate `crossPairHasUsdAnchor` (`utils/lotMarketRate.ts`): "LBP on
   * either side anchors; else either side's rate row anchors". Adversarial
   * review (Exchange Lot Settlement, 2026-08): the preview
   * (`ExchangeLotService.previewSettlement`) has no exchange row to run this
   * exact method against, so it calls the shared predicate instead of
   * re-deriving its own copy of this availability rule — keeping submit's
   * "skip lot tracking" decision and the preview's "don't show a realized
   * figure the server will discard" decision permanently in sync (rule 14).
   */
  private _crossUsdNotional(data: CreateExchangeData): number | null {
    if (data.fromCurrency === "LBP") {
      const perUnit = this._usdPerUnitFromExecutedRate(data.leg1Rate, "LBP");
      return perUnit === null ? null : perUnit * data.amountIn;
    }
    if (data.toCurrency === "LBP") {
      const perUnit = this._usdPerUnitFromExecutedRate(
        data.leg2Rate as number,
        "LBP",
      );
      return perUnit === null ? null : perUnit * data.amountOut;
    }
    const fromPerUnit = this._usdPerUnitFromExecutedRate(
      data.leg1Rate,
      data.fromCurrency,
    );
    if (fromPerUnit !== null) return fromPerUnit * data.amountIn;
    const toPerUnit = this._usdPerUnitFromExecutedRate(
      data.leg2Rate as number,
      data.toCurrency,
    );
    if (toPerUnit !== null) return toPerUnit * data.amountOut;
    return null;
  }

  /**
   * USD value of exactly ONE unit of `currencyCode`, decoded from an ALREADY
   * EXECUTED leg rate — never re-derived from the live `exchange_rates` row
   * (EXCHANGE_LOT_SETTLEMENT.md's "Rate-editing note": a later rate edit or
   * operator override must not retroactively change a past exchange's cost
   * basis; `exchange_rates` keeps no history, an upsert overwrites).
   *
   * Mirrors `currencyConverter`'s own `convertToUSD`/`convertFromUSD`
   * is_stronger branch at amount = 1 (rule 14: one named fragment, not a
   * second orientation convention) — delegates the actual formula to the
   * shared `marketRateToUsdPerUnit` (`utils/lotMarketRate.ts`), the SAME
   * helper `_marketUnitCostUsd` below and `ExchangeLotService` (Phase 4a)
   * use — `is_stronger === 1` (LBP-like, rate = units-per-USD) divides;
   * `is_stronger === -1` (EUR-like, rate = USD-per-unit) is the rate itself.
   *
   * Returns `null` — never throws — when `currencyCode` has no configured
   * `exchange_rates` row (or the table itself doesn't exist on this
   * connection, same defensive `sqlite_master` check `_marketUnitCostUsd`
   * uses). A feed-only exotic (e.g. an open.er-api.com currency) is NEVER
   * given a row by `createTransaction`'s own `ensureCurrency` (which only
   * ever inserts into `currencies`), so "no row" is a
   * NORMAL, expected outcome for this method, not a data error — the
   * earlier claim that a cross leg's currency "MUST already exist" only
   * held for the server-recomputed path (`ExchangeService.addTransaction`);
   * the desktop form's main path (`addDirectTransaction`) computes a
   * feed-only currency's leg rates from the live feed, never this table.
   * The caller (`_crossUsdNotional`) treats `null` as "try the next
   * anchor" and, if nothing has a row, skips lot tracking for the whole
   * exchange rather than blocking the trade (Q6's spirit).
   */
  private _usdPerUnitFromExecutedRate(
    rate: number,
    currencyCode: string,
  ): number | null {
    if (!this._exchangeRatesTableExists()) return null;
    const rateRow = getRateRepository().findByCode(currencyCode);
    if (!rateRow) return null;
    return marketRateToUsdPerUnit(rate, rateRow.is_stronger);
  }

  /**
   * Q6 (oversell) basis for the uncovered slice of a FIFO consume: the
   * currency's CURRENT `market_rate`, USD-normalized the same way as
   * `_usdPerUnitFromExecutedRate`. Unlike that method this reads the LIVE
   * `exchange_rates` row on purpose — an uncovered slice has no lot to
   * freeze a historical cost from, so "today's market rate" (Q6's own
   * wording) IS the basis by design.
   *
   * Falls back to `unitProceedsUsd` (making the uncovered slice's profit
   * exactly 0) when the currency has no configured `exchange_rates` row at
   * all — a feed-only exotic with no manually-configured buy/sell spread.
   * Never throws: an oversell must never be blocked (Q6 — "never block").
   * Delegates the orientation formula to the shared `marketRateToUsdPerUnit`
   * (rule 14 — see `_usdPerUnitFromExecutedRate`'s doc for why this isn't a
   * second inline copy).
   *
   * Also falls back the same way when the `exchange_rates` TABLE itself is
   * absent (checked defensively, same `sqlite_master` pattern
   * `TransactionRepository._supplierLedgerHasSourceRefColumns` uses) — every
   * real DB has had this table since v59, long before this feature, but an
   * oversell's market-basis slice is called for EVERY under-covered consume,
   * including ones a caller reaches purely to test an unrelated guard on a
   * minimal hand-rolled schema. "Never block" applies here too: this repo
   * has no business hard-crashing a connection over a table it only reads
   * defensively.
   */
  private _marketUnitCostUsd(
    currencyCode: string,
    unitProceedsUsd: number,
  ): number {
    if (!this._exchangeRatesTableExists()) return unitProceedsUsd;
    const rateRow = getRateRepository().findByCode(currencyCode);
    if (!rateRow) return unitProceedsUsd;
    return marketRateToUsdPerUnit(rateRow.market_rate, rateRow.is_stronger);
  }

  /** See `_marketUnitCostUsd`'s doc for why this check exists. */
  private _exchangeRatesTableExists(): boolean {
    return (
      this.db
        .prepare(
          `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'exchange_rates'`,
        )
        .get() !== undefined
    );
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
