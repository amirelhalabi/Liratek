/**
 * Recharge Repository
 *
 * Handles recharge-specific queries (virtual stock).
 * Uses recharges and drawer_balances tables.
 */

import type Database from "better-sqlite3";
import { BaseRepository } from "./BaseRepository.js";
import { rechargeLogger } from "../utils/logger.js";
import { getCurrentTenantId } from "../db/tenantContext.js";

import {
  paymentMethodToDrawerName,
  isDrawerAffectingMethod,
  partitionLegs,
} from "../utils/payments.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { getVoucherRepository } from "./VoucherRepository.js";
import {
  reconcileLegs,
  expectedTotalIn,
  applyDrawerDelta,
  insertPaymentRow,
  bookClientDebtCharge,
  assertPartnerIdRequired,
  assertNoCounterPayment,
  postPayoutLegs,
  usdEquivalent,
  lbpEquivalent,
  sumLegsByCurrency,
  resolveStampedExchangeRate,
  LEG_RECONCILIATION_EPSILON_USD,
} from "./moneyPosting.js";
import { formatMoneyAmount } from "../utils/formatMoney.js";
import { getDebtService } from "../services/DebtService.js";
import { getUsdLbpSellRate } from "../utils/exchangeRate.js";
import {
  SMS_TRANSFER_FEE_USD,
  planSmsTransfer,
} from "../utils/telecomCredit.js";
import { getSupplierRepository } from "./SupplierRepository.js";
import { getPartnerRepository } from "./PartnerRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import {
  type TopUpProvider,
  TOP_UP_PROVIDER_DRAWERS,
  TOP_UP_PROVIDER_LABELS,
} from "../constants/index.js";
import {
  getCarrierLineRepository,
  type CarrierKey,
} from "./CarrierLineRepository.js";
import { getCarrierLineService } from "../services/CarrierLineService.js";
import { isSameLebanesePhone } from "../utils/phoneNumber.js";
import { getExpenseRepository } from "./ExpenseRepository.js";
import { omtAppCashoutCommission } from "../constants/omtAppCashout.js";

// =============================================================================
// SMS transfer fee → expense constants (owner decision 2026-09-06) — rule 14:
// defined ONCE here, the single call site below, never re-spelled elsewhere.
// =============================================================================

/** `expenses.category` for the SMS transfer fee a CREDIT_TRANSFER burns. */
export const SMS_TRANSFER_EXPENSE_CATEGORY = "SMS_Transfer_Fee";

/**
 * `expenses.paid_by_method` for the SMS transfer fee expense. Kept as the
 * SAME label the pre-cutover payment leg used (`"SMS_COST"`) — NOT a
 * registered `payment_methods` row (deliberately, same reasoning as
 * `LINE_USAGE_PAID_BY_METHOD`): no cash drawer, no wallet, no customer
 * tender is involved. The value leaves the carrier's own credit drawer via
 * `CreateExpenseData.drawer_override`, and this string is only the audit
 * label for that.
 */
export const SMS_TRANSFER_EXPENSE_PAID_BY_METHOD = "SMS_COST";

// =============================================================================
// Entity Types
// =============================================================================

export interface VirtualStock {
  mtc: number;
  alfa: number;
}

export type RechargePaidByMethod = string;

export interface RechargeData {
  provider: "MTC" | "Alfa";
  /**
   * `"CREDIT_BUYBACK"` (CARRIER_LINES_VALIDITY_PLAN.md Phase 6, D7/D8): the
   * operator detected the shop's OWN carrier line in the Credit tab's phone
   * field and flipped the form to a reversible buy-back — the customer hands
   * the shop credits, the shop pays cash out. Routed to
   * {@link RechargeRepository.processCreditBuyback} at the very top of
   * {@link RechargeRepository.processRecharge}, so it never reaches this
   * method's normal sale body; `amount` is reused as the credits gained
   * (USD face value) and `price` as the total cash paid out (in `currency`).
   */
  type:
    | "CREDIT_TRANSFER"
    | "VOUCHER"
    | "DAYS"
    | "TOP_UP"
    | "ALFA_GIFT"
    | "CREDIT_BUYBACK";
  amount: number;
  cost: number;
  price: number;
  default_price_to_client?: number;
  currency?: string; // Defaults to "USD"
  paid_by_method?: RechargePaidByMethod;
  /** Multi-payment support: when provided, overrides paid_by_method */
  payments?: Array<{
    method: string;
    currencyCode: string;
    amount: number;
    /** Set when method === 'GIFT_CARD' — the voucher code being redeemed. */
    voucherCode?: string;
    /** IN (customer pays, default) or OUT (shop returns change to customer). */
    direction?: "IN" | "OUT";
  }>;
  phoneNumber?: string;
  clientId?: number;
  clientName?: string;
  userId?: number;
  transaction_time?: string;
  /**
   * The CLIENT's own local calendar day (`YYYY-MM-DD`, e.g. the frontend's
   * `localDay()`). Fed to `CarrierLineService.applyMovement`'s `today` for
   * the DAYS-sale validity decrement and the CREDIT_BUYBACK credit movement
   * below — see `CarrierLineRepository.ApplyCarrierLineMovementInput.today`'s
   * doc for why a server-computed day is untrustworthy on web (Fly runs UTC,
   * the shop is Beirut UTC+3) and why `transaction_time` (backdating-only,
   * undefined on every normal real-time recharge) cannot substitute for it.
   * Also reused, unchanged in effect, as the "today" a redeemed GIFT_CARD
   * voucher's expiry is checked against (`VoucherRepository.redeemByCode`).
   * Optional; falls back to the server's own `localDay()`.
   */
  client_day?: string;
  /** T3 keep-change (KC-3): kept (not returned) change per currency —
   *  added to the transaction's profit stamp (tender-native amounts). */
  kept_change_usd?: number;
  kept_change_lbp?: number;
  /**
   * Payment-Legs Integrity plan (false-reject fix, 2026-07-2x): the USD→LBP
   * rate the caller's own till/MultiPaymentInput actually converted the
   * customer's tender at (e.g. the buy rate — the owner's 2026-07-06
   * MPI-buy-rate decision — which can differ from the sell-side rate this
   * repository stamps on `transactions.exchange_rate`). When present, leg
   * reconciliation (`reconcileLegs`) converts cross-currency legs at THIS
   * rate instead of the stamped rate — comparing at the SAME rate the till
   * used, so a legitimate buy/sell-spread checkout with change doesn't
   * false-reject (the owner's MTC CREDIT_TRANSFER repro: 720,000 LBP price,
   * $10 IN, 170,000 LBP OUT, till rate 89,000 vs. stamped sell rate 90,000).
   * `reconcileLegs` bands this against the stamped rate (±15%) and throws a
   * distinct error if it's implausibly far off. Omitted → current behavior,
   * reconciles at the stamped sell rate alone.
   *
   * Owner decision (2026-08-08, same repro): ALSO used to stamp
   * `transactions.exchange_rate` — via `resolveStampedExchangeRate`
   * (moneyPosting.ts), a non-throwing sibling of the reconciliation
   * band-check that falls back to the server (sell) rate silently outside
   * the band or when absent. This does NOT change what `reconcileLegs`/
   * `postPayoutLegs` reconcile against — they keep anchoring at the server
   * sell rate, unchanged.
   */
  tender_exchange_rate?: number;
  /**
   * Session-basket deferred payment mode. When true, the customer-cash inflow,
   * its debt, and any returned change are owned by the basket recorder; only the
   * telecom stock leg (and SMS cost) is written here. Non-session callers leave
   * this falsy → behavior is unchanged.
   */
  deferPayment?: boolean;
  /**
   * PFT-R (Partner FOR-Transactions, full-amount model): when set together
   * with `partnerMode === "FOR"`, this is NOT a walk-in customer sale — no
   * counter cash is taken at all. The FULL `price` books to `partner_ledger`
   * (FOR_RECHARGE DEBIT) against this partner, settled later on the Partners
   * page. The normal provider drawer consumption, stock, and SMS-cost flow
   * are unchanged; only the customer-payment step is replaced.
   */
  partnerId?: number;
  /** Only "FOR" is valid for recharges — the partner analog of CUSTOMER_ACCOUNT. */
  partnerMode?: "FOR";
}

export interface RechargeEntity {
  id: number;
  carrier: string;
  recharge_type: string;
  amount: number;
  cost: number;
  price: number;
  default_price_to_client: number | null;
  currency_code: string;
  paid_by: string;
  phone_number: string | null;
  client_id: number | null;
  client_name: string | null;
  note: string | null;
  created_at: string;
  created_by: number;
  edited_by: string | null;
  edited_at: string | null;
  /** LIRA-131: set by `TransactionRepository._markSourceRefunded` when the
   *  unified transaction sourced from this row is voided/refunded —
   *  `recharges` is in its supported-tables whitelist. Was written by the
   *  reversal path but never projected here, so the Recharge history
   *  modal's existing "Refunded" badge (`recharge/components/HistoryModal
   *  .tsx`, gated on `tx.is_refunded`) stayed dormant. */
  is_refunded: number;
  refunded_at: string | null;
}

// =============================================================================
// Summary/note formatting
// =============================================================================

const RECHARGE_TYPE_LABELS: Record<RechargeData["type"], string> = {
  CREDIT_TRANSFER: "Credits",
  VOUCHER: "Voucher",
  DAYS: "Days",
  TOP_UP: "Top-up",
  ALFA_GIFT: "Gift",
  CREDIT_BUYBACK: "Credit Buy-back",
};

/**
 * Human-readable "what was actually recharged" detail, distinct from `price`
 * (what the customer was charged): DAYS is denominated in days, every other
 * type in the recharge's own dollar face value. Shown alongside price on the
 * unified transaction summary and the recharge/debt notes so an operator can
 * see both the quantity sold and the amount collected at a glance.
 */
function describeRechargeAmount(
  type: RechargeData["type"],
  amount: number,
): string {
  if (type === "DAYS") return `${amount} days`;
  if (type === "TOP_UP") return "";
  return `$${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function rechargeDetailLabel(
  type: RechargeData["type"],
  amount: number,
): string {
  const label = RECHARGE_TYPE_LABELS[type] ?? type;
  const amountDetail = describeRechargeAmount(type, amount);
  return amountDetail ? `${label} ${amountDetail}` : label;
}

// =============================================================================
// Provider credit-stock consumption (CARRIER_LINES_VALIDITY_PLAN.md Phase 0)
// =============================================================================

/**
 * The setting key the Days tab's LBP conversion actually uses. Settings → Shop
 * Config writes it (`ShopConfig.tsx`) and both telecom submit paths read it
 * (`Recharge/index.tsx`, `TelecomForm.tsx` — `alfaCreditCostRate`).
 *
 * **Not `telecom_credit_cost_rate_lbp`.** Those two keys hold the same number
 * today and that is deliberate, not redundant — see the note on
 * `TELECOM_CREDIT_COST_RATE_LBP` in utils/telecomCredit.ts. One is the cost of
 * credit bought DIRECTLY as a top-up (this one), the other the cost of credit
 * that arrives EMBEDDED in a prepaid card. Nothing keeps them in sync, so
 * inverting at the wrong one silently breaks the moment an owner edits Shop
 * Config.
 */
// NOTE the key: `alfa_credit_cost_lbp`, NOT `telecom_credit_cost_rate_lbp`.
// Both exist, both sit near 85,000, and they are deliberately separate — see
// migration v141's note ("named distinctly from the existing
// alfa_credit_sell_rate_lbp / alfa_credit_cost_rate_lbp / alfa_credit_cost_lbp
// keys"). `telecom_credit_cost_rate_lbp` is the card-embedded credit rate (R)
// used to split an Only-Days item's cost; this one is the Alfa/MTC direct
// credit rate the Days tab multiplies by. Inverting at the wrong one is
// lossless only while the two happen to hold equal values, and silently wrong
// the moment an owner edits Shop Config.
const ALFA_CREDIT_COST_RATE_SETTING = "alfa_credit_cost_lbp";

/**
 * The frontend's own hardcoded fallback when the setting is unset
 * (`alfaCreditCostRate || 85000` / `useState(85000)`). Duplicated here on
 * purpose rather than aliased to `TELECOM_CREDIT_COST_RATE_LBP`: that
 * constant has been re-anchored before (migration v146 moved it from 93,333.33
 * to 85,000) and re-anchoring it again must NOT silently make this inversion
 * disagree with what the form multiplied by.
 */
const ALFA_CREDIT_COST_RATE_FALLBACK_LBP = 85_000;

/**
 * The tenant's cost of $1 of telecom credit in LBP, resolved through the SAME
 * chain the Recharge page uses before it multiplies the Days tab's `Cost ($)`
 * field by it (`cost = parseFloat(telecomDaysCostUsd) * (alfaCreditCostRate ||
 * 85000)`).
 *
 * Dividing by this exact rate is what makes the LBP→USD inversion below
 * lossless. The USD/LBP *sell* rate is a different number, so inverting at it
 * would debit the provider drawer an amount the operator never saw on screen —
 * which is precisely what plan §0.3 forbids, since the Cost field is editable.
 *
 * Defensive in the same style as `getUsdLbpSellRate`: a missing table/row or an
 * unusable value falls back to the named default rather than throwing inside a
 * money transaction.
 */
function getAlfaCreditCostRateLbp(
  db: Database.Database,
  tenantId: number,
): number {
  try {
    const row = db
      .prepare(
        `SELECT value FROM system_settings
         WHERE key_name = ? AND tenant_id = ?`,
      )
      .get(ALFA_CREDIT_COST_RATE_SETTING, tenantId) as
      | { value?: string | null }
      | undefined;
    const parsed = Number(row?.value);
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : ALFA_CREDIT_COST_RATE_FALLBACK_LBP;
  } catch {
    return ALFA_CREDIT_COST_RATE_FALLBACK_LBP;
  }
}

/** One negative USD movement against the provider (MTC/Alfa) credit drawer. */
interface TelecomStockLeg {
  /** `payments.method` — the carrier for a credit send, a distinct marker
   *  otherwise (mirrors the `SMS_COST` leg's labelling). */
  method: string;
  /** Signed USD delta (always ≤ 0 here). */
  amountUsd: number;
  note: string;
}

/**
 * Which USD figure leaves the provider credit drawer for a given recharge type,
 * and how that leg is labelled. Returns `null` when the type consumes nothing.
 *
 * **`data.amount` is not always dollars.** It is the USD face value of the
 * credit sent for every type EXCEPT `DAYS`, where it is a **day count** (see
 * `describeRechargeAmount` above). The pre-fix code applied
 * `-Math.abs(data.amount)` unconditionally, so selling 30 days debited the MTC
 * drawer $30.00 instead of the $0.90 the three SMSes actually cost — a 33x
 * over-deduction (owner ruling 2026-08-06: each SMS adds 10 days and costs the
 * shop $0.30).
 *
 * SUPERSEDED PARENTHETICAL (owner ruling 2026-08-06 also said "the shop's own
 * validity never moves" — a LATER owner report, 2026-08-08, asked for the
 * literal reverse: a DAYS sale must decrement the shop's own line's
 * `validity_expires_at` by the days sold. This function's scope is
 * unaffected — it only ever moved the USD credit-cost drawer leg, never
 * validity — the validity decrement is a SEPARATE `CarrierLineService
 * .applyMovement` call in `processRecharge`, right after this function's
 * result is applied. See `RechargeRepository.daysChargeValidityDecrement
 * .test.ts` (LIRA-113).
 *
 * The days figure comes from the operator-submitted cost, already converted to
 * USD by the caller — never recomputed from the day count, because the Days
 * tab's `Cost ($)` field is editable and a recomputed drawer debit would
 * disagree with the profit stamp on the same sale (plan §0.3).
 *
 * Exhaustive by construction: every member of `RechargeData["type"]` has its
 * own arm and there is deliberately no `default`, so adding a type fails the
 * build here (missing return) instead of silently inheriting the wrong unit.
 */
function telecomStockLeg(args: {
  type: RechargeData["type"];
  /** Carrier label used as the `method` on a credit-send leg. */
  carrier: string;
  /** `data.amount` — USD face value, or a DAY COUNT when type is `DAYS`. */
  amount: number;
  /** The DAYS cost in USD (already inverted from the submitted cost). */
  daysCostUsd: number;
}): TelecomStockLeg | null {
  switch (args.type) {
    case "CREDIT_TRANSFER":
    case "VOUCHER":
    case "TOP_UP":
    case "ALFA_GIFT":
      // `amount` is USD face value — consumed from the credit stock 1:1.
      return {
        method: args.carrier,
        amountUsd: -Math.abs(args.amount),
        note: "Telecom balance sent",
      };
    case "DAYS": {
      // The day count contributes ZERO. Only the days cost moves the drawer.
      const cost = Math.abs(args.daysCostUsd);
      if (!Number.isFinite(cost) || cost <= 0) return null;
      return {
        method: "VALIDITY_DAYS_COST",
        amountUsd: -cost,
        note: `Validity days cost: ${args.amount} days`,
      };
    }
    case "CREDIT_BUYBACK":
      // Unreachable in practice: `processRecharge` dispatches a
      // CREDIT_BUYBACK payload to `processCreditBuyback` before this
      // function is ever called (see the type's own doc comment). Kept as
      // an explicit arm — not folded under a `default` — so the exhaustive-
      // switch contract this function documents keeps holding if that
      // dispatch is ever removed.
      return null;
  }
}

// =============================================================================
// Recharge Repository Class
// =============================================================================

export class RechargeRepository extends BaseRepository<RechargeEntity> {
  constructor() {
    super("recharges", { softDelete: false });
  }

  // LIRA-131: is_refunded/refunded_at are written by
  // TransactionRepository._markSourceRefunded on void/refund but were never
  // projected here, so a refunded recharge silently read back as an
  // ordinary live row. getHistory()/findById()/findAll() all share this one
  // method (used by both the IPC `recharge:get-history` handler and the
  // REST `GET /api/recharge/history` route via RechargeService.getHistory
  // -> repo.getHistory), so this one change fixes the read path identically
  // for desktop and web (rule 19).
  protected getColumns(): string {
    return "id, carrier, recharge_type, amount, cost, price, default_price_to_client, currency_code, paid_by, phone_number, client_id, client_name, note, created_at, created_by, edited_by, edited_at, is_refunded, refunded_at";
  }

  /**
   * Get recharge history for a specific provider
   */
  getHistory(provider: "MTC" | "Alfa"): RechargeEntity[] {
    const rows = this.db
      .prepare(
        `SELECT ${this.getColumns()}
         FROM recharges
         WHERE carrier = ? AND tenant_id = ?
         ORDER BY created_at DESC
         LIMIT 100`,
      )
      .all(provider, getCurrentTenantId()) as RechargeEntity[];

    return rows;
  }

  /**
   * Get virtual stock totals for MTC and Alfa from drawer balances
   * This reads from the drawer_balances table instead of products table
   */
  getVirtualStock(currency = "USD"): VirtualStock {
    const tenantId = getCurrentTenantId();
    const mtc = this.db
      .prepare(
        "SELECT balance FROM drawer_balances WHERE drawer_name = 'MTC' AND currency_code = ? AND tenant_id = ?",
      )
      .get(currency, tenantId) as { balance: number | null };

    const alfa = this.db
      .prepare(
        "SELECT balance FROM drawer_balances WHERE drawer_name = 'Alfa' AND currency_code = ? AND tenant_id = ?",
      )
      .get(currency, tenantId) as { balance: number | null };

    return {
      mtc: mtc?.balance || 0,
      alfa: alfa?.balance || 0,
    };
  }

  /**
   * Top up provider drawer from another drawer.
   * This is a drawer-to-drawer transfer with no fees or commission.
   * Records a TOP_UP entry in the recharges table.
   */
  topUpApp(data: {
    provider: TopUpProvider;
    amount: number;
    currency: string;
    sourceDrawer: string;
    userId: number;
  }): { success: boolean; error?: string } {
    try {
      const destDrawer = TOP_UP_PROVIDER_DRAWERS[data.provider];
      const currency = data.currency;
      const amount = Math.abs(data.amount);
      const amountLabel = formatMoneyAmount(amount, currency);
      const tenantId = getCurrentTenantId();

      // Validate source drawer has sufficient balance
      const sourceBalanceRow = this.db
        .prepare(
          "SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ? AND tenant_id = ?",
        )
        .get(data.sourceDrawer, currency, tenantId) as {
        balance: number | null;
      };

      const sourceBalance = sourceBalanceRow?.balance ?? 0;
      if (sourceBalance < amount) {
        return {
          success: false,
          error: `Insufficient balance in ${data.sourceDrawer}. Available: ${sourceBalance} ${currency}`,
        };
      }

      this.db.transaction(() => {
        // Record the top-up in recharges table
        const rechargeResult = this.db
          .prepare(
            `INSERT INTO recharges (carrier, recharge_type, amount, cost, price, currency_code, paid_by, note, created_by, tenant_id)
             VALUES (?, 'TOP_UP', ?, 0, 0, ?, ?, ?, ?, ?)`,
          )
          .run(
            data.provider,
            amount,
            currency,
            data.sourceDrawer,
            `${TOP_UP_PROVIDER_LABELS[data.provider]} top-up from ${data.sourceDrawer}: +${amountLabel}`,
            data.userId,
            tenantId,
          );

        const rechargeId = Number(rechargeResult.lastInsertRowid);

        // Create unified transaction record
        const txnId = getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.RECHARGE_TOPUP,
          source_table: "recharges",
          source_id: rechargeId,
          user_id: data.userId,
          amount_usd: currency === "USD" ? amount : 0,
          amount_lbp: currency === "LBP" ? amount : 0,
          summary: `${TOP_UP_PROVIDER_LABELS[data.provider]} top-up: ${data.sourceDrawer} → ${destDrawer}: ${amountLabel}`,
          metadata_json: {
            provider: data.provider,
            amount,
            currency,
            sourceDrawer: data.sourceDrawer,
            destDrawer,
          },
        });

        // Deduct from source drawer. CQ-3 survey note: intentionally NOT
        // `applyDrawerDelta` — a plain UPDATE that must NOT create a row for
        // a missing source drawer (a typo'd/missing source must no-op, not
        // silently create a phantom negative-balance drawer). LIRA-194: this
        // is still safe to pair with a REAL `payments` row below — a void
        // could only "create" a phantom source drawer if a missing/short
        // source drawer had been allowed to reach this transaction at all,
        // and the balance check above (`sourceBalance < amount`) already
        // rejects that for any `amount > 0` BEFORE this transaction opens.
        // Do NOT switch this to `applyDrawerDelta` — that would silently
        // change the missing-drawer semantics this note protects.
        this.db
          .prepare(
            `UPDATE drawer_balances SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP
             WHERE drawer_name = ? AND currency_code = ? AND tenant_id = ?`,
          )
          .run(amount, data.sourceDrawer, currency, tenantId);
        insertPaymentRow(this.db, {
          transactionId: txnId,
          method: data.sourceDrawer,
          drawerName: data.sourceDrawer,
          currencyCode: currency,
          amount: -amount,
          note: `${TOP_UP_PROVIDER_LABELS[data.provider]} top-up: -${amountLabel}`,
          createdBy: data.userId,
          tenantId,
        });

        // Add to destination drawer — a REAL `payments` row (rule 20), not a
        // bare `applyDrawerDelta`, so the generic void path (`_reversePayments`)
        // can restore it later — same pair `topUpFromSupplier`/
        // `cashoutToSupplier` already use for their own dest-drawer leg.
        insertPaymentRow(this.db, {
          transactionId: txnId,
          method: destDrawer,
          drawerName: destDrawer,
          currencyCode: currency,
          amount,
          note: `${TOP_UP_PROVIDER_LABELS[data.provider]} top-up: +${amountLabel}`,
          createdBy: data.userId,
          tenantId,
        });
        applyDrawerDelta(this.db, {
          drawerName: destDrawer,
          currencyCode: currency,
          delta: amount,
          tenantId,
        });
      })();

      rechargeLogger.info(
        {
          provider: data.provider,
          amount: data.amount,
          currency,
          sourceDrawer: data.sourceDrawer,
          destDrawer,
        },
        `${TOP_UP_PROVIDER_LABELS[data.provider]} top-up: ${data.sourceDrawer} → ${destDrawer}: ${amountLabel}`,
      );

      return { success: true };
    } catch (error) {
      rechargeLogger.error({ error, data }, "App top-up failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get all drawer balances
   */
  getDrawerBalances(): Array<{
    name: string;
    usdBalance: number;
    lbpBalance: number;
    usdtBalance: number;
  }> {
    try {
      const rows = this.db
        .prepare(
          `SELECT drawer_name, currency_code, balance
           FROM drawer_balances
           WHERE currency_code IN ('USD', 'LBP', 'USDT') AND tenant_id = ?
           ORDER BY drawer_name`,
        )
        .all(getCurrentTenantId()) as Array<{
        drawer_name: string;
        currency_code: string;
        balance: number;
      }>;

      const drawerMap = new Map<
        string,
        { usdBalance: number; lbpBalance: number; usdtBalance: number }
      >();

      for (const row of rows) {
        if (!drawerMap.has(row.drawer_name)) {
          drawerMap.set(row.drawer_name, {
            usdBalance: 0,
            lbpBalance: 0,
            usdtBalance: 0,
          });
        }
        const drawer = drawerMap.get(row.drawer_name)!;
        if (row.currency_code === "USD") drawer.usdBalance = row.balance;
        else if (row.currency_code === "LBP") drawer.lbpBalance = row.balance;
        else if (row.currency_code === "USDT") drawer.usdtBalance = row.balance;
      }

      return Array.from(drawerMap.entries()).map(([name, balances]) => ({
        name,
        usdBalance: balances.usdBalance,
        lbpBalance: balances.lbpBalance,
        usdtBalance: balances.usdtBalance,
      }));
    } catch (error) {
      rechargeLogger.error({ error }, "Failed to get drawer balances");
      return [];
    }
  }

  /**
   * Process a recharge transaction (creates recharges row, updates drawers, logs activity)
   */
  processRecharge(data: RechargeData): {
    success: boolean;
    id?: number;
    error?: string;
  } {
    // CARRIER_LINES_VALIDITY_PLAN.md Phase 6 (D7/D8): a credit buy-back is a
    // fundamentally different money direction (payout, not a sale) — routed
    // to its own method before any of this method's sale-shaped logic runs.
    if (data.type === "CREDIT_BUYBACK") {
      return this.processCreditBuyback(data);
    }

    try {
      const result = this.db.transaction(() => {
        const detail = rechargeDetailLabel(data.type, data.amount);
        const note = `${data.provider} ${detail}${data.phoneNumber ? ` - ${data.phoneNumber}` : ""}`;
        const paidBy = data.paid_by_method || "CASH";
        const currency = data.currency ?? "USD";
        const createdBy = data.userId ?? 1;
        const tenantId = getCurrentTenantId();

        // 1. Create Recharge Record (goes into recharges table, not sales)
        const clientName = data.clientId
          ? ((
              this.db
                .prepare(
                  "SELECT full_name FROM clients WHERE id = ? AND tenant_id = ?",
                )
                .get(data.clientId, tenantId) as
                | { full_name: string }
                | undefined
            )?.full_name ??
            data.clientName ??
            null)
          : (data.clientName ?? null);

        const insertRecharge = this.db.prepare(`
          INSERT INTO recharges (
            carrier, recharge_type, amount, cost, price, default_price_to_client, currency_code,
            paid_by, phone_number, client_id, client_name, note, created_by, tenant_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
        `);
        const rechargeResult = insertRecharge.run(
          data.provider,
          data.type,
          data.amount,
          data.cost,
          data.price,
          data.default_price_to_client ?? null,
          currency,
          paidBy,
          data.phoneNumber || null,
          data.clientId || null,
          clientName,
          note,
          createdBy,
          tenantId,
          data.transaction_time ?? null,
        );
        const rechargeId = Number(rechargeResult.lastInsertRowid);

        // 2. Create unified transaction row
        // rechargeCommission is denominated in the SALE currency (price and
        // cost share it).
        //
        // Owner decision 2026-09-06: the SMS transfer fee no longer nets
        // against this GROSS margin — it is booked as its OWN expense below
        // (step 5b) instead of a payment leg on this transaction, so the
        // recharge page and the Profits page agree on the same figure (a $3
        // MTC credit sale for 300,000 LBP used to show 45,000 on Recharge vs
        // 30,600 on Profits; both now read 45,000, with the 14,400 LBP fee
        // showing up as an expense line). Total net profit is unchanged —
        // the cost only moved from an invisible netting here to a visible
        // expense line. Cutover, not restatement (migration v166): existing
        // recharges keep the NET figure they were stamped with pre-cutover.
        const rechargeCommission = data.price - data.cost;
        // Carrier SMS rules live in ONE place (rule 14, LIRA-090 spec §2.1) —
        // utils/telecomCredit.ts. This now goes through the one SMS transfer
        // function (planSmsTransfer, TELECOM_DAYS_COST_PLAN.md §9/§6) shared
        // with the resale decision table's deliveredCostLbp; same ceil(amount
        // / 3) messages count as before, so this is behaviour-preserving.
        const smsCount =
          data.type === "CREDIT_TRANSFER"
            ? planSmsTransfer(data.amount).messages
            : 0;
        const smsCostUsd = smsCount * SMS_TRANSFER_FEE_USD;
        const sellRate = getUsdLbpSellRate(this.db);
        // Owner decision (2026-08-08, repro: buy 89,000 vs. sell 90,000):
        // the `transactions.exchange_rate` stamp reflects the operator's
        // tendered rate when it's within the reconciliation band of `sellRate`
        // (see `resolveStampedExchangeRate`'s doc on `RechargeData.
        // tender_exchange_rate`); falls back to `sellRate` silently otherwise.
        // `reconcileLegs` below keeps anchoring at `sellRate` — unaffected.
        const recordExchangeRate = resolveStampedExchangeRate(
          sellRate,
          data.tender_exchange_rate,
        );
        const txnId = getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.RECHARGE,
          source_table: "recharges",
          source_id: rechargeId,
          user_id: createdBy,
          amount_usd: currency === "USD" ? data.price : 0,
          amount_lbp: currency === "LBP" ? data.price : 0,
          // GROSS commission (sale currency) + kept change (T3,
          // tender-native). The SMS fee no longer nets against this figure —
          // see the comment above `rechargeCommission`.
          profit_usd:
            (currency === "USD" ? rechargeCommission : 0) +
            (data.kept_change_usd ?? 0),
          profit_lbp:
            (currency === "LBP" ? rechargeCommission : 0) +
            (data.kept_change_lbp ?? 0),
          client_id: data.clientId ?? null,
          // For-partner recharges label the row with the partner (owner ask:
          // the transactions table shows "<partner> [partner]").
          client_name:
            data.partnerMode === "FOR" && data.partnerId
              ? `${getPartnerRepository().getById(data.partnerId)?.name ?? `#${data.partnerId}`} [partner]`
              : (clientName ?? null),
          summary: `Recharge: ${data.provider} ${detail} — ${currency === "LBP" ? "" : "$"}${data.price.toLocaleString()} ${currency}`,
          metadata_json: {
            provider: data.provider,
            type: data.type,
            amount: data.amount,
            cost: data.cost,
            price: data.price,
            currency,
            paid_by: paidBy,
            phone: data.phoneNumber,
          },
          exchange_rate: recordExchangeRate,
          transaction_time: data.transaction_time,
        });

        // 3. Update running balances
        const methodDrawerName = paymentMethodToDrawerName(paidBy);
        const providerDrawerName = data.provider === "MTC" ? "MTC" : "Alfa";

        // insertPayment / upsertBalanceDelta are shared wrapper objects used
        // by several call sites below. Wrapped (rather than threading
        // tenant_id through every call site) so the existing `.run(...)`
        // call sites — all money-flow control logic, untouched — transparently
        // carry the current tenant. CQ-3: the SQL itself now lives in the
        // shared moneyPosting helpers, called from inside these wrappers —
        // every call site below is unchanged.
        const insertPayment = {
          run: (
            transactionId: number,
            method: string,
            drawerName: string,
            currencyCode: string,
            amount: number,
            note: string | null,
            createdBy: number,
          ) =>
            insertPaymentRow(this.db, {
              transactionId,
              method,
              drawerName,
              currencyCode,
              amount,
              note,
              createdBy,
              tenantId,
            }),
        };

        const upsertBalanceDelta = {
          run: (drawerName: string, currencyCode: string, balance: number) =>
            applyDrawerDelta(this.db, {
              drawerName,
              currencyCode,
              delta: balance,
              tenantId,
            }),
        };

        // PFT-R (Partner FOR-Transactions, full-amount model): a "for
        // partner" recharge has NO walk-in customer and takes NO counter
        // cash — the partner owes the FULL price, settled later on the
        // Partners page. Computed before touching any payment legs so the
        // customer-cash step below can be skipped entirely in partner mode.
        const isForPartner = data.partnerMode === "FOR";
        if (isForPartner) {
          assertPartnerIdRequired(data.partnerId);
        }

        // Customer payment (cash-like inflow). Split returned-change (OUT) legs
        // out so the inflow loop and debt calc only see customer-paid (IN) legs.
        const { inLegs: inPayments, outLegs: returnLegs } = partitionLegs(
          data.payments,
        );
        if (isForPartner) {
          // FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §3 slice 2: wire the
          // REAL legacy field. `data.paid_by_method` is read independently
          // by the walk-in single-payment fallback (the `paidBy` local,
          // line ~597) — nothing folds it into `inPayments`, so a stale
          // non-CASH value (e.g. a leftover "CUSTOMER_ACCOUNT" from before
          // the operator ticked the partner checkbox) used to sail through
          // and still get stamped into `metadata_json.paid_by`/
          // `recharges.paid_by` (line ~702) even though nothing executed —
          // the same audit-trail gap LIRA-114 reported for Custom Services.
          // Safe to pass unconditionally: no FOR-partner recharge caller
          // (TelecomForm.tsx's `handleForPartnerSubmit`) ever sends
          // `paid_by_method` at all — this branch takes the full price
          // straight to `partner_ledger` with no drawer leg of any kind, so
          // there is no legitimate disbursement-source concept here (unlike
          // Financial Services' transfer SEND); any non-CASH value reaching
          // this point is dead data.
          assertNoCounterPayment(
            inPayments.length > 0,
            data.paid_by_method,
            "recharge",
          );
        }
        const deferPayment = data.deferPayment === true;

        // CARRIER_LINES_VALIDITY_PLAN.md Phase 7 — backend guard, not
        // frontend inspection. `paid_by_method: "MULTI"` is ONLY ever a
        // truthful value when the caller actually split the payment into
        // 2+ legs (Recharge/index.tsx's `derivePaidByMethod`, mirroring the
        // crypto/FinancialForm/KatchForm pattern) — it is never a real
        // payment method. If `inPayments` is empty despite `paidBy ===
        // "MULTI"` (a REST caller whose `payments[]` got stripped/omitted,
        // or any other caller that lies about having split), the legacy
        // single-method fallback below would post the WHOLE `data.price`
        // into whatever drawer `paymentMethodToDrawerName("MULTI")`
        // resolves to (General, via the unknown-method fallback) instead of
        // across the real legs — silently wrong, not merely stale. Excludes
        // isForPartner/deferPayment: both legitimately carry zero inPayments
        // by contract (the partner ledger / session basket owns the
        // customer-cash side there), so `paidBy` is irrelevant in those
        // branches regardless of its value.
        if (
          !isForPartner &&
          !deferPayment &&
          paidBy === "MULTI" &&
          inPayments.length === 0
        ) {
          throw new Error(
            "Payment legs are required when paid_by_method is MULTI",
          );
        }

        // S2 hard-reject reconciliation (Payment-Legs Integrity plan): the
        // customer's legs must cover `data.price` — the same total this
        // flow credits to drawers/debt below. No-ops on an empty
        // `data.payments` (legacy single-payment fallback via paid_by_method)
        // or under deferPayment/FOR-partner (neither owns the customer-cash
        // side here — the session basket or the partner ledger does).
        if (!isForPartner && !deferPayment) {
          reconcileLegs({
            inLegs: inPayments,
            outLegs: returnLegs,
            keptChange: {
              usd: data.kept_change_usd,
              lbp: data.kept_change_lbp,
            },
            expectedTotals: expectedTotalIn(data.price, currency),
            exchangeRate: sellRate,
            tenderExchangeRate: data.tender_exchange_rate,
            context: `${data.provider} ${data.type} recharge`,
          });
        }

        let hasDebt = false;
        if (isForPartner) {
          // No customer cash and no debt — the FULL price is booked to the
          // partner below (after the stock/SMS legs), replacing both the
          // cash step and the client debt_ledger step for this transaction.
        } else if (deferPayment) {
          // Session basket owns the customer-cash inflow + debt + change.
          // Only the telecom stock leg (below) is recorded on this transaction.
        } else if (inPayments.length > 0) {
          // Multi-payment mode
          for (const p of inPayments) {
            if (p.method === "GIFT_CARD") {
              // Voucher leg — deposit the voucher's full value to the owner's
              // account; the charge is then consumed from that account as debt.
              getVoucherRepository().redeemByCode({
                code: (p.voucherCode ?? "").trim().toUpperCase(),
                context: "recharge",
                transactionId: txnId,
                userId: createdBy,
                day: data.client_day,
              });
              hasDebt = true;
              continue;
            }
            if (!isDrawerAffectingMethod(p.method)) {
              hasDebt = true;
              continue;
            }
            const drawer = paymentMethodToDrawerName(p.method);
            insertPayment.run(
              txnId,
              p.method,
              drawer,
              p.currencyCode,
              Math.abs(p.amount),
              note,
              createdBy,
            );
            upsertBalanceDelta.run(drawer, p.currencyCode, Math.abs(p.amount));
          }
        } else if (isDrawerAffectingMethod(paidBy)) {
          // Single payment (backwards-compatible)
          insertPayment.run(
            txnId,
            paidBy,
            methodDrawerName,
            currency,
            Math.abs(data.price),
            note,
            createdBy,
          );
          upsertBalanceDelta.run(
            methodDrawerName,
            currency,
            Math.abs(data.price),
          );
        } else {
          hasDebt = true;
        }

        // Telecom balance consumed (shop number stock — always in USD credits).
        // WHICH figure leaves the drawer depends on the type: `data.amount` is
        // USD face value for a credit send, but a DAY COUNT for DAYS — see
        // telecomStockLeg. For DAYS the debit is the operator-submitted cost,
        // inverted to USD at the SAME telecom credit-cost rate the Days tab
        // multiplied by (plan §0.3), never at the USD/LBP sell rate.
        const daysCostUsd =
          data.type === "DAYS"
            ? currency === "LBP"
              ? Math.abs(data.cost) /
                getAlfaCreditCostRateLbp(this.db, tenantId)
              : Math.abs(data.cost)
            : 0;
        const stockLeg = telecomStockLeg({
          type: data.type,
          // Same string as the drawer — the credit-send leg has always been
          // labelled with the carrier (one derivation, not two).
          carrier: providerDrawerName,
          amount: data.amount,
          daysCostUsd,
        });
        if (stockLeg) {
          insertPayment.run(
            txnId,
            stockLeg.method,
            providerDrawerName,
            "USD",
            stockLeg.amountUsd,
            stockLeg.note,
            createdBy,
          );
          upsertBalanceDelta.run(providerDrawerName, "USD", stockLeg.amountUsd);
        }

        // LIRA-113 (owner report, 2026-08-08): "charging 10 days to a
        // customer decreases the shop's line validity by exactly 10 days" —
        // a DAYS sale must decrement the shop's OWN carrier line's
        // `validity_expires_at` by the days sold, not just consume the
        // credit-cost drawer leg above. Gated to DAYS only — every other
        // `RechargeData.type` sends USD credit face value and never touches
        // validity (see `telecomStockLeg`'s doc).
        //
        // Reuses `CarrierLineService.applyMovement` → the ONE validity rule
        // in `utils/carrierLineValidity.ts` (rule 14, no second date
        // computation) with a NEGATIVE `validityDaysDelta`.
        //
        // LIRA-157 — a negative delta is a CONSUMPTION record, and the rule
        // treats it accordingly: it subtracts from the line's OWN expiry and
        // is never refused, so neither the 5-day revival grace nor the
        // burned-line block applies here. Selling days must always be
        // recordable; only CHARGING a dead line is refused.
        //
        // This is a deliberate behaviour change from the pre-LIRA-157 code,
        // which rebased every lapsed line onto `max(today, current_expiry)`
        // first: selling 10 days off a line 22 days dead used to store
        // `today − 10`, reporting it as LESS expired than it really was.
        // Still-valid lines (the normal case) are unaffected — they always
        // subtracted from their own expiry. No new timezone surface either:
        // `localDay()` remains the only "what day is it" call in the path.
        //
        // Tied to `txnId`, so void/refund's type-agnostic
        // `TransactionRepository._reverseCarrierLineMovements` restores
        // `validity_expires_at` from `previous_validity_expires_at` verbatim
        // (rule 20) — no new reversal code needed. Mirrors
        // `FinancialServiceRepository.processTelecomCreditReturn`'s
        // established convention: missing primary line logs a warning and
        // skips the informational side effect rather than failing the sale
        // (the credits leg above has already posted).
        //
        // Every real schema (create_db.sql, every migrated app db) has
        // `carrier_lines`/`carrier_line_movements` — LIRA-090 (v140) creates
        // them together, unconditionally. The missing-PRIMARY-LINE case
        // below is the only legitimate runtime skip (mirrors
        // `FinancialServiceRepository.processTelecomCreditReturn`'s
        // established convention): a shop that hasn't configured a primary
        // line for this carrier yet, not a missing table.
        if (data.type === "DAYS") {
          const carrier: CarrierKey = data.provider === "MTC" ? "mtc" : "alfa";
          const primaryLine = getCarrierLineRepository().getPrimary(carrier);
          if (primaryLine) {
            const validityMovement = getCarrierLineService().applyMovement({
              carrierLineId: primaryLine.id,
              validityDaysDelta: -Math.abs(data.amount),
              reason: "DAYS_SALE",
              transactionId: txnId,
              today: data.client_day,
            });
            if (!validityMovement.success) {
              throw new Error(
                `Failed to apply carrier line movement: ${validityMovement.error}`,
              );
            }
          } else {
            rechargeLogger.warn(
              { carrier },
              "processRecharge(DAYS): no primary carrier line configured — validity decrement skipped",
            );
          }
        }

        // SMS transfer fee: each CREDIT_TRANSFER requires SMSes to send
        // credits. Owner decision 2026-09-06 — this no longer posts as a
        // payment leg on THIS transaction (which used to net it invisibly
        // out of recharge profit); it books as its own `SMS_Transfer_Fee`
        // expense via `ExpenseRepository.createExpense`, the SAME LIRA-145
        // Line_Usage precedent (rule 14: reuse the one EXPENSE writer, don't
        // hand-roll a second one). `drawer_override` still moves exactly the
        // SAME provider drawer, currency and magnitude the removed
        // `insertPayment`/`upsertBalanceDelta` pair used to — the money
        // moves exactly ONCE, just through the expense's own leg instead of
        // this transaction's. `source_ref_table`/`source_ref_id` (migration
        // v166) link this expense back to the recharge so
        // `TransactionRepository._cascadeExpenseSiblingVoid` reverses it
        // when the recharge is voided/refunded (rule 20).
        if (data.type === "CREDIT_TRANSFER" && smsCostUsd > 0) {
          getExpenseRepository().createExpense(
            {
              description: `SMS cost: ${smsCount} × $${SMS_TRANSFER_FEE_USD} (${data.provider} ${detail})`,
              category: SMS_TRANSFER_EXPENSE_CATEGORY,
              paid_by_method: SMS_TRANSFER_EXPENSE_PAID_BY_METHOD,
              amount_usd: smsCostUsd,
              amount_lbp: 0,
              expense_date: data.transaction_time ?? new Date().toISOString(),
              transaction_time: data.transaction_time,
              drawer_override: {
                drawer_name: providerDrawerName,
                currency_code: "USD",
              },
              source_ref_table: "recharges",
              source_ref_id: rechargeId,
              extra_metadata: {
                recharge_id: rechargeId,
                sms_count: smsCount,
                sms_fee_usd: SMS_TRANSFER_FEE_USD,
              },
            },
            createdBy,
          );
        }

        // PFT-R (Partner FOR-Transactions, full-amount model): routing is
        // mutually exclusive. In partner mode the FULL price books to
        // partner_ledger (FOR_RECHARGE DEBIT) against data.partnerId — never
        // a remainder, and never the client's debt_ledger.
        if (isForPartner) {
          getPartnerRepository().addLedgerEntry({
            partner_id: data.partnerId as number,
            transaction_type: "FOR_RECHARGE",
            reference_table: "recharges",
            reference_id: rechargeId,
            amount: Math.abs(data.price),
            currency,
            direction: "DEBIT",
            user_id: createdBy,
            notes: note,
          });
        } else if (hasDebt) {
          // Debt: create ledger entry when paid by DEBT
          if (!data.clientId) {
            throw new Error("Cannot create debt without a client");
          }
          // S7 (Payment-Legs Integrity plan): book PER LEG CURRENCY, never
          // summed across currencies into one column. The pre-fix code
          // summed every non-drawer-affecting leg's `amount` regardless of
          // `currencyCode` into a single `debtAmount`, then booked the WHOLE
          // sum under whichever currency column matched the service
          // `currency` — a USD account leg + an LBP account leg (e.g. $5 +
          // 450,000) collapsed into "450,005" and landed entirely in ONE
          // column. Mirrors FinancialServiceRepository's multi-leg Service
          // Debt booking (debtUsd/debtLbp accumulated separately, per leg's
          // OWN currencyCode).
          let debtUsd = 0;
          let debtLbp = 0;
          if (inPayments.length > 0) {
            for (const p of inPayments) {
              if (isDrawerAffectingMethod(p.method)) continue;
              if (p.currencyCode === "USD") debtUsd += Math.abs(p.amount);
              else if (p.currencyCode === "LBP") debtLbp += Math.abs(p.amount);
            }
          } else {
            // Single payment (backwards-compatible): the whole price is on
            // account, in the recharge's own service currency.
            if (currency === "USD") debtUsd = data.price;
            else if (currency === "LBP") debtLbp = data.price;
          }
          bookClientDebtCharge(this.db, {
            clientId: data.clientId,
            transactionType: "Recharge Debt",
            amountUsd: debtUsd,
            amountLbp: debtLbp,
            transactionId: txnId,
            note,
            createdBy,
            tenantId,
          });
        }

        // Return (OUT) legs: change handed back via a chosen method or kept as
        // store credit. Debits the method's drawer, or deposits client credit.
        // Deferred (session basket): change is owned by the basket recorder.
        // Partner mode: no counter cash was ever taken, so there is no
        // change to return either.
        for (const r of deferPayment || isForPartner ? [] : returnLegs) {
          const amt = Math.abs(r.amount);
          if (amt <= 0) continue;
          if (r.method === "CUSTOMER_ACCOUNT") {
            if (!data.clientId) {
              throw new Error(
                "Client is required to return change as store credit",
              );
            }
            getDebtService().addCredit({
              clientId: data.clientId,
              amountUsd: r.currencyCode === "USD" ? amt : 0,
              amountLbp: r.currencyCode === "LBP" ? amt : 0,
              note: "Change returned",
              userId: createdBy,
              transactionId: txnId,
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
              createdBy,
            );
            upsertBalanceDelta.run(drawer, r.currencyCode, -amt);
          }
        }

        return rechargeId;
      })();

      rechargeLogger.info(
        {
          id: result,
          provider: data.provider,
          type: data.type,
          amount: data.amount,
          price: data.price,
          paidBy: data.paid_by_method || "CASH",
        },
        `${data.provider} ${data.type}: ${data.amount} credits @ ${data.price.toLocaleString()} ${data.currency ?? "USD"}`,
      );

      return { success: true, id: result };
    } catch (error) {
      rechargeLogger.error({ error, data }, "Recharge failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Telecom credit buy-back (CARRIER_LINES_VALIDITY_PLAN.md Phase 6, D7/D8):
   * a customer hands the shop MTC/Alfa credits — detected because they typed
   * the shop's OWN carrier line's phone number into the Credit tab — and the
   * shop pays them cash. The reverse of a normal sale: credits IN (to the
   * shop's line), cash OUT (from a real drawer, via ordinary payout legs).
   *
   * `data.amount` is reused as the credits gained (USD face value, matching
   * every other type's convention — see {@link telecomStockLeg}'s doc).
   * `data.price` is reused as the total cash paid out, in `data.currency`.
   * Neither `data.cost` nor `data.default_price_to_client` is meaningful
   * here.
   *
   * Money movement (mirrors the retired `topUpFromCustomer` modal arm's
   * profit shape — profit = credits gained − cash paid — but routes the cash
   * leg through plain `paymentMethodToDrawerName` rather than always
   * debiting General: MTC/Alfa are never the shop's primary cash system, so
   * `resolveServiceCashDrawer`'s PCD rerouting never applies here):
   *   - `getPrimary(carrier)` gains `credits` — a `carrier_line_movements`
   *     row, reason `CREDIT_BUYBACK`, `validityDaysDelta: 0` (D9 — a
   *     buy-back never touches validity; that only happens via an iPick/
   *     Katsh self-charge).
   *
   *     OWNER-CONFIRMED 2026-08-11 (LIRA-113): D9 stands for credit buy-back
   *     — permanently, and by the owner's OWN decision, not merely an
   *     agent's inference. The owner's 2026-08-10 LIRA-113 note ("that rule
   *     was written before adding a validity and a shop line to the shop...
   *     credits and validity days should be reduced" when charging a client
   *     phone days) read, on first pass, as a possible revocation of D9's
   *     *general* premise. An agent's investigation narrowed that to the
   *     DAYS-sale gap only (`processRecharge`'s `DAYS` arm, fixed by this
   *     same ticket, see the block above the SMS-cost deduction below), on
   *     four independent grounds: (1) this method is reachable ONLY when
   *     `rechargeType === "CREDIT_TRANSFER"` and the typed phone matches the
   *     shop's own line (`Recharge/index.tsx`'s `isBuyback`,
   *     `TelecomForm.tsx`'s `isCreditBuyback`) — the Days tab's OWN
   *     shop-line match instead renders a block-and-redirect notice
   *     (`ShopLineRedirectNotice`) and refuses to submit at all, proven by
   *     `Recharge.telecomPhoneNumberTabSwitch.test.tsx`; (2) `data.amount`
   *     here is documented above as USD credit face value, not a day count —
   *     there is no "days sold" figure in this flow's input to subtract at
   *     all; (3) `RechargeRepository.creditBuyback.test.ts` already asserts
   *     `validityDaysDelta === 0` and validity untouched as a passing,
   *     unmodified test — changing this zero would break it, and that
   *     ticket's brief authorized editing only the 3 LIRA-113 red tests.
   *     The owner was then asked directly, and confirmed explicitly:
   *     "days sale only" — only the DAYS-tab sale reduces the shop line's
   *     credits AND validity; credit buy-back reduces credits only, exactly
   *     as D9 always said. D9 is settled for this method by the owner's own
   *     ruling — this is not an open question for the next reader to
   *     re-derive or revisit.
   *   - The provider drawer is then set to `getCarrierCreditsSum(carrier)`
   *     (§0.1) — posted as the DIFFERENCE from its current balance, as an
   *     ordinary auditable `payments` row, so §0.6's "a NEW path does not
   *     get the grandfather exemption" holds from day one, even if the
   *     drawer had already drifted from the line sum before this ran.
   *   - Cash pays out via the shared `postPayoutLegs` (moneyPosting.ts) —
   *     ordinary IN legs with no `direction` key (D7): a payout is NOT the
   *     `direction: "OUT"` change-leg marker (this method has no
   *     end-of-transaction return-leg loop for it to collide with).
   *
   * Reversible (D8, deliberately NOT in `NON_REVERSIBLE_TRANSACTION_TYPES`):
   * `_reversePayments` (the drawer-delta leg and every payout leg),
   * `_reverseCarrierLineMovements` (the credits gain), and `_cancelDebt`'s
   * widened `CREDIT_DEPOSIT` scan (a CUSTOMER_ACCOUNT payout leg) between
   * them net every ledger back to its pre-transaction value.
   */
  processCreditBuyback(data: RechargeData): {
    success: boolean;
    id?: number;
    error?: string;
  } {
    try {
      if (!data.payments || data.payments.length === 0) {
        return {
          success: false,
          error: "Payment legs are required for a credit buy-back payout",
        };
      }

      const { inLegs: payoutLegs, outLegs } = partitionLegs(data.payments);
      if (outLegs.length > 0) {
        return {
          success: false,
          error:
            "A credit buy-back accepts payout legs only — direction:'OUT' legs are not supported here",
        };
      }

      const credits = Math.abs(data.amount);
      if (!(credits > 0)) {
        return {
          success: false,
          error: "Credits amount must be greater than 0",
        };
      }

      const carrier: CarrierKey = data.provider === "MTC" ? "mtc" : "alfa";
      const providerDrawerName = TOP_UP_PROVIDER_DRAWERS[data.provider];
      const carrierLineRepo = getCarrierLineRepository();
      const primaryLine = carrierLineRepo.getPrimary(carrier);
      if (!primaryLine) {
        return {
          success: false,
          error: `No active ${data.provider} line to buy back credits into`,
        };
      }
      // Backend re-validation (rule 14 — the REST route is directly
      // callable, so a client-computed "this is a buy-back" flag alone
      // cannot be trusted): if a phone number was submitted, it must
      // actually be the shop's own line. Omitted entirely → the explicit
      // `type: "CREDIT_BUYBACK"` the operator chose is the authoritative
      // signal, same as every other recharge type.
      if (
        data.phoneNumber &&
        !isSameLebanesePhone(data.phoneNumber, primaryLine.phone_number)
      ) {
        return {
          success: false,
          error: `Phone number does not match the shop's own ${data.provider} line — a buy-back must be against the shop's own line`,
        };
      }

      const payoutAmount = Math.abs(data.price);
      const currency = data.currency ?? "USD";
      const createdBy = data.userId ?? 1;
      const tenantId = getCurrentTenantId();
      const sellRate = getUsdLbpSellRate(this.db);
      // Owner decision (2026-08-08, repro: buy 89,000 vs. sell 90,000): the
      // `transactions.exchange_rate` stamp reflects the operator's tendered
      // rate when it's within the reconciliation band of `sellRate` (see
      // `resolveStampedExchangeRate`'s doc on `RechargeData.
      // tender_exchange_rate`); falls back to `sellRate` silently otherwise.
      // `postPayoutLegs` below keeps anchoring at `sellRate` — unaffected.
      const recordExchangeRate = resolveStampedExchangeRate(
        sellRate,
        data.tender_exchange_rate,
      );
      const paidByLabel =
        payoutLegs.length > 1 ? "MULTI" : payoutLegs[0]?.method || "CASH";

      const result = this.db.transaction(() => {
        const clientName = data.clientId
          ? ((
              this.db
                .prepare(
                  "SELECT full_name FROM clients WHERE id = ? AND tenant_id = ?",
                )
                .get(data.clientId, tenantId) as
                | { full_name: string }
                | undefined
            )?.full_name ??
            data.clientName ??
            null)
          : (data.clientName ?? null);

        const note = `${data.provider} credit buy-back${data.phoneNumber ? ` - ${data.phoneNumber}` : ""}`;

        const insertRecharge = this.db.prepare(`
          INSERT INTO recharges (
            carrier, recharge_type, amount, cost, price, default_price_to_client, currency_code,
            paid_by, phone_number, client_id, client_name, note, created_by, tenant_id, created_at
          ) VALUES (?, 'CREDIT_BUYBACK', ?, 0, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
        `);
        const rechargeResult = insertRecharge.run(
          data.provider,
          credits,
          payoutAmount,
          currency,
          paidByLabel,
          data.phoneNumber || null,
          data.clientId || null,
          clientName,
          note,
          createdBy,
          tenantId,
          data.transaction_time ?? null,
        );
        const rechargeId = Number(rechargeResult.lastInsertRowid);

        const payoutUsd = usdEquivalent(
          currency === "USD" ? payoutAmount : 0,
          currency === "LBP" ? payoutAmount : 0,
          sellRate,
        );

        const txnId = getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.TELECOM_CREDIT_BUYBACK,
          source_table: "recharges",
          source_id: rechargeId,
          user_id: createdBy,
          amount_usd: currency === "USD" ? payoutAmount : 0,
          amount_lbp: currency === "LBP" ? payoutAmount : 0,
          // Profit = credits gained − cash paid (USD-equivalent) — the same
          // spread the retired topUpFromCustomer modal arm booked. Tracked
          // in USD only (credits are always a USD figure), mirroring that
          // arm's own convention.
          profit_usd: credits - payoutUsd,
          profit_lbp: 0,
          client_id: data.clientId ?? null,
          client_name: clientName,
          summary: `Credit buy-back: ${data.provider} +$${credits} credits — ${currency === "LBP" ? "" : "$"}${payoutAmount.toLocaleString()} ${currency} paid out`,
          metadata_json: {
            provider: data.provider,
            type: "CREDIT_BUYBACK",
            credits,
            payoutAmount,
            currency,
            phone: data.phoneNumber,
          },
          exchange_rate: recordExchangeRate,
          transaction_time: data.transaction_time,
        });

        // Cash payout — ordinary IN legs, no `direction` key (D7). No
        // drawer-sufficiency guard, by design (FEATURE_GUIDE §7 / plan
        // Phase 6) — the PCD/General may go negative.
        postPayoutLegs({
          db: this.db,
          legs: payoutLegs,
          payoutAmount,
          currency,
          exchangeRate: sellRate,
          tenderExchangeRate: data.tender_exchange_rate,
          context: `${data.provider} credit buy-back`,
          txnId,
          tenantId,
          createdBy,
          resolveDrawer: (method) => paymentMethodToDrawerName(method),
          note: `Cash paid to customer (${data.provider} credit buy-back)`,
          onCustomerAccountLeg: (usd, lbp) => {
            if (!data.clientId) {
              throw new Error(
                "Client is required for CUSTOMER_ACCOUNT cashout",
              );
            }
            getDebtService().addCredit({
              clientId: data.clientId,
              amountUsd: usd,
              amountLbp: lbp,
              note: `${data.provider} credit buy-back — credited to account`,
              userId: createdBy,
              transactionId: txnId,
            });
          },
        });

        // Credit the shop's own line — D9: credits only, validity never
        // moves. Established call convention (mirrors
        // FinancialServiceRepository.selfChargeTelecomItem): repository for
        // reads (getPrimary, above), service for the paired write. D9
        // stands here, permanently, by the owner's OWN 2026-08-11 decision:
        // asked directly whether LIRA-113's "credits and validity days
        // should be reduced" note extended to credit buy-back too, the
        // owner answered "days sale only" — see the "OWNER-CONFIRMED
        // 2026-08-11" paragraph on this method's own doc comment above for
        // the full evidence trail.
        const movement = getCarrierLineService().applyMovement({
          carrierLineId: primaryLine.id,
          creditsDelta: credits,
          validityDaysDelta: 0,
          reason: "CREDIT_BUYBACK",
          transactionId: txnId,
          today: data.client_day,
        });
        if (!movement.success) {
          throw new Error(
            `Failed to apply carrier line movement: ${movement.error}`,
          );
        }

        // §0.1/§0.6: the drawer follows the line SUM, never the reverse — a
        // NEW path (this one) does not get the grandfather exemption. Post
        // the DIFFERENCE from the drawer's CURRENT balance as an ordinary
        // leg, so drawer == Σ(active lines) holds after this transaction
        // even if the drawer had already drifted from it beforehand.
        const currentDrawerRow = this.db
          .prepare(
            `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = 'USD' AND tenant_id = ?`,
          )
          .get(providerDrawerName, tenantId) as { balance: number } | undefined;
        const currentDrawerBalance = currentDrawerRow?.balance ?? 0;
        const targetSum = carrierLineRepo.getCarrierCreditsSum(carrier);
        const drawerDelta = targetSum - currentDrawerBalance;
        if (drawerDelta !== 0) {
          insertPaymentRow(this.db, {
            transactionId: txnId,
            method: providerDrawerName,
            drawerName: providerDrawerName,
            currencyCode: "USD",
            amount: drawerDelta,
            note: `Credits received (buy-back): +${credits}`,
            createdBy,
            tenantId,
          });
          applyDrawerDelta(this.db, {
            drawerName: providerDrawerName,
            currencyCode: "USD",
            delta: drawerDelta,
            tenantId,
          });
        }

        return rechargeId;
      })();

      rechargeLogger.info(
        {
          id: result,
          provider: data.provider,
          credits,
          payoutAmount,
          currency,
        },
        `${data.provider} credit buy-back: +${credits} credits, -${payoutAmount} ${currency} cash`,
      );

      return { success: true, id: result };
    } catch (error) {
      rechargeLogger.error({ error, data }, "Credit buy-back failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Top up a Katsh, iPick, or OMT App provider drawer via supplier credit.
   * The supplier extends credit — no source drawer is deducted.
   * Records a TOP_UP entry in supplier_ledger (we now owe the supplier).
   *
   * LIRA-190 (OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §1 D2/D4, §5): `"OMT_APP"`
   * widened onto this existing iPick/Katsh mechanism unchanged — the
   * behaviour this method already had (no source drawer touched, dest
   * drawer up, `TOP_UP` debt booked on the supplier found by
   * `getByProvider(data.provider)`) is exactly D2's rule for the OMT App
   * wallet too. `getByProvider("OMT_APP")` resolves the `'OMT App'`
   * supplier row (`create_db.sql`'s system-supplier seed), which
   * LIRA-187's migration parents under `'OMT'` — so this booking lands in
   * the OMT open-credit account automatically, with zero new code here.
   */
  topUpFromSupplier(data: {
    provider: "iPick" | "Katsh" | "OMT_APP";
    amount: number;
    currency: string;
    userId: number;
  }): { success: boolean; error?: string } {
    try {
      const destDrawer = TOP_UP_PROVIDER_DRAWERS[data.provider];
      const currency = data.currency;
      const amount = Math.abs(data.amount);
      const amountLabel = formatMoneyAmount(amount, currency);
      const tenantId = getCurrentTenantId();

      // Find matching active supplier for this provider
      const supplier = getSupplierRepository().getByProvider(data.provider);

      this.db.transaction(() => {
        // Insert TOP_UP recharge record (no paid_by drawer — funded by supplier)
        const rechargeResult = this.db
          .prepare(
            `INSERT INTO recharges (carrier, recharge_type, amount, cost, price, currency_code, paid_by, note, created_by, tenant_id)
             VALUES (?, 'TOP_UP', ?, 0, 0, ?, 'SUPPLIER', ?, ?, ?)`,
          )
          .run(
            data.provider,
            amount,
            currency,
            `${TOP_UP_PROVIDER_LABELS[data.provider]} supplier top-up: +${amountLabel}`,
            data.userId,
            tenantId,
          );

        const rechargeId = Number(rechargeResult.lastInsertRowid);

        // Create unified transaction record
        const txnId = getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.RECHARGE_TOPUP,
          source_table: "recharges",
          source_id: rechargeId,
          user_id: data.userId,
          amount_usd: currency === "USD" ? amount : 0,
          amount_lbp: currency === "LBP" ? amount : 0,
          summary: `${TOP_UP_PROVIDER_LABELS[data.provider]} supplier top-up → ${destDrawer}: ${amountLabel}`,
          metadata_json: {
            provider: data.provider,
            amount,
            currency,
            sourceDrawer: "SUPPLIER",
            destDrawer,
          },
        });

        // Record supplier ledger TOP_UP entry (liability — we now owe the
        // supplier). CQ-7: routed through addLedgerEntry's link-mode instead
        // of a raw INSERT — same entry_type/amounts/note/is_auto(=0) as
        // before, plus the RECHARGE_TOPUP transaction_id link the raw INSERT
        // never stamped.
        if (supplier) {
          getSupplierRepository().addLedgerEntry({
            supplier_id: supplier.id,
            entry_type: "TOP_UP",
            amount_usd: currency === "USD" ? amount : 0,
            amount_lbp: currency === "LBP" ? amount : 0,
            note: `${TOP_UP_PROVIDER_LABELS[data.provider]} supplier top-up: +${amountLabel}`,
            created_by: data.userId,
            transaction_id: txnId,
          });
        }

        // Increase the provider drawer balance — a REAL `payments` row
        // (rule 20/LIRA-194), not a bare `applyDrawerDelta`, so the generic
        // void path (`_reversePayments`) can restore it later. The
        // `supplier_ledger` TOP_UP row above is link-mode (`transaction_id`),
        // not an `is_auto`/`source_ref_*` sibling, so it needs its OWN
        // reversal owner — see `TransactionRepository
        // ._reverseSupplierLedgerByTransactionLink`.
        insertPaymentRow(this.db, {
          transactionId: txnId,
          method: destDrawer,
          drawerName: destDrawer,
          currencyCode: currency,
          amount,
          note: `${TOP_UP_PROVIDER_LABELS[data.provider]} supplier top-up: +${amountLabel}`,
          createdBy: data.userId,
          tenantId,
        });
        applyDrawerDelta(this.db, {
          drawerName: destDrawer,
          currencyCode: currency,
          delta: amount,
          tenantId,
        });
      })();

      rechargeLogger.info(
        {
          provider: data.provider,
          amount,
          currency,
          destDrawer,
          supplierId: supplier?.id ?? null,
        },
        `${TOP_UP_PROVIDER_LABELS[data.provider]} supplier top-up → ${destDrawer}: ${amountLabel}`,
      );

      return { success: true };
    } catch (error) {
      rechargeLogger.error({ error, data }, "Supplier top-up failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * "Cash Out to OMT" (LIRA-192, OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §8) — the
   * mirror of {@link topUpFromSupplier}'s OMT App credit path, opposite
   * sign: value leaves the `OMT_App` drawer and the OMT open-credit account
   * is credited principal + a 0.1% commission
   * (`constants/omtAppCashout.ts`). No physical cash moves either way (D2).
   *
   * D16: OMT App only, for now — the `provider` union is a single literal
   * on purpose so a future iPick/Katsh cashout is a deliberate widening,
   * not a silent fallthrough.
   *
   * Money movement, all inside ONE `db.transaction()`:
   *   1. D15 — reject an over-draw of the `OMT_App` balance for this
   *      currency BEFORE opening the transaction. This is the one place a
   *      balance guard belongs (unlike the PCD, which may go negative —
   *      FEATURE_GUIDE.md §7): the wallet is a prepaid balance OMT actually
   *      holds.
   *   2. `commission = omtAppCashoutCommission(amount, currency)` — the
   *      shared helper, never a re-spelled rate at this call site.
   *   3. Insert a `recharges` row exactly like `topUpFromSupplier`'s own
   *      INSERT shape, so the existing `source_table: "recharges"`
   *      soft-void path already covers it. `recharge_type` stays `'TOP_UP'`
   *      — the column's CHECK enum (`create_db.sql`) has no cashout-shaped
   *      value and widening it is a schema change outside this lane; the
   *      row's `note` and the unified transaction's own `WALLET_CASHOUT`
   *      type are what actually distinguish it.
   *   4. Unified transaction, type `WALLET_CASHOUT`, `source_table:
   *      "recharges"`. `profit_usd`/`profit_lbp` are stamped 0 — D14: the
   *      commission is RECOGNISED at OMT account settlement (LIRA-189,
   *      wave 2), not here. The computed commission is still stored (in
   *      `metadata_json.commission` — `transactions`/`recharges` have no
   *      dedicated commission COLUMN; see this repo's existing
   *      `json_extract(metadata_json, ...)` precedent in
   *      `TransactionRepository`/migrations) so LIRA-189's settlement stamp
   *      can sum it later without re-deriving it.
   *   5. The wallet leg is written as a REAL `payments` row (rule 20) — NOT
   *      a bare drawer UPDATE — via `insertPaymentRow` +
   *      `applyDrawerDelta`, the same pair `topUpFromSupplier` uses, so the
   *      generic type-agnostic `_reversePayments` can restore it on void.
   *   6. ONE `supplier_ledger` row on the `'OMT App'` supplier via
   *      `addLedgerEntry`, `entry_type: "PAYMENT"` — NOT
   *      `SUPPLIER_PAYS_US`, which is POSITIVE and would move the account
   *      the WRONG way by the full amount (plan §9.2; `addLedgerEntry`
   *      force-negates every PAYMENT row, `SupplierRepository.ts:691-697`).
   *      `is_auto: true` with `source_ref_table: "recharges"` /
   *      `source_ref_id: <recharges id>` (NOT link-mode / `transaction_id`
   *      — the two are mutually exclusive, and this row is a sibling of the
   *      WALLET_CASHOUT transaction, not sharing it) so the existing
   *      source-ref cascade-void can find and negate it. No `drawer_name`
   *      is passed: the wallet leg already lives on our own transaction
   *      (step 5), and `addLedgerEntry` only ever consumes `drawer_name` on
   *      its own PAYMENT+drawer branch — passing it here would move the
   *      `OMT_App` drawer a SECOND time.
   *
   * Reversal (rule 20): create + void must net the `OMT_App` drawer, the
   * `'OMT App'` ledger, the OMT account, and profit to exactly 0 per
   * currency. This method only writes the rows; wiring/verifying the void
   * cascade for `WALLET_CASHOUT` and the `recharges` source-ref sibling is
   * `TransactionRepository`'s lane (L4) — see this ticket's
   * CROSS_LANE_REQUESTS.
   */
  cashoutToSupplier(data: {
    provider: "OMT_APP";
    amount: number;
    currency: string;
    userId: number;
  }): { success: boolean; error?: string; commission?: number } {
    try {
      if (data.provider !== "OMT_APP") {
        return {
          success: false,
          error: `Unsupported cashout provider: ${String(data.provider)}`,
        };
      }

      const destDrawer = TOP_UP_PROVIDER_DRAWERS[data.provider];
      const currency = data.currency;
      const amount = Math.abs(data.amount);
      if (!(amount > 0)) {
        return { success: false, error: "Amount must be greater than 0" };
      }
      const amountLabel = formatMoneyAmount(amount, currency);
      const tenantId = getCurrentTenantId();

      // D15 — block an over-draw of the wallet balance, per currency.
      // Checked BEFORE opening the db.transaction() so a rejected cashout
      // writes nothing at all.
      const walletBalanceRow = this.db
        .prepare(
          "SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ? AND tenant_id = ?",
        )
        .get(destDrawer, currency, tenantId) as
        | { balance: number | null }
        | undefined;
      const walletBalance = walletBalanceRow?.balance ?? 0;
      if (walletBalance < amount) {
        return {
          success: false,
          error: `Insufficient balance in ${destDrawer}. Available: ${walletBalance} ${currency}`,
        };
      }

      const supplier = getSupplierRepository().getByProvider(data.provider);
      const commission = omtAppCashoutCommission(amount, currency);
      const creditedLabel = formatMoneyAmount(amount + commission, currency);

      this.db.transaction(() => {
        // Insert a TOP_UP-shaped recharges record (see doc comment §3) —
        // no `paid_by` drawer in the sense of a customer payment; `paid_by`
        // instead names the drawer this cashout actually debited, mirroring
        // `topUpApp`'s convention of stamping the real source drawer there.
        const rechargeResult = this.db
          .prepare(
            `INSERT INTO recharges (carrier, recharge_type, amount, cost, price, currency_code, paid_by, note, created_by, tenant_id)
             VALUES (?, 'TOP_UP', ?, 0, 0, ?, ?, ?, ?, ?)`,
          )
          .run(
            data.provider,
            amount,
            currency,
            destDrawer,
            `Cash Out to OMT: -${amountLabel} (OMT account credited ${creditedLabel}, incl. ${formatMoneyAmount(commission, currency)} commission)`,
            data.userId,
            tenantId,
          );

        const rechargeId = Number(rechargeResult.lastInsertRowid);

        // Unified transaction record. profit_* = 0 at creation (D14) — the
        // commission is recognised at OMT account settlement (LIRA-189),
        // not here; a future reader must not "fix" this to stamp profit
        // immediately.
        const txnId = getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.WALLET_CASHOUT,
          source_table: "recharges",
          source_id: rechargeId,
          user_id: data.userId,
          amount_usd: currency === "USD" ? amount : 0,
          amount_lbp: currency === "LBP" ? amount : 0,
          profit_usd: 0,
          profit_lbp: 0,
          summary: `Cash Out to OMT: ${destDrawer} -${amountLabel} → OMT account +${creditedLabel}`,
          metadata_json: {
            provider: data.provider,
            amount,
            commission,
            currency,
            destDrawer,
          },
        });

        // Wallet leg: OMT_App -amount, as a REAL payments row (rule 20) —
        // not a bare drawer UPDATE — so the generic void path can restore
        // it later.
        insertPaymentRow(this.db, {
          transactionId: txnId,
          method: destDrawer,
          drawerName: destDrawer,
          currencyCode: currency,
          amount: -amount,
          note: `Cash Out to OMT: -${amountLabel}`,
          createdBy: data.userId,
          tenantId,
        });
        applyDrawerDelta(this.db, {
          drawerName: destDrawer,
          currencyCode: currency,
          delta: -amount,
          tenantId,
        });

        // Account ledger: 'OMT App' now owes the shop principal + commission
        // (entry_type PAYMENT, force-negated by addLedgerEntry — see this
        // method's doc comment on why NOT SUPPLIER_PAYS_US). source-ref
        // (not link-mode) so the sibling row is a separate, auto-generated
        // transaction the existing cascade-void can find via
        // source_ref_table/source_ref_id when the WALLET_CASHOUT
        // transaction above is voided.
        if (supplier) {
          getSupplierRepository().addLedgerEntry({
            supplier_id: supplier.id,
            entry_type: "PAYMENT",
            amount_usd: currency === "USD" ? amount + commission : 0,
            amount_lbp: currency === "LBP" ? amount + commission : 0,
            note: `Cash Out to OMT: ${amountLabel} + ${formatMoneyAmount(commission, currency)} commission`,
            created_by: data.userId,
            is_auto: true,
            source_ref_table: "recharges",
            source_ref_id: rechargeId,
          });
        } else {
          // Mirrors topUpFromSupplier's own established convention: a
          // missing 'OMT App' supplier row (a minimal/pre-seed fixture)
          // logs and skips the ledger side rather than failing the whole
          // wallet movement.
          rechargeLogger.warn(
            { provider: data.provider },
            "cashoutToSupplier: no 'OMT App' supplier found — account ledger entry skipped",
          );
        }
      })();

      rechargeLogger.info(
        {
          provider: data.provider,
          amount,
          currency,
          commission,
          destDrawer,
          supplierId: supplier?.id ?? null,
        },
        `Cash Out to OMT: ${destDrawer} -${amountLabel} → OMT account +${creditedLabel}`,
      );

      return { success: true, commission };
    } catch (error) {
      rechargeLogger.error({ error, data }, "OMT App cash-out failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Top up the Whish App drawer via a partner.
   * The partner extends credit — no source drawer is deducted.
   * Records a WHISH_TOPUP partner_ledger entry with direction CREDIT
   * (we now owe the partner).
   */
  topUpFromPartner(data: {
    provider: "WHISH_APP";
    partnerId: number;
    amount: number;
    currency: string;
    userId: number;
  }): { success: boolean; error?: string } {
    try {
      const destDrawer = TOP_UP_PROVIDER_DRAWERS[data.provider];
      const currency = data.currency;
      const amount = Math.abs(data.amount);
      const amountLabel = formatMoneyAmount(amount, currency);
      const tenantId = getCurrentTenantId();

      // Validate the partner exists and is active
      const partner = this.db
        .prepare(
          "SELECT id FROM partners WHERE id = ? AND is_active = 1 AND tenant_id = ?",
        )
        .get(data.partnerId, tenantId) as { id: number } | undefined;
      if (!partner) {
        return { success: false, error: "Partner not found" };
      }

      this.db.transaction(() => {
        // Insert TOP_UP recharge record (funded by partner)
        const rechargeResult = this.db
          .prepare(
            `INSERT INTO recharges (carrier, recharge_type, amount, cost, price, currency_code, paid_by, note, created_by, tenant_id)
             VALUES ('WHISH_APP', 'TOP_UP', ?, 0, 0, ?, 'PARTNER', ?, ?, ?)`,
          )
          .run(
            amount,
            currency,
            `${TOP_UP_PROVIDER_LABELS[data.provider]} top-up via partner: +${amountLabel}`,
            data.userId,
            tenantId,
          );

        const rechargeId = Number(rechargeResult.lastInsertRowid);

        // Record partner ledger CREDIT entry (we now owe the partner). CQ-7:
        // routed through PartnerRepository.addLedgerEntry instead of a raw
        // INSERT — same transaction_type/reference/amount/currency/direction
        // as before (notes stays unset/NULL, matching the prior column list;
        // no created_at override — the raw INSERT always used
        // CURRENT_TIMESTAMP and this flow has no backdate field). WHISH_TOPUP
        // is neither "SETTLEMENT" nor applyCoverage:true, so addLedgerEntry
        // applies no FIFO coverage here — identical to before.
        getPartnerRepository().addLedgerEntry({
          partner_id: data.partnerId,
          transaction_type: "WHISH_TOPUP",
          reference_table: "recharges",
          reference_id: rechargeId,
          amount,
          currency,
          direction: "CREDIT",
          user_id: data.userId,
        });

        // Create unified transaction record
        const txnId = getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.RECHARGE_TOPUP,
          source_table: "recharges",
          source_id: rechargeId,
          user_id: data.userId,
          amount_usd: currency === "USD" ? amount : 0,
          amount_lbp: currency === "LBP" ? amount : 0,
          summary: `Whish App top-up via partner: +${amountLabel}`,
          metadata_json: {
            provider: data.provider,
            partnerId: data.partnerId,
            amount,
            currency,
            destDrawer,
          },
        });

        // Increase the Whish App drawer balance — a REAL `payments` row
        // (rule 20/LIRA-194), not a bare `applyDrawerDelta`, so the generic
        // void path (`_reversePayments`) can restore it later. The
        // `partner_ledger` WHISH_TOPUP row above already carries
        // `reference_table: "recharges"` / `reference_id: rechargeId`, which
        // the existing type-agnostic `_reversePartnerLedger` already matches
        // — no partner-ledger change needed here.
        insertPaymentRow(this.db, {
          transactionId: txnId,
          method: destDrawer,
          drawerName: destDrawer,
          currencyCode: currency,
          amount,
          note: `Whish App top-up via partner: +${amountLabel}`,
          createdBy: data.userId,
          tenantId,
        });
        applyDrawerDelta(this.db, {
          drawerName: destDrawer,
          currencyCode: currency,
          delta: amount,
          tenantId,
        });
      })();

      rechargeLogger.info(
        {
          provider: data.provider,
          partnerId: data.partnerId,
          amount,
          currency,
          destDrawer,
        },
        `Whish App top-up via partner: +${amountLabel}`,
      );

      return { success: true };
    } catch (error) {
      rechargeLogger.error({ error, data }, "Partner top-up failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Top up the Whish App drawer with credits transferred by a client.
   *
   * Follow-on from the owner's LIRA-194 session (not LIRA-195 — that ticket
   * is a separate, already-archived plan; see docs/plans/done_plans/): the
   * client transfers Whish credits to the shop and is paid out of the
   * shop's OWN drawers via REAL, possibly-split
   * `payments[]` legs (rule 16) — the hand-rolled `cashPaid` scalar + a
   * single hardcoded General-drawer UPDATE this method used before is gone.
   * `amount`/`currency` is what the client handed over; `data.payments` is
   * what the shop pays back OUT. The shop's cut (credits received minus the
   * payout, both expressed in `currency`) is booked as profit at
   * acquisition time, exactly as before.
   *
   * Direction (CLAUDE.md rule 16): this is a money-OUT (payout) flow. Legs
   * carry NO `direction` — undirected is the IN/payout set `partitionLegs`
   * already establishes app-wide. `direction: "OUT"` legs are HARD-REJECTED
   * below: a client top-up payout has no customer tender, so there is no
   * change to hand back — the exact reasoning
   * `SupplierRepository.settleAccount` (LIRA-189) already established for a
   * supplier settlement (FEATURE_GUIDE §13 item 15): the shop either pays
   * out exactly what it owes the client for the credits received, or it
   * doesn't; there is no "customer overpaid, hand back change" concept on a
   * payout with no counter-tender at all.
   *
   * Every payout leg must move a REAL drawer (`isDrawerAffectingMethod`,
   * utils/payments.ts — the SAME predicate `settleAccount`'s own
   * `assertLegMovesADrawer` wraps) — this method's own model text is "the
   * shop pays the client out of its drawers", so a CUSTOMER_ACCOUNT/
   * GIFT_CARD leg (no drawer at all) is rejected outright rather than
   * silently accepted with an unchecked, meaningless "balance". If a future
   * owner decision wants a client to receive store credit instead of cash
   * here, that is a deliberate widening of this guard, not a silent gap.
   */
  topUpFromClient(data: {
    amount: number;
    currency: string;
    payments: Array<{
      method: string;
      currencyCode: string;
      amount: number;
      direction?: "IN" | "OUT";
    }>;
    /** Rate to convert a payout leg whose currency differs from `currency`
     *  at, and to stamp on `transactions.exchange_rate`. Falls back to the
     *  server's USD/LBP sell rate when omitted or outside the band (see
     *  `resolveStampedExchangeRate`). */
    exchangeRate?: number;
    clientName?: string;
    clientId?: number;
    userId: number;
  }): { success: boolean; error?: string } {
    try {
      const destDrawer = TOP_UP_PROVIDER_DRAWERS.WHISH_APP;
      const currency = data.currency;
      const amount = Math.abs(data.amount);
      // `amount` is a credits quantity (no currency label — "credits" already
      // conveys the unit).
      const creditsLabel = amount.toLocaleString();
      const tenantId = getCurrentTenantId();

      if (amount <= 0) {
        return { success: false, error: "Amount must be greater than 0" };
      }

      if (!data.payments || data.payments.length === 0) {
        return {
          success: false,
          error: "Payment legs are required for a client top-up payout",
        };
      }

      // OUT (change/return) legs are rejected outright — see this method's
      // doc comment for the full reasoning (mirrors settleAccount's own
      // blanket ban). `partitionLegs` (utils/payments.ts, rule 16) is the
      // ONE place "which legs are IN vs OUT" is decided.
      const { inLegs: payoutLegs, outLegs } = partitionLegs(data.payments);
      if (outLegs.length > 0) {
        return {
          success: false,
          error:
            "Client top-up payout does not accept OUT (change/return) legs — the client hands over credits and is paid from the shop's drawers; there is no customer tender here to hand change back from",
        };
      }
      if (payoutLegs.length === 0) {
        return {
          success: false,
          error: "Payment legs are required for a client top-up payout",
        };
      }

      // ── ONE predicate for "this leg can pay out a client top-up" ────────
      // Reused by BOTH the reconciliation/balance guard below AND the
      // posting loop inside the transaction (FEATURE_GUIDE §13 item 15b —
      // the exact drift between a guard and a posting loop that has leaked
      // money four times in this codebase). The underlying predicate is
      // `isDrawerAffectingMethod` (utils/payments.ts) — already the shared
      // answer to "does this method move a real drawer" everywhere else
      // (settleAccount, recordSupplierCashflow, postPayoutLegs) — wrapped
      // only for a clearer error message, same shape as settleAccount's own
      // `assertLegMovesADrawer` closure.
      const assertLegMovesADrawer = (method: string): void => {
        if (!isDrawerAffectingMethod(method)) {
          throw new Error(
            `Client top-up payout: payment method "${method}" does not move a real drawer — a client top-up can only be paid out of the shop's own drawers`,
          );
        }
      };

      const sellRate = getUsdLbpSellRate(this.db);
      const recordExchangeRate = resolveStampedExchangeRate(
        sellRate,
        data.exchangeRate,
      );

      // ── Reconcile BEFORE posting (FEATURE_GUIDE §13 item 15a) ───────────
      // Unlike `reconcileLegs`'s exact-equality contract, this is a
      // ONE-SIDED upper bound: paying out LESS than the credits received is
      // fine (the shop just keeps more profit); paying out MORE is a real
      // loss, not a top-up, and is rejected outright. Compared at
      // USD-equivalent (`usdEquivalent`, moneyPosting.ts) so a cross-currency
      // leg (needs `exchangeRate`) and same-currency legs compare on one
      // scale. Tolerance: `LEG_RECONCILIATION_EPSILON_USD` ($0.05
      // USD-equivalent) — moneyPosting.ts's own S2 cross-currency-rounding
      // tolerance, reused rather than inventing a second one (rule 14).
      for (const leg of payoutLegs) {
        assertLegMovesADrawer(leg.method);
      }
      // Reuse moneyPosting's shared per-currency summing helper (rule 14)
      // instead of a hand-rolled loop — it already rejects a non-USD/LBP
      // currency (thrown, not returned; this method's own outer try/catch
      // converts that into the same `{success:false, error}` envelope, with
      // a message at least as informative as the one this replaces) AND
      // skips zero-amount legs, which the posting loop below ALSO skips
      // (`if (legAmount <= 0) continue`) — one shared predicate on both the
      // guard and the posting side, closing the guard/posting-loop drift
      // shape FEATURE_GUIDE §13 item 15b warns about (unreachable today only
      // because the schema's `.positive()` already guarantees every leg is
      // non-zero).
      const { usd: payoutUsd, lbp: payoutLbp } = sumLegsByCurrency(
        payoutLegs,
        "Client top-up payout",
      );
      const payoutTotalUsd = usdEquivalent(
        payoutUsd,
        payoutLbp,
        recordExchangeRate,
      );
      const amountUsd = usdEquivalent(
        currency === "USD" ? amount : 0,
        currency === "LBP" ? amount : 0,
        recordExchangeRate,
      );
      if (payoutTotalUsd - amountUsd > LEG_RECONCILIATION_EPSILON_USD) {
        return {
          success: false,
          error:
            `Client top-up payout exceeds the credits received — paid out ` +
            `$${payoutTotalUsd.toFixed(2)} USD-equivalent against $${amountUsd.toFixed(2)} ` +
            `USD-equivalent received; a top-up cannot pay out more than it takes in`,
        };
      }

      // ── Per-leg, per-currency drawer balance guard ──────────────────────
      // BEFORE opening the db transaction (read-then-act inside a
      // transaction is a race, FEATURE_GUIDE §13 item 15) — a rejected
      // top-up writes nothing. Aggregated by (drawer, currency): two legs
      // that resolve to the SAME drawer+currency (e.g. two CASH legs) must
      // be checked against their COMBINED draw, not independently.
      const neededByDrawer = new Map<
        string,
        { drawer: string; currencyCode: string; amount: number }
      >();
      for (const leg of payoutLegs) {
        const drawer = paymentMethodToDrawerName(leg.method);
        const key = `${drawer}::${leg.currencyCode}`;
        const legAmount = Math.abs(leg.amount);
        const existing = neededByDrawer.get(key);
        if (existing) existing.amount += legAmount;
        else
          neededByDrawer.set(key, {
            drawer,
            currencyCode: leg.currencyCode,
            amount: legAmount,
          });
      }
      for (const {
        drawer,
        currencyCode,
        amount: needed,
      } of neededByDrawer.values()) {
        const row = this.db
          .prepare(
            "SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ? AND tenant_id = ?",
          )
          .get(drawer, currencyCode, tenantId) as
          | { balance: number | null }
          | undefined;
        const balance = row?.balance ?? 0;
        if (balance < needed) {
          return {
            success: false,
            error: `Insufficient balance in ${drawer}. Available: ${balance} ${currencyCode}`,
          };
        }
      }

      // `cashPaid` — LOAD-BEARING metadata (rule 14, ONE writer): the summed
      // payout, converted to `currency`. `frontend/src/features/audit/
      // cashFlow.ts`'s RECHARGE_TOPUP case branches on
      // `m.cashPaid != null` / `> 0` to pick the "both" vs "in" cash-flow
      // badge (guarded by `cashFlow.test.ts` /
      // `TransactionsViewer.topUpCashFlowDirection.test.tsx`) — derived HERE
      // at the one writer, never hand-maintained a second time downstream.
      // Both branches reuse moneyPosting's shared converters (`usdEquivalent`
      // / `lbpEquivalent`) rather than an inline expression — the USD branch
      // is exactly `payoutTotalUsd`, already computed above for the
      // over-payout guard; re-deriving it here inline would let the guard's
      // notion of "the payout, in USD" and this metadata's notion of it
      // silently diverge if `usdEquivalent` ever changes (rule 14).
      const cashPaid =
        currency === "USD"
          ? payoutTotalUsd
          : lbpEquivalent(payoutUsd, payoutLbp, recordExchangeRate);
      const cashLabel = formatMoneyAmount(cashPaid, currency);
      const profit = amount - cashPaid;
      // The REAL drawer(s) this payout actually debits — resolved the same
      // way the posting loop below resolves each leg's drawer
      // (`paymentMethodToDrawerName`), NOT the raw payment METHOD. Before
      // this fix, `sourceDrawer` held a method name (e.g. "CASH") or the
      // literal "MULTI", which `isCashEquivalentDrawer` (cashFlow.ts) would
      // silently misjudge if it were ever read on this branch — it isn't
      // today only because `cashFlow.ts`'s RECHARGE_TOPUP case checks
      // `m.cashPaid != null` FIRST and returns before reaching `sourceDrawer`
      // for this writer. `sourceDrawer` stays a single value ("MULTI" when
      // more than one distinct drawer was debited, matching every other
      // RECHARGE_TOPUP writer's sentinel) and the full resolved list is
      // carried separately under `sourceDrawers` so no information is lost.
      const payoutDrawers = Array.from(
        new Set(payoutLegs.map((leg) => paymentMethodToDrawerName(leg.method))),
      );
      const sourceDrawerMeta =
        payoutDrawers.length > 1 ? "MULTI" : payoutDrawers[0];

      const result = this.db.transaction(() => {
        const clientName = data.clientId
          ? ((
              this.db
                .prepare(
                  "SELECT full_name FROM clients WHERE id = ? AND tenant_id = ?",
                )
                .get(data.clientId, tenantId) as
                | { full_name: string }
                | undefined
            )?.full_name ??
            data.clientName ??
            null)
          : (data.clientName ?? null);

        // Record the top-up in recharges table
        const rechargeResult = this.db
          .prepare(
            `INSERT INTO recharges (carrier, recharge_type, amount, cost, price, currency_code, paid_by, note, created_by, tenant_id)
             VALUES ('WHISH_APP', 'TOP_UP', ?, ?, ?, ?, 'CLIENT', ?, ?, ?)`,
          )
          .run(
            amount,
            cashPaid,
            amount,
            currency,
            `Whish App top-up from client: +${creditsLabel} credits, paid ${cashLabel} cash`,
            data.userId,
            tenantId,
          );

        const rechargeId = Number(rechargeResult.lastInsertRowid);

        // Create unified transaction record
        const txnId = getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.RECHARGE_TOPUP,
          source_table: "recharges",
          source_id: rechargeId,
          user_id: data.userId,
          amount_usd: currency === "USD" ? amount : 0,
          amount_lbp: currency === "LBP" ? amount : 0,
          profit_usd: currency === "USD" ? profit : 0,
          profit_lbp: currency === "LBP" ? profit : 0,
          client_id: data.clientId ?? null,
          client_name: clientName,
          summary: `Whish App top-up from client: +${creditsLabel} credits, -${cashLabel} cash`,
          metadata_json: {
            provider: "WHISH_APP",
            amount,
            cashPaid,
            currency,
            clientId: data.clientId ?? null,
            clientName: data.clientName ?? null,
            sourceDrawer: sourceDrawerMeta,
            sourceDrawers: payoutDrawers,
            destDrawer,
          },
          exchange_rate: recordExchangeRate,
        });

        // Pay the client from each leg's own drawer, in that leg's own
        // currency (rule 16) — a REAL `payments` row per leg + a matching
        // `applyDrawerDelta`, so the generic void path (`_reversePayments`)
        // can restore every leg later, split or not.
        for (const leg of payoutLegs) {
          assertLegMovesADrawer(leg.method);
          const legAmount = Math.abs(leg.amount);
          if (legAmount <= 0) continue;
          const drawer = paymentMethodToDrawerName(leg.method);
          insertPaymentRow(this.db, {
            transactionId: txnId,
            method: leg.method,
            drawerName: drawer,
            currencyCode: leg.currencyCode,
            amount: -legAmount,
            note: `Whish App top-up from client: -${formatMoneyAmount(legAmount, leg.currencyCode)} cash`,
            createdBy: data.userId,
            tenantId,
          });
          applyDrawerDelta(this.db, {
            drawerName: drawer,
            currencyCode: leg.currencyCode,
            delta: -legAmount,
            tenantId,
          });
        }

        // Add the received credits to the Whish App drawer — a REAL
        // `payments` row (rule 20/LIRA-194), not a bare `applyDrawerDelta`,
        // so the generic void path (`_reversePayments`) can restore both
        // legs later.
        insertPaymentRow(this.db, {
          transactionId: txnId,
          method: destDrawer,
          drawerName: destDrawer,
          currencyCode: currency,
          amount,
          note: `Whish App top-up from client: +${creditsLabel} credits`,
          createdBy: data.userId,
          tenantId,
        });
        applyDrawerDelta(this.db, {
          drawerName: destDrawer,
          currencyCode: currency,
          delta: amount,
          tenantId,
        });

        return rechargeId;
      })();

      rechargeLogger.info(
        {
          id: result,
          amount,
          cashPaid,
          currency,
          clientId: data.clientId ?? null,
          destDrawer,
        },
        `Whish App top-up from client: +${creditsLabel} credits, -${cashLabel} cash`,
      );

      return { success: true };
    } catch (error) {
      rechargeLogger.error({ error, data }, "Client top-up failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Update non-financial metadata on a recharge record.
   * Only metadata fields are allowed — financial data is immutable.
   */
  updateMetadata(
    id: number,
    data: { phone_number?: string; client_name?: string; note?: string },
    editedBy: string,
  ): RechargeEntity | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const fields: string[] = [];
    const values: unknown[] = [];

    if (data.phone_number !== undefined) {
      fields.push("phone_number = ?");
      values.push(data.phone_number);
    }
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
    values.push(id, getCurrentTenantId());

    this.db
      .prepare(
        `UPDATE recharges SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`,
      )
      .run(...values);

    return this.findById(id);
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let rechargeRepositoryInstance: RechargeRepository | null = null;

export function getRechargeRepository(): RechargeRepository {
  if (!rechargeRepositoryInstance) {
    rechargeRepositoryInstance = new RechargeRepository();
  }
  return rechargeRepositoryInstance;
}

/** Reset the singleton (for testing) */
export function resetRechargeRepository(): void {
  rechargeRepositoryInstance = null;
}
