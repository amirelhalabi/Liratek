/**
 * Transaction Repository
 *
 * Provides the unified accounting journal for all financial operations.
 * Every module creates a `transactions` row as the canonical record of
 * "something happened." Downstream tables (payments, debt_ledger, etc.)
 * link back via `transaction_id` / `unified_transaction_id`.
 *
 * Key concepts:
 * - **Void**: Sets original status to VOIDED, creates reversal row with
 *   negated amounts and `reverses_id` pointing to the original.
 *   Reverses drawer balances, restores stock, and cancels debt.
 * - **Refund**: Creates a REFUND row with `reverses_id` pointing to the
 *   original. Original stays ACTIVE.
 *   Reverses drawer balances, restores stock, and cancels debt.
 * - **Exchange rate**: Immutable snapshot captured at creation time.
 */

import { localDayExpr } from "./reportingTimeFragments.js";
import {
  MODULE_DEBT_TRANSACTION_TYPES,
  NON_REVERSIBLE_TRANSACTION_TYPES,
  SESSION_BASKET_BYPASSABLE_NON_REVERSIBLE_TYPES,
  SESSION_ITEM_REFUND_CREDIT_TYPE,
  SESSION_ITEM_REFUND_LINK_TYPE,
  SESSION_ITEM_REFUNDABLE_TYPES,
  isSwapTransactionType,
  TRANSACTION_TYPES,
  type TransactionStatus,
  type TransactionType,
} from "../constants/transactionTypes.js";
import {
  REFUND_LEG_AMOUNT_EPSILON,
  REFUND_VALUE_TOLERANCE_USD,
} from "../constants/refundTolerance.js";
import {
  isSessionPayoutMember,
  type SessionPayoutMemberCandidate,
} from "../constants/sessionPayoutMember.js";
import { partnerObligationHeadRowSql } from "../constants/partnerObligation.js";
import { isAuditOnlyPaymentMethod } from "../constants/auditOnlyPaymentMethods.js";
import { BaseRepository, type BaseEntity } from "./BaseRepository.js";
import { getRateRepository } from "./RateRepository.js";
import {
  BusinessRuleError,
  DatabaseError,
  NotFoundError,
} from "../utils/errors.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import {
  applyDrawerDelta,
  insertPaymentRow,
  type KeptChange,
} from "./moneyPosting.js";
import { resolveKeptChange } from "./keptChange.js";
import { allocateFifo } from "../utils/fifoCoverage.js";
import {
  isDrawerAffectingMethod,
  paymentMethodToDrawerName,
  resolveServiceCashDrawer,
  type BaseSystem,
  type ServiceCashDrawerContext,
} from "../utils/payments.js";
import { getPaymentMethodRepository } from "./PaymentMethodRepository.js";
import { getCarrierLineMovementRepository } from "./CarrierLineMovementRepository.js";
import { getCarrierLineService } from "../services/CarrierLineService.js";
import { isPendingSupplierSettlement } from "./FinancialServiceRepository.js";
import { getExchangeLotRepository } from "./ExchangeLotRepository.js";
import { getProductUnitRepository } from "./ProductUnitRepository.js";
import { getStockBatchRepository } from "./StockBatchRepository.js";
import { restoreMaintenanceJobParts } from "./maintenancePartsStock.js";
import { restoreExpenseStock } from "./expenseStock.js";
import {
  REFUND_KEPT_CHANGE_META,
  REFUND_KEPT_CHANGE_TYPES,
  type TransactionTypeFilterInput,
} from "../validators/transaction.js";
// LIRA-232 phase 1 — refundSessionBasketItem's SALE branch reuses
// SalesRepository's per-line item reversal (rule 14). Both files already
// reference each other's singleton getters lazily (SalesRepository imports
// getTransactionRepository from THIS file), so this import cycle is safe:
// neither getter is invoked at module-evaluation time, only from inside a
// method body once both modules have finished loading — the same pattern
// already used for FinancialServiceRepository above.
import { getSalesRepository } from "./SalesRepository.js";
// LIRA-232 phase 1 (adversarial-review fix, finding #6) — the client's
// CURRENT total balance (`getClientBalance`, a plain SUM(amount_usd)/
// SUM(amount_lbp) across every debt_ledger row) is the one existing,
// rule-14-correct way to know "how much of this account charge has ALREADY
// been repaid" — 'Session Debt' rows never get FIFO `covered_*` coverage
// (DebtRepository._coverServiceDebtsFIFO's whitelist excludes 'Session
// Debt' by design), so re-deriving that from `covered_*` (the pre-fix
// approach) always read the gross charge, repayment or not. Same safe
// circular-import pattern as the `SalesRepository` import above: DebtRepository
// imports `getTransactionRepository` at its own top level, and neither class
// touches the other's import at module-evaluation time, only from inside a
// method body.
import { getDebtRepository, readRepaymentCoverage } from "./DebtRepository.js";
import { getVoucherRepository } from "./VoucherRepository.js";
// LIRA-258 / G17 — the shared repayment-coverable type list (rule 14/20),
// same lazy circular-import pattern as above (only read inside a method).
import { repaymentCoverableTypesSqlList } from "./sessionDebtCoverage.js";

// A `debt_ledger` row represents an on-account CHARGE (customer paid via their
// account) that should surface a "Customer Account" method leg — EXCEPT
// 'Refund Reversal' rows, which cancel debt and belong to a refund/void
// transaction that already shows its own real method. Defined once and reused
// by every account-leg reconstruction query (rule 14).
//
// Finding #11 (adversarial review, LIRA-232) — `SESSION_ITEM_REFUND_CREDIT_TYPE`
// ('Session Item Refund') is excluded for the SAME reason as 'Refund
// Reversal': it is a credit belonging to a REFUND transaction that shows its
// own real method, not a fresh charge on the session group. Before this
// exclusion it passed the predicate (a different string from 'Refund
// Reversal') and surfaced as a spurious "Customer Account" OUT leg on the
// whole session group, while the REFUND row it actually belongs to showed no
// legs at all. See `_attachPaymentLegs`'s dedicated per-transaction lookup
// (`sessionItemRefundCreditLegsByTxn`) for where it's re-attached correctly.
const ACCOUNT_CHARGE_PREDICATE = `transaction_type NOT IN ('Refund Reversal', '${SESSION_ITEM_REFUND_CREDIT_TYPE}')`;

// LIRA-115: the `payments.note` stamped on a session basket's pooled-leg
// reversal (`_reverseSessionPooledPayments`) — reused (rule 14) both to write
// the row and to detect "this basket's pooled cash was already reversed"
// (`_assertSessionBasketReversible`), so the two never drift out of sync.
// Exported (LPAY-V1, OWNER_NOTES_2026-09-21.md §6.5 PA-3.5 review round 3) so
// ProfitRepository.getPaymentMethodRows can build the SAME "has this session
// basket already been voided/refunded" predicate `_assertSessionBasketReversible`
// uses, instead of hand-copying the literal note string a second time (rule 14).
export const SESSION_BASKET_REVERSAL_NOTE = "Basket reversal";

// Coordinator follow-up (2026-09-27) — the ONE message
// `voidSessionBasket`/`refundSessionBasket`'s up-front
// `isSessionBasketFullyRefunded` guard throws (rule 14), so IPC and REST
// surface byte-identical text in the normal `{ success: false, error }`
// envelope (both transports forward `error.message` verbatim).
export const SESSION_BASKET_ALREADY_FULLY_REFUNDED_MESSAGE =
  "Everything in this basket has already been refunded item by item — there is nothing left to refund.";

// Coordinator follow-up (2026-09-28, N+1 fix) — SQLite's bound-parameter
// ceiling (older builds cap at 999) means a `session_id IN (...)` built from
// an unbounded page's worth of distinct sessions must be split into
// batches. This is the ONE chunk size every batched session-flag query
// below shares (rule 14), so they can never split a caller's id list
// differently from one another.
const SESSION_BATCH_CHUNK_SIZE = 400;

function chunkIds<T>(ids: T[], size: number): T[][] {
  if (ids.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}

// =============================================================================
// Types
// =============================================================================

export interface TransactionEntity extends BaseEntity {
  type: TransactionType;
  status: TransactionStatus;
  source_table: string;
  source_id: number;
  user_id: number;
  amount_usd: number;
  amount_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  exchange_rate: number | null;
  client_id: number | null;
  client_name: string | null;
  client_phone: string | null;
  reverses_id: number | null;
  summary: string | null;
  metadata_json: string | null;
  device_id: string | null;
  created_at: string;
}

export interface PaymentRow {
  id: number;
  method: string;
  drawer_name: string;
  currency_code: string;
  amount: number;
  note: string | null;
  created_at: string;
}

/**
 * A single structured payment leg for a transaction (LIRA-064).
 *
 * `direction` describes cash flow from the shop's perspective:
 * - `"in"`  — money the customer paid the shop (positive payment amount)
 * - `"out"` — money the shop returned/disbursed (negative payment amount,
 *   e.g. change given, exchange payout, reversal leg)
 *
 * `amount` is always the absolute value; the sign lives in `direction` so the
 * frontend can render `in: ... · out: ...` without re-deriving signs. The raw
 * signed value is preserved in `signed_amount` for any future aggregation.
 *
 * This shape is intentionally self-describing so a future expandable detail
 * row (LIRA-067) can consume the same field with no backend changes.
 */
export interface TransactionPaymentLeg {
  direction: "in" | "out";
  amount: number;
  signed_amount: number;
  currency_code: string;
  method: string;
  /**
   * The drawer this leg moved money in/out of. Present for legs read from
   * the `payments` table; absent for legs reconstructed from other sources
   * (CUSTOMER_ACCOUNT settlements built from `debt_ledger`, which move no
   * drawer).
   */
  drawer_name?: string;
  /**
   * Production test 2026-10-07 — `true` on a session basket's pooled leg that
   * REVERSES the checkout (`SESSION_BASKET_REVERSAL_NOTE`, written by
   * `_reverseSessionPooledPayments` on a whole-basket void/refund). Without it
   * the pooled list mixes the checkout and its reversal and the table read
   * "in: $5.5 · out: $5.5" for a $5-paid basket. Display-only; ABSENT (never
   * `false`) on every other leg.
   */
  reversal?: true;
}

/** The ONE `payments.method` marking telecom credit returned to the shop on an
 *  Only-Days sale (LIRA-090 §5.1 — written solely by
 *  `FinancialServiceRepository.processTelecomCreditReturn`, and mirrored
 *  negated onto the reversal row by `_reversePayments`). Already a member of
 *  INTERNAL_LEG_METHODS below: it is NOT customer cash, so it stays out of the
 *  in/out summary — LIRA-205 surfaces it separately as its own read-only
 *  figure (`returned_credits_usd`) instead. Reused by the Set below and by
 *  `_attachPaymentLegs`'s accumulator, so those two can never drift from EACH
 *  OTHER (rule 14). It is NOT yet the single global source the name implies,
 *  though: `FinancialServiceRepository.processTelecomCreditReturn` (the sole
 *  writer) still hardcodes the literal "CREDIT_RETURN" rather than importing
 *  this constant — that file sits outside this change's ownership boundary,
 *  so pointing it at this export is a follow-up, not done here. Exported
 *  (rather than left module-private) so that follow-up is a one-line import
 *  away instead of also needing to add the export first. */
export const CREDIT_RETURN_LEG_METHOD = "CREDIT_RETURN";

/**
 * The `payments` table is an internal multi-leg ledger: alongside real customer
 * payments and change/returns it also stores provider/system drawer movements
 * (e.g. the Binance USDT crypto leg, cost-flow provider cost legs, and
 * fee/transfer reporting rows). The LIRA-064 in/out summary must surface ONLY
 * customer-facing cash — so these internal legs are filtered out. Identifiers
 * below mark legs that are NOT customer cash. NOTE (Primary Cash Drawer plan
 * §2#4): OMT_System/Whish_System are EXCLUDED from that internal set as of
 * this feature — they are the physical primary cash drawer (PCD) now, not a
 * provider-side float, so their legs ARE customer cash and must stay visible.
 */
// Marker methods used for internal (non-customer) ledger rows.
// Exported (LIRA — PA-3.5, OWNER_NOTES_2026-09-21.md §6.3) so
// ProfitRepository.getPaymentMethodRows can build its own exclusion set from
// this SAME canonical list instead of hand-copying a second one that silently
// drifts out of sync with it (rule 14) — that drift is exactly what let a
// voided expense's mirrored TRANSFER/CREDIT_RETURN/CREDIT_USED/SMS_COST/
// PM_FEE leg re-surface as a bogus "payment method" row on the Profits page.
export const INTERNAL_LEG_METHODS = new Set([
  "COMMISSION", // reporting-only fee row (zero delta)
  "PM_FEE", // payment-method fee audit row
  "TRANSFER", // shop→system drawer transfer leg
  // Primary Cash Drawer plan §8.6: both legs of a General↔cash-drawer transfer
  // are the shop moving its OWN money between two of its own drawers — never
  // customer cash. This entry is load-bearing now that the `_System`
  // drawer-name exclusion above is gone: without it BOTH legs of every
  // transfer would leak into the D1 cash-flow report and the in/out summary.
  "DRAWER_TRANSFER",
  "RESERVE", // cash reserved out of General/wallet for provider settlement (SEND / debt repayment)
  "OMT_APP", // shop-wallet side of an app transfer (customer cash side stays visible)
  "WHISH_APP", // shop-wallet side of an app transfer (customer cash side stays visible)
  CREDIT_RETURN_LEG_METHOD, // returned telecom credits to a provider drawer
  "CREDIT_USED", // on-account charge (also lives in debt_ledger)
  "SMS_COST", // telecom SMS cost consumed from the provider stock drawer
  "LINE_CREDIT", // carrier-line usage expense (LIRA-145): internal credit-stock consumption, no customer cash
  // LPAY-V3 (OWNER_NOTES_2026-09-21.md §6.5 PA-3.5 review, round 3): a
  // WalletExchangeRepository conversion (OMT_App/Whish_App wallet, never a
  // customer) posts method "WALLET_EXCHANGE" on both its legs — the shop
  // converting its own wallet currency, same "never customer tender" shape
  // as DRAWER_TRANSFER above. It does NOT belong in this SHARED set, though:
  // `isInternalLegJs` (built from this Set) also feeds `isOverridableLeg`
  // (via `!isInternalLegJs(p) && isDrawerAffectingMethod(p.method)`), which
  // gates the LIRA-078 refund-tender-override money path
  // (`_validateRefundLegOverride`/`_reversePayments`) — a reporting-only fix
  // has no business changing what a refund override treats as
  // customer-facing. The Profits "By Payment" report's own exclusion now
  // lives in `ProfitRepository.ts`'s `PAYMENT_REPORT_ONLY_EXCLUSIONS`
  // instead — see that file's comment, and
  // `TransactionRepository.walletExchangeRefundOverride.test.ts` for the
  // verified (not assumed) proof that removing it from here leaves the
  // refund-override path byte-identical either way in the shape the running
  // app actually uses.
]);
// Provider stock / reserve drawers — value the SHOP holds with a provider
// (telecom credit stock, app balance), never customer cash. Customer WALLET
// drawers (Whish_App / OMT_App) are intentionally NOT here: a customer paying
// via that method is real customer cash and must stay in the summary.
// OMT_System / Whish_System are ALSO intentionally NOT here (Primary Cash
// Drawer plan §2#4) — they are the primary cash drawer (PCD), real
// customer-facing cash, not a provider stock/reserve drawer.
// Exported (LPAY-V2, OWNER_NOTES_2026-09-21.md §6.5 PA-3.5 review round 3) so
// ProfitRepository.getPaymentMethodRows can exclude a provider-stock leg (the
// TELECOM_CREDIT_BUYBACK/TELECOM_SELF_CHARGE credit legs, a bills-only
// settlement's commission drawer top-up, ...) by DRAWER rather than by
// method — those legs' `method` value is often the provider code itself
// (e.g. "MTC", "Alfa", "SELF_CHARGE"), which the report's own method-only
// exclusion list can never enumerate exhaustively (rule 14: reuse this ONE
// drawer set instead of guessing at every method literal that might target
// it).
export const PROVIDER_STOCK_DRAWERS = new Set([
  "MTC",
  "Alfa",
  "Katsh",
  "iPick",
]);

/**
 * SQL mirror of `_assertSessionBasketReversible`'s two existence checks
 * (rule 14 — same predicate, reused instead of re-derived): TRUE when the
 * session basket referenced by `${sessionIdCol}` (on tenant
 * `${tenantIdCol}`) has NOT already been voided/refunded — i.e. neither its
 * pooled-leg reversal (`SESSION_BASKET_REVERSAL_NOTE`) nor its debt
 * 'Refund Reversal' row exists yet. `_assertSessionBasketReversible` itself
 * stays untouched (two separate throws, each with its own message) — this
 * is a NEW, additive consumer of the SAME note constant and the SAME two
 * conditions, not a refactor of that method, so the void/refund money path
 * it guards is provably unchanged (LPAY-V1's report-only invariant).
 */
export function sessionBasketNotReversedSql(
  sessionIdCol: string,
  tenantIdCol: string,
): string {
  return `NOT EXISTS (
      SELECT 1 FROM payments rp
      WHERE rp.session_id = ${sessionIdCol}
        AND rp.transaction_id IS NULL
        AND rp.note = '${SESSION_BASKET_REVERSAL_NOTE}'
        AND rp.tenant_id = ${tenantIdCol}
    )
    AND NOT EXISTS (
      SELECT 1 FROM debt_ledger rd
      WHERE rd.session_id = ${sessionIdCol}
        AND rd.transaction_type = 'Refund Reversal'
        AND rd.tenant_id = ${tenantIdCol}
    )`;
}
// Customer cash is always denominated in one of these; USDT/crypto legs are internal.
const CUSTOMER_CASH_CURRENCIES = new Set(["USD", "LBP"]);

/**
 * ONE definition of "customer-facing cash leg" (rule 14). The JS predicate is
 * used by the per-row leg attachment (toLeg); the SQL builder mirrors it from
 * the SAME constant sets for aggregate queries (D1 cash-flow report). Change
 * the rule here, in both forms, or the report and the in/out column diverge.
 */
function isInternalLegJs(p: {
  method: string;
  drawer_name: string;
  currency_code: string;
  amount: number;
  note: string | null;
}): boolean {
  const note = p.note ?? "";
  return (
    p.amount === 0 || // reporting-only row (e.g. COMMISSION, zero delta)
    INTERNAL_LEG_METHODS.has(p.method) || // fee / transfer / credit / SMS markers
    PROVIDER_STOCK_DRAWERS.has(p.drawer_name) || // MTC/Alfa/Katsh/iPick stock
    // Primary Cash Drawer plan §2#4 (docs/plans/todo_plans/PRIMARY_CASH_DRAWER_PLAN.md):
    // OMT_System/Whish_System are no longer an internal provider-side float —
    // they ARE the physical cash drawer at the money-transfer counter, so a
    // leg posted there is real customer cash and must NOT be filtered out
    // here. The `endsWith("_System")` exclusion that used to live on this
    // line is deleted (rule 14 pair with customerCashLegSql below — change
    // both or neither).
    !CUSTOMER_CASH_CURRENCIES.has(p.currency_code) || // USDT / crypto leg
    note.startsWith("Cost:") || // cost/price-flow provider cost outflow
    note.endsWith("(cost outflow)") || // custom-service hidden cost outflow
    note.startsWith("Crypto ") // Binance crypto sent/received leg
  );
}

/** SQL mirror of isInternalLegJs, negated (keeps customer-cash legs). Values
 *  come from module constants, never user input. */
function customerCashLegSql(a: string): string {
  const methods = [...INTERNAL_LEG_METHODS].map((m) => `'${m}'`).join(", ");
  const drawers = [...PROVIDER_STOCK_DRAWERS].map((d) => `'${d}'`).join(", ");
  const currencies = [...CUSTOMER_CASH_CURRENCIES]
    .map((c) => `'${c}'`)
    .join(", ");
  // Primary Cash Drawer plan §2#4: the `NOT LIKE '%\_System'` exclusion that
  // used to sit here is deleted in lockstep with isInternalLegJs above (rule
  // 14) — OMT_System/Whish_System legs are customer-facing cash now.
  return `${a}.amount != 0
      AND ${a}.method NOT IN (${methods})
      AND ${a}.drawer_name NOT IN (${drawers})
      AND ${a}.currency_code IN (${currencies})
      AND COALESCE(${a}.note, '') NOT LIKE 'Cost:%'
      AND COALESCE(${a}.note, '') NOT LIKE '%(cost outflow)'
      AND COALESCE(${a}.note, '') NOT LIKE 'Crypto %'`;
}

/**
 * LIRA-078 (refund tender-selection modal): a payments row is eligible to be
 * REPLACED by the operator's chosen return method — instead of mirrored
 * verbatim — only when it is BOTH customer-facing (`!isInternalLegJs`, the
 * same rule the LIRA-064 in/out summary and `getCustomerFacingLegs` use) AND
 * itself drawer-affecting (`isDrawerAffectingMethod`). The second condition is
 * belt-and-suspenders: every existing repository already gates
 * `insertPaymentRow` on `isDrawerAffectingMethod` (CUSTOMER_ACCOUNT/GIFT_CARD
 * never reach the `payments` table today), so in practice `!isInternalLegJs`
 * alone already excludes them — but requiring both here means a future call
 * site that regresses that gate still can't leak a non-drawer leg into the
 * override's replace-set; it would just keep mirroring harmlessly (rule 14:
 * ONE predicate, reused by both the validation net and the `_reversePayments`
 * skip-set below, never copy-pasted).
 */
// Exported (LIRA-231 — rule 14) so SalesRepository's POS per-item refund
// override can gate its own "which legs does the operator's choice replace"
// decision with the EXACT same predicate this file's whole-transaction
// override uses, instead of re-deriving it.
export function isOverridableLeg(p: {
  method: string;
  drawer_name: string;
  currency_code: string;
  amount: number;
  note: string | null;
}): boolean {
  return !isInternalLegJs(p) && isDrawerAffectingMethod(p.method);
}

/**
 * LIRA-231 (rule 14): convert raw `payments` rows into the structured
 * `TransactionPaymentLeg[]` shape RefundMethodModal consumes, filtering out
 * internal (non-customer) legs via `isInternalLegJs` — the SAME filter
 * `getRecent`'s own leg-attachment (`toLeg`) and `getCustomerFacingLegs` use.
 * `scale` lets a caller pre-shrink every leg to a PROPORTIONAL share (e.g. one
 * sale item's fraction of the whole sale) without duplicating the pro-rata
 * math here — the caller computes the ratio, this function only applies it
 * uniformly to every leg's signed amount.
 */
export function paymentRowsToLegs(
  rows: Array<{
    method: string;
    drawer_name: string;
    currency_code: string;
    amount: number;
    note: string | null;
  }>,
  scale = 1,
): TransactionPaymentLeg[] {
  const legs: TransactionPaymentLeg[] = [];
  for (const p of rows) {
    if (isInternalLegJs(p)) continue;
    const signedAmount = p.amount * scale;
    legs.push({
      direction: signedAmount < 0 ? "out" : "in",
      amount: Math.abs(signedAmount),
      signed_amount: signedAmount,
      currency_code: p.currency_code,
      method: p.method,
      ...(p.drawer_name ? { drawer_name: p.drawer_name } : {}),
    });
  }
  return legs;
}

/**
 * LIRA-236 — the day's fallback LBP rate (`exchange_rates.buy_rate`, else
 * `market_rate`), used whenever nothing more specific is available: a
 * session basket with no typed rate and no member-recorded rate
 * (`TransactionRepository._crossCurrencyRateForBasket`'s last resort), or
 * any refund preview's `bookedRateSource: "fallback"`
 * (`resolveBookedRate` below). Rule 14 — the ONE place any of them reads
 * the day's rate from. A free function (not just a private method) so
 * `SalesRepository.getItemRefundPreview` can reach it too, via
 * `resolveBookedRate`, without a cross-repository private-method reach-in.
 */
export function dayRateFallback(): number | null {
  try {
    const rate = getRateRepository().findByCode("LBP");
    if (rate?.buy_rate && rate.buy_rate > 0) return rate.buy_rate;
    if (rate?.market_rate && rate.market_rate > 0) return rate.market_rate;
  } catch {
    // fall through
  }
  return null;
}

/**
 * LIRA-236 — the default booked rate for ANY refund preview: the thing
 * being refunded's OWN recorded rate when it has one (source "sale" for a
 * SALE transaction — `sales.exchange_rate_snapshot`, stamped onto
 * `transactions.exchange_rate` at creation, so reading the transaction row
 * is reading the sale's own snapshot; source "transaction" for any other
 * transaction type that recorded a rate), else the day's fallback rate
 * (source "fallback", never a hard-coded guess). Rule 14 — the ONE place
 * `TransactionRepository.getSaleRefundPreview`/`getRefundBookedRate`/
 * `getSessionItemRefundPreview` (via `_bookedRateFor`, which delegates
 * here) AND `SalesRepository.getItemRefundPreview` all derive
 * `bookedRate`/`bookedRateSource` from.
 */
export function resolveBookedRate(
  recordedRate: number | null | undefined,
  sourceIfPresent: "sale" | "transaction",
): {
  bookedRate: number;
  bookedRateSource: "sale" | "transaction" | "fallback";
} {
  if (recordedRate != null && recordedRate > 0) {
    return { bookedRate: recordedRate, bookedRateSource: sourceIfPresent };
  }
  return { bookedRate: dayRateFallback() ?? 0, bookedRateSource: "fallback" };
}

/**
 * ONE definition (rule 14) of "signed net customer-facing total per
 * currency, summed over overridable legs" — free-function counterpart to
 * `TransactionRepository._overridableNetByCurrency` (which now delegates
 * here), also consumed directly by SalesRepository's per-item refund
 * override so both refund paths compute the same shape the same way.
 */
export function overridableNetByCurrency(
  rows: Array<{
    method: string;
    drawer_name: string;
    currency_code: string;
    amount: number;
    note: string | null;
  }>,
): Record<string, number> {
  const net: Record<string, number> = {};
  for (const p of rows) {
    if (!isOverridableLeg(p)) continue;
    net[p.currency_code] = (net[p.currency_code] ?? 0) + p.amount;
  }
  return net;
}

/**
 * F14 (round-3 review, defensive) — the ONE gate (rule 14) for "is this a
 * usable cashier-typed/booked exchange rate" wherever a rate first enters
 * this repository's cross-currency refund math (`refundLegReversalSign`,
 * `validateRefundLegOverrideAmounts`, `_planSessionItemRefund`'s
 * `effectiveRate`). Mirrors `_crossCurrencyRateForBasket`'s existing
 * `Number.isFinite` guard (LIRA-236 §9b item 12) rather than inventing a
 * second convention — `rate > 0` ALONE lets `Infinity` through (`Infinity >
 * 0` is `true`), and `1 / Infinity` silently prices every LBP amount, on
 * EITHER side of a comparison, at exactly $0 — collapsing an 8,000,000 LBP
 * original and an unrelated 3,000,000 LBP override to "$0 vs $0" and wrongly
 * accepting the mismatch, or flipping `refundLegReversalSign`'s direction by
 * dropping the LBP leg from the overall-value sum entirely. Every
 * transport-facing schema already rejects a non-finite/non-positive rate
 * (`refundExchangeRateSchema`'s `.positive().finite()`), so this is
 * belt-and-suspenders for a caller that reaches the repository directly
 * (an internal caller, a test, a future direct call) — not a new UI-facing
 * validation.
 */
function isUsableRefundExchangeRate(
  rate: number | null | undefined,
): rate is number {
  return rate != null && Number.isFinite(rate) && rate > 0;
}

/**
 * ONE definition (rule 14) of "which direction does a refund-override leg
 * post in" — shared by `TransactionRepository._reversePayments` and
 * `SalesRepository._applySaleItemMoneyBack`, replacing each file's own
 * `originalNet < 0 ? 1 : -1` copy (F1, round-3 review, corrected after a
 * coordinator review of the first fix — see below).
 *
 * `exchangeRate` OMITTED (today's per-currency exact-match refund, legs only
 * ever refund in the SAME currency they were paid in): byte-identical to
 * before this fix — the sign comes from THIS currency's own net, defaulting
 * to -1 when there is nothing recorded for it (a currency with a truly zero
 * net can only be reached by an override leg of amount 0, which the
 * validator already rejects).
 *
 * `exchangeRate` GIVEN (LIRA-236 cross-currency refund) — THE RULE: a refund
 * moves money in exactly ONE direction, the reversal of the ORIGINAL's
 * OVERALL signed value — never a per-currency sign. A money-in original
 * (sale, SEND, the customer's side of an exchange: overall value > 0) posts
 * EVERY refund leg OUT (a drawer debit), whatever currency that leg is in. A
 * payout original (a RECEIVE cash-out, a prize: overall value < 0) posts
 * EVERY leg IN. "Overall value" is the SAME USD-equivalent number
 * `validateRefundLegOverrideAmounts`'s value branch computes and compares
 * against (Σ every currency's signed net, converted at the cashier's typed
 * rate) — one shared number, one shared sign, for every leg regardless of
 * its own currency.
 *
 * This is NOT "this currency's own net, falling back to the overall sign
 * only when that net is 0" — that per-currency-first version was the
 * ORIGINAL (wrong) draft of this fix and reproduces the exact bug it was
 * meant to close: a $90 sale tendered as $100 cash + a 895,000 LBP change
 * leg has an LBP net of -895,000 in isolation (money already went OUT as
 * change), even though the sale as a WHOLE was a net $90 customer payment
 * IN — a refund posted entirely in LBP, signed by that per-currency net,
 * would ADD to the drawer instead of subtracting. Always taking the OVERALL
 * sign fixes it: LBP has no special case here, it just follows the same
 * direction as every other currency.
 *
 * Falls back to this currency's own net only when the overall value is
 * exactly 0 (a fully offsetting original, e.g. an even-rate EXCHANGE — see
 * that function's refund tests, where any nonzero override is rejected by
 * the validator before direction even matters) or no usable rate was
 * supplied at all.
 */
export function refundLegReversalSign(
  originalNetByCurrency: Record<string, number>,
  currency: string,
  exchangeRate?: number,
): 1 | -1 {
  if (isUsableRefundExchangeRate(exchangeRate)) {
    let totalValueUsd = 0;
    for (const [curr, net] of Object.entries(originalNetByCurrency)) {
      const toUsd = curr === "LBP" ? 1 / exchangeRate : 1;
      totalValueUsd += net * toUsd;
    }
    if (totalValueUsd !== 0) return totalValueUsd < 0 ? 1 : -1;
  }
  const ownNet = originalNetByCurrency[currency] ?? 0;
  return ownNet < 0 ? 1 : -1;
}

/**
 * ONE definition (rule 14) of "does this set of operator-chosen refund legs
 * reproduce the given per-currency net" — shared by TransactionRepository's
 * whole-transaction refund override (`_validateRefundLegOverride`, fed the
 * transaction's own net), SalesRepository's per-item refund override (fed
 * the item's PROPORTIONAL share of the sale's net), and
 * `refundSessionBasketItem`'s money-back remainder check. `entityId` is only
 * used to annotate the thrown error.
 *
 * LIRA-236 — `exchangeRate` (LBP per 1 USD) is optional and changes HOW the
 * legs are checked, never WHICH legs are allowed per-leg (every per-leg rule
 * below — positive amount, USD/LBP only, active drawer-affecting method —
 * applies identically either way):
 *   - OMITTED: today's exact behavior, unchanged — per CURRENCY, the legs'
 *     total must equal that currency's own original net within
 *     `REFUND_LEG_AMOUNT_EPSILON`. A currency with legs but no original net
 *     (or vice versa) fails this per-currency check, which is what made a
 *     cross-currency refund (USD sale, LBP legs) impossible before this
 *     rate existed to convert between them.
 *   - GIVEN: checked by TOTAL VALUE instead — every amount (both the
 *     original net and the legs) is converted to a USD-equivalent
 *     (`usd + lbp / exchangeRate`) and summed across ALL currencies into
 *     ONE number on each side, compared within `REFUND_VALUE_TOLERANCE_USD`.
 *     This is deliberately not "convert one currency then still check each
 *     currency separately" — the whole point (REFUND_EXCHANGE_RATE_PLAN.md
 *     §1) is a $50 item refundable as $20 + the rest in LBP, or all LBP, or
 *     any other mix whose VALUE at the typed rate matches.
 */
export function validateRefundLegOverrideAmounts(
  originalNetByCurrency: Record<string, number>,
  refundLegs: RefundLegOverride[],
  entityId: number,
  exchangeRate?: number,
): void {
  const EPSILON = REFUND_LEG_AMOUNT_EPSILON;

  const paymentMethodRepo = getPaymentMethodRepository();
  const overrideNet: Record<string, number> = {};
  for (const leg of refundLegs) {
    if (!(leg.amount > 0)) {
      throw new DatabaseError(
        `Refund method override: leg amount must be greater than 0 (got ${leg.amount} ${leg.currencyCode})`,
        { entityId },
      );
    }
    if (!CUSTOMER_CASH_CURRENCIES.has(leg.currencyCode)) {
      throw new DatabaseError(
        `Refund method override: currency "${leg.currencyCode}" is not a supported refund currency (USD or LBP)`,
        { entityId },
      );
    }
    const pm = paymentMethodRepo.getByCode(leg.method);
    if (!pm || pm.is_active !== 1 || pm.affects_drawer !== 1) {
      throw new DatabaseError(
        `Refund method override: "${leg.method}" is not an active, drawer-affecting payment method`,
        { entityId },
      );
    }
    overrideNet[leg.currencyCode] =
      (overrideNet[leg.currencyCode] ?? 0) + leg.amount;
  }

  const currencies = new Set([
    ...Object.keys(originalNetByCurrency),
    ...Object.keys(overrideNet),
  ]);
  if (currencies.size === 0) {
    throw new DatabaseError(
      "Refund method override: this transaction has no customer-facing payment to refund",
      { entityId },
    );
  }

  if (isUsableRefundExchangeRate(exchangeRate)) {
    // Value-based check — ONE USD-equivalent number per side, summed across
    // every currency (LIRA-236). `originalNetByCurrency` is SIGNED (see the
    // per-currency branch's own comment below for why) — the signed nets
    // are summed FIRST and only THEN taken as one absolute value
    // (`originalValueUsd`), never `Math.abs`'d per currency and summed
    // after. A mixed-currency original (e.g. a $100 USD payment with a
    // 895,000 LBP change leg — net USD +100, net LBP -895,000) has a real
    // customer-facing value of $90 (100 - 10), not $110
    // (|100| + |-895000/89500|): summing the absolute values per currency
    // double-counts the change leg as if it were a SECOND payment instead
    // of a partial giveback of the first, rejecting the correct $90 refund
    // and wrongly accepting a $110 one (F1, round-3 review). The override
    // side stays a sum of positive magnitudes — every `RefundLegOverride`
    // amount is already validated `> 0` above, so there is no sign to lose
    // there.
    let originalNetValueUsd = 0;
    let overrideValueUsd = 0;
    for (const currency of currencies) {
      const original = originalNetByCurrency[currency] ?? 0;
      const override = overrideNet[currency] ?? 0;
      const toUsd = currency === "LBP" ? 1 / exchangeRate : 1;
      originalNetValueUsd += original * toUsd;
      overrideValueUsd += override * toUsd;
    }
    const originalValueUsd = Math.abs(originalNetValueUsd);
    if (
      Math.abs(originalValueUsd - overrideValueUsd) > REFUND_VALUE_TOLERANCE_USD
    ) {
      throw new DatabaseError(
        `Refund method override: refund legs do not match the original payment's value at rate ${exchangeRate} — ` +
          `original value $${originalValueUsd.toFixed(2)}, refund legs value $${overrideValueUsd.toFixed(2)}`,
        { entityId },
      );
    }
    return;
  }

  for (const currency of currencies) {
    // Magnitude comparison — see `_validateRefundLegOverride`'s doc comment
    // for why `originalNetByCurrency` is signed while the override is always
    // a positive magnitude sum.
    const original = Math.abs(originalNetByCurrency[currency] ?? 0);
    const override = overrideNet[currency] ?? 0;
    const epsilon = EPSILON[currency] ?? 0.01;
    if (Math.abs(original - override) > epsilon) {
      throw new DatabaseError(
        `Refund method override: ${currency} totals do not match the original payment — ` +
          `original ${original}, refund legs total ${override}`,
        { entityId },
      );
    }
  }
}

/**
 * Operator-chosen return method for ONE currency of a refund (LIRA-078). The
 * money contract is METHOD-OVERRIDE ONLY: `amount`/`currencyCode` together
 * must reproduce the original transaction's own net customer-facing total for
 * that currency (see `_validateRefundLegOverride`) — the operator picks which
 * drawer the money leaves from, never the amount or the currency. Multiple
 * entries for the same currency are allowed (a split return, e.g. part CASH +
 * part OMT) as long as they sum correctly.
 */
export interface RefundLegOverride {
  /** A payment method code (payment_methods.code) — must be active and
   *  drawer-affecting (CUSTOMER_ACCOUNT/GIFT_CARD rejected). */
  method: string;
  /** "USD" or "LBP" — cross-currency refunds are out of scope (see the
   *  money contract doc on `refundTransaction`). */
  currencyCode: string;
  /** Absolute amount returned via this method, in `currencyCode`. */
  amount: number;
}

/**
 * LIRA-143 phase 4 (rule 20) — the phone-refund UI's per-unit flag override,
 * riding alongside `refundLegs` on the SAME `refundTransaction` call (rule
 * 16: one IPC payload, no follow-up call). `unit_id` must be part of the
 * sale being refunded — validated by `_validateRefundUnitExtras` BEFORE any
 * unit is flipped (see `_reverseProductUnits`). `is_defective`/
 * `warranty_override_until` follow `ProductUnitRepository.markInStock`'s own
 * option semantics: `undefined`/omitted leaves the existing value untouched;
 * an explicit `null` for `warranty_override_until` clears it.
 */
export interface RefundUnitExtra {
  unit_id: number;
  is_defective?: boolean;
  warranty_override_until?: string | null;
}

/**
 * ONE definition (rule 14) of "does every `unit_id` in this refund's
 * `unitExtras` belong to the linked-unit set it's being checked against" —
 * free-function counterpart to `TransactionRepository._validateRefundUnitExtras`
 * (which now delegates here), also consumed directly by
 * `SalesRepository.refundSaleItem`'s per-item override, which checks against
 * THAT SALE ITEM's own linked units only (never the whole sale's — a unit
 * belonging to a sibling line on the same sale must still be rejected).
 * Throws BEFORE any unit is flipped — an id outside `linkedUnitIds` is
 * operator error, not data to half-apply, same discipline as
 * `validateRefundLegOverrideAmounts`. `entityId`/`entityLabel` only shape the
 * thrown message (e.g. "... is not linked to sale #12" vs "... is not linked
 * to sale item #34").
 */
export function validateRefundUnitExtras(
  linkedUnitIds: Set<number>,
  unitExtras: RefundUnitExtra[],
  entityId: number,
  entityLabel: string,
): void {
  for (const extra of unitExtras) {
    if (!linkedUnitIds.has(extra.unit_id)) {
      throw new DatabaseError(
        `Refund unit extras: product unit #${extra.unit_id} is not linked to ${entityLabel} #${entityId}`,
        { entityId },
      );
    }
  }
}

/** One row of the D1 currency in/out by-date report. */
export interface CashFlowByDateRow {
  /** Business date (YYYY-MM-DD): transaction_time when set, else created_at. */
  date: string;
  currency_code: string;
  total_in: number;
  total_out: number;
}

export interface CreateTransactionInput {
  type: TransactionType;
  source_table: string;
  source_id: number;
  user_id: number;
  /** Denominated value of the transaction, NOT the tender (legs carry tender).
   *  Required: a row with no stated amount is unreadable in every report. */
  amount_usd: number;
  amount_lbp: number;
  profit_usd?: number;
  profit_lbp?: number;
  /** USD↔LBP rate stamp. Omit to snapshot the current market rate; pass an
   *  explicit null only to opt out of a rate stamp entirely. */
  exchange_rate?: number | null;
  client_id?: number | null;
  client_name?: string | null;
  /** Requires client_name — a bare phone number is never a valid identity. */
  client_phone?: string | null;
  /** Required, non-blank: the human-readable row label in the transactions table. */
  summary: string;
  /** Required: flow-specific facts (provider, service_type, item_key, …) that
   *  filters and receipts read. Pass {} only if the flow truly has none. */
  metadata_json: Record<string, unknown>;
  device_id?: string;
  transaction_time?: string;
}

export interface TransactionFilters {
  type?: TransactionType;
  status?: TransactionStatus;
  user_id?: number;
  client_id?: number;
  source_table?: string;
  from?: string;
  to?: string;
  provider?: string;
  service_type?: string;
  has_item_key?: boolean;
  search?: string;
  /** Types to exclude from the result, applied before LIMIT (see getRecent). */
  excludeTypes?: TransactionType[];
  /**
   * Transactions page multi-select Type filter: a UNION of tuples, each one
   * shaped like the singular type/provider/service_type/has_item_key fields
   * above. getRecent() OR's the tuples together as ONE group and ANDs that
   * group with every other condition here (date range, search,
   * excludeTypes, status, …) — "Whish App Send" + "Katsh Bills" becomes
   * `(type=FINANCIAL_SERVICE AND provider=WHISH_APP AND service_type=SEND
   * AND item_key IS NULL) OR (type=FINANCIAL_SERVICE AND provider=Katsh AND
   * item_key IS NOT NULL)`.
   *
   * Non-empty `typeFilters` takes precedence over the singular
   * type/provider/service_type/has_item_key fields above — those keep
   * working unchanged for every other caller that only ever needs one
   * tuple (buildTypeTupleConditions is the single predicate shared by both
   * paths, rule 14).
   */
  typeFilters?: TransactionTypeFilterInput[];
}

/**
 * Builds the AND-ed SQL condition fragments for ONE type tuple
 * (type/provider/service_type/has_item_key), pushing its bound params onto
 * `params` in the same order. Shared by getRecent()'s singular filters AND
 * its typeFilters OR-group so this predicate is defined exactly once (rule
 * 14) — every value still lands in a `?` placeholder, never interpolated.
 */
function buildTypeTupleConditions(
  tuple: TransactionTypeFilterInput,
  params: unknown[],
): string[] {
  const conditions: string[] = [];
  if (tuple.type) {
    conditions.push("t.type = ?");
    params.push(tuple.type);
  }
  if (tuple.provider) {
    conditions.push("json_extract(t.metadata_json, '$.provider') = ?");
    params.push(tuple.provider);
  }
  if (tuple.service_type) {
    conditions.push("json_extract(t.metadata_json, '$.service_type') = ?");
    params.push(tuple.service_type);
  }
  if (tuple.has_item_key === true) {
    conditions.push("json_extract(t.metadata_json, '$.item_key') IS NOT NULL");
  } else if (tuple.has_item_key === false) {
    conditions.push("json_extract(t.metadata_json, '$.item_key') IS NULL");
  }
  return conditions;
}

export interface DailySummary {
  date: string;
  total_usd: number;
  total_lbp: number;
  by_type: Array<{
    type: string;
    count: number;
    total_usd: number;
    total_lbp: number;
  }>;
  void_count: number;
  void_usd: number;
  void_lbp: number;
}

/**
 * Owner decision 2026-10-07 — the rate a row's customer actually PAID at,
 * for the Transactions table's "@ rate". A session-basket member reads the
 * basket's checkout rate: a SALE its `sales.exchange_rate_snapshot`
 * (back-filled by `markSalePaid`), every other member
 * `customer_session_transactions.paid_exchange_rate` (v186) — each falling
 * back to the row's own `transactions.exchange_rate`, which is also what a
 * row outside any basket shows. This is the SQL twin of the preference
 * order `refundSessionItem` resolves in TypeScript ("checkoutRate"), so the
 * rate a refund defaults to and the rate the table shows cannot disagree.
 * Expects `t` = transactions and `cst` = its (LEFT JOINed) session
 * membership row, as `getRecent` aliases them.
 */
export const DISPLAY_EXCHANGE_RATE_SQL = `CASE
  WHEN cst.id IS NULL THEN t.exchange_rate
  WHEN t.type = 'SALE' AND t.source_table = 'sales' THEN COALESCE(
    (SELECT s.exchange_rate_snapshot FROM sales s
      WHERE s.id = t.source_id AND s.tenant_id = t.tenant_id),
    t.exchange_rate)
  ELSE COALESCE(cst.paid_exchange_rate, t.exchange_rate)
END`;

export interface TransactionWithUser extends TransactionEntity {
  username: string;
  client_name: string | null;
  /**
   * The rate to SHOW for this row ("@ rate"): see
   * `DISPLAY_EXCHANGE_RATE_SQL`. `exchange_rate` itself stays the stored
   * stamp (amount sort, profit conversion and refunds read that).
   */
  display_exchange_rate?: number | null;
  /**
   * The customer session this transaction belongs to (basket payment), or null.
   * Resolved via customer_session_transactions.unified_transaction_id = t.id.
   * Used by the viewer to group same-session rows and attach basket legs.
   */
  session_id: number | null;
  /**
   * The id of the ACTIVE REFUND row whose `reverses_id` points back at this
   * row, or null if this row has never been refunded (note 21d). Computed
   * via a correlated subquery over `reverses_id` (indexed —
   * idx_transactions_reverses) so the Transactions viewer can gate
   * Void/Refund WITHOUT needing that REFUND row loaded on the same
   * page/filter window: refundTransaction() deliberately leaves the
   * ORIGINAL row status=ACTIVE (so SALE/module + REFUND profit nets to
   * zero — see `_markSourceRefunded`), so `status`/`reverses_id` alone
   * can never reveal "this was refunded" on the original row. Mirrors
   * refundTransaction's own double-refund guard exactly (`reverses_id = id
   * AND type = 'REFUND'`, no status filter needed — a REFUND row's
   * `reverses_id` is always set, so `_assertReversible` already forbids it
   * from ever being voided/refunded itself, meaning it can never end up
   * non-ACTIVE).
   */
  reversed_by_id: number | null;
  /**
   * Structured in/out payment legs joined from the `payments` table (LIRA-064).
   * Computed read-only; never persisted into the stored `summary` text.
   * ALWAYS this row's OWN legs only — empty when it has none (LIRA-201b).
   * Before LIRA-201b a session member with no own legs inherited the WHOLE
   * basket's legs here, which printed the same pooled in/out on every row of
   * a session (owner-reported duplicate summary). The pooled legs are now
   * exposed separately, see `session_payments` below.
   */
  payments: TransactionPaymentLeg[];
  /**
   * CUSTOMER_ACCOUNT (on-account) legs charged directly against THIS
   * transaction (not a session basket), sourced from `debt_ledger` rather
   * than `payments` — a CUSTOMER_ACCOUNT settlement never touches a drawer,
   * so `SessionPaymentService.recordBasketPayment` deliberately skips
   * writing a `payments` row for it (see that file's non-drawer branch).
   * Kept SEPARATE from `payments` (rather than merged in) so the cash-only
   * `in:/out:` summary keeps its existing meaning; only method-display code
   * should read this field. Always absent for a session-basket row — its
   * on-account charge, if any, is pooled into `session_account_payments`
   * instead (LIRA-201b), never duplicated here.
   */
  account_payments?: TransactionPaymentLeg[];
  /**
   * LIRA-201b — the WHOLE session basket's pooled cash legs (the same
   * `payments` rows `basketLegsBySession` joins below), present on EVERY
   * row belonging to a session that has any (member rows AND the row that
   * happens to hold its own legs alike). Distinct from `payments`, which is
   * always this one row's own legs — the two used to be conflated (see that
   * field's doc). The Transactions viewer reads this field to render the
   * pooled in/out and payment detail ONCE, on a single session-group header
   * row, while every member's own `payments`/Amount column stays row-scoped.
   * Never fed into a void/refund/money computation — display only.
   */
  session_payments?: TransactionPaymentLeg[];
  /**
   * LIRA-201b — the session-basket analogue of `session_payments`, for the
   * pooled CUSTOMER_ACCOUNT settlement of the basket (same source query as
   * the old per-row `account_payments` inheritance). See `session_payments`'
   * doc for why this is separate from the per-row `account_payments` field.
   */
  session_account_payments?: TransactionPaymentLeg[];
  /**
   * LIRA-205 — net telecom credit returned to the shop on this transaction
   * (Only-Days sale of an MTC/Alfa card through iPick/Katsh), in USD. Only
   * USD-denominated CREDIT_RETURN legs are accumulated into this figure (see
   * `_attachPaymentLegs`'s doc comment on `returnedCreditsByTxn`) — the UI
   * renders it with a hard "$" prefix, so a non-USD leg must never reach it.
   *
   * ABSENT (never 0) on every transaction that posted no CREDIT_RETURN leg:
   * a zero on a money column is a claim that credit was returned and it was
   * nothing. Presence-keyed, not sum-keyed, so a hypothetical net-zero pair
   * still renders a figure rather than vanishing.
   *
   * Signed: the void/refund row carries the negated mirror `_reversePayments`
   * writes, so the original keeps its history and the reversal shows -N.
   */
  returned_credits_usd?: number;
  /**
   * LIRA-236 follow-up (2026-09-27 review) — true when THIS row is a
   * session-basket member that was netted as a payout at checkout (a loto
   * cash prize, a wallet/Binance cash-out, a negative-amount custom-service
   * payout) — i.e. `refundSessionBasketItem`/`getSessionItemRefundPreview`
   * would refuse the WHOLE basket this row belongs to
   * (`_assertNoNettedPayoutMembers`). Computed by `getRecent()` with the
   * shared `isSessionPayoutMember` predicate fed this member's
   * CUSTOMER-SIDE `customer_session_transactions` amount (see that method's
   * own doc for why, never the amount columns on THIS interface). Always
   * `false` for a non-session row (`session_id` null).
   */
  is_session_payout: boolean;
  /**
   * Coordinator follow-up (2026-09-27) — true when THIS row belongs to a
   * session basket where EVERY member has already been reversed (item by
   * item, or by an earlier whole-member refund/void) — i.e.
   * `voidSessionBasket`/`refundSessionBasket` would now refuse the basket
   * with "nothing left to refund" (`isSessionBasketFullyRefunded`'s own
   * doc). Computed ONCE per distinct `session_id` present in a `getRecent()`
   * page (never per row, never re-derived in SQL) and stamped onto every
   * row of that session. Always `false` for a non-session row.
   */
  session_fully_refunded: boolean;
}

export interface DebtAgingBuckets {
  client_id: number;
  current: { usd: number; lbp: number };
  days_31_60: { usd: number; lbp: number };
  days_61_90: { usd: number; lbp: number };
  over_90: { usd: number; lbp: number };
}

export interface OverdueDebtEntry {
  client_id: number;
  client_name: string;
  phone_number: string | null;
  total_usd: number;
  total_lbp: number;
  oldest_due_date: string;
  max_days_overdue: number;
  entry_count: number;
}

/**
 * Result of `voidCheckoutGroup` — CARRIER_LEGS_VOID_ASYMMETRY.md (design B+).
 */
export interface VoidCheckoutGroupResult {
  groupId: string;
  /** Total members found for this group (voided + already-voided-and-skipped). */
  memberCount: number;
  /** Original transaction ids that were voided by THIS call (excludes any
   *  already VOIDED before the call). */
  voidedTransactionIds: number[];
  /** Reversal transaction ids created, one per entry in voidedTransactionIds. */
  reversalIds: number[];
}

/**
 * Result of `voidSessionBasket` / `refundSessionBasket` (LIRA-115) — the
 * basket-level reversal option (a) routes to, mirroring
 * `VoidCheckoutGroupResult`'s shape for the split_group precedent (rule 14).
 */
export interface SessionBasketReversalResult {
  sessionId: number;
  /** Total items found linked to this session basket (reversed + any
   *  already-voided/refunded-and-skipped). */
  itemCount: number;
  /** Original item transaction ids reversed by THIS call (excludes any
   *  already VOIDED/refunded before the call). */
  reversedTransactionIds: number[];
  /** Reversal (VOID or REFUND) transaction ids created, one per entry in
   *  reversedTransactionIds. */
  reversalIds: number[];
}

/**
 * LIRA-232 phase 1 — read-only result of `TransactionRepository
 * .getSessionItemRefundPreview` (SESSION_ITEM_REFUND_PLAN.md §3's "expose a
 * read-only preview for the UI"). Post-adversarial-review rewrite (rule 27 —
 * every amount is a USD/LBP PAIR, never a single amount+currency tag): a
 * session-basket item can be dual-currency (a custom service priced $10 +
 * 450,000 LBP; a basket paid in a DIFFERENT currency mix than the item's
 * own), so `itemAmount`/`itemCurrency` (a single tagged value) silently
 * dropped whichever currency lost the tag-pick — see
 * SESSION_ITEM_REFUND_PLAN adversarial findings #2/#3.
 * `itemAmountUsd`/`itemAmountLbp` is A, split by currency; `accountReduction*`
 * is how much of the basket's outstanding 'Session Debt' this refund
 * actually cancels (capped by the client's CURRENT balance — finding #6);
 * `remainderUsd`/`remainderLbp` is R, split by currency — the part handed
 * back as cash, itself composed of (a) any already-repaid slice of the
 * account-attributed amount (finding #6) and (b) the basket's own pooled-IN
 * currency MIX applied to whatever was never attributed to the account at
 * all (finding #2's cross-currency fix); `defaultLegs` is the pre-fill a
 * transport can show editable, matching what `refundSessionBasketItem`
 * itself posts when the caller sends no `refundLegs` override.
 */
export interface SessionItemRefundPreview {
  itemAmountUsd: number;
  itemAmountLbp: number;
  accountReductionUsd: number;
  accountReductionLbp: number;
  remainderUsd: number;
  remainderLbp: number;
  defaultLegs: TransactionPaymentLeg[];
  /** Round-2 finding #10 (LOW) — the display name of the client the
   *  account reduction ACTUALLY lands on (the basket's own 'Session Debt'
   *  client, `debtClientId` — see finding #10's own doc on
   *  `_planSessionItemRefund`), which can differ from the refunded item's
   *  own buyer inside a basket. Only present when there IS an account
   *  reduction to name a client for. */
  accountClientName?: string;
  /** LIRA-236 — the default rate the popup shows: the refunded member's own
   *  recorded rate (or, when the caller's own request already carried an
   *  `exchangeRate`, that value — see `_planSessionItemRefund`'s
   *  `bookedRate` doc), else the day's fallback. Every `accountReduction*`/
   *  `remainder*` figure above was computed at THIS rate (or the caller's
   *  own typed one, when given). */
  bookedRate: number;
  bookedRateSource: "sale" | "transaction" | "fallback";
}

/** LIRA-232 phase 1 — `TransactionRepository.refundSessionBasketItem`'s
 *  payload. `saleItemId`/`quantity` are required together and only valid
 *  for a SALE member; omitting `saleItemId` on a SALE member refunds every
 *  remaining line in one operation (owner answer Q2). `unitExtras` (owner
 *  decision 2026-09-26) is the SAME "Returned phones" defective/warranty
 *  override shape `refundSaleItem` accepts — forwarded verbatim to
 *  `SalesRepository.applySaleItemReversalForSession` for a SALE member; a
 *  no-op for every other member type. */
export interface RefundSessionBasketItemInput {
  sessionId: number;
  transactionId: number;
  saleItemId?: number;
  quantity?: number;
  refundLegs?: RefundLegOverride[];
  unitExtras?: RefundUnitExtra[];
  userId: number;
  /** Rule 27 — reserved for a future day-dependent read in this flow;
   *  nothing here currently reads the clock, but the field is accepted so a
   *  caller can always supply it without a type error. */
  clientDay?: string;
  /** LIRA-236 — the cashier-typed exchange rate (LBP per 1 USD), driving
   *  BOTH the account-first cross-currency step and `refundLegs`' value-based
   *  validation. Omitted: the refunded member's own booked rate, else the
   *  day's fallback (`getSessionItemRefundPreview`'s `bookedRate`). */
  exchangeRate?: number;
  /** Owner decision 2026-10-07 — refund kept change: the cash handed back
   *  is short of the refund remainder by a small leftover, which the shop
   *  keeps as profit. Names come from `sessionItemRefundSchema` (the
   *  handler/route spread the parsed payload in). */
  kept_change_usd?: number;
  kept_change_lbp?: number;
}

/** See `SessionItemRefundPreview`'s doc for why every amount below is a
 *  USD/LBP pair (post-review rewrite — `itemAmount`/`itemCurrency`/
 *  `remainderAmount` no longer exist). */
export interface RefundSessionBasketItemResult {
  refundTransactionId: number;
  sessionId: number;
  memberTransactionId: number;
  itemAmountUsd: number;
  itemAmountLbp: number;
  accountReductionUsd: number;
  accountReductionLbp: number;
  remainderUsd: number;
  remainderLbp: number;
  legs: TransactionPaymentLeg[];
}

// =============================================================================
// Repository
// =============================================================================

export class TransactionRepository extends BaseRepository<TransactionEntity> {
  constructor() {
    super("transactions");
  }

  protected getColumns(): string {
    return [
      "id",
      "type",
      "status",
      "source_table",
      "source_id",
      "user_id",
      "amount_usd",
      "amount_lbp",
      "profit_usd",
      "profit_lbp",
      "exchange_rate",
      "client_id",
      "client_name",
      "client_phone",
      "reverses_id",
      "summary",
      "metadata_json",
      "device_id",
      "created_at",
    ].join(", ");
  }

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  /**
   * Create a new transaction record. Returns the new transaction ID.
   *
   * Completeness guards (every flow funnels through here — see
   * createGuards test): blank summaries and phone-without-name client
   * identities are rejected; a missing exchange_rate is snapshotted from the
   * current LBP market rate so reports can always convert the row.
   */
  createTransaction(data: CreateTransactionInput): number {
    if (!data.summary || data.summary.trim() === "") {
      throw new Error(
        `Transaction summary must be non-empty (type=${data.type}, source=${data.source_table}#${data.source_id})`,
      );
    }
    if (data.client_phone && !data.client_name) {
      throw new Error(
        `client_phone requires client_name (type=${data.type}, source=${data.source_table}#${data.source_id})`,
      );
    }

    const exchangeRate =
      data.exchange_rate !== undefined
        ? data.exchange_rate
        : this.snapshotExchangeRate();

    const metadataStr = data.metadata_json
      ? JSON.stringify(data.metadata_json)
      : null;

    const result = this.execute(
      `INSERT INTO transactions
        (type, source_table, source_id, user_id, amount_usd, amount_lbp,
         profit_usd, profit_lbp,
         exchange_rate, client_id, client_name, client_phone, summary, metadata_json, device_id, created_at, tenant_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?)`,
      data.type,
      data.source_table,
      data.source_id,
      data.user_id,
      data.amount_usd ?? 0,
      data.amount_lbp ?? 0,
      data.profit_usd ?? 0,
      data.profit_lbp ?? 0,
      exchangeRate ?? null,
      data.client_id ?? null,
      data.client_name ?? null,
      data.client_phone ?? null,
      data.summary ?? null,
      metadataStr,
      data.device_id ?? null,
      data.transaction_time ?? null,
      getCurrentTenantId(),
    );

    return result.lastInsertRowid as number;
  }

  /**
   * LIRA-229 — update the mutable fields of an EXISTING ACTIVE, non-reversal
   * transaction row in place, instead of writing a new one. A POS sale's
   * `transactions` row is written exactly once, when the sale becomes
   * `completed` (see the `status === "completed"` gate in
   * `SalesRepository.processSale`) — a draft never reaches this at all.
   * This method exists only to keep that "exactly once" true if
   * `processSale` is ever called AGAIN with `status: "completed"` for a
   * sale that already has one (a retry/double-submit): `processSale` looks
   * up its own anchor row by `source_table`/`source_id`
   * (`getActiveSaleTransactionId`) and calls this instead of
   * `createTransaction` when it already exists. Never touches `type`,
   * `source_table`, `source_id`, `status`, or `created_at` — the row's
   * identity, ACTIVE status and original timestamp stay fixed; only its
   * content changes. Guarded by `status = 'ACTIVE'` so this can never
   * mutate an already VOIDED row or a void's negated reversal row.
   */
  updateTransactionCore(
    id: number,
    data: Omit<
      CreateTransactionInput,
      "source_table" | "source_id" | "type" | "transaction_time"
    >,
  ): void {
    if (!data.summary || data.summary.trim() === "") {
      throw new Error(
        `Transaction summary must be non-empty (updating id=${id})`,
      );
    }
    if (data.client_phone && !data.client_name) {
      throw new Error(`client_phone requires client_name (updating id=${id})`);
    }

    const exchangeRate =
      data.exchange_rate !== undefined
        ? data.exchange_rate
        : this.snapshotExchangeRate();

    const metadataStr = data.metadata_json
      ? JSON.stringify(data.metadata_json)
      : null;

    this.execute(
      `UPDATE transactions SET
         user_id = ?, amount_usd = ?, amount_lbp = ?, profit_usd = ?, profit_lbp = ?,
         exchange_rate = ?, client_id = ?, client_name = ?, client_phone = ?,
         summary = ?, metadata_json = ?, device_id = ?
       WHERE id = ? AND tenant_id = ? AND status = 'ACTIVE'`,
      data.user_id,
      data.amount_usd ?? 0,
      data.amount_lbp ?? 0,
      data.profit_usd ?? 0,
      data.profit_lbp ?? 0,
      exchangeRate ?? null,
      data.client_id ?? null,
      data.client_name ?? null,
      data.client_phone ?? null,
      data.summary ?? null,
      metadataStr,
      data.device_id ?? null,
      id,
      getCurrentTenantId(),
    );
  }

  /**
   * Snapshot the current USD→LBP market rate for rows created without an
   * explicit exchange_rate. Fail-soft: partial schemas (older test fixtures)
   * and missing rate rows yield null — a write must never fail on this.
   */
  private snapshotExchangeRate(): number | null {
    try {
      const rate = getRateRepository().findByCode("LBP");
      return rate ? rate.market_rate : null;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  /**
   * Get recent transactions with optional filters.
   */
  /**
   * D1 — currency in/out by business date. Aggregates customer-facing cash
   * legs (same rule as the transactions table's in/out column) per date and
   * currency. transactions.created_at IS the business date: createTransaction
   * COALESCEs the caller's transaction_time into it, so backdated entries
   * already land on their business date. Session-basket legs (no transaction
   * of their own) bucket by their payment date.
   */
  getCashFlowByDate(from: string, to: string): CashFlowByDateRow[] {
    const tenantId = getCurrentTenantId();
    return this.query<CashFlowByDateRow>(
      `SELECT
         l.date,
         l.currency_code,
         ROUND(SUM(CASE WHEN l.amount > 0 THEN l.amount ELSE 0 END), 2) AS total_in,
         ROUND(SUM(CASE WHEN l.amount < 0 THEN -l.amount ELSE 0 END), 2) AS total_out
       FROM (
         SELECT ${localDayExpr("t.created_at")} AS date,
                p.currency_code, p.amount, p.method, p.drawer_name, p.note
           FROM payments p
           JOIN transactions t ON t.id = p.transaction_id AND t.tenant_id = ?
          WHERE t.status = 'ACTIVE' AND p.tenant_id = ?
         UNION ALL
         SELECT ${localDayExpr("p.created_at")} AS date,
                p.currency_code, p.amount, p.method, p.drawer_name, p.note
           FROM payments p
          WHERE p.transaction_id IS NULL AND p.session_id IS NOT NULL AND p.tenant_id = ?
       ) l
       WHERE l.date BETWEEN ? AND ?
         AND ${customerCashLegSql("l")}
       GROUP BY l.date, l.currency_code
       ORDER BY l.date DESC`,
      tenantId,
      tenantId,
      tenantId,
      from,
      to,
    );
  }

  /**
   * OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-189, §8.4/§11) — `getRecent()` had
   * its OWN hand-listed SELECT column set (rule 14 drift from
   * `getColumns()`, needed here because of the `users`/`clients` JOINs and
   * the computed `reversed_by_id` subquery) that never included
   * `profit_usd`/`profit_lbp`, even though `TransactionWithUser` — via
   * `TransactionEntity` — has always declared both as real, non-optional
   * columns. Every caller reading `.profit_usd` off a `getRecent()` row
   * therefore silently got `undefined` (falsy, reads as 0) regardless of
   * the transaction's REAL stamped profit — not a money-posting bug (the
   * column itself is written correctly by every writer), but a reporting
   * gap: any feature auditing profit through the "recent transactions"
   * journal (exactly what LIRA-189's deferred cashout-commission
   * recognition, D14, needs to prove) silently saw $0. Found via
   * `lira-189-omt-account-settlement.spec.ts` asserting a settlement's
   * recognised profit through `transactions.getRecent()` — the DB row was
   * correct; only this read path dropped it.
   */
  getRecent(limit = 50, filters?: TransactionFilters): TransactionWithUser[] {
    const tenantId = getCurrentTenantId();
    const conditions: string[] = ["t.tenant_id = ?"];
    const params: unknown[] = [tenantId];

    if (filters?.status) {
      conditions.push("t.status = ?");
      params.push(filters.status);
    }
    if (filters?.user_id) {
      conditions.push("t.user_id = ?");
      params.push(filters.user_id);
    }
    if (filters?.client_id) {
      conditions.push("t.client_id = ?");
      params.push(filters.client_id);
    }
    if (filters?.source_table) {
      conditions.push("t.source_table = ?");
      params.push(filters.source_table);
    }
    if (filters?.from) {
      conditions.push("t.created_at >= ?");
      params.push(filters.from);
    }
    if (filters?.to) {
      conditions.push("t.created_at <= ?");
      params.push(filters.to);
    }

    // Type/provider/service_type/has_item_key — either the classic single
    // tuple (top-level fields, unchanged for every existing caller) or the
    // Transactions page's multi-select `typeFilters` union. Both funnel
    // through buildTypeTupleConditions() so the predicate is defined exactly
    // once (rule 14). A non-empty typeFilters wins: its tuples are OR'd
    // together as ONE group, which is then ANDed with every condition here
    // (the group is dropped entirely if every tuple turns out empty).
    if (filters?.typeFilters && filters.typeFilters.length > 0) {
      const orGroups = filters.typeFilters
        .map((tuple) => buildTypeTupleConditions(tuple, params))
        .filter((tupleConditions) => tupleConditions.length > 0)
        .map((tupleConditions) => `(${tupleConditions.join(" AND ")})`);
      if (orGroups.length > 0) {
        conditions.push(`(${orGroups.join(" OR ")})`);
      }
    } else {
      conditions.push(
        ...buildTypeTupleConditions(
          {
            type: filters?.type,
            provider: filters?.provider,
            service_type: filters?.service_type,
            has_item_key: filters?.has_item_key,
          },
          params,
        ),
      );
    }

    if (filters?.search) {
      const term = `%${filters.search}%`;
      conditions.push(
        "(t.summary LIKE ? OR t.client_name LIKE ? OR u.username LIKE ?)",
      );
      params.push(term, term, term);
    }
    if (filters?.excludeTypes && filters.excludeTypes.length > 0) {
      const placeholders = filters.excludeTypes.map(() => "?").join(", ");
      conditions.push(`t.type NOT IN (${placeholders})`);
      params.push(...filters.excludeTypes);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    params.push(limit);

    const rawRows = this.query<
      TransactionWithUser & {
        cst_amount_usd: number | null;
        cst_amount_lbp: number | null;
      }
    >(
      `SELECT t.id, t.type, t.status, t.source_table, t.source_id,
              t.user_id, t.amount_usd, t.amount_lbp, t.profit_usd, t.profit_lbp,
              t.exchange_rate,
              ${DISPLAY_EXCHANGE_RATE_SQL} AS display_exchange_rate,
              t.client_id, t.client_phone,
              t.reverses_id, t.summary, t.metadata_json,
              t.device_id, t.created_at,
              u.username,
              COALESCE(t.client_name, c.full_name) AS client_name,
              cst.session_id AS session_id,
              cst.amount_usd AS cst_amount_usd,
              cst.amount_lbp AS cst_amount_lbp,
              (SELECT r.id FROM transactions r
                WHERE r.reverses_id = t.id
                  AND r.type = 'REFUND'
                  AND r.tenant_id = t.tenant_id
                LIMIT 1) AS reversed_by_id
       FROM transactions t
       LEFT JOIN users u ON u.id = t.user_id AND u.tenant_id = ?
       LEFT JOIN clients c ON c.id = t.client_id AND c.tenant_id = ?
       LEFT JOIN customer_session_transactions cst
              ON cst.unified_transaction_id = t.id AND cst.tenant_id = ?
       ${where}
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT ?`,
      tenantId,
      tenantId,
      tenantId,
      ...params,
    );

    // LIRA-236 follow-up (2026-09-27 review) — `is_session_payout`, computed
    // HERE in TypeScript with the ONE shared `isSessionPayoutMember`
    // predicate (rule 14 — the exact same one
    // `_assertNoNettedPayoutMembers`/`_planSessionItemRefund` use to REFUSE a
    // session item refund on a basket that contains a netted payout), never
    // re-derived in SQL. Fed the member's CUSTOMER-SIDE `cst.amount_usd/lbp`
    // — never `t.amount_usd/lbp` — for the same reason
    // `_assertNoNettedPayoutMembers` reads `cst`: a FINANCIAL_SERVICE RECEIVE
    // payout's own unified `transactions` row carries the POSITIVE transfer
    // amount; only the pooled `customer_session_transactions` row carries
    // the negative customer-side payout sign. A non-session row (no `cst`
    // match, `session_id` null) always reads false.
    const rowsWithPayoutFlag = rawRows.map((row) => {
      const { cst_amount_usd, cst_amount_lbp, ...rest } = row;
      const payoutCandidate: SessionPayoutMemberCandidate = {
        type: row.type,
        amount_usd: cst_amount_usd ?? 0,
        amount_lbp: cst_amount_lbp ?? 0,
        status: row.status,
        reverses_id: row.reverses_id,
      };
      // F4/F6 (round-3 review) — the SAME `_isNettedSessionPayoutMember`
      // predicate `_assertNoNettedPayoutMembers` refuses on (rule 14), so
      // this flag and that guard can never disagree about which payout
      // hides the "Refund item" button. Short-circuits on the cheap sign
      // check FIRST (`isSessionPayoutMember`, no DB access) before the
      // FINANCIAL_SERVICE provider lookup — the overwhelming majority of
      // rows in any page are not payouts at all.
      const isSessionPayout =
        row.session_id != null && isSessionPayoutMember(payoutCandidate);
      return {
        ...rest,
        is_session_payout:
          isSessionPayout &&
          this._isNettedSessionPayoutMember(payoutCandidate, row.id),
      };
    });

    // Coordinator follow-up (2026-09-27, batched 2026-09-28 — N+1 fix) —
    // `session_fully_refunded`, computed for every DISTINCT session present
    // on this page in a small, constant number of set-based queries
    // (`isSessionBasketFullyRefundedBatch`, rule 14 — the SAME predicate the
    // void/refund guards use via `isSessionBasketFullyRefunded`, which is
    // now itself defined in terms of this batch call), then stamped onto
    // every row of that session. A page of up to 5,000 rows across up to
    // 250 fully-refunded sessions used to cost ~1,750 extra one-off
    // per-session queries; this costs a handful regardless of page size.
    const distinctSessionIds = Array.from(
      new Set(
        rowsWithPayoutFlag
          .map((r) => r.session_id)
          .filter((id): id is number => id != null),
      ),
    );
    const fullyRefundedBySession =
      this.isSessionBasketFullyRefundedBatch(distinctSessionIds);
    const rows: TransactionWithUser[] = rowsWithPayoutFlag.map((row) => ({
      ...row,
      session_fully_refunded:
        row.session_id != null
          ? (fullyRefundedBySession.get(row.session_id) ?? false)
          : false,
    }));

    return this._attachPaymentLegs(rows);
  }

  /**
   * Batch-load structured in/out payment legs for a set of transaction rows and
   * attach them as `row.payments` (LIRA-064). One `IN (...)` query covers every
   * row, so this stays O(1) round-trips regardless of page size.
   *
   * Legs are derived purely from the joined `payments` table; the stored
   * `summary` text is never modified.
   */
  private _attachPaymentLegs(
    rows: TransactionWithUser[],
  ): TransactionWithUser[] {
    if (rows.length === 0) return rows;

    const tenantId = getCurrentTenantId();
    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => "?").join(", ");

    const legRows = this.query<{
      transaction_id: number;
      method: string;
      drawer_name: string;
      currency_code: string;
      amount: number;
      note: string | null;
    }>(
      `SELECT transaction_id, method, drawer_name, currency_code, amount, note
       FROM payments
       WHERE transaction_id IN (${placeholders}) AND tenant_id = ?
       ORDER BY id ASC`,
      ...ids,
      tenantId,
    );

    const toLeg = (p: {
      method: string;
      drawer_name: string;
      currency_code: string;
      amount: number;
      note: string | null;
    }): TransactionPaymentLeg | null => {
      // Surface only customer-facing cash — shared rule (see isInternalLegJs).
      if (isInternalLegJs(p)) return null;
      return {
        direction: p.amount < 0 ? "out" : "in",
        amount: Math.abs(p.amount),
        signed_amount: p.amount,
        currency_code: p.currency_code,
        method: p.method,
        // exactOptionalPropertyTypes: never assign `drawer_name: undefined`.
        // Guard on truthiness — the column can be NULL at runtime even
        // though the query's row type declares it `string`.
        ...(p.drawer_name ? { drawer_name: p.drawer_name } : {}),
        ...(p.note === SESSION_BASKET_REVERSAL_NOTE
          ? { reversal: true as const }
          : {}),
      };
    };

    // A CUSTOMER_ACCOUNT settlement never writes a `payments` row (no drawer
    // movement), so its method leg is reconstructed from the matching
    // `debt_ledger` charge. One builder, shared by both the session and the
    // non-session paths below (rule 14).
    const debtToAccountLegs = (
      amount_usd: number,
      amount_lbp: number,
    ): TransactionPaymentLeg[] => {
      const legs: TransactionPaymentLeg[] = [];
      if (amount_usd !== 0) {
        legs.push({
          direction: amount_usd < 0 ? "out" : "in",
          amount: Math.abs(amount_usd),
          signed_amount: amount_usd,
          currency_code: "USD",
          method: "CUSTOMER_ACCOUNT",
        });
      }
      if (amount_lbp !== 0) {
        legs.push({
          direction: amount_lbp < 0 ? "out" : "in",
          amount: Math.abs(amount_lbp),
          signed_amount: amount_lbp,
          currency_code: "LBP",
          method: "CUSTOMER_ACCOUNT",
        });
      }
      return legs;
    };

    // LIRA-205 — net returned-credits figure per transaction, accumulated
    // from the SAME batch query above (no new SQL, no new round-trip).
    //
    // Restricted to USD legs: the field is named (and rendered by the UI,
    // TransactionCells.tsx's ReturnedCreditsCell) as a hard-"$" USD amount,
    // and the sole writer (FinancialServiceRepository.processTelecomCreditReturn)
    // always posts the leg in "USD" — so today this filter changes nothing in
    // practice. It exists so a future non-USD CREDIT_RETURN leg does not get
    // silently summed into a column that presents itself as dollars (a wrong
    // number wearing a currency symbol is worse than a leg this column simply
    // doesn't cover yet); adding real multi-currency display is out of scope
    // for this fix.
    const returnedCreditsByTxn = new Map<number, number>();

    const byTxn = new Map<number, TransactionPaymentLeg[]>();
    for (const p of legRows) {
      if (p.method === CREDIT_RETURN_LEG_METHOD && p.currency_code === "USD") {
        returnedCreditsByTxn.set(
          p.transaction_id,
          (returnedCreditsByTxn.get(p.transaction_id) ?? 0) + p.amount,
        );
      }
      const leg = toLeg(p);
      if (!leg) continue;
      const legs = byTxn.get(p.transaction_id) ?? [];
      legs.push(leg);
      byTxn.set(p.transaction_id, legs);
    }

    // Session-basket pooled legs: EVERY row belonging to a session gets the
    // session's basket legs attached as `session_payments`/
    // `session_account_payments` (below), regardless of whether that row also
    // carries its own customer-cash legs in `payments` — a session member with
    // an own leg (e.g. a linked exchange) still needs the pooled total so the
    // UI can render it once, on whichever row it picks as the group header
    // (TransactionsViewer.tsx). One IN(...) query batch-loads every distinct
    // session, keeping this O(1) round-trips.
    const sessionIds = Array.from(
      new Set(
        rows
          .filter((r) => r.session_id != null)
          .map((r) => r.session_id as number),
      ),
    );
    const basketLegsBySession = new Map<number, TransactionPaymentLeg[]>();
    const accountLegsBySession = new Map<number, TransactionPaymentLeg[]>();
    if (sessionIds.length > 0) {
      const sPlaceholders = sessionIds.map(() => "?").join(", ");
      const basketRows = this.query<{
        session_id: number;
        method: string;
        drawer_name: string;
        currency_code: string;
        amount: number;
        note: string | null;
      }>(
        `SELECT session_id, method, drawer_name, currency_code, amount, note
         FROM payments
         WHERE session_id IN (${sPlaceholders}) AND tenant_id = ?
         ORDER BY id ASC`,
        ...sessionIds,
        tenantId,
      );
      for (const p of basketRows) {
        const leg = toLeg(p);
        if (!leg) continue;
        const legs = basketLegsBySession.get(p.session_id) ?? [];
        legs.push(leg);
        basketLegsBySession.set(p.session_id, legs);
      }

      // CUSTOMER_ACCOUNT settlement of the same basket, if any — see the
      // `account_payments` doc comment on TransactionWithUser for why this is
      // a separate table/field rather than another `payments` row.
      // ACCOUNT_CHARGE_PREDICATE excludes 'Refund Reversal': reversal rows also
      // carry a transaction_id/session_id but belong to the refund transaction,
      // which shows its own real method — a refund must never render a spurious
      // "Customer Account" leg. Shared verbatim by the non-session lookup below.
      const debtRows = this.query<{
        session_id: number;
        amount_usd: number;
        amount_lbp: number;
      }>(
        `SELECT session_id, amount_usd, amount_lbp
         FROM debt_ledger
         WHERE session_id IN (${sPlaceholders}) AND tenant_id = ?
           AND ${ACCOUNT_CHARGE_PREDICATE}`,
        ...sessionIds,
        tenantId,
      );
      for (const d of debtRows) {
        const legs = accountLegsBySession.get(d.session_id) ?? [];
        legs.push(...debtToAccountLegs(d.amount_usd, d.amount_lbp));
        accountLegsBySession.set(d.session_id, legs);
      }
    }

    // Non-session on-account charges. Unlike the session-basket settlement, a
    // plain on-account sale/recharge/service/… writes its `debt_ledger` row with
    // `transaction_id` set and `session_id` NULL, so the session-keyed lookup
    // above misses it and the Method column renders blank. Reconstruct the same
    // CUSTOMER_ACCOUNT leg by `transaction_id`. `session_id IS NULL` keeps this
    // query-disjoint from the session path (session debt carries both keys), so
    // no row is ever attached twice.
    const accountLegsByTxn = new Map<number, TransactionPaymentLeg[]>();
    const txnDebtRows = this.query<{
      transaction_id: number;
      amount_usd: number;
      amount_lbp: number;
    }>(
      `SELECT transaction_id, amount_usd, amount_lbp
       FROM debt_ledger
       WHERE transaction_id IN (${placeholders})
         AND session_id IS NULL
         AND tenant_id = ?
         AND ${ACCOUNT_CHARGE_PREDICATE}`,
      ...ids,
      tenantId,
    );
    for (const d of txnDebtRows) {
      const legs = accountLegsByTxn.get(d.transaction_id) ?? [];
      legs.push(...debtToAccountLegs(d.amount_usd, d.amount_lbp));
      accountLegsByTxn.set(d.transaction_id, legs);
    }

    // Finding #11 — the 'Session Item Refund' credit (`ACCOUNT_CHARGE_
    // PREDICATE` now excludes it from the session-group query above) belongs
    // to its OWN REFUND transaction (`debt_ledger.transaction_id` = the
    // refund's id), not the whole session group — re-attach it there, same
    // shape as `accountLegsByTxn` above but keyed regardless of `session_id`
    // (the credit row always carries both).
    const creditRows = this.query<{
      transaction_id: number;
      amount_usd: number;
      amount_lbp: number;
    }>(
      `SELECT transaction_id, amount_usd, amount_lbp
       FROM debt_ledger
       WHERE transaction_id IN (${placeholders})
         AND transaction_type = ?
         AND tenant_id = ?`,
      ...ids,
      SESSION_ITEM_REFUND_CREDIT_TYPE,
      tenantId,
    );
    for (const d of creditRows) {
      const legs = accountLegsByTxn.get(d.transaction_id) ?? [];
      legs.push(...debtToAccountLegs(d.amount_usd, d.amount_lbp));
      accountLegsByTxn.set(d.transaction_id, legs);
    }

    for (const row of rows) {
      // LIRA-201b: `payments` is always this row's OWN legs only — never the
      // basket's pooled legs (that duplicated the same in/out on every
      // session member; see the field's doc comment). Pooled legs go on
      // `session_payments`/`session_account_payments` below instead, on
      // every row of the session so the viewer can pick whichever member is
      // currently visible to carry the group header (survives sorting/
      // filtering — TransactionsViewer.tsx).
      const own = byTxn.get(row.id);
      row.payments = own && own.length > 0 ? own : [];

      if (row.session_id != null) {
        const basketLegs = basketLegsBySession.get(row.session_id);
        if (basketLegs && basketLegs.length > 0) {
          row.session_payments = basketLegs;
        }
        const basketAccountLegs = accountLegsBySession.get(row.session_id);
        if (basketAccountLegs && basketAccountLegs.length > 0) {
          row.session_account_payments = basketAccountLegs;
        }
        // Finding #11 — a session-linked row can STILL own a per-transaction
        // account leg: specifically, a `refundSessionBasketItem` REFUND row
        // carrying its own 'Session Item Refund' credit (`creditRows` above).
        // Attached as `account_payments` (the row's OWN leg), never
        // `session_account_payments` (the whole group's pooled legs) — this
        // is what actually shows the credit on the REFUND row itself instead
        // of the session group.
        const ownAccountLegs = accountLegsByTxn.get(row.id);
        if (ownAccountLegs && ownAccountLegs.length > 0) {
          row.account_payments = ownAccountLegs;
        }
      } else {
        const accountLegs = accountLegsByTxn.get(row.id);
        if (accountLegs && accountLegs.length > 0) {
          row.account_payments = accountLegs;
        }
      }
      // LIRA-205 — conditional assignment only: never `= undefined`, so a
      // row with no CREDIT_RETURN leg has no key at all (absent, not 0).
      const returnedCredits = returnedCreditsByTxn.get(row.id);
      if (returnedCredits !== undefined) {
        row.returned_credits_usd = returnedCredits;
      }
    }

    return rows;
  }

  /**
   * Find the transaction row that corresponds to a specific source record.
   */
  getBySourceId(
    sourceTable: string,
    sourceId: number,
  ): TransactionEntity | null {
    return this.queryOne<TransactionEntity>(
      `SELECT ${this.getColumns()} FROM transactions
       WHERE source_table = ? AND source_id = ? AND status = 'ACTIVE' AND tenant_id = ?
       ORDER BY id DESC LIMIT 1`,
      sourceTable,
      sourceId,
      getCurrentTenantId(),
    );
  }

  /**
   * LIRA-229 — the id of a sale's own live SALE transaction row (the one
   * `SalesRepository.processSale` should UPDATE, via `updateTransactionCore`,
   * on a completion retry instead of inserting a second one), or null if
   * none exists yet — which is the case for a draft, and for a sale being
   * completed for the first time.
   *
   * Deliberately narrower than `getBySourceId` above: that method returns
   * the most-recently-created ACTIVE row for a source, which — once a sale
   * has been voided — is the void's own negated REFUND-shaped SALE
   * reversal row (still `type = 'SALE'`, ACTIVE, `reverses_id` set; see
   * `isVoidReversalRow`'s doc comment in ProfitRepository.ts). Reusing
   * `getBySourceId` here would let a later completion retry silently
   * overwrite that historical reversal record. `reverses_id IS NULL`
   * excludes it, so a retry attempted against an already-voided sale
   * correctly falls back to INSERTing a fresh row instead (defensive; not
   * a path any current caller reaches, since a voided sale is never
   * resubmitted).
   */
  getActiveSaleTransactionId(saleId: number): number | null {
    const row = this.queryOne<{ id: number }>(
      `SELECT id FROM transactions
       WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE'
         AND status = 'ACTIVE' AND reverses_id IS NULL AND tenant_id = ?
       ORDER BY id DESC LIMIT 1`,
      saleId,
      getCurrentTenantId(),
    );
    return row ? row.id : null;
  }

  /**
   * Get all transactions for a given client.
   */
  getByClientId(clientId: number, limit = 100): TransactionEntity[] {
    return this.query<TransactionEntity>(
      `SELECT ${this.getColumns()} FROM transactions
       WHERE client_id = ? AND tenant_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      clientId,
      getCurrentTenantId(),
      limit,
    );
  }

  /**
   * Get transactions in a date range with optional type filter.
   */
  getByDateRange(
    from: string,
    to: string,
    type?: TransactionType,
  ): TransactionEntity[] {
    const tenantId = getCurrentTenantId();
    if (type) {
      return this.query<TransactionEntity>(
        `SELECT ${this.getColumns()} FROM transactions
         WHERE created_at >= ? AND created_at <= ? AND type = ? AND tenant_id = ?
         ORDER BY created_at DESC`,
        from,
        to,
        type,
        tenantId,
      );
    }
    return this.query<TransactionEntity>(
      `SELECT ${this.getColumns()} FROM transactions
       WHERE created_at >= ? AND created_at <= ? AND tenant_id = ?
       ORDER BY created_at DESC`,
      from,
      to,
      tenantId,
    );
  }

  // ---------------------------------------------------------------------------
  // Accounting Journal Operations
  // ---------------------------------------------------------------------------

  /**
   * Void a transaction using the accounting journal pattern:
   * 1. Set original status to VOIDED
   * 2. Create a reversal row with negated amounts and reverses_id = original.id
   * 3. Reverse drawer balances via negated payment rows
   * 4. If SALE: mark sale as 'cancelled', restore stock, cancel debt
   *
   * Returns the reversal transaction's ID.
   */
  voidTransaction(id: number, userId: number): number {
    return this._voidTransactionInternal(id, userId, {});
  }

  /**
   * Void every non-voided member of a multi-unit split checkout
   * (CARRIER_LEGS_VOID_ASYMMETRY.md, design B+) in ONE db transaction —
   * siblings first, carrier last. Reuses `_voidTransactionInternal` per
   * member (with the split-group guard bypassed for THIS call only) so
   * drawer/debt/profit/partner-ledger reversal all run through the exact
   * same code a single `voidTransaction` uses — nothing new to keep in sync.
   * better-sqlite3 nests `db.transaction()` calls via savepoints, so the
   * whole group is genuinely atomic: a failure partway through rolls back
   * every member already voided in this call.
   *
   * Members already VOIDED (e.g. a re-run after a partial failure) are
   * skipped, not errored — idempotent re-invocation is safe. An unknown or
   * empty group throws NotFoundError. Legacy pre-fix rows carry no
   * `split_group` marker and can never be found by this method — see the
   * doc's legacy-row limitation.
   */
  voidCheckoutGroup(groupId: string, userId: number): VoidCheckoutGroupResult {
    if (!groupId || groupId.trim() === "") {
      throw new DatabaseError("groupId is required");
    }
    const tenantId = getCurrentTenantId();
    // json_extract (not a `metadata_json LIKE '%"split_group":"<id>"%'` scan)
    // — already the established pattern for querying this exact column in
    // this exact file (see the provider/service_type filters in getRecent
    // below), exact-match rather than substring, and safe: metadata_json is
    // always either NULL or `JSON.stringify`-produced (createTransaction),
    // so json_extract never sees malformed JSON, and `groupId` is a bound
    // parameter, never concatenated.
    const members = this.query<{
      id: number;
      status: TransactionStatus;
      metadata_json: string | null;
    }>(
      `SELECT id, status, metadata_json FROM transactions
       WHERE tenant_id = ? AND reverses_id IS NULL
         AND json_extract(metadata_json, '$.split_group') = ?
       ORDER BY id ASC`,
      tenantId,
      groupId,
    );
    if (members.length === 0) {
      throw new NotFoundError("split checkout group", groupId);
    }

    // Siblings first, carrier last (see method doc).
    const ranked = members
      .map((m) => ({
        ...m,
        role: this._getSplitGroup(m.metadata_json)?.role ?? null,
      }))
      .sort((a, b) => {
        const rank = (r: string | null) => (r === "carrier" ? 1 : 0);
        return rank(a.role) - rank(b.role);
      });

    return this.transaction(() => {
      const voidedTransactionIds: number[] = [];
      const reversalIds: number[] = [];
      for (const m of ranked) {
        if (m.status === "VOIDED") continue;
        const reversalId = this._voidTransactionInternal(m.id, userId, {
          allowSplitGroupMember: true,
        });
        voidedTransactionIds.push(m.id);
        reversalIds.push(reversalId);
      }
      return {
        groupId,
        memberCount: members.length,
        voidedTransactionIds,
        reversalIds,
      };
    });
  }

  /**
   * Void every item in a customer-session basket, PLUS the basket's own
   * pooled cash leg(s) and pooled 'Session Debt' charge, in ONE db
   * transaction (LIRA-115, option (a) — the per-item guard in
   * `_assertReversible` refuses a bare `voidTransaction` on any of these
   * rows and routes here instead, mirroring `voidCheckoutGroup`'s relationship
   * to the split_group guard).
   *
   * Each item is reversed via `_voidTransactionInternal` with
   * `allowSessionMember: true` — the EXACT same per-item reversal a standalone
   * `voidTransaction` would run (cost/provider-drawer legs, profit stamp,
   * carrier-line movements, supplier-ledger siblings, partner ledger, …), so
   * nothing module-specific needs reimplementing here (rule 14). This method
   * adds exactly the TWO things a per-item reversal structurally cannot see:
   * the pooled `payments` row(s) (`transaction_id IS NULL, session_id = ?`)
   * and the pooled `debt_ledger` 'Session Debt' row, each reversed exactly
   * ONCE for the whole basket — never per item, which would multiply the
   * reversal by the item count.
   *
   * Idempotent re-invocation is refused, not silently no-op'd: once the
   * pooled leg/debt has a reversal marker, a second call throws (see
   * `_assertSessionBasketReversible`) rather than risk double-reversing money
   * that was already returned.
   */
  voidSessionBasket(
    sessionId: number,
    userId: number,
  ): SessionBasketReversalResult {
    const tenantId = getCurrentTenantId();
    this._assertSessionBasketReversible(sessionId);
    // Coordinator follow-up (2026-09-27) — refuse up front (nothing
    // written) when every member was already refunded item by item; see
    // `isSessionBasketFullyRefunded`'s own doc.
    if (this.isSessionBasketFullyRefunded(sessionId)) {
      throw new BusinessRuleError(
        SESSION_BASKET_ALREADY_FULLY_REFUNDED_MESSAGE,
      );
    }
    // Finding #4 (BLOCKER, adversarial review) — `cst.transaction_type =
    // 'session_item_refund'` rows are NOT basket members to reverse; they
    // only LINK a prior `refundSessionBasketItem` call's own REFUND
    // transaction into the session group for display (§5). Before this
    // exclusion, that REFUND row's own `unified_transaction_id` was fetched
    // as an "item" here too and handed to `_voidTransactionInternal`, which
    // throws "REFUND transactions cannot be voided" (REFUND is
    // NON_REVERSIBLE and never session-bypassable) — making the WHOLE
    // basket permanently unreversable after even one item refund. See
    // `refundSessionBasket`'s identical fix immediately below for the twin
    // case (refund instead of void).
    const items = this.query<{ id: number; status: TransactionStatus }>(
      `SELECT t.id AS id, t.status AS status
       FROM customer_session_transactions cst
       JOIN transactions t ON t.id = cst.unified_transaction_id AND t.tenant_id = ?
       WHERE cst.session_id = ? AND cst.tenant_id = ? AND cst.transaction_type <> 'session_item_refund'
       ORDER BY cst.id ASC`,
      tenantId,
      sessionId,
      tenantId,
    );
    if (items.length === 0) {
      throw new NotFoundError("session basket", sessionId);
    }

    return this.transaction(() => {
      const reversedTransactionIds: number[] = [];
      const reversalIds: number[] = [];
      for (const item of items) {
        // Idempotent re-invocation safe, mirroring voidCheckoutGroup's own
        // already-voided skip — a partial-progress re-run never happens in
        // practice (the whole loop + pooled reversal below is ONE db
        // transaction, so a mid-loop failure rolls back everything), but a
        // deliberate second call after a full success is still handled
        // gracefully rather than throwing on item #1's "already voided".
        if (item.status === "VOIDED") continue;
        const reversalId = this._voidTransactionInternal(item.id, userId, {
          allowSessionMember: true,
        });
        reversedTransactionIds.push(item.id);
        reversalIds.push(reversalId);
      }
      this._reverseSessionPooledPayments(sessionId, userId);
      this._cancelSessionDebt(sessionId, userId);
      return {
        sessionId,
        itemCount: items.length,
        reversedTransactionIds,
        reversalIds,
      };
    });
  }

  /**
   * Refund every item in a customer-session basket, PLUS the basket's own
   * pooled cash leg(s) and pooled 'Session Debt' charge, in ONE db
   * transaction. Same shape as `voidSessionBasket` (rule 14) but keeps every
   * original item ACTIVE and creates a REFUND row per item, matching
   * `refundTransaction`'s own accounting (rather than VOIDing the item) —
   * this is the path the owner's actual LIRA-115 report exercises
   * ("Refund of a service txn...").
   */
  refundSessionBasket(
    sessionId: number,
    userId: number,
  ): SessionBasketReversalResult {
    const tenantId = getCurrentTenantId();
    this._assertSessionBasketReversible(sessionId);
    // Coordinator follow-up (2026-09-27) — refuse up front (nothing
    // written) when every member was already refunded item by item; see
    // `isSessionBasketFullyRefunded`'s own doc.
    if (this.isSessionBasketFullyRefunded(sessionId)) {
      throw new BusinessRuleError(
        SESSION_BASKET_ALREADY_FULLY_REFUNDED_MESSAGE,
      );
    }
    // Finding #4 (BLOCKER) — see `voidSessionBasket`'s identical exclusion
    // above: a 'session_item_refund' cst row links a PRIOR item refund's own
    // REFUND transaction into the session group; it is not a basket member
    // to reverse a second time. For a non-SALE member this row's REFUND
    // falls through to the generic branch below and throws "REFUND
    // transactions cannot be voided or refunded" before this fix (a SALE
    // member's REFUND happened to be masked by the `source_table === 'sales'`
    // branch's own remaining-lines check, which is why this bug was
    // invisible on the SALE-only fixture and only surfaced on
    // recharge/custom-service members).
    const items = this.query<{ id: number; status: TransactionStatus }>(
      `SELECT t.id AS id, t.status AS status
       FROM customer_session_transactions cst
       JOIN transactions t ON t.id = cst.unified_transaction_id AND t.tenant_id = ?
       WHERE cst.session_id = ? AND cst.tenant_id = ? AND cst.transaction_type <> 'session_item_refund'
       ORDER BY cst.id ASC`,
      tenantId,
      sessionId,
      tenantId,
    );
    if (items.length === 0) {
      throw new NotFoundError("session basket", sessionId);
    }

    return this.transaction(() => {
      const reversedTransactionIds: number[] = [];
      const reversalIds: number[] = [];
      for (const item of items) {
        // Skip a member already voided, or already refunded by a prior call
        // to this same method (idempotent re-invocation — see
        // voidSessionBasket's identical comment).
        if (item.status === "VOIDED") continue;
        const alreadyRefunded = this.queryOne<{ id: number }>(
          `SELECT id FROM transactions WHERE reverses_id = ? AND type = 'REFUND' AND tenant_id = ?`,
          item.id,
          tenantId,
        );
        if (alreadyRefunded) continue;

        // LIRA-232 (Q1, SESSION_ITEM_REFUND_PLAN.md §9) — a SALE member that
        // was PARTIALLY reversed by a prior `refundSessionBasketItem` call
        // has `sale_items.refunded_quantity` set on some lines but the
        // member's OWN transaction is still ACTIVE with no `reverses_id`
        // pointing at it (item refunds never touch the member itself, only
        // its lines) — a bare `_refundTransactionInternal` on it would hit
        // `_assertNoPartialItemRefunds` and throw. Detect that state and
        // refund ONLY the remaining lines instead of the whole transaction.
        const original = this.findById(item.id);
        if (
          original &&
          original.source_table === "sales" &&
          original.source_id != null
        ) {
          const state = this._saleItemRefundState(original.source_id);
          if (state.touched > 0) {
            if (state.remaining === 0) {
              // Every line already refunded item-by-item — nothing left on
              // this member; it contributes no NEW reversal to this call.
              continue;
            }
            const refundId = this._reverseRemainingSaleLines(
              original.source_id,
              item.id,
              sessionId,
              userId,
            );
            reversedTransactionIds.push(item.id);
            reversalIds.push(refundId);
            continue;
          }
        }

        const refundId = this._refundTransactionInternal(item.id, userId, {
          allowSessionMember: true,
        });
        reversedTransactionIds.push(item.id);
        reversalIds.push(refundId);
      }
      this._reverseSessionPooledPayments(sessionId, userId);
      this._cancelSessionDebt(sessionId, userId);
      return {
        sessionId,
        itemCount: items.length,
        reversedTransactionIds,
        reversalIds,
      };
    });
  }

  /** Q1 helper — `{ touched, remaining }` line counts for a sale, reusing
   *  the SAME predicates `_assertNoPartialItemRefunds` uses (rule 14),
   *  so `refundSessionBasket`'s partial-refund detection can never drift
   *  from what that guard considers "already touched by an item refund". */
  private _saleItemRefundState(saleId: number): {
    touched: number;
    remaining: number;
  } {
    const counts = this.queryOne<{
      touched: number | null;
      remaining: number | null;
    }>(
      `SELECT
         SUM(CASE WHEN ${TransactionRepository.SALE_ITEM_REFUND_TOUCHED} THEN 1 ELSE 0 END) AS touched,
         SUM(CASE WHEN ${TransactionRepository.SALE_ITEM_HAS_REFUNDABLE_REMAINDER} THEN 1 ELSE 0 END) AS remaining
       FROM sale_items
       WHERE sale_id = ? AND tenant_id = ?`,
      saleId,
      getCurrentTenantId(),
    );
    return { touched: counts?.touched ?? 0, remaining: counts?.remaining ?? 0 };
  }

  /**
   * Q1 (SESSION_ITEM_REFUND_PLAN.md §9) — refund ONLY the sale lines a prior
   * `refundSessionBasketItem` call left untouched, for `refundSessionBasket`'s
   * whole-basket loop. Mirrors `refundSessionBasketItem`'s own SALE branch
   * (ONE aggregate REFUND row, per-line item reversal via
   * `SalesRepository.applySaleItemReversalForSession`) but does NOT do
   * account-first or post money-back legs — the whole-basket caller's own
   * `_cancelSessionDebt`/`_reverseSessionPooledPayments` own the basket's
   * remaining money for every member alike, item or not.
   */
  private _reverseRemainingSaleLines(
    saleId: number,
    memberTransactionId: number,
    sessionId: number,
    userId: number,
  ): number {
    const tenantId = getCurrentTenantId();
    const salesRepo = getSalesRepository();
    const remainingRows = this.query<{
      id: number;
      quantity: number;
      refunded_quantity: number | null;
    }>(
      `SELECT id, quantity, refunded_quantity FROM sale_items
       WHERE sale_id = ? AND tenant_id = ? AND (quantity - COALESCE(refunded_quantity, 0)) > 0`,
      saleId,
      tenantId,
    );
    const original = this.findById(memberTransactionId);
    if (!original) {
      throw new NotFoundError("transactions", memberTransactionId);
    }

    const lines = remainingRows.map((row) => {
      const qty = row.quantity - (row.refunded_quantity ?? 0);
      const preview = salesRepo.previewSaleItemRefundAmount({
        saleId,
        saleItemId: row.id,
        refundQuantity: qty,
      });
      return {
        saleItemId: row.id,
        quantity: qty,
        amountUsd: preview.refundAmountUsd,
        profitUsd: preview.refundProfitUsd,
        clientId: preview.clientId,
      };
    });
    const totalAmount = lines.reduce((sum, l) => sum + l.amountUsd, 0);
    const totalProfit = lines.reduce((sum, l) => sum + l.profitUsd, 0);
    const clientId =
      lines.find((l) => l.clientId != null)?.clientId ?? original.client_id;

    const refundTxnId = this.createTransaction({
      type: TRANSACTION_TYPES.REFUND,
      source_table: "sales",
      source_id: saleId,
      user_id: userId,
      amount_usd: -totalAmount,
      amount_lbp: 0,
      profit_usd: -totalProfit,
      profit_lbp: 0,
      exchange_rate: original.exchange_rate,
      client_id: clientId,
      summary: `SESSION BASKET REFUND (remaining lines): Sale #${saleId}`,
      metadata_json: {
        refundType: "sessionItem",
        sessionId,
        memberTransactionId,
        saleItemIds: lines.map((l) => l.saleItemId),
      },
      device_id: original.device_id ?? undefined,
    });

    for (const line of lines) {
      salesRepo.applySaleItemReversalForSession({
        saleId,
        saleItemId: line.saleItemId,
        refundQuantity: line.quantity,
        userId,
        refundTxnId,
      });
    }

    this.execute(
      `INSERT INTO customer_session_transactions
         (tenant_id, session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd, amount_lbp, profit_usd, profit_lbp)
       VALUES (?, ?, 'session_item_refund', ?, ?, ?, ?, ?, ?)`,
      tenantId,
      sessionId,
      saleId,
      refundTxnId,
      -totalAmount,
      0,
      -totalProfit,
      0,
    );

    return refundTxnId;
  }

  /**
   * Up-front refusal (before any write) if this basket's pooled cash/debt
   * was already reversed by a prior `voidSessionBasket`/`refundSessionBasket`
   * call — prevents double-reversing the ONE pooled leg/debt on a repeat
   * invocation (see both callers' idempotency comment for why the per-item
   * loop alone can't detect this: every item might already be
   * voided/refunded from a fully-successful prior call, which would
   * otherwise look identical to "nothing to do" and let the pooled-reversal
   * steps run a second time).
   */
  private _assertSessionBasketReversible(sessionId: number): void {
    const tenantId = getCurrentTenantId();
    const reversedLeg = this.queryOne<{ id: number }>(
      `SELECT id FROM payments
       WHERE session_id = ? AND transaction_id IS NULL AND note = ? AND tenant_id = ?
       LIMIT 1`,
      sessionId,
      SESSION_BASKET_REVERSAL_NOTE,
      tenantId,
    );
    if (reversedLeg) {
      throw new DatabaseError(
        `Session basket #${sessionId} has already been voided/refunded`,
        { entityId: sessionId },
      );
    }
    const reversedDebt = this.queryOne<{ id: number }>(
      `SELECT id FROM debt_ledger
       WHERE session_id = ? AND transaction_type = 'Refund Reversal' AND tenant_id = ?
       LIMIT 1`,
      sessionId,
      tenantId,
    );
    if (reversedDebt) {
      throw new DatabaseError(
        `Session basket #${sessionId} has already been voided/refunded`,
        { entityId: sessionId },
      );
    }
  }

  /**
   * Reverse the ONE (or two, USD+LBP) pooled `payments` row(s) a session
   * basket's customer-cash leg was posted as (`SessionPaymentService
   * .recordBasketPayment` → `insertSessionLeg`, `transaction_id` NULL,
   * `session_id` set) — exactly once for the whole basket. Mirrors
   * `_reversePayments`'s mirror-and-negate shape (rule 14) but keyed by
   * `session_id` instead of `transaction_id`, and posts the reversal leg back
   * onto the SAME pool (`session_id` set, `transaction_id` NULL) rather than
   * onto any one item's reversal row — there is no single item that "owns"
   * pooled cash, so the reversal stays pooled too. `getCashFlowByDate` (D1)
   * already includes `transaction_id IS NULL AND session_id IS NOT NULL`
   * rows unconditionally, so this reversal leg surfaces on its own date
   * exactly like the original leg did on its date — no report changes needed.
   */
  /**
   * Round-3 adversarial review, finding #6 (LOW) — rule 14: the ONE
   * proportional-split allocator every money-producing site in this class
   * uses. Splits `total` (rounded to `unit` first) across `weights` in
   * proportion, rounding every share to `unit` except the LAST, which
   * absorbs whatever rounding remainder is left over — guaranteeing the
   * allocated shares sum to EXACTLY `total`, never off by a fraction of a
   * cent/LBP the way independently rounding each share left it. Measured
   * pre-fix (`_reverseSessionPooledPayments`): 3 equal pooled LBP legs
   * splitting an already-returned 890,000 LBP independently rounded to
   * 296,667 each — summing to 890,001, one LBP too many.
   *
   * Round-4 review, finding L3 — the ORIGINAL algorithm ("round every share
   * except the last independently, then force the last share to absorb
   * whatever is left") could drive that LAST share NEGATIVE once uneven
   * weights made the earlier shares' independent rounding overshoot the
   * total (measured: `(0.02, [25,25,25,2.5], 0.01)` → the first three legs
   * each round UP to 0.01 (0.03 total, already more than 0.02), leaving the
   * last leg `0.02 - 0.03 = -0.01`; `(2, [1,1,1,0.1], 1)` → `[1,1,1,-1]`).
   * A negative refund leg is not a rounding nit, it is money moving the
   * wrong way. Replaced with the largest-remainder method (Hamilton
   * apportionment): every share is FLOORED to whole units first (never
   * negative, since every weight/total here is non-negative), then the few
   * leftover units are handed out ONE AT A TIME to the shares with the
   * largest fractional remainder until the sum matches exactly — this can
   * never push any individual share below its floor, so it can never go
   * negative, for any number of legs (not just the 3-leg case the original
   * "last one absorbs it" approach happened to work for).
   */
  private _allocateExact(
    total: number,
    weights: number[],
    unit: number,
  ): number[] {
    const roundedTotal = this._roundToUnit(total, unit);
    const sumWeights = weights.reduce((a, b) => a + b, 0);
    if (weights.length === 0 || !(sumWeights > 0) || !(roundedTotal > 0)) {
      return weights.map(() => 0);
    }
    const totalUnits = Math.round(roundedTotal / unit);
    const rawUnits = weights.map(
      (w) => (roundedTotal * (w / sumWeights)) / unit,
    );
    const floorUnits = rawUnits.map((r) => Math.floor(r));
    const allocatedUnits = floorUnits.reduce((a, b) => a + b, 0);
    let leftoverUnits = totalUnits - allocatedUnits;
    const shareUnits = [...floorUnits];
    const byRemainderDesc = rawUnits
      .map((r, i) => ({ i, frac: r - floorUnits[i] }))
      .sort((a, b) => b.frac - a.frac);
    for (const { i } of byRemainderDesc) {
      if (leftoverUnits <= 0) break;
      shareUnits[i] += 1;
      leftoverUnits -= 1;
    }
    return shareUnits.map((u) => this._roundToUnit(u * unit, unit));
  }

  /** Rule 14 — the ONE "round to the nearest cent (USD) / whole LBP" helper
   *  every money-producing site in this class uses, so "round LBP to whole
   *  LBP and USD to cents at every money-producing site" (round-3 finding
   *  #6) is one function, not a hand-copied `Math.round(x*100)/100`. */
  private _roundToUnit(amount: number, unit: number): number {
    return Math.round(amount / unit) * unit;
  }

  private _reverseSessionPooledPayments(
    sessionId: number,
    userId: number,
  ): void {
    const tenantId = getCurrentTenantId();
    const legs = this.query<{
      method: string;
      drawer_name: string;
      currency_code: string;
      amount: number;
    }>(
      `SELECT method, drawer_name, currency_code, amount
       FROM payments WHERE transaction_id IS NULL AND session_id = ? AND tenant_id = ?`,
      sessionId,
      tenantId,
    );

    // LIRA-232 (Q1, SESSION_ITEM_REFUND_PLAN.md §9) — a prior
    // `refundSessionBasketItem` call already handed some money back through
    // its OWN legs (`transaction_id` = that refund's id, linked to this
    // session via `customer_session_transactions.transaction_type =
    // 'session_item_refund'`). Reversing the FULL pooled IN leg here on top
    // of that would double-refund exactly what those legs already returned.
    // Subtract it, per currency, from the POSITIVE (IN) pooled legs only —
    // an OUT (change-given) pooled leg's reversal is unrelated to what an
    // item refund handed back.
    //
    // Round-2 finding #1 (BLOCKER) — "already returned" must be ONLY the
    // pool-attributed share of a prior item refund's money-back legs
    // (`poolSplitUsd`/`poolSplitLbp`, persisted on the REFUND row's own
    // metadata_json), never the FULL posted leg amount: a prior refund's
    // legs are `poolSplit` (genuinely from this pool) PLUS, separately,
    // `repaidBack{Usd,Lbp}` — a REAL cash repayment the customer made after
    // checkout, merged into the SAME posted leg for convenience but never
    // sourced from this basket's pool at all. Summing the raw negative leg
    // (the pre-fix query, now removed) double-counted the repaid-back part
    // as "already handled by the pool", under-reversing the pool by exactly
    // that amount and stranding it in the drawer — see this file's
    // "round-2 finding #1" test for the measured $40 stuck in General.
    const alreadyReturned =
      this._priorSessionItemRefundPoolAttributed(sessionId);
    const alreadyReturnedByCurrency: Record<string, number> = {
      USD: alreadyReturned.usd,
      LBP: alreadyReturned.lbp,
    };

    // Round-3 finding #6 (LOW) — group the POSITIVE (IN) legs by currency
    // and allocate each currency's "already returned" figure across them
    // via `_allocateExact` (last-leg-absorbs), so the sum across a
    // currency's legs matches `already` EXACTLY — never off by a fraction
    // of a cent/LBP the way an independent `Math.round` per leg left it
    // (measured: two LBP legs off by ±0.296; three equal legs summing to
    // 890,001 instead of 890,000).
    type Leg = (typeof legs)[number];
    const positiveLegsByCurrency = new Map<string, Leg[]>();
    for (const p of legs) {
      if (p.amount > 0) {
        const arr = positiveLegsByCurrency.get(p.currency_code) ?? [];
        arr.push(p);
        positiveLegsByCurrency.set(p.currency_code, arr);
      }
    }
    const reduceByForLeg = new Map<Leg, number>();
    for (const [currency, group] of positiveLegsByCurrency) {
      const total = group.reduce((sum, p) => sum + p.amount, 0);
      const already = Math.min(alreadyReturnedByCurrency[currency] ?? 0, total);
      if (!(already > 0)) continue;
      const unit = currency === "LBP" ? 1 : 0.01;
      const shares = this._allocateExact(
        already,
        group.map((p) => p.amount),
        unit,
      );
      group.forEach((p, i) => reduceByForLeg.set(p, shares[i]));
    }

    for (const p of legs) {
      const unit = p.currency_code === "LBP" ? 1 : 0.01;
      const reduceBy = p.amount > 0 ? (reduceByForLeg.get(p) ?? 0) : 0;
      // LIRA-236 integration-gap round-4 L2 (coordinator, 2026-09-27) —
      // `_roundToUnit` rounded even when `reduceBy` is 0 (no prior item
      // refund touched this leg at all), so a sub-cent-drifted pooled
      // amount (e.g. $33.335, from a currency-converted split) reversed as
      // -33.34 instead of -33.335 — 0.005 MORE than was ever paid in,
      // leaving the drawer negative by that amount after a whole-basket
      // refund that should net to exactly 0. Rounding only matters when
      // SUBTRACTING `reduceBy` (that arithmetic can itself introduce a
      // sub-unit remainder); with nothing subtracted, reverse the leg's
      // exact stored amount, unrounded.
      const negatedAmount =
        reduceBy > 0
          ? -this._roundToUnit(p.amount - reduceBy, unit)
          : -p.amount;
      // Round-3 finding #7 (LOW) — never write a zero-amount reversal leg —
      // a pooled leg an item refund already fully consumed has nothing
      // left to reverse (the pre-fix code always wrote a 0-amount 'Basket
      // reversal' payments row for it).
      if (Math.abs(negatedAmount) < unit / 2) continue;
      insertPaymentRow(this.db, {
        sessionId,
        method: p.method,
        drawerName: p.drawer_name,
        currencyCode: p.currency_code,
        amount: negatedAmount,
        note: SESSION_BASKET_REVERSAL_NOTE,
        createdBy: userId,
        tenantId,
      });
      applyDrawerDelta(this.db, {
        drawerName: p.drawer_name,
        currencyCode: p.currency_code,
        delta: negatedAmount,
        tenantId,
      });
    }
  }

  /**
   * Reverse the pooled `debt_ledger` rows a basket's non-cash portions were
   * booked as, each `session_id` set / `transaction_id` NULL (no single item
   * owns pooled money, mirroring `_reverseSessionPooledPayments`):
   *
   * - 'Session Debt': the CUSTOMER_ACCOUNT (+ GIFT_CARD) CHARGE side
   *   (`SessionPaymentRepository.insertBasketDebt`) — closes the gap the
   *   constant's own doc comment (`transactionTypes.ts`) named but never
   *   implemented: "'Session Debt' ... is reversed by the session flow, not
   *   the generic path."
   * - 'CREDIT_DEPOSIT': the PAYOUT/change-to-account side (LIRA-201c,
   *   `SessionPaymentService`'s "OUT on account" branch → `DebtService
   *   .addCredit({ sessionId })` → `DebtRepository.addCredit`, no
   *   `transactionId`) — the rule-20 gap the owner named directly: without
   *   this, a basket that sent a payout/change to the customer's account
   *   left the credit behind on refund. `_cancelDebt` (the generic,
   *   transaction_id-keyed reversal) structurally cannot see either shape —
   *   both are pooled, not linked to any one item's transaction_id.
   *
   * No drawer is touched here — neither shape moved cash of its own (a
   * CREDIT_DEPOSIT's cash, if any, went through the basket's pooled
   * `payments` leg, reversed separately by
   * `_reverseSessionPooledPayments`) — so both reversals are ledger-only,
   * the SAME 'Refund Reversal' insert shape `_cancelDebt` uses for every
   * other module-charge debt type (rule 14).
   */
  private _cancelSessionDebt(sessionId: number, userId: number): void {
    const tenantId = getCurrentTenantId();
    const debts = this.query<{
      id: number;
      client_id: number;
      amount_usd: number;
      amount_lbp: number;
      transaction_type: string;
      covered_usd: number;
      covered_lbp: number;
    }>(
      `SELECT id, client_id, amount_usd, amount_lbp, transaction_type,
              COALESCE(covered_usd, 0) AS covered_usd, COALESCE(covered_lbp, 0) AS covered_lbp
       FROM debt_ledger
       WHERE session_id = ? AND transaction_id IS NULL
         AND transaction_type IN ('Session Debt', 'CREDIT_DEPOSIT')
         AND tenant_id = ?
       ORDER BY id ASC`,
      sessionId,
      tenantId,
    );
    if (debts.length === 0) return;

    // LIRA-232 (Q1 — SESSION_ITEM_REFUND_PLAN.md §9), adversarial-review
    // rewrite (finding #6, then a coordinator follow-up fix): a whole-basket
    // reversal that runs AFTER one or more `refundSessionBasketItem` calls
    // must cancel only what's STILL attributable to the account side, not
    // the ORIGINAL gross charge. `covered_usd`/`covered_lbp` is NOT that
    // figure — FIFO repayment coverage never populates it for 'Session Debt'
    // rows at all (see `_priorSessionItemRefundAccountAttributed`'s doc) —
    // so the pre-fix `d.amount_usd - d.covered_usd` always read the gross
    // charge whether or not the customer had repaid any of it.
    //
    // The fix is `cancel = max(0, grossCharge − Σ prior item refunds'
    // A_account)` per currency — nothing more. A client-balance CAP on top
    // of this (an earlier version of this fix) is wrong and was removed: it
    // ran even with ZERO prior item refunds, so a basket charged $100,
    // then genuinely repaid $70 (a real 'Repayment' row against the
    // CLIENT — see DebtRepository.addRepayment), had its whole-basket
    // reversal cancel only min($100, currentBalance=$30) = $30 instead of
    // the full $100 — the customer's $70 repayment vanished instead of
    // surviving as a store credit (balance ended at $0, not the correct
    // −$70). It also read the client's TOTAL balance across every OTHER
    // debt they have, coupling this session's reversal to unrelated debt.
    //
    // Subtracting A_account (not the smaller, balance-capped credit) is
    // what already prevents over-cancellation for the compound case: an
    // item refund's own credit is itself capped by the balance AT THAT
    // MOMENT (`_planSessionItemRefund`'s `accountReductionUsd/Lbp`, kept
    // as-is — that cap is correct and untouched by this fix, since it sizes
    // ONE item's own credit against real money, not this method's
    // grosscharge-minus-attribution subtraction). Worked example: $100
    // charged, $70 repaid, item A ($50) refunded first — its OWN credit is
    // capped at $30 (balance at that moment), cash-back $20, A_account $50.
    // The later whole-basket reversal then cancels $100 − $50 = $50 more,
    // unconditionally — ending balance $100 − $70 − $30 − $50 = −$50 (a
    // store credit), and the customer's $70 repayment nets exactly to
    // $20 cash + $50 credit. 'CREDIT_DEPOSIT' rows are untouched by item
    // refunds (no A_account concept) and cancel in full, as before.
    const priorAccountAttributed =
      this._priorSessionItemRefundAccountAttributed(sessionId);

    // Round-3 adversarial review, finding #5 (LOW) — restore the STAGED
    // shape (`git show :packages/core/src/repositories/TransactionRepository.ts`,
    // pre-LIRA-232): ONE 'Refund Reversal' row per ORIGINAL debt_ledger ROW,
    // each with THAT row's own `client_id` — not one combined row per TYPE
    // using `debts[0].client_id` for every row regardless of whose it was.
    // Measured: a basket with two CUSTOMER_ACCOUNT OUT legs (two
    // CREDIT_DEPOSIT rows) wrote only 2 reversal rows total (1 Session Debt
    // + 1 combined CREDIT_DEPOSIT) instead of 3. The round-2 finding #4 fix
    // (below) still applies — a row is written even when its own net is 0,
    // since the row itself, not its amount, is the idempotency marker — but
    // per ROW now, not per TYPE.
    //
    // The A_account attribution (finding #6/round-2) still applies ONLY to
    // 'Session Debt' rows, distributed across them IN ORDER (lowest id
    // first) — a basket can have more than one 'Session Debt' row (e.g. two
    // separate CUSTOMER_ACCOUNT charges recorded in two basket-payment
    // calls), and a prior item refund's attribution must be consumed from
    // the EARLIEST charge first, mirroring how `_clientBalanceBeforeRow`
    // already treats id order as booking order. 'CREDIT_DEPOSIT' rows are
    // untouched by item refunds (no A_account concept) and cancel in full,
    // per row, as before.
    const sessionDebtRows = debts
      .filter((d) => d.transaction_type === "Session Debt")
      .sort((a, b) => a.id - b.id);
    const creditDepositRows = debts.filter(
      (d) => d.transaction_type !== "Session Debt",
    );

    const insertReversal = this.db.prepare(
      `INSERT INTO debt_ledger (
        client_id, transaction_type, amount_usd, amount_lbp, transaction_id, session_id, note, created_by, tenant_id
      ) VALUES (?, 'Refund Reversal', ?, ?, NULL, ?, 'Debt cancelled by session basket void/refund', ?, ?)`,
    );

    // The invariant, now applied per row: cancel exactly what's still
    // attributable to the account side, no more and no less — never capped
    // by the client's current balance (see the doc above this method's
    // signature for why that cap was wrong). Subtracting A_account (not a
    // smaller, already-balance-capped credit) is what keeps this correct
    // across any number of prior item refunds and any amount of real
    // repayment, without reading the client's balance at all.
    let remainingAttributedUsd = priorAccountAttributed.usd;
    let remainingAttributedLbp = priorAccountAttributed.lbp;
    for (const d of sessionDebtRows) {
      const takeUsd = Math.min(d.amount_usd, remainingAttributedUsd);
      const takeLbp = Math.min(d.amount_lbp, remainingAttributedLbp);
      remainingAttributedUsd -= takeUsd;
      remainingAttributedLbp -= takeLbp;
      // Round-4 review, finding L1 — round at the money-producing boundary
      // (rule 14's existing discipline throughout this class): an unrounded
      // `d.amount_usd - takeUsd` can carry IEEE-754 dust (measured:
      // 10.10 + 20.20 charged on account nets to -3.552713678800501e-15
      // instead of exactly 0), which `findClientHistory`'s exact `= 0`
      // filter (below) then fails to recognize as a zero-amount row.
      const netUsd = this._roundToUnit(
        Math.max(0, d.amount_usd - takeUsd),
        0.01,
      );
      const netLbp = this._roundToUnit(Math.max(0, d.amount_lbp - takeLbp), 1);
      // Written even when this row's own net is 0 (fully attributed away by
      // prior item refunds) — the row itself is the idempotency marker.
      insertReversal.run(
        d.client_id,
        -netUsd,
        -netLbp,
        sessionId,
        userId,
        tenantId,
      );
    }
    for (const d of creditDepositRows) {
      insertReversal.run(
        d.client_id,
        -d.amount_usd,
        -d.amount_lbp,
        sessionId,
        userId,
        tenantId,
      );
    }
  }

  // ===========================================================================
  // LIRA-232 phase 1 — refundSessionBasketItem (SESSION_ITEM_REFUND_PLAN.md)
  // ===========================================================================

  /**
   * Server-side "day's BUY rate" for a cross-currency account-reduction
   * (Q3 — SESSION_ITEM_REFUND_PLAN.md §9): the SAME `exchange_rates.buy_rate`
   * column session payments already read (RateRepository — rule 14, no new
   * rate source). Fails soft to `market_rate`. Adversarial-review fix
   * (finding #11): NEVER silently guesses a hardcoded rate — a missing/
   * unreadable rate row returns `null`, and the ONE caller that actually
   * needs a cross-currency conversion (`_requireBuyRate`) refuses the
   * refund outright instead of moving money at a made-up number. A refund
   * that never needs to cross currencies (same-currency account reduction,
   * or a basket whose pool is already in the item's own currency) never
   * calls `_requireBuyRate` and is completely unaffected by a missing rate
   * row.
   *
   * Round-3 adversarial review, finding #8 (owner question, NOT
   * implemented — the owner has not yet answered which rate a fully
   * item-by-item basket refund should use) — renamed from `_resolveBuyRate`
   * and takes `sessionId` (currently unused) so EVERY caller in this class
   * already goes through the ONE function the owner's answer would change,
   * with no call-site rewrite needed later. Today this still returns "the
   * day's rate" regardless of the basket. If the owner instead wants "the
   * basket's OWN booked rate", it is derivable without a new column: for a
   * basket with a `debt_ledger` 'Session Debt' row, `amount_lbp /
   * amount_usd` on that ROW (when both are nonzero) is the rate the
   * account-side charge was booked at; for a pooled-cash-only basket, the
   * ratio of the pooled LBP IN legs to the pooled USD IN legs, scaled by
   * each item's own USD value at sale time (`sale_items.sold_price_usd` /
   * the custom-service or recharge amount pair), approximates it — neither
   * is exact when a basket mixes several rates across its own items, which
   * is exactly the residue case the finding describes (an LBP-account
   * basket still owing 140,000 LBP; a mixed pool returning $19.82 +
   * 7,135,857 LBP instead of $20 + 7,200,000).
   *
   * SETTLED 2026-09-27 by LIRA-236 (REFUND_EXCHANGE_RATE_PLAN.md, owner
   * decision 2) — `preferredRate` is `_planSessionItemRefund`'s already-
   * resolved "the cashier's typed rate, else the refunded member's own
   * booked rate" (SESSION_ITEM_REFUND_PLAN.md §9b item 12's answer). When
   * given (and positive/finite), it wins outright — the day's rate below is
   * now ONLY the last-resort fallback for when NEITHER exists (nothing
   * recorded on the member AND the cashier hasn't typed one yet, e.g. the
   * read-only preview's very first render). This is still the ONE function
   * every call site in this class goes through for a session's
   * cross-currency rate (`_requireBuyRate`, `_splitAcrossPoolCurrencyMix`),
   * so resolving it here once — never re-derived per call site — is what
   * makes "the rate the popup shows" and "the rate the write actually
   * applies" provably the same number.
   */
  private _crossCurrencyRateForBasket(
    sessionId: number,
    preferredRate?: number | null,
  ): number | null {
    void sessionId;
    if (
      preferredRate != null &&
      preferredRate > 0 &&
      Number.isFinite(preferredRate)
    ) {
      return preferredRate;
    }
    return this._dayRateFallback();
  }

  /** Delegates to the free `dayRateFallback` function below (rule 14 — see
   *  that function's own doc for why it's a free function, not just a
   *  private method). */
  private _dayRateFallback(): number | null {
    return dayRateFallback();
  }

  /** Finding #11 — the throwing counterpart of `_crossCurrencyRateForBasket`,
   *  called only at the exact point a cross-currency conversion is about to
   *  happen. Refuses with a clear, actionable message rather than silently
   *  defaulting to a guessed rate (the pre-fix behavior — a hardcoded
   *  89500 — could move money at a rate nobody set). LIRA-236 —
   *  `preferredRate` threads through to `_crossCurrencyRateForBasket`. */
  private _requireBuyRate(
    sessionId: number,
    preferredRate?: number | null,
  ): number {
    const rate = this._crossCurrencyRateForBasket(sessionId, preferredRate);
    if (!rate || !(rate > 0)) {
      throw new DatabaseError(
        "Set the LBP exchange rate first — this refund needs to convert between USD and LBP.",
      );
    }
    return rate;
  }

  /**
   * LIRA-236 — the default booked rate for a refund preview (rule 14: this
   * class's own instance method delegates to the free `resolveBookedRate`
   * function below, the SAME shape `_overridableNetByCurrency` uses for
   * `overridableNetByCurrency` — one implementation, reachable both as a
   * method here and as a standalone import for `SalesRepository
   * .getItemRefundPreview`, which has no access to this class's private
   * `_dayRateFallback`).
   */
  private _bookedRateFor(
    recordedRate: number | null | undefined,
    sourceIfPresent: "sale" | "transaction",
  ): {
    bookedRate: number;
    bookedRateSource: "sale" | "transaction" | "fallback";
  } {
    return resolveBookedRate(recordedRate, sourceIfPresent);
  }

  /** F3 (round-3 review) — a SALE member's checkout rate: `sales
   *  .exchange_rate_snapshot`, back-filled by `SalesRepository.markSalePaid`
   *  with the rate the basket was ACTUALLY paid at (never the cart-time
   *  `transactions.exchange_rate`). `null` when the sale row is missing or
   *  the snapshot was never set (e.g. a non-session sale reaching this path
   *  by accident) — the caller falls back to `transactions.exchange_rate`. */
  private _saleExchangeRateSnapshot(saleId: number): number | null {
    const row = this.queryOne<{ exchange_rate_snapshot: number | null }>(
      `SELECT exchange_rate_snapshot FROM sales WHERE id = ? AND tenant_id = ?`,
      saleId,
      getCurrentTenantId(),
    );
    return row?.exchange_rate_snapshot ?? null;
  }

  /** This session basket's pooled IN legs in ONE currency (drawer-affecting
   *  only — CUSTOMER_ACCOUNT/GIFT_CARD legs are not "cash to hand back" and
   *  are excluded), used to proportion a default money-back leg split. */
  private _sessionPooledInLegs(
    sessionId: number,
    currency: string,
  ): Array<{ method: string; drawer_name: string; amount: number }> {
    const tenantId = getCurrentTenantId();
    const rows = this.query<{
      method: string;
      drawer_name: string;
      currency_code: string;
      amount: number;
    }>(
      `SELECT method, drawer_name, currency_code, amount FROM payments
       WHERE session_id = ? AND transaction_id IS NULL AND currency_code = ? AND amount > 0 AND tenant_id = ?`,
      sessionId,
      currency,
      tenantId,
    );
    return rows
      .filter((p) => isDrawerAffectingMethod(p.method))
      .map((p) => ({
        method: p.method,
        drawer_name: p.drawer_name,
        amount: p.amount,
      }));
  }

  /**
   * Default money-back legs for `remainderAmount` (R), proportional to the
   * basket's own pooled IN legs in the SAME currency (SESSION_ITEM_REFUND_
   * PLAN.md §3: "pre-filled from the basket's pooled IN legs, in proportion
   * to R"). Falls back to a single generic CASH/General leg when the basket
   * has no pooled IN leg in R's currency (e.g. an LBP-priced item refunded
   * out of an all-USD-cash basket) — a documented simplification (rule 14
   * keeps this the ONE place either the preview or the real write computes
   * a default, never two copies).
   */
  private _defaultSessionRefundLegs(
    sessionId: number,
    remainderAmount: number,
    currency: "USD" | "LBP",
  ): TransactionPaymentLeg[] {
    if (!(remainderAmount > 0)) return [];
    const pooled = this._sessionPooledInLegs(sessionId, currency);
    const total = pooled.reduce((sum, p) => sum + p.amount, 0);
    if (!(total > 0)) {
      const drawerName = paymentMethodToDrawerName("CASH");
      return [
        {
          direction: "out",
          amount: remainderAmount,
          signed_amount: -remainderAmount,
          currency_code: currency,
          method: "CASH",
          drawer_name: drawerName,
        },
      ];
    }
    // Round-2 finding #9 (LOW) — LBP has no sub-lira; round-3 finding #6
    // (LOW) widens it to "every proportional split sums EXACTLY to its
    // total" (LBP whole, USD to cents) via the shared `_allocateExact`
    // allocator (last-leg-absorbs) — independently rounding each leg could
    // over/under-shoot `remainderAmount` by a fraction of a unit once ≥2
    // pooled legs are involved.
    const unit = currency === "LBP" ? 1 : 0.01;
    const shares = this._allocateExact(
      remainderAmount,
      pooled.map((p) => p.amount),
      unit,
    );
    return pooled
      .map((p, i) => {
        const amount = shares[i];
        return {
          direction: "out" as const,
          amount,
          signed_amount: -amount,
          currency_code: currency,
          method: p.method,
          drawer_name: p.drawer_name,
        };
      })
      .filter((l) => l.amount > (currency === "LBP" ? 0 : 0.0001));
  }

  /**
   * Adversarial-review fix (finding #2, BLOCKER — cross-currency double
   * refund). The part of an item's remainder that was never attributed to
   * the account charge (`refundSessionBasketItem`'s "pool-attributed"
   * amount, whatever the item's OWN currency) must be handed back in
   * whatever currency the basket ACTUALLY collected, not the item's own
   * currency: cash-back used to always post in the item's currency
   * regardless of what the customer tendered, so a $100 item refunded out
   * of an all-LBP-paid basket posted a USD cash-back leg the basket never
   * received — and the later whole-basket reversal, which only nets
   * "already returned" PER CURRENCY, then reversed the FULL LBP pool on
   * top, losing $50 from the USD drawer with nothing to show for it.
   *
   * Splits `usdEquivAmount` (already converted to a common USD-equivalent
   * unit by the caller) across the basket's pooled IN legs' currency MIX,
   * proportional to each currency's value converted at the day's buy rate
   * — the SAME buy-rate rule Q3 already established for account-first
   * cross-currency conversion (rule 14, one conversion rate, reused). Falls
   * back to `preferredCurrency` (the item's own native currency) when the
   * pool has no IN legs in EITHER currency at all — matches
   * `_defaultSessionRefundLegs`'s existing no-pool fallback exactly, so a
   * basket paid entirely in non-drawer-affecting legs (e.g. a voucher) is
   * unaffected.
   */
  private _splitAcrossPoolCurrencyMix(
    sessionId: number,
    usdEquivAmount: number,
    preferredCurrency: "USD" | "LBP",
    preferredRate?: number | null,
  ): { usd: number; lbp: number } {
    if (!(usdEquivAmount > 0.005)) return { usd: 0, lbp: 0 };
    const pooledUsd = this._sessionPooledInLegs(sessionId, "USD");
    const pooledLbp = this._sessionPooledInLegs(sessionId, "LBP");
    const totalUsd = pooledUsd.reduce((sum, p) => sum + p.amount, 0);
    const totalLbpRaw = pooledLbp.reduce((sum, p) => sum + p.amount, 0);
    const noPool = totalUsd <= 0 && totalLbpRaw <= 0;
    // Round-3 finding #3 (MEDIUM, cumulative over-refund) — the CAP below
    // must never re-apply against the GROSS pool on every call. `available*`
    // is `poolNet* − Σ prior poolSplit*`: poolNet subtracts any pooled OUT
    // (change/return) leg first (never just the gross IN total — a basket
    // that already gave cash back has that much less to hand out again),
    // then subtracts every EARLIER `refundSessionBasketItem` call's own
    // `poolSplit` (persisted on that call's REFUND row, read back via
    // `_priorSessionItemRefundPoolAttributed`, rule 14 — the SAME reader
    // `_reverseSessionPooledPayments` already uses for its own "already
    // returned" figure). Measured pre-fix: a $10+450,000 LBP custom service
    // ($15.056 pool share) followed by a $5 sale, both capped against the
    // SAME gross $20 pool independently, handed back $20.056 total — $0.056
    // more than the pool ever held.
    const priorPoolSplit =
      this._priorSessionItemRefundPoolAttributed(sessionId);
    const poolNetUsd =
      totalUsd - this._sessionPooledOutLegsTotal(sessionId, "USD");
    const poolNetLbp =
      totalLbpRaw - this._sessionPooledOutLegsTotal(sessionId, "LBP");
    const availableUsd = Math.max(0, poolNetUsd - priorPoolSplit.usd);
    const availableLbp = Math.max(0, poolNetLbp - priorPoolSplit.lbp);
    // Pure single-currency pool (the overwhelmingly common case, and every
    // existing test's fixture): no conversion needed at all, so a missing
    // exchange rate can never block a refund it doesn't actually require.
    if (noPool || (totalLbpRaw <= 0 && totalUsd > 0)) {
      if (noPool) {
        // F3 (round-3 review) — "cap the no-pool branch": a basket with NO
        // pooled drawer-affecting cash leg in EITHER currency has, by
        // definition, no cash of its own to hand back for whatever part of
        // an item the account charge didn't cover. This used to convert
        // `usdEquivAmount` at the buy rate and hand it out of General
        // regardless — measured: a $10-USD-charged, $10+450,000-LBP
        // CUSTOM_SERVICE item (the LBP side never charged to anything, no
        // pooled cash at all) paid out ~$5.06 cash from a basket that never
        // held a single dollar. The ONLY money that can legitimately come
        // back as cash from a no-pool basket is a genuine post-charge
        // repayment, and that is handled entirely separately by
        // `repaidBackUsd`/`repaidBackLbp` (`_repaidBackLegs`) in
        // `_planSessionItemRefund` — never through this pool-mix split.
        return { usd: 0, lbp: 0 };
      }
      // Round-2 finding #8 (LOW, BLOCKER-adjacent) — a USD-only pool: never
      // hand back more than the pool actually holds. A dual-currency
      // item's leftover LBP portion, converted here at the buy rate, is
      // not guaranteed to equal what the checkout actually collected in
      // cash for it (the cashier tenders whatever amount was handed over,
      // not necessarily this rate's exact equivalent) — measured: a $10 +
      // 450,000 LBP item refunded from an all-USD $15 pool asked for
      // $15.056, $0.056 more than the pool (and the drawer) ever received.
      // Capping to the pool's own total is "the conversion that cannot
      // over-refund" (never redistributed to the other currency, which
      // would just reintroduce the same questionable rate). Round-3
      // finding #3 tightens the cap from the gross pool to what's actually
      // still available after every prior item refund's own share.
      return {
        usd: this._roundToUnit(Math.min(usdEquivAmount, availableUsd), 0.01),
        lbp: 0,
      };
    }
    if (totalUsd <= 0 && totalLbpRaw > 0) {
      return {
        usd: 0,
        lbp: Math.min(
          Math.round(
            usdEquivAmount * this._requireBuyRate(sessionId, preferredRate),
          ),
          availableLbp,
        ),
      };
    }
    // Mixed pool (both currencies present) — the buy rate is required to
    // compare them on one scale (finding #11: never guessed).
    //
    // Round-4 review, finding MEDIUM-3 — TWO fixes to the pre-fix version:
    //   (a) the MIX ratio is now the basket's NET mix (pooled IN minus
    //       CHANGE already given back in that currency — `poolNetUsd`/
    //       `poolNetLbp`, computed above via `_sessionPooledOutLegsTotal`,
    //       which HIGH-1's fix restricted to change-only, never a payout).
    //       Using the GROSS tender (the pre-fix `totalUsd`/`totalLbpRaw`)
    //       skewed the ratio toward whichever currency the CHANGE happened
    //       to come out of, shorting the customer in the other one.
    //   (b) whichever side's own availability CAP binds now pushes its
    //       shortfall to the OTHER side (bounded by that side's own
    //       remaining headroom) instead of silently dropping it — the
    //       pre-fix code only ever fed the USD cap's leftover forward into
    //       the LBP calc (computed second); the LBP cap, computed last, had
    //       nowhere left to push its own leftover back to USD.
    // Measured pre-fix (reviewer's exact repro): lines $60+$40, tendered
    // $50 USD + 4,895,000 LBP, 445,000 LBP change given, rate 89,000 —
    // refunding both lines returned $47.62 + 4,450,000 LBP, $2.38 short.
    // With both fixes, the same scenario nets to exactly $50 + 4,450,000
    // LBP (the customer's own outstanding IN, exactly).
    const buyRate = this._requireBuyRate(sessionId, preferredRate);
    const netMixUsd = Math.max(0, poolNetUsd);
    const netMixLbp = Math.max(0, poolNetLbp);
    const netMixUsdEquiv = netMixUsd + netMixLbp / buyRate;
    const usdShare = netMixUsdEquiv > 0 ? netMixUsd / netMixUsdEquiv : 1;
    let usd = Math.min(usdEquivAmount * usdShare, availableUsd);
    const lbpWanted = Math.round((usdEquivAmount - usd) * buyRate);
    const lbp = Math.min(lbpWanted, availableLbp);
    if (lbp < lbpWanted) {
      // The LBP side's own cap bound — push the shortfall back to USD,
      // bounded by USD's own remaining headroom (never over-refund).
      const shortfallUsdEquiv = (lbpWanted - lbp) / buyRate;
      usd = Math.min(usd + shortfallUsdEquiv, availableUsd);
    }
    // Round the USD side to cents for the RETURN value only — the
    // unrounded `usd` above still feeds the LBP-leftover calc so the two
    // currencies stay consistent with each other.
    return { usd: this._roundToUnit(usd, 0.01), lbp };
  }

  /** Round-3 finding #3 — the pooled OUT (change-given/return) leg total for
   *  ONE currency, the counterpart of `_sessionPooledInLegs` (which only
   *  ever reads `amount > 0`). Used to derive `poolNet` (IN minus OUT) so
   *  `_splitAcrossPoolCurrencyMix`'s availability cap is never overstated by
   *  cash the basket already gave back at checkout.
   *
   *  Round-4 review, finding HIGH-2 — restricted to CHANGE legs only
   *  (`payments.note` starting with `SessionPaymentService`'s own
   *  `"Basket change returned"` marker — see that service's `outNote`
   *  discriminator, rule 14: the ONE place that distinguishes a change leg
   *  from a payout leg, both written the same way as a negative pooled
   *  leg). A NON-netted payout (`"Basket payout to customer"`, e.g. an OMT
   *  SYSTEM RECEIVE under #11-A, never netted against the basket's items)
   *  is NOT cash "already given back" for THIS purpose — it is a separate
   *  flow that happens to share the pooled-legs table. Counting it here
   *  shrank an item refund's available cash-back by the payout's own
   *  amount (measured pre-fix: a $100 sale + an un-netted $60 payout made
   *  an item refund return only $40 instead of the full $100). */
  /**
   * Coordinator follow-up (2026-09-28, N+1 fix) — batched across MANY
   * sessions in a small, constant number of `session_id IN (...)` queries
   * (chunked at `SESSION_BATCH_CHUNK_SIZE`), keyed by `"<sessionId>::
   * <currency>"`. `_sessionPooledOutLegsTotal` (the single-session reader
   * every other caller of this predicate still uses) is now defined in
   * terms of this batch (rule 14) instead of holding a second copy of the
   * same query.
   */
  private _sessionPooledOutLegsTotalBatch(
    sessionIds: number[],
    tenantId: number,
  ): Map<string, number> {
    const result = new Map<string, number>();
    for (const chunk of chunkIds(sessionIds, SESSION_BATCH_CHUNK_SIZE)) {
      const placeholders = chunk.map(() => "?").join(", ");
      const rows = this.query<{
        session_id: number;
        method: string;
        currency_code: string;
        amount: number;
      }>(
        `SELECT session_id, method, currency_code, amount FROM payments
         WHERE session_id IN (${placeholders}) AND transaction_id IS NULL AND amount < 0
           AND note LIKE 'Basket change returned%' AND tenant_id = ?`,
        ...chunk,
        tenantId,
      );
      for (const row of rows) {
        if (!isDrawerAffectingMethod(row.method)) continue;
        const key = `${row.session_id}::${row.currency_code}`;
        result.set(key, (result.get(key) ?? 0) + Math.abs(row.amount));
      }
    }
    return result;
  }

  private _sessionPooledOutLegsTotal(
    sessionId: number,
    currency: "USD" | "LBP",
  ): number {
    const tenantId = getCurrentTenantId();
    return (
      this._sessionPooledOutLegsTotalBatch([sessionId], tenantId).get(
        `${sessionId}::${currency}`,
      ) ?? 0
    );
  }

  /** Combines the default legs from two independent sources (the pool-mix
   *  split and the flat "repaid-account cash-back" leg, finding #6) into
   *  one array, summing amounts for any (method, drawer, currency) that
   *  appears in both rather than posting two separate rows for the same
   *  drawer leg. */
  private _mergeLegs(
    legGroups: TransactionPaymentLeg[][],
  ): TransactionPaymentLeg[] {
    const byKey = new Map<string, TransactionPaymentLeg>();
    for (const legs of legGroups) {
      for (const leg of legs) {
        const key = `${leg.method}::${leg.drawer_name ?? ""}::${leg.currency_code}`;
        const existing = byKey.get(key);
        if (existing) {
          existing.amount += leg.amount;
          existing.signed_amount += leg.signed_amount;
        } else {
          byKey.set(key, { ...leg });
        }
      }
    }
    return [...byKey.values()].filter((l) => l.amount > 0.0001);
  }

  /**
   * Finding #6 (HIGH) — "account first" ignores repayments. A basket's
   * 'Session Debt' charge never gets `covered_usd`/`covered_lbp` from a real
   * repayment (`DebtRepository`'s FIFO coverage sweep excludes 'Session
   * Debt' by design — repayments net the CLIENT's total balance instead, via
   * a separate negative 'Repayment' row), so the gross charge alone is the
   * wrong "how much of this basket is still unpaid" figure once ANY of it
   * has been repaid OR already reduced by a prior item refund.
   *
   * `basketChargeRemaining[c] = grossCharge[c] − Σ prior item refunds'
   * A_account[c]` is the correct "still attributable to the account side"
   * figure; A_account per prior refund isn't reconstructable from the credit
   * row alone (the credit can be SMALLER than A_account when a repayment had
   * already covered part of it), so each `refundSessionBasketItem` call
   * persists its own `accountAttributedUsd`/`accountAttributedLbp` onto the
   * REFUND transaction's `metadata_json` (see `refundSessionBasketItem`'s
   * write), and this reads every prior one back for the session, summed.
   */
  /**
   * Round-2 finding #5 — this client's net debt_ledger balance from every
   * row with an id STRICTLY BEFORE `beforeRowId` (the basket's own
   * 'Session Debt' row) — i.e. "what this client owed/was owed the instant
   * before this basket's charge was booked". Same sign convention as
   * `DebtRepository.getClientBalance` (positive = owed BY the client,
   * negative = a credit the shop owes them). Id ordering (not `created_at`,
   * which is second-granular and ties within one checkout) is what keeps
   * this correct for same-checkout rows (e.g. a CREDIT_DEPOSIT written just
   * before the Session Debt charge in the same db.transaction) while still
   * excluding a LATER real repayment, which always gets a higher id.
   */
  private _clientBalanceBeforeRow(
    clientId: number,
    beforeRowId: number,
  ): { usd: number; lbp: number } {
    const tenantId = getCurrentTenantId();
    const row = this.queryOne<{ usd: number | null; lbp: number | null }>(
      `SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_lbp), 0) AS lbp
       FROM debt_ledger WHERE client_id = ? AND id < ? AND tenant_id = ?`,
      clientId,
      beforeRowId,
      tenantId,
    );
    return { usd: row?.usd ?? 0, lbp: row?.lbp ?? 0 };
  }

  private _priorSessionItemRefundAccountAttributed(sessionId: number): {
    usd: number;
    lbp: number;
  } {
    return this._sumPriorSessionItemRefundMeta(
      sessionId,
      "accountAttributedUsd",
      "accountAttributedLbp",
    );
  }

  /**
   * Round-2 finding #1 (BLOCKER) — the counterpart of
   * `_priorSessionItemRefundAccountAttributed` for the POOL-attributed part
   * of every prior `refundSessionBasketItem` call on this session (persisted
   * as `poolSplitUsd`/`poolSplitLbp`, see `refundSessionBasketItem`'s write).
   *
   * `_reverseSessionPooledPayments` used to derive "already returned from
   * the pool" by summing the FULL negative leg amount of every prior item
   * refund — but a prior refund's money-back legs are the SUM of TWO
   * different sources merged into one posted amount (`_planDefaultLegs`):
   * the genuinely pool-attributed share (`poolSplit`) AND, separately, any
   * `repaidBack{Usd,Lbp}` — money the customer had ALREADY repaid in cash
   * (via a real `DebtRepository.addRepayment`) that never came out of this
   * basket's own pooled leg at all. Treating BOTH as "already returned from
   * the pool" over-credited the pool reversal by exactly the repaid-back
   * portion, permanently stranding that money in the drawer once the rest
   * of the basket was later whole-refunded (measured: a $40 real repayment
   * handed back via one item's refund never made it out of General on the
   * follow-up whole-basket call — see this file's "round-2 finding #1"
   * test). Reading ONLY `poolSplit{Usd,Lbp}` back here fixes that at the
   * source: it is the ONE figure that means "this much of THIS pool's own
   * cash was already handed back", nothing else.
   */
  private _priorSessionItemRefundPoolAttributed(sessionId: number): {
    usd: number;
    lbp: number;
  } {
    return this._sumPriorSessionItemRefundMeta(
      sessionId,
      "poolSplitUsd",
      "poolSplitLbp",
    );
  }

  /**
   * Round-3 adversarial review, finding #4 (MEDIUM) — the counterpart of
   * `_priorSessionItemRefundAccountAttributed`/`*PoolAttributed` for the
   * PRE-EXISTING-credit bucket `_planSessionItemRefund`'s `availableUsd/Lbp`
   * draws from (`max(0, -balanceBeforeThisCharge)`, round-2 finding #5).
   * That bucket is a FIXED figure per basket (the client's balance the
   * instant before this basket's own charge existed) — every item refund on
   * the SAME basket that re-read it fresh, without subtracting what an
   * EARLIER item refund already drew from it, could reuse the SAME $60 of
   * pre-existing credit twice. Reading back `restoredFromPreexistingCredit
   * Usd/Lbp` (persisted on each REFUND row's own metadata_json, the SAME
   * pattern the pool/account attribution readers already use) fixes it at
   * the source. Measured: $60 pre-existing credit, two $50 items charged to
   * account, $40 real repayment — refunding both items independently
   * treated the $60 bucket as available TWICE, reducing the account by
   * $100 total (should be $60) and handing back $0 cash (should be $40).
   */
  private _priorSessionItemRefundPreexistingCreditUsed(sessionId: number): {
    usd: number;
    lbp: number;
  } {
    return this._sumPriorSessionItemRefundMeta(
      sessionId,
      "restoredFromPreexistingCreditUsd",
      "restoredFromPreexistingCreditLbp",
    );
  }

  /**
   * Coordinator follow-up (2026-09-28, N+1 fix) — the batched counterpart of
   * `_sumPriorSessionItemRefundMeta`, covering MANY sessions in a small,
   * constant number of `session_id IN (...)` queries (chunked at
   * `SESSION_BATCH_CHUNK_SIZE`). `_sumPriorSessionItemRefundMeta` — the ONE
   * query behind every `_priorSessionItemRefund*Attributed` reader — is now
   * defined in terms of this batch (rule 14) instead of holding a second
   * copy of the same query. Malformed/legacy/missing metadata contributes 0
   * (fail-soft — never blocks a refund), matching every other
   * metadata_json read in this file.
   */
  private _sumPriorSessionItemRefundMetaBatch(
    sessionIds: number[],
    usdKey: string,
    lbpKey: string,
    tenantId: number,
  ): Map<number, { usd: number; lbp: number }> {
    const result = new Map<number, { usd: number; lbp: number }>();
    for (const sessionId of sessionIds) {
      result.set(sessionId, { usd: 0, lbp: 0 });
    }
    for (const chunk of chunkIds(sessionIds, SESSION_BATCH_CHUNK_SIZE)) {
      const placeholders = chunk.map(() => "?").join(", ");
      const rows = this.query<{
        session_id: number;
        metadata_json: string | null;
      }>(
        `SELECT cst.session_id AS session_id, t.metadata_json AS metadata_json
         FROM customer_session_transactions cst
         JOIN transactions t ON t.id = cst.unified_transaction_id AND t.tenant_id = cst.tenant_id
         WHERE cst.session_id IN (${placeholders}) AND cst.transaction_type = 'session_item_refund' AND cst.tenant_id = ?`,
        ...chunk,
        tenantId,
      );
      for (const row of rows) {
        const acc = result.get(row.session_id);
        if (!acc || !row.metadata_json) continue;
        try {
          const meta = JSON.parse(row.metadata_json) as Record<
            string,
            number | undefined
          >;
          acc.usd += meta[usdKey] ?? 0;
          acc.lbp += meta[lbpKey] ?? 0;
        } catch {
          // Malformed/legacy metadata — contributes nothing rather than
          // blocking the refund (same fail-soft discipline as every other
          // metadata_json read in this file).
        }
      }
    }
    return result;
  }

  private _sumPriorSessionItemRefundMeta(
    sessionId: number,
    usdKey: string,
    lbpKey: string,
  ): { usd: number; lbp: number } {
    const tenantId = getCurrentTenantId();
    return (
      this._sumPriorSessionItemRefundMetaBatch(
        [sessionId],
        usdKey,
        lbpKey,
        tenantId,
      ).get(sessionId) ?? { usd: 0, lbp: 0 }
    );
  }

  /**
   * Round-3 adversarial review, finding #2 (HIGH) — refuses an item refund
   * outright when this session basket contains ANY other member whose own
   * net effect is a payout (a loto cash prize, a wallet/Binance/
   * FINANCIAL_SERVICE cash-out, a negative-amount custom-service payout) —
   * the SAME predicate step 4a already applies to the member being
   * refunded itself, reused here across EVERY member instead of just the
   * one requested.
   *
   * Coordinator follow-up (2026-09-27) — the decision "is this member a
   * payout" is now `isSessionPayoutMember` (`constants/sessionPayoutMember
   * .js`, rule 14), a pure/browser-safe function shared with the frontend's
   * OWN session-group derivation, instead of a second hand-written copy of
   * the same rule. It is why this query still selects (and does not filter
   * out in SQL) the REFUND row a prior item refund's own
   * 'session_item_refund' link points at: that row's `type` is 'REFUND',
   * which `isSessionPayoutMember` excludes ON ITS OWN — the SQL
   * `cst.transaction_type <> ?` filter below is a cheap pre-filter, not the
   * source of truth, so the two can never drift into disagreeing about a
   * REFUND row. This is the exact bug the frontend's OWN ad-hoc version of
   * this check had: testing `amount_usd < 0 || amount_lbp < 0` over every
   * session-group row (including the REFUND row `refundSessionBasketItem`
   * itself just wrote, always negative) made the whole basket look like a
   * "payout basket" after the FIRST item refund, hiding "Refund item" for
   * every remaining item.
   */
  private _assertNoNettedPayoutMembers(sessionId: number): void {
    const tenantId = getCurrentTenantId();
    // Round-4 review, finding HIGH-1 — `amount_usd`/`amount_lbp` come from
    // `cst` (customer_session_transactions), the member's own CUSTOMER-SIDE
    // signed amount, not `t.amount_usd/lbp` (the unified transactions row) —
    // see the `membership` query in `_planSessionItemRefund` (this same
    // predicate's other caller) for why: a FINANCIAL_SERVICE RECEIVE's own
    // `transactions` row carries the POSITIVE transfer amount (0/0 for
    // USDT/Binance pre-F4 — see `_isNettedSessionPayoutMember`'s doc), so
    // the pre-fix version of this query — reading `t.amount_usd/lbp` —
    // never saw a netted wallet/Binance cash-out as a payout at all.
    // `t.type`/`t.status`/`t.reverses_id`/`t.id` are still read from
    // `transactions`, which owns those fields.
    const candidates = this.query<{
      type: string;
      amount_usd: number;
      amount_lbp: number;
      status: string;
      reverses_id: number | null;
      unified_transaction_id: number;
    }>(
      `SELECT t.type AS type, cst.amount_usd AS amount_usd, cst.amount_lbp AS amount_lbp,
              t.status AS status, t.reverses_id AS reverses_id, t.id AS unified_transaction_id
       FROM customer_session_transactions cst
       JOIN transactions t ON t.id = cst.unified_transaction_id AND t.tenant_id = cst.tenant_id
       WHERE cst.session_id = ? AND cst.tenant_id = ?
         AND cst.transaction_type <> ?`,
      sessionId,
      tenantId,
      SESSION_ITEM_REFUND_LINK_TYPE,
    );
    const payout = candidates.find((c) =>
      this._isNettedSessionPayoutMember(c, c.unified_transaction_id),
    );
    if (payout) {
      throw new DatabaseError(
        `This basket includes a payout (${payout.type}) that was netted against its items — refund the whole basket instead.`,
        { entityId: sessionId },
      );
    }
  }

  /**
   * F4/F6 (round-3 review) — ONE shared predicate (rule 14) for "is this
   * session-basket payout member NETTED against the basket's other items"
   * (decision 10: can only be undone by the whole-basket reversal) vs
   * backed by its OWN full pooled leg (an item refund on some OTHER member
   * still prices correctly). Reused by `_assertNoNettedPayoutMembers` (the
   * write-path guard) and `getRecent`'s `is_session_payout` (the SAME flag
   * that hides the frontend's "Refund item" button) — never two copies.
   *
   * `isSessionPayoutMember` alone only answers "is this a payout AT ALL"
   * from sign — necessary but not sufficient. Decision 10's own list
   * ("a loto prize, a wallet or Binance cash-out, or a custom-service
   * payout") is netted; a financial-service RECEIVE routed to the shop's
   * OWN primary cash drawer is NOT — it always posts its own full "Basket
   * payout to customer" pooled leg (BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4
   * decision #11-A: a `payoutOrigin: "SYSTEM"` leg is "always the primary
   * cash drawer, never netted"), so nothing was netted against another
   * item. Reuses `_financialServiceCashDrawerCtx`'s EXACT eligibility
   * check (`provider === baseSystem`) — the SAME test `resolveServiceCashDrawer`
   * uses to route the real money in the first place (rule 14) — rather
   * than re-deriving a second "is this the primary system" rule that could
   * drift from it. A non-FINANCIAL_SERVICE payout (LOTO_CASH_PRIZE, a
   * negative-amount CUSTOM_SERVICE) has no such drawer to land in at all
   * and is always netted.
   */
  private _isNettedSessionPayoutMember(
    candidate: SessionPayoutMemberCandidate,
    unifiedTransactionId: number,
  ): boolean {
    if (!isSessionPayoutMember(candidate)) return false;
    const ctx = this._financialServiceCashDrawerCtx(unifiedTransactionId);
    if (!ctx) return true;
    return ctx.provider !== ctx.baseSystem;
  }

  /**
   * Coordinator follow-up (2026-09-27) — once every item in a session basket
   * has been refunded ONE BY ONE (`refundSessionBasketItem`), "Refund
   * basket"/"Void basket" could still be clicked: it succeeded as a no-op
   * (nothing left to reverse, so the item loop below does nothing) but still
   * looked like a real action. This is the ONE predicate (rule 14) for "is
   * there truly nothing left for the whole-basket call to do" — shared by
   * the `voidSessionBasket`/`refundSessionBasket` up-front guard below AND
   * `getRecent`'s `session_fully_refunded` field.
   *
   * THREE things must all hold — member-reversedness alone is NOT enough
   * (round-3 finding #6/#7's own fixtures, kept green rather than "fixed"
   * out of existence, are the proof: a basket over-paid beyond its items'
   * value, or one whose account debt hasn't yet had its idempotency marker
   * written, both still have a REAL action left for the whole-basket call):
   *
   *  1. Every member is reversed — see `_isSessionBasketMemberReversedBatch`.
   *  2. Every pooled CASH leg (`payments`, `transaction_id IS NULL`) is
   *     fully attributed to a prior item refund's money-back share
   *     (`_sumPriorSessionItemRefundMetaBatch`, keyed on
   *     `poolSplitUsd`/`poolSplitLbp`) — an item refund is CAPPED at its own
   *     item's value, so a basket paid MORE than its items were worth
   *     (change, a rounding pad, …) can still have real drawer money
   *     sitting in the pool after every item is individually refunded;
   *     only the whole-basket call can return it.
   *  3. NO qualifying `debt_ledger` row ('Session Debt'/'CREDIT_DEPOSIT',
   *     `transaction_id IS NULL`) exists for this session. `_cancelSessionDebt`
   *     writes ONE 'Refund Reversal' marker PER such row even when its net
   *     is $0 (round-3 finding #5 — "the row itself, not its amount, is the
   *     idempotency marker" — other readers, e.g. `ProfitRepository
   *     .getPaymentMethodRows`'s LPAY-V1 exclusion, key on that marker's
   *     existence), and `refundSessionBasketItem` never writes it — only
   *     the whole-basket call does, exactly once (a second call is already
   *     refused by `_assertSessionBasketReversible` once that marker
   *     exists). So a basket with such a row ALWAYS has one real,
   *     first-time action pending until the whole-basket call runs.
   *
   * Coordinator follow-up (2026-09-28, N+1 fix) — computes this predicate
   * for MANY sessions at once, in a small, constant number of set-based
   * `session_id IN (...)` queries (chunked at `SESSION_BATCH_CHUNK_SIZE`)
   * instead of the fixed handful of queries this used to run PER session.
   * A `getRecent()` page of up to 5,000 rows across up to 250 distinct
   * fully-refunded sessions used to cost ~1,750 extra one-off queries
   * (~156ms measured); this costs a small constant number regardless of
   * how many sessions are on the page. `isSessionBasketFullyRefunded`
   * below is now DEFINED IN TERMS OF this batch (`.get([sessionId])`,
   * rule 14), so the single-session void/refund guards and `getRecent`'s
   * batched flag can never disagree about the same session.
   */
  isSessionBasketFullyRefundedBatch(
    sessionIds: number[],
  ): Map<number, boolean> {
    const result = new Map<number, boolean>();
    const uniqueIds = Array.from(new Set(sessionIds));
    if (uniqueIds.length === 0) return result;
    const tenantId = getCurrentTenantId();

    // 1. Every session's basket members (excludes the item-refund LINK
    //    rows — same predicate the single-session query always used).
    type MemberRow = {
      session_id: number;
      id: number;
      status: TransactionStatus;
      source_table: string;
      source_id: number | null;
    };
    const membersBySession = new Map<number, MemberRow[]>();
    for (const chunk of chunkIds(uniqueIds, SESSION_BATCH_CHUNK_SIZE)) {
      const placeholders = chunk.map(() => "?").join(", ");
      const rows = this.query<MemberRow>(
        `SELECT cst.session_id AS session_id, t.id AS id, t.status AS status,
                t.source_table AS source_table, t.source_id AS source_id
         FROM customer_session_transactions cst
         JOIN transactions t ON t.id = cst.unified_transaction_id AND t.tenant_id = cst.tenant_id
         WHERE cst.session_id IN (${placeholders}) AND cst.tenant_id = ? AND cst.transaction_type <> ?`,
        ...chunk,
        tenantId,
        SESSION_ITEM_REFUND_LINK_TYPE,
      );
      for (const row of rows) {
        const list = membersBySession.get(row.session_id) ?? [];
        list.push(row);
        membersBySession.set(row.session_id, list);
      }
    }

    // A session with no basket members at all reads as NOT fully refunded
    // (same as the single-session path's `members.length === 0` check).
    const activeSessionIds: number[] = [];
    for (const sid of uniqueIds) {
      if ((membersBySession.get(sid)?.length ?? 0) > 0) {
        activeSessionIds.push(sid);
      } else {
        result.set(sid, false);
      }
    }
    if (activeSessionIds.length === 0) return result;

    // 2. #1 — "is every member reversed", one batched pass over every
    //    member of every still-live session.
    const allMembers = activeSessionIds.flatMap(
      (sid) => membersBySession.get(sid)!,
    );
    const reversedByMemberId = this._isSessionBasketMemberReversedBatch(
      allMembers,
      tenantId,
    );
    const candidateIds: number[] = [];
    for (const sid of activeSessionIds) {
      const members = membersBySession.get(sid)!;
      if (members.every((m) => reversedByMemberId.get(m.id) === true)) {
        candidateIds.push(sid);
      } else {
        result.set(sid, false);
      }
    }
    if (candidateIds.length === 0) return result;

    // 3. #3 — a pending debt-ledger marker is a real, first-time action.
    const pendingDebtSessions = new Set<number>();
    for (const chunk of chunkIds(candidateIds, SESSION_BATCH_CHUNK_SIZE)) {
      const placeholders = chunk.map(() => "?").join(", ");
      const rows = this.query<{ session_id: number }>(
        `SELECT DISTINCT session_id FROM debt_ledger
         WHERE session_id IN (${placeholders}) AND transaction_id IS NULL
           AND transaction_type IN ('Session Debt', 'CREDIT_DEPOSIT')
           AND tenant_id = ?`,
        ...chunk,
        tenantId,
      );
      for (const row of rows) pendingDebtSessions.add(row.session_id);
    }
    const noDebtIds: number[] = [];
    for (const sid of candidateIds) {
      if (pendingDebtSessions.has(sid)) {
        result.set(sid, false);
      } else {
        noDebtIds.push(sid);
      }
    }
    if (noDebtIds.length === 0) return result;

    // 4. #2 — the pooled cash legs, batched, then the same "net positive by
    //    currency" reduction the single-session path always did (F5,
    //    round-3 review: NET pool per currency — gross IN minus any pooled
    //    CHANGE/OUT leg — never the gross IN total alone).
    const pooledLegsBySession = new Map<
      number,
      Array<{ currency_code: string; amount: number }>
    >();
    for (const chunk of chunkIds(noDebtIds, SESSION_BATCH_CHUNK_SIZE)) {
      const placeholders = chunk.map(() => "?").join(", ");
      const rows = this.query<{
        session_id: number;
        currency_code: string;
        amount: number;
      }>(
        `SELECT session_id, currency_code, amount FROM payments
         WHERE session_id IN (${placeholders}) AND transaction_id IS NULL AND tenant_id = ?`,
        ...chunk,
        tenantId,
      );
      for (const row of rows) {
        const list = pooledLegsBySession.get(row.session_id) ?? [];
        list.push(row);
        pooledLegsBySession.set(row.session_id, list);
      }
    }

    const positiveByCurrencyBySession = new Map<number, Map<string, number>>();
    const needsPositiveCheckIds: number[] = [];
    for (const sid of noDebtIds) {
      const legs = pooledLegsBySession.get(sid) ?? [];
      const positiveByCurrency = new Map<string, number>();
      for (const leg of legs) {
        if (leg.amount > 0) {
          positiveByCurrency.set(
            leg.currency_code,
            (positiveByCurrency.get(leg.currency_code) ?? 0) + leg.amount,
          );
        }
      }
      if (positiveByCurrency.size === 0) {
        result.set(sid, true);
      } else {
        positiveByCurrencyBySession.set(sid, positiveByCurrency);
        needsPositiveCheckIds.push(sid);
      }
    }
    if (needsPositiveCheckIds.length === 0) return result;

    const outLegTotals = this._sessionPooledOutLegsTotalBatch(
      needsPositiveCheckIds,
      tenantId,
    );
    const priorPoolAttributed = this._sumPriorSessionItemRefundMetaBatch(
      needsPositiveCheckIds,
      "poolSplitUsd",
      "poolSplitLbp",
      tenantId,
    );

    for (const sid of needsPositiveCheckIds) {
      const positiveByCurrency = positiveByCurrencyBySession.get(sid)!;
      const alreadyReturned = priorPoolAttributed.get(sid) ?? {
        usd: 0,
        lbp: 0,
      };
      const alreadyReturnedByCurrency: Record<string, number> = {
        USD: alreadyReturned.usd,
        LBP: alreadyReturned.lbp,
      };
      let fully = true;
      for (const [currency, total] of positiveByCurrency) {
        const unit = currency === "LBP" ? 1 : 0.01;
        const outTotal = outLegTotals.get(`${sid}::${currency}`) ?? 0;
        const netTotal = total - outTotal;
        const remaining = netTotal - (alreadyReturnedByCurrency[currency] ?? 0);
        if (remaining > unit / 2) {
          fully = false;
          break;
        }
      }
      result.set(sid, fully);
    }

    return result;
  }

  isSessionBasketFullyRefunded(sessionId: number): boolean {
    return (
      this.isSessionBasketFullyRefundedBatch([sessionId]).get(sessionId) ??
      false
    );
  }

  /**
   * Coordinator follow-up (2026-09-28, N+1 fix) — the batched counterpart
   * of `_isSessionBasketMemberReversed`, covering MANY members (from
   * possibly many different sessions) in a small, constant number of
   * `IN (...)` queries. `_isSessionBasketMemberReversed` is now defined in
   * terms of this batch (rule 14) instead of holding a second copy of the
   * same two queries.
   */
  private _isSessionBasketMemberReversedBatch(
    members: Array<{
      id: number;
      status: TransactionStatus;
      source_table: string;
      source_id: number | null;
    }>,
    tenantId: number,
  ): Map<number, boolean> {
    const result = new Map<number, boolean>();
    const needsRefundCheck: typeof members = [];
    for (const member of members) {
      if (member.status === "VOIDED") {
        result.set(member.id, true);
      } else {
        needsRefundCheck.push(member);
      }
    }
    if (needsRefundCheck.length === 0) return result;

    const memberIds = needsRefundCheck.map((m) => m.id);
    const reversedIds = new Set<number>();
    for (const chunk of chunkIds(memberIds, SESSION_BATCH_CHUNK_SIZE)) {
      const placeholders = chunk.map(() => "?").join(", ");
      const rows = this.query<{ reverses_id: number }>(
        `SELECT reverses_id FROM transactions
         WHERE reverses_id IN (${placeholders}) AND type = 'REFUND' AND tenant_id = ?`,
        ...chunk,
        tenantId,
      );
      for (const row of rows) reversedIds.add(row.reverses_id);
    }

    const needsSaleCheck: typeof members = [];
    for (const member of needsRefundCheck) {
      if (reversedIds.has(member.id)) {
        result.set(member.id, true);
      } else if (member.source_table === "sales" && member.source_id != null) {
        needsSaleCheck.push(member);
      } else {
        result.set(member.id, false);
      }
    }
    if (needsSaleCheck.length === 0) return result;

    // Same aggregate `_saleItemRefundState` relies on (its `remaining`
    // column only), grouped across every distinct sale in one query.
    const saleIds = Array.from(
      new Set(needsSaleCheck.map((m) => m.source_id!)),
    );
    const remainingBySale = new Map<number, number>();
    for (const chunk of chunkIds(saleIds, SESSION_BATCH_CHUNK_SIZE)) {
      const placeholders = chunk.map(() => "?").join(", ");
      const rows = this.query<{ sale_id: number; remaining: number | null }>(
        `SELECT sale_id,
                SUM(CASE WHEN ${TransactionRepository.SALE_ITEM_HAS_REFUNDABLE_REMAINDER} THEN 1 ELSE 0 END) AS remaining
         FROM sale_items
         WHERE sale_id IN (${placeholders}) AND tenant_id = ?
         GROUP BY sale_id`,
        ...chunk,
        tenantId,
      );
      for (const row of rows)
        remainingBySale.set(row.sale_id, row.remaining ?? 0);
    }
    for (const member of needsSaleCheck) {
      const remaining = remainingBySale.get(member.source_id!) ?? 0;
      result.set(member.id, remaining === 0);
    }
    return result;
  }

  private _isSessionBasketMemberReversed(
    member: {
      id: number;
      status: TransactionStatus;
      source_table: string;
      source_id: number | null;
    },
    tenantId: number,
  ): boolean {
    return (
      this._isSessionBasketMemberReversedBatch([member], tenantId).get(
        member.id,
      ) ?? false
    );
  }

  /**
   * Read-only planning shared by `getSessionItemRefundPreview` and
   * `refundSessionBasketItem` (rule 14 — one computation, one set of guards,
   * never re-derived). Performs EVERY guard and EVERY amount/account/leg
   * computation with NO writes, so a thrown error here never leaves a
   * partial write behind (same discipline as `_validateRefundLegOverride`).
   */
  private _planSessionItemRefund(input: {
    sessionId: number;
    transactionId: number;
    saleItemId?: number;
    quantity?: number;
    /** LIRA-236 — the cashier-typed rate, when given. Drives BOTH the
     *  account-first cross-currency step and the default legs' pool-mix
     *  conversion (`_crossCurrencyRateForBasket`'s doc). */
    exchangeRate?: number;
  }): {
    original: TransactionEntity;
    isSaleMember: boolean;
    saleId: number | null;
    /** LIRA-236 — the default rate the popup shows: the typed rate (if this
     *  call was given one) else the refunded member's own recorded rate,
     *  else the day's fallback. */
    bookedRate: number;
    bookedRateSource: "sale" | "transaction" | "fallback";
    /** LIRA-236 — the rate actually used by THIS plan's own cross-currency
     *  math (identical to `bookedRate` unless a caller passed a DIFFERENT
     *  `exchangeRate` than what `bookedRate` would default to — which never
     *  happens today, since `bookedRate` IS `input.exchangeRate` when given;
     *  kept as its own field so a future caller can distinguish "what the
     *  popup shows by default" from "what this specific call applied"). */
    effectiveRate: number;
    lines: Array<{
      saleItemId: number;
      quantity: number;
      amountUsd: number;
      profitUsd: number;
    }>;
    clientId: number | null;
    /** Finding #10 — the client the 'Session Debt' row was actually charged
     *  to; the credit row must use THIS, never `clientId` (the item's own
     *  buyer). */
    debtClientId: number | null;
    itemAmountUsd: number;
    itemAmountLbp: number;
    nativeCurrency: "USD" | "LBP";
    /** A_account per currency — persisted onto the REFUND row's
     *  metadata_json so a LATER item refund on the same basket can
     *  reconstruct `basketChargeRemaining` (finding #6). */
    accountAttributedUsd: number;
    accountAttributedLbp: number;
    accountReductionUsd: number;
    accountReductionLbp: number;
    repaidBackUsd: number;
    repaidBackLbp: number;
    /** Round-3 finding #4 — how much of THIS call's own accountReduction
     *  drew from the pre-existing-credit bucket; persisted onto the REFUND
     *  row's metadata_json so a LATER item refund on the same basket never
     *  re-counts it (see `_priorSessionItemRefundPreexistingCreditUsed`). */
    restoredFromPreexistingCreditUsd: number;
    restoredFromPreexistingCreditLbp: number;
    poolSplit: { usd: number; lbp: number };
    remainderUsd: number;
    remainderLbp: number;
  } {
    const tenantId = getCurrentTenantId();
    const { sessionId, transactionId } = input;

    // 1. The member belongs to the session.
    //
    // Round-4 review, finding HIGH-1 — `amount_usd`/`amount_lbp` are read
    // from THIS row (customer_session_transactions), not `transactions`,
    // because a FINANCIAL_SERVICE RECEIVE's own unified `transactions` row
    // carries the POSITIVE transfer amount (or 0/0 for a USDT/Binance leg —
    // `FinancialServiceRepository.ts`), never the NEGATIVE customer-side
    // payout sign checkout stamps onto the basket link
    // (`item.amount = -60`). Reading `transactions.amount_*` here (the
    // pre-fix behavior) made `isSessionPayoutMember` blind to any netted
    // wallet/Binance cash-out — see step 4a and
    // `_assertNoNettedPayoutMembers` below, which share this SAME
    // customer-side-amount source (rule 14).
    const membership = this.queryOne<{
      id: number;
      amount_usd: number;
      amount_lbp: number;
      /** F3 (round-3 review) — the rate THIS member's basket was actually
       *  checked out at (migration v186), read alongside the membership row
       *  since both come from the same `customer_session_transactions` id. */
      paid_exchange_rate: number | null;
    }>(
      `SELECT id, amount_usd, amount_lbp, paid_exchange_rate FROM customer_session_transactions
       WHERE session_id = ? AND unified_transaction_id = ? AND tenant_id = ?`,
      sessionId,
      transactionId,
      tenantId,
    );
    if (!membership) {
      throw new DatabaseError(
        `Transaction #${transactionId} is not a member of session basket #${sessionId}`,
        { entityId: transactionId },
      );
    }

    // 2. The basket hasn't been whole-reversed.
    this._assertSessionBasketReversible(sessionId);

    const original = this.findById(transactionId);
    if (!original) {
      throw new NotFoundError("transactions", transactionId);
    }
    if (original.status === "VOIDED") {
      throw new DatabaseError("This item has already been voided", {
        entityId: transactionId,
      });
    }

    // 3. Reuse the generic gate — same session-member bypass the
    // whole-basket path uses (a LOTO_CASH_PRIZE/KEPT_CHANGE member would
    // pass THIS gate, but is refused next by the sold-item whitelist below,
    // matching the owner's wording exactly instead of the generic message).
    this._assertReversible(original, { allowSessionMember: true });

    // 4. Only a SOLD item — never a payout, prize or kept-change member
    // (owner decision #4).
    if (!SESSION_ITEM_REFUNDABLE_TYPES.has(original.type)) {
      throw new DatabaseError(
        `${original.type} cannot be refunded on its own from a session basket — only sold items ` +
          `(products, services, recharges) can be; payouts and kept change are undone by the ` +
          `whole-basket reversal.`,
        { entityId: transactionId },
      );
    }

    const isSaleMember =
      original.source_table === "sales" &&
      original.type === TRANSACTION_TYPES.SALE;
    if (input.saleItemId != null && !isSaleMember) {
      throw new DatabaseError("saleItemId is only valid for a SALE member", {
        entityId: transactionId,
      });
    }

    // LIRA-236 (REFUND_EXCHANGE_RATE_PLAN.md §3, SESSION_ITEM_REFUND_PLAN.md
    // §9b item 12) — resolve the rate this refund's cross-currency math
    // uses, ONCE, before any of it runs: the cashier's typed rate when
    // given, else the rate the BASKET was actually checked out/paid at
    // (never `transactions.exchange_rate`, the rate stamped on the item at
    // CART-creation time — round-3 review finding F3: the two can
    // legitimately differ when the shop's rate moves between adding an item
    // to a basket and finally checking it out). A SALE member's checkout
    // rate is `sales.exchange_rate_snapshot` (back-filled by
    // `SalesRepository.markSalePaid` — source "sale"); every other member
    // type reads it from `customer_session_transactions.paid_exchange_rate`
    // (migration v186, stamped by `SessionPaymentService.recordBasketPayment`
    // — source "transaction"). Either falls back to
    // `transactions.exchange_rate` when unset (a pre-migration row, or a
    // member whose basket was never actually settled through
    // `recordBasketPayment` — defensive, not the expected path), then to the
    // day's fallback rate (source "fallback", never a hard-coded guess).
    // `bookedRate` is what the refund preview/popup DEFAULTS to;
    // `effectiveRate` is what THIS call actually applies — identical unless
    // a future caller ever wants them to diverge (see the return type's own
    // doc).
    const checkoutRate = isSaleMember
      ? (this._saleExchangeRateSnapshot(original.source_id) ??
        original.exchange_rate)
      : (membership.paid_exchange_rate ?? original.exchange_rate);
    const { bookedRate, bookedRateSource } = this._bookedRateFor(
      checkoutRate,
      isSaleMember ? "sale" : "transaction",
    );
    // F14 (round-3 review, defensive) — same shared gate `refundLegReversalSign`/
    // `validateRefundLegOverrideAmounts` use, so a non-finite typed rate
    // never becomes `effectiveRate` in the first place (it would otherwise
    // still be caught downstream by those two functions' own guard, but
    // resolving it here too keeps `effectiveRate` — which is also stamped
    // into the refund row's metadata_json, F12 — honest for audit purposes).
    const effectiveRate = isUsableRefundExchangeRate(input.exchangeRate)
      ? input.exchangeRate
      : bookedRate;

    // 4a. Finding #11 (adversarial review) — refuse a member whose net
    // effect is a PAYOUT (direction OUT), even though its type is in
    // `SESSION_ITEM_REFUNDABLE_TYPES`. A custom service booked as a payout
    // (a negative amount) was never "sold" to the customer — that is not
    // this flow's business (owner decision #4: only sold items). A SALE
    // member's amount is always positive by construction, so this only
    // ever fires for a CUSTOM_SERVICE/RECHARGE/FINANCIAL_SERVICE member.
    //
    // Round-4 review, finding HIGH-1 — uses the SAME shared predicate
    // (`isSessionPayoutMember`) and the SAME customer-side amount source
    // (`membership.amount_usd/lbp`, the cst row) as
    // `_assertNoNettedPayoutMembers` below, rather than a second hand-copy
    // of "is this a payout" that only ever looked at `transactions.amount_*`
    // — see the `membership` query's own doc for why that missed a netted
    // wallet/Binance cash-out.
    if (
      !isSaleMember &&
      isSessionPayoutMember({
        type: original.type,
        amount_usd: membership.amount_usd,
        amount_lbp: membership.amount_lbp,
        status: original.status,
        reverses_id: original.reverses_id,
      })
    ) {
      throw new DatabaseError(
        `${original.type} is a payout, not a sold item — it cannot be refunded on its own from a session basket.`,
        { entityId: transactionId },
      );
    }

    // 4b. Round-3 adversarial review, finding #2 (HIGH) — refuse ANY item
    // refund when the basket contains a payout member ELSEWHERE (not just
    // when the member BEING refunded is one, which 4a above already
    // covers). `SessionCheckoutModal` nets a General payout (loto prize,
    // wallet/Binance cash-out, a custom-service payout, …) against the
    // basket's OTHER items at checkout, so the pooled IN legs are smaller
    // than the items' own value — refunding one item against that short
    // pool (`_splitAcrossPoolCurrencyMix`'s per-currency cap) hands back
    // LESS than the item is worth, because the pool never held the netted
    // portion to begin with. Orchestrator decision (owner not yet asked):
    // since the payout was netted against every item, undoing one item in
    // isolation can't be priced correctly — only the whole-basket reversal
    // (which also undoes the payout) can.
    this._assertNoNettedPayoutMembers(sessionId);

    // 5. Double-refund guard for the non-SALE (whole-member) branch — the
    // SALE branch gets its own per-line cap from `previewSaleItemRefundAmount`
    // (refunded_quantity), which this generic reverses_id check cannot see.
    if (!isSaleMember) {
      const existing = this.queryOne<{ id: number }>(
        `SELECT id FROM transactions WHERE reverses_id = ? AND type = 'REFUND' AND status = 'ACTIVE' AND tenant_id = ?`,
        transactionId,
        tenantId,
      );
      if (existing) {
        throw new DatabaseError("This item has already been refunded", {
          entityId: transactionId,
        });
      }
    }

    const salesRepo = getSalesRepository();
    const lines: Array<{
      saleItemId: number;
      quantity: number;
      amountUsd: number;
      profitUsd: number;
    }> = [];
    let clientId: number | null = original.client_id;
    let saleId: number | null = null;
    // Adversarial-review rewrite (findings #2/#3) — the item's own amount is
    // now a PAIR, never a single tagged amount+currency. A SALE member is
    // always USD-only (sold_price_usd); a CUSTOM_SERVICE/RECHARGE member can
    // be dual-currency (e.g. $10 + 450,000 LBP), and the old single-tag
    // logic (`amount_lbp !== 0 && amount_usd === 0 ? LBP : USD`) silently
    // dropped whichever side lost the pick — see finding #3's measured case
    // (a $10 + 450,000 LBP custom service left 450,000 LBP owed forever).
    let itemAmountUsd = 0;
    let itemAmountLbp = 0;

    if (isSaleMember) {
      saleId = original.source_id;
      if (input.saleItemId != null) {
        if (!(input.quantity != null && input.quantity > 0)) {
          throw new DatabaseError(
            "quantity is required and must be greater than 0 when saleItemId is given",
            { entityId: transactionId },
          );
        }
        const preview = salesRepo.previewSaleItemRefundAmount({
          saleId,
          saleItemId: input.saleItemId,
          refundQuantity: input.quantity,
        });
        clientId = preview.clientId ?? clientId;
        lines.push({
          saleItemId: input.saleItemId,
          quantity: input.quantity,
          amountUsd: preview.refundAmountUsd,
          profitUsd: preview.refundProfitUsd,
        });
      } else {
        // Q2 (owner answer) — saleItemId omitted: every remaining line, in
        // full, in ONE operation.
        const remainingRows = this.query<{
          id: number;
          quantity: number;
          refunded_quantity: number | null;
        }>(
          `SELECT id, quantity, refunded_quantity FROM sale_items
           WHERE sale_id = ? AND tenant_id = ? AND (quantity - COALESCE(refunded_quantity, 0)) > 0`,
          saleId,
          tenantId,
        );
        if (remainingRows.length === 0) {
          throw new DatabaseError("Nothing remains to refund on this sale", {
            entityId: transactionId,
          });
        }
        for (const row of remainingRows) {
          const remainingQty = row.quantity - (row.refunded_quantity ?? 0);
          const preview = salesRepo.previewSaleItemRefundAmount({
            saleId,
            saleItemId: row.id,
            refundQuantity: remainingQty,
          });
          clientId = preview.clientId ?? clientId;
          lines.push({
            saleItemId: row.id,
            quantity: remainingQty,
            amountUsd: preview.refundAmountUsd,
            profitUsd: preview.refundProfitUsd,
          });
        }
      }
      itemAmountUsd = lines.reduce((sum, l) => sum + l.amountUsd, 0);
      itemAmountLbp = 0; // sale lines are always sold_price_usd
    } else {
      itemAmountUsd = Math.abs(original.amount_usd);
      itemAmountLbp = Math.abs(original.amount_lbp);
    }
    // The item's own native currency — used ONLY as the no-pool fallback
    // currency for `_splitAcrossPoolCurrencyMix` (finding #2), never again
    // for the amount itself.
    const nativeCurrency: "USD" | "LBP" =
      itemAmountLbp > 0 && itemAmountUsd === 0 ? "LBP" : "USD";

    // 6. Account first (findings #2/#3/#6/#10, adversarial-review rewrite).
    //
    // `basketChargeRemaining[c]` = the basket's GROSS 'Session Debt' charge
    // in currency c, minus every PRIOR item refund's own A_account[c] (never
    // minus `covered_*`, which FIFO repayment coverage never populates for
    // 'Session Debt' rows at all — finding #6's root cause). This is "how
    // much of the basket's account-paid side is still unclaimed by an item".
    const sessionDebtRows = this.query<{
      id: number;
      client_id: number;
      amount_usd: number;
      amount_lbp: number;
    }>(
      `SELECT id, client_id, amount_usd, amount_lbp
       FROM debt_ledger
       WHERE session_id = ? AND transaction_id IS NULL AND transaction_type = 'Session Debt' AND tenant_id = ?`,
      sessionId,
      tenantId,
    );
    let grossChargeUsd = 0;
    let grossChargeLbp = 0;
    // Finding #10 — the credit belongs to the client the 'Session Debt' row
    // was actually CHARGED to, which can differ from `clientId` (the item's
    // own buyer, e.g. a sale line rung up under client A inside a basket
    // whose account charge is on client B).
    let debtClientId: number | null = null;
    // Round-2 finding #5 — the LOWEST id among this basket's own 'Session
    // Debt' row(s): the boundary `_clientBalanceBeforeRow` reads "this
    // client's balance as it stood immediately before THIS charge" from.
    let sessionDebtRowId: number | null = null;
    for (const r of sessionDebtRows) {
      grossChargeUsd += r.amount_usd;
      grossChargeLbp += r.amount_lbp;
      debtClientId = debtClientId ?? r.client_id;
      sessionDebtRowId =
        sessionDebtRowId == null ? r.id : Math.min(sessionDebtRowId, r.id);
    }
    debtClientId = debtClientId ?? clientId;

    const priorAccountAttributed =
      this._priorSessionItemRefundAccountAttributed(sessionId);
    const basketChargeRemainingUsd = Math.max(
      0,
      grossChargeUsd - priorAccountAttributed.usd,
    );
    const basketChargeRemainingLbp = Math.max(
      0,
      grossChargeLbp - priorAccountAttributed.lbp,
    );

    // A_account[c] — same-currency attribution first, then a cross-currency
    // step (Q3's buy-rate rule) if the item still has leftover in one
    // currency while the OTHER currency's charge remainder is nonzero.
    let accountAttributedUsd = Math.min(
      itemAmountUsd,
      basketChargeRemainingUsd,
    );
    let accountAttributedLbp = Math.min(
      itemAmountLbp,
      basketChargeRemainingLbp,
    );
    let leftoverItemUsd = itemAmountUsd - accountAttributedUsd;
    let leftoverItemLbp = itemAmountLbp - accountAttributedLbp;
    let leftoverChargeUsd = basketChargeRemainingUsd - accountAttributedUsd;
    let leftoverChargeLbp = basketChargeRemainingLbp - accountAttributedLbp;
    if (leftoverItemUsd > 0.005 && leftoverChargeLbp > 1) {
      const buyRate = this._requireBuyRate(sessionId, effectiveRate);
      // Round-3 finding #6 (LOW) — round the LBP side of a cross-currency
      // conversion at the moment it's produced; an unrounded `take` here
      // fed straight into `accountAttributedLbp`, which then fed the
      // account-reduction credit row as fractional LBP (measured:
      // -4,153,333.333 LBP credit rows and ledger dust).
      const take = this._roundToUnit(
        Math.min(leftoverItemUsd * buyRate, leftoverChargeLbp),
        1,
      );
      accountAttributedLbp += take;
      leftoverItemUsd -= take / buyRate;
      leftoverChargeLbp -= take;
    }
    if (leftoverItemLbp > 1 && leftoverChargeUsd > 0.005) {
      const buyRate = this._requireBuyRate(sessionId, effectiveRate);
      const take = this._roundToUnit(
        Math.min(leftoverItemLbp / buyRate, leftoverChargeUsd),
        0.01,
      );
      accountAttributedUsd += take;
      leftoverItemLbp -= take * buyRate;
      leftoverChargeUsd -= take;
    }

    // credit[c] = how much of A_account[c] is still "unpaid in real cash"
    // and so must reduce the account rather than be handed back as cash.
    // Round-2 finding #5 (MEDIUM) — the PRE-FIX cap, `min(A_account,
    // max(0, balance_now))`, treated ANY negative current balance as "this
    // was already repaid" and refunded it as cash — but a negative balance
    // is just as often PRE-EXISTING store credit (a gift card, an earlier
    // overpayment) that never involved this basket's own charge at all.
    // Handing that back as cash turns store credit into cash the shop
    // never should have released. The fix separates the two:
    //   `available[c] = max(0, balance_now[c])                    // still genuinely owed
    //                 + max(0, -balanceBeforeThisCharge[c])`        // pre-existing credit
    // — `balanceBeforeThisCharge` is this client's own balance from EVERY
    // debt_ledger row with a LOWER id than this basket's own 'Session Debt'
    // row (rows from the SAME checkout, e.g. a same-basket CREDIT_DEPOSIT,
    // are written before it — see SessionPaymentService's write order —
    // and so are correctly folded in as "pre-existing", not as a
    // repayment). Only the REMAINDER — a real repayment credited AFTER
    // this charge existed — ever becomes cash (`repaidBack` below).
    // Worked-example proof (this file's "round-2 finding #5" tests):
    //   - pre-existing $200 credit, $100 charged, $50 item refund:
    //     balance_now = -100, balanceBefore = -200 →
    //     available = 0 + 200 = 200 → credit $50, cash $0.
    //   - $200 unrelated debt owed BEFORE this basket, $100 charged, $70
    //     repaid, $50 item refund: balance_now = 230, balanceBefore = 200
    //     → available = 230 + 0 = 230 → credit $50, cash $0.
    //   - worked example 4 (SESSION_ITEM_REFUND_PLAN.md §3): no prior
    //     debt, $100 charged, $70 repaid, $50 item refund: balance_now =
    //     30, balanceBefore = 0 → available = 30 → credit $30, cash $20
    //     (unchanged — this is the EXISTING "partly repaid debt" test).
    const clientBalance = debtClientId
      ? getDebtRepository().getClientBalance(debtClientId)
      : { balance_usd: 0, balance_lbp: 0 };
    const balanceBefore =
      debtClientId != null && sessionDebtRowId != null
        ? this._clientBalanceBeforeRow(debtClientId, sessionDebtRowId)
        : { usd: 0, lbp: 0 };
    // Round-3 finding #4 (MEDIUM) — the pre-existing-credit bucket
    // (`max(0, -balanceBefore)`) is a FIXED amount for the whole basket, not
    // a per-call re-read: subtract every EARLIER item refund's own draw on
    // it (`priorRestoredPreexisting`, see that reader's doc) before using it
    // here, so two item refunds on the same basket can never both treat the
    // SAME pre-existing credit as available.
    const priorRestoredPreexisting =
      this._priorSessionItemRefundPreexistingCreditUsed(sessionId);
    const stillOwedBucketUsd = Math.max(0, clientBalance.balance_usd);
    const stillOwedBucketLbp = Math.max(0, clientBalance.balance_lbp);
    const preexistingBucketUsd = Math.max(
      0,
      Math.max(0, -balanceBefore.usd) - priorRestoredPreexisting.usd,
    );
    const preexistingBucketLbp = Math.max(
      0,
      Math.max(0, -balanceBefore.lbp) - priorRestoredPreexisting.lbp,
    );
    const availableUsd = stillOwedBucketUsd + preexistingBucketUsd;
    const availableLbp = stillOwedBucketLbp + preexistingBucketLbp;
    // Round-3 finding #6 (LOW) — round to whole LBP / whole cents at THIS
    // money-producing site too (the account-reduction credit row and the
    // repaid-back cash leg both read straight off these two values).
    const accountReductionUsd = this._roundToUnit(
      Math.min(accountAttributedUsd, availableUsd),
      0.01,
    );
    const accountReductionLbp = this._roundToUnit(
      Math.min(accountAttributedLbp, availableLbp),
      1,
    );
    const repaidBackUsd = Math.max(
      0,
      accountAttributedUsd - accountReductionUsd,
    );
    const repaidBackLbp = Math.max(
      0,
      accountAttributedLbp - accountReductionLbp,
    );
    // How much of THIS call's own accountReduction drew from the
    // pre-existing bucket specifically (consumption order: the genuinely
    // still-owed bucket first, then pre-existing) — persisted so a LATER
    // item refund on the same basket can subtract it via
    // `_priorSessionItemRefundPreexistingCreditUsed` above.
    const restoredFromPreexistingCreditUsd = Math.min(
      Math.max(0, accountReductionUsd - stillOwedBucketUsd),
      preexistingBucketUsd,
    );
    const restoredFromPreexistingCreditLbp = Math.min(
      Math.max(0, accountReductionLbp - stillOwedBucketLbp),
      preexistingBucketLbp,
    );

    // The part of the item never attributed to the account at all — this is
    // what finding #2's pool-currency-mix split applies to. Combined into a
    // single USD-equivalent figure so ONE split call can allocate it across
    // whatever the basket's pool actually holds, then converted back.
    const poolAttributedUsdEquiv =
      leftoverItemUsd +
      (leftoverItemLbp > 1
        ? leftoverItemLbp / this._requireBuyRate(sessionId, effectiveRate)
        : 0);
    const poolSplit = this._splitAcrossPoolCurrencyMix(
      sessionId,
      poolAttributedUsdEquiv,
      nativeCurrency,
      effectiveRate,
    );

    // Finding #11 (dust legs) — floor a sub-cent/sub-LBP remainder to
    // exactly 0 rather than posting a leg (and requiring the operator's
    // override to match) for an amount too small to be real money. Same
    // 0.005 USD / 1 LBP thresholds already used pervasively throughout this
    // class (e.g. `_cancelSessionDebt`, the account-first step above) —
    // not a new magic number.
    const remainderUsdRaw = repaidBackUsd + poolSplit.usd;
    // Round-2 finding #9 (LOW) — round to a whole LBP at this final
    // boundary too (belt-and-suspenders on top of `poolSplit.lbp` already
    // being rounded at its own source): `repaidBackLbp` alone can still
    // carry fractional LBP from the cross-currency account-attribution
    // step above (`take = leftoverItemUsd * buyRate`), and there is no
    // sub-lira anywhere in this app's LBP figures.
    const remainderLbpRaw = Math.round(repaidBackLbp + poolSplit.lbp);
    const remainderUsd = remainderUsdRaw > 0.005 ? remainderUsdRaw : 0;
    const remainderLbp = remainderLbpRaw > 1 ? remainderLbpRaw : 0;

    return {
      original,
      isSaleMember,
      saleId,
      bookedRate,
      bookedRateSource,
      effectiveRate,
      lines,
      clientId,
      debtClientId,
      itemAmountUsd,
      itemAmountLbp,
      nativeCurrency,
      accountAttributedUsd,
      accountAttributedLbp,
      accountReductionUsd,
      accountReductionLbp,
      repaidBackUsd,
      repaidBackLbp,
      restoredFromPreexistingCreditUsd,
      restoredFromPreexistingCreditLbp,
      poolSplit,
      remainderUsd,
      remainderLbp,
    };
  }

  /**
   * Finding #6 — a flat CASH/General leg for money that is NOT the pool's
   * own cash but the CLIENT's already-repaid account money being handed
   * back (`repaidBack{Usd,Lbp}`): it never came out of this basket's pool,
   * so proportioning it across the pool's drawer mix (like
   * `_splitAcrossPoolCurrencyMix` does for the genuinely pool-attributed
   * remainder) would be attributing it to the wrong source. `CASH` /
   * `paymentMethodToDrawerName("CASH")` is the SAME default
   * `_defaultSessionRefundLegs`'s own no-pool fallback already uses (rule
   * 14 — one "default cash drawer" constant, not a second literal).
   */
  private _repaidBackLegs(usd: number, lbp: number): TransactionPaymentLeg[] {
    const drawerName = paymentMethodToDrawerName("CASH");
    const legs: TransactionPaymentLeg[] = [];
    if (usd > 0.005) {
      // Round-3 finding #6 (LOW) — round to whole cents; `usd` here is
      // `repaidBackUsd`, itself now rounded at its own source (see
      // `_planSessionItemRefund`), but rounding again at the leg-writing
      // site too keeps this function correct even if a future caller feeds
      // it an unrounded figure.
      const roundedUsd = this._roundToUnit(usd, 0.01);
      legs.push({
        direction: "out",
        amount: roundedUsd,
        signed_amount: -roundedUsd,
        currency_code: "USD",
        method: "CASH",
        drawer_name: drawerName,
      });
    }
    if (lbp > 1) {
      // Round-2 finding #9 (LOW) — no sub-lira.
      const roundedLbp = this._roundToUnit(lbp, 1);
      legs.push({
        direction: "out",
        amount: roundedLbp,
        signed_amount: -roundedLbp,
        currency_code: "LBP",
        method: "CASH",
        drawer_name: drawerName,
      });
    }
    return legs;
  }

  /** The FULL default money-back leg set for a plan (rule 14 — the ONE place
   *  either the preview or the real write computes it): the pool-mix split
   *  (finding #2) plus the flat repaid-account cash-back (finding #6),
   *  merged so a shared drawer leg posts as one row. */
  private _planDefaultLegs(
    sessionId: number,
    plan: ReturnType<TransactionRepository["_planSessionItemRefund"]>,
  ): TransactionPaymentLeg[] {
    return this._mergeLegs([
      this._defaultSessionRefundLegs(sessionId, plan.poolSplit.usd, "USD"),
      this._defaultSessionRefundLegs(sessionId, plan.poolSplit.lbp, "LBP"),
      this._repaidBackLegs(plan.repaidBackUsd, plan.repaidBackLbp),
    ]);
  }

  /**
   * LIRA-232 phase 1 — read-only preview: the account reduction (amount +
   * currency split) and the default pre-filled money-back legs, WITHOUT
   * writing anything. Mirrors LIRA-231's `getSaleRefundPreview` shape.
   */
  getSessionItemRefundPreview(input: {
    sessionId: number;
    transactionId: number;
    saleItemId?: number;
    quantity?: number;
    /** LIRA-236 — when given, the account reduction and remainder above are
     *  computed at THIS rate instead of the member's own booked rate. */
    exchangeRate?: number;
  }): SessionItemRefundPreview {
    const plan = this._planSessionItemRefund(input);
    // Round-2 finding #10 — the account-reduction message the UI shows
    // must name the CHARGED client (`plan.debtClientId`), not the item's
    // own buyer (`plan.clientId`, which the UI otherwise defaults to and
    // can differ inside a basket — see finding #10's own doc comment on
    // `_planSessionItemRefund` for the exact scenario).
    const hasAccountReduction =
      plan.accountReductionUsd > 0.0001 || plan.accountReductionLbp > 0.0001;
    // A minimal direct read (not `ClientRepository.findById`) — this is a
    // single display-only field, and pulling in that repository's full
    // column set here would couple this read to columns this method has no
    // other reason to depend on.
    const accountClientName =
      hasAccountReduction && plan.debtClientId != null
        ? this.queryOne<{ full_name: string }>(
            `SELECT full_name FROM clients WHERE id = ? AND tenant_id = ?`,
            plan.debtClientId,
            getCurrentTenantId(),
          )?.full_name
        : undefined;
    return {
      itemAmountUsd: plan.itemAmountUsd,
      itemAmountLbp: plan.itemAmountLbp,
      accountReductionUsd: plan.accountReductionUsd,
      accountReductionLbp: plan.accountReductionLbp,
      remainderUsd: plan.remainderUsd,
      remainderLbp: plan.remainderLbp,
      defaultLegs: this._planDefaultLegs(input.sessionId, plan),
      bookedRate: plan.bookedRate,
      bookedRateSource: plan.bookedRateSource,
      ...(accountClientName ? { accountClientName } : {}),
    };
  }

  /**
   * LIRA-232 phase 1 — refund ONE (or, with `saleItemId` omitted on a SALE
   * member, every remaining) line of a session-basket item, in ONE db
   * transaction (SESSION_ITEM_REFUND_PLAN.md §3):
   *   1. ITEM side — reuses `SalesRepository.applySaleItemReversalForSession`
   *      for a SALE member (per-line: stock, batches, units,
   *      refunded_quantity, the line's own 'Sale Debt' cancel), or
   *      `_createRefundRow` + `_applyGenericItemReversal` for a
   *      RECHARGE/CUSTOM_SERVICE member (whole-row: profit/source reversal,
   *      the same generic machinery `refundTransaction` uses, minus its
   *      MONEY step). Never `_reversePayments` — a session member's own
   *      `payments` rows are empty; money lives on the basket's pooled leg.
   *   2. ACCOUNT FIRST — reduces the basket's outstanding 'Session Debt' by
   *      min(A, D), writing ONE `SESSION_ITEM_REFUND_CREDIT_TYPE` credit
   *      linked to BOTH the session and this REFUND transaction (never the
   *      'Refund Reversal' shape — see that constant's doc for why).
   *   3. MONEY BACK — posts the remainder R as OUT legs (the caller's
   *      confirmed `refundLegs`, exact-matched against R via the existing
   *      `validateRefundLegOverrideAmounts`, or the proportional default)
   *      through drawer_balances, `transaction_id` = this REFUND id (never
   *      pooled) so they read as the refund's own legs, not the basket's.
   *   4. Links the REFUND transaction into the session
   *      (`customer_session_transactions`) so it shows in the session group
   *      and the Debts basket view.
   */
  refundSessionBasketItem(
    input: RefundSessionBasketItemInput,
  ): RefundSessionBasketItemResult {
    const tenantId = getCurrentTenantId();
    const { sessionId, transactionId, userId } = input;

    const plan = this._planSessionItemRefund(input);
    const {
      original,
      isSaleMember,
      saleId,
      effectiveRate,
      lines,
      clientId,
      debtClientId,
      itemAmountUsd,
      itemAmountLbp,
      accountAttributedUsd,
      accountAttributedLbp,
      accountReductionUsd,
      accountReductionLbp,
      restoredFromPreexistingCreditUsd,
      restoredFromPreexistingCreditLbp,
      remainderUsd,
      remainderLbp,
      poolSplit,
    } = plan;

    // Validate the operator's chosen return leg(s), if any, BEFORE any row
    // is written — same discipline as every other refund-override path.
    // Post-review rewrite (finding #2/#3): validated PER CURRENCY against
    // BOTH remainderUsd and remainderLbp, never a single tagged amount.
    // LIRA-236 — `effectiveRate` (the caller's typed rate, else the
    // member's own booked rate, else the day's fallback — see
    // `_planSessionItemRefund`) makes this a VALUE-based check, so the
    // cashier can hand back the remainder in a different currency mix than
    // `remainderUsd`/`remainderLbp`'s own split.
    const refundLegs = input.refundLegs;
    const hasOverride = !!refundLegs && refundLegs.length > 0;
    // Owner decision 2026-10-07 — refund kept change on the MONEY BACK
    // remainder (never on the account-first reduction, which moves no
    // cash). Same shared check as the whole-transaction refund; no claim →
    // the remainder is validated exactly as before.
    const keptResolved = this._resolveRefundKeptChange({
      owedNet: { USD: remainderUsd, LBP: remainderLbp },
      refundLegs: hasOverride ? refundLegs : undefined,
      claimed: { usd: input.kept_change_usd, lbp: input.kept_change_lbp },
      exchangeRate: this._refundKeptChangeRate(
        effectiveRate,
        original.exchange_rate,
      ),
      isForPartner: this._isForPartnerTransaction(original),
      originalType: original.type,
      entityId: transactionId,
    });
    const keptUsd = keptResolved.keptUsd;
    const keptLbp = keptResolved.keptLbp;
    if (hasOverride) {
      validateRefundLegOverrideAmounts(
        keptResolved.owedNetAfterKept,
        refundLegs!,
        transactionId,
        effectiveRate,
      );
    }

    return this.transaction(() => {
      let refundTxnId: number;
      // Finding #6 — every writer of this REFUND row stamps its OWN
      // account-attributed pair into metadata_json so a later item refund
      // on the SAME basket can reconstruct `basketChargeRemaining`
      // (`_priorSessionItemRefundAccountAttributed`). Round-2 finding #1 —
      // ALSO stamps its own pool-attributed pair (`poolSplit`), the SAME
      // way, so a later whole-basket reversal's `_reverseSessionPooledPayments`
      // can tell "already returned from THIS pool" apart from money that
      // came from a real repayment instead (`_priorSessionItemRefundPoolAttributed`).
      // Round-3 finding #4 — ALSO stamps how much of THIS call's own
      // account reduction drew from the pre-existing-credit bucket, so a
      // later item refund on the same basket never re-counts it (see
      // `_priorSessionItemRefundPreexistingCreditUsed`).
      const accountAttributionMeta = {
        accountAttributedUsd,
        accountAttributedLbp,
        poolSplitUsd: poolSplit.usd,
        poolSplitLbp: poolSplit.lbp,
        restoredFromPreexistingCreditUsd,
        restoredFromPreexistingCreditLbp,
        // LIRA-236, contract item 6 — the rate THIS refund actually used
        // (the caller's typed rate, else the member's own booked rate, else
        // the day's fallback — `_planSessionItemRefund`'s `effectiveRate`).
        exchangeRate: effectiveRate,
      };

      if (isSaleMember) {
        const saleItemIds = lines.map((l) => l.saleItemId).join(", ");
        refundTxnId = this.createTransaction({
          type: TRANSACTION_TYPES.REFUND,
          source_table: original.source_table,
          source_id: original.source_id,
          user_id: userId,
          amount_usd: -itemAmountUsd,
          amount_lbp: -itemAmountLbp,
          // + refund kept change (owner decision 2026-10-07), 0 when none.
          profit_usd: -lines.reduce((sum, l) => sum + l.profitUsd, 0) + keptUsd,
          profit_lbp: keptLbp,
          exchange_rate: original.exchange_rate,
          client_id: clientId,
          summary:
            lines.length === 1
              ? `SESSION ITEM REFUND: ${lines[0].quantity}x sale item #${lines[0].saleItemId} from Sale #${saleId}`
              : `SESSION ITEM REFUND: sale items [${saleItemIds}] from Sale #${saleId}`,
          metadata_json: {
            refundType: "sessionItem",
            sessionId,
            memberTransactionId: transactionId,
            saleItemIds: lines.map((l) => l.saleItemId),
            // LIRA-253 — the per-line quantities `undoSessionBasketItemRefund`
            // needs to reverse `sale_items.refunded_quantity` exactly (the
            // plain `saleItemIds` id list above carries no quantity).
            lines: lines.map((l) => ({
              saleItemId: l.saleItemId,
              quantity: l.quantity,
            })),
            ...accountAttributionMeta,
            ...(keptUsd > 0 || keptLbp > 0
              ? { kept_change_usd: keptUsd, kept_change_lbp: keptLbp }
              : {}),
          },
          device_id: original.device_id ?? undefined,
        });
        // Round-2 finding #3 (HIGH) — route the shared `unitExtras` array
        // to the line each unit actually belongs to, ONCE, before the
        // per-line loop (rule 14 — `SalesRepository.routeUnitExtrasByLine`,
        // one grouping query, not a re-derivation per line). Without this,
        // `applySaleItemReversalForSession`'s own per-line validation
        // rejected a unit linked to a DIFFERENT line in the same multi-line
        // refund (Q2's "every remaining line, in ONE operation").
        const unitExtrasByLine = input.unitExtras
          ? getSalesRepository().routeUnitExtrasByLine(
              lines.map((l) => l.saleItemId),
              input.unitExtras,
            )
          : undefined;
        // LIRA-253 — collect every unit THIS refund flipped IN_STOCK across
        // every line, same convention as the standalone `refundSaleItem`'s
        // own `restoredUnitIds` stamp (see `undoSaleItemRefund`'s doc for
        // why: distinguishes "still where the refund left it" from "resold
        // under a different sale" when an undo is later attempted).
        const allRestoredUnitIds: number[] = [];
        for (const line of lines) {
          const { restoredUnitIds } =
            getSalesRepository().applySaleItemReversalForSession({
              saleId: saleId!,
              saleItemId: line.saleItemId,
              refundQuantity: line.quantity,
              userId,
              refundTxnId,
              // 2026-09-26 owner decision (NEW API CONTRACT) — the "Returned
              // phones" defective/warranty override applies on every refund
              // path, including this one. Validated per-line against THIS
              // line's own linked units inside applySaleItemReversalForSession
              // itself (rule 14 — one validator, `validateRefundUnitExtras`).
              unitExtras: unitExtrasByLine?.get(line.saleItemId),
            });
          allRestoredUnitIds.push(...restoredUnitIds);
        }
        if (allRestoredUnitIds.length > 0) {
          this.execute(
            `UPDATE transactions SET metadata_json = json_set(metadata_json, '$.restoredUnitIds', json(?)) WHERE id = ? AND tenant_id = ?`,
            JSON.stringify(allRestoredUnitIds),
            refundTxnId,
            tenantId,
          );
        }
      } else {
        refundTxnId = this._createRefundRow(
          original,
          transactionId,
          userId,
          {
            refundType: "sessionItem",
            sessionId,
            memberTransactionId: transactionId,
            ...accountAttributionMeta,
            ...(keptUsd > 0 || keptLbp > 0
              ? { kept_change_usd: keptUsd, kept_change_lbp: keptLbp }
              : {}),
          },
          keptUsd > 0 || keptLbp > 0
            ? { usd: keptUsd, lbp: keptLbp }
            : undefined,
        );
        this._applyGenericItemReversal(
          original,
          transactionId,
          refundTxnId,
          userId,
        );
        // Finding #5 (BLOCKER) — reverse the MEMBER'S OWN `payments` rows
        // (the recharge's telecom stock leg / the FINANCIAL_SERVICE crypto
        // leg — system legs written on the member's own transaction_id even
        // under deferPayment; see RechargeRepository.processRecharge's
        // stockLeg write and FinancialServiceRepository's Binance debit).
        // These are NEVER customer-facing (deferPayment skips the
        // customer-cash step entirely — that lives on the session's pooled
        // leg, reversed separately below), so mirroring them here can never
        // double-count against the account-first/money-back steps. Omitting
        // this call (the pre-fix state) left the provider/crypto drawer
        // permanently short after an item refund — see this repository's
        // test file for the measured MTC-drawer proof.
        this._reversePayments(transactionId, refundTxnId, userId);
      }

      // Link the REFUND into the session so it shows in the session group
      // and the Debts basket view (SESSION_ITEM_REFUND_PLAN.md §5).
      this.execute(
        `INSERT INTO customer_session_transactions
           (tenant_id, session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd, amount_lbp, profit_usd, profit_lbp)
         VALUES (?, ?, 'session_item_refund', ?, ?, ?, ?, ?, ?)`,
        tenantId,
        sessionId,
        original.source_id,
        refundTxnId,
        -itemAmountUsd,
        -itemAmountLbp,
        // Same stamp as the REFUND row itself, incl. refund kept change.
        (isSaleMember
          ? -lines.reduce((sum, l) => sum + l.profitUsd, 0)
          : -original.profit_usd) + keptUsd,
        (isSaleMember ? 0 : -original.profit_lbp) + keptLbp,
      );

      // ACCOUNT FIRST — finding #10: credited to `debtClientId` (the client
      // the 'Session Debt' row was actually charged to), never `clientId`
      // (the item's own buyer, which can differ inside a basket).
      if (accountReductionUsd > 0.0001 || accountReductionLbp > 0.0001) {
        this.execute(
          `INSERT INTO debt_ledger (
             client_id, transaction_type, amount_usd, amount_lbp, transaction_id, session_id, note, created_by, tenant_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          debtClientId,
          SESSION_ITEM_REFUND_CREDIT_TYPE,
          -accountReductionUsd,
          -accountReductionLbp,
          refundTxnId,
          sessionId,
          `Session #${sessionId} basket item refund — account reduced`,
          userId,
          tenantId,
        );
      }

      // MONEY BACK — findings #2/#6: per-currency remainder, the operator's
      // override or the merged (pool-mix + repaid-account) default.
      const legsToPost: TransactionPaymentLeg[] = hasOverride
        ? refundLegs!.map((leg) => ({
            direction: "out" as const,
            amount: leg.amount,
            signed_amount: -leg.amount,
            currency_code: leg.currencyCode,
            method: leg.method,
            drawer_name: paymentMethodToDrawerName(leg.method),
          }))
        : this._planDefaultLegs(sessionId, plan);

      for (const leg of legsToPost) {
        insertPaymentRow(this.db, {
          transactionId: refundTxnId,
          method: leg.method,
          drawerName: leg.drawer_name ?? paymentMethodToDrawerName(leg.method),
          currencyCode: leg.currency_code,
          amount: leg.signed_amount,
          note: "Session item refund",
          createdBy: userId,
          tenantId,
        });
        applyDrawerDelta(this.db, {
          drawerName: leg.drawer_name ?? paymentMethodToDrawerName(leg.method),
          currencyCode: leg.currency_code,
          delta: leg.signed_amount,
          tenantId,
        });
      }

      return {
        refundTransactionId: refundTxnId,
        sessionId,
        memberTransactionId: transactionId,
        itemAmountUsd,
        itemAmountLbp,
        accountReductionUsd,
        accountReductionLbp,
        remainderUsd,
        remainderLbp,
        legs: legsToPost,
      };
    });
  }

  /**
   * LIRA-253 — admin-only "Undo refund" for a session-basket item refund
   * (`refundSessionBasketItem`'s own REFUND row, `metadata_json.refundType
   * === "sessionItem"`), the follow-up to `SalesRepository.undoSaleItemRefund`
   * (LIRA-147, standalone per-item refund). Restores exactly what
   * `refundSessionBasketItem` changed, by inverting each row IT wrote:
   *   - ITEM side (SALE member only — see scope note below): the per-line
   *     inverse of `applySaleItemReversalForSession`, via
   *     `SalesRepository.unapplySaleItemReversal` (rule 14 — one item
   *     reversal routine, shared with the standalone undo).
   *   - `debt_ledger` `SESSION_ITEM_REFUND_CREDIT_TYPE` ("Session Item
   *     Refund") rows the refund wrote (crediting the basket's charged
   *     client) are re-posted as 'Session Debt' rows with the negated
   *     (re-charging) amount — exactly re-establishing the account reduction
   *     the refund applied.
   *   - `payments`/drawers: the exact negated inverse of every leg the
   *     refund itself posted under its own transaction id — handles BOTH
   *     the pool-mix split and the flat repaid-account cash-back leg
   *     identically, since both end up as concrete `payments` rows either
   *     way (same technique as `undoSaleItemRefund`'s own money step).
   *   - `sale_items.refunded_quantity`/`sales.status`: restored to
   *     'completed' if this undo leaves anything un-refunded again.
   *
   * Scope (owner decision 2026-10-02): only a SALE session member is
   * supported today — the refund's own metadata must carry the `lines`
   * detail `refundSessionBasketItem` now stamps for a SALE member. A
   * non-SALE member (RECHARGE/CUSTOM_SERVICE item refund) refuses with a
   * named reason rather than attempting a generic reversal this method
   * cannot yet trace precisely (`_applyGenericItemReversal`'s own FIFO/
   * profit-source reversal has no traced inverse here). A refund whose
   * returned stock capacity was already consumed, or whose returned unit was
   * already resold under a different sale, also refuses — same two
   * dependent-activity guards `undoSaleItemRefund` already enforces (rule
   * 14, `unapplySaleItemReversal` + `canUnrestoreForSaleItem`).
   *
   * Idempotency: refuses if an ACTIVE REFUND_UNDO row already references
   * this `refundTransactionId`.
   */
  undoSessionBasketItemRefund(params: {
    refundTransactionId: number;
    userId: number;
  }): number {
    const db = this.db;
    const tenantId = getCurrentTenantId();

    const refundTxn = db
      .prepare(
        `SELECT id, type, status, source_table, source_id, amount_usd, amount_lbp,
                profit_usd, profit_lbp, exchange_rate, client_id, device_id, metadata_json
         FROM transactions WHERE id = ? AND tenant_id = ?`,
      )
      .get(params.refundTransactionId, tenantId) as
      | {
          id: number;
          type: string;
          status: string;
          source_table: string;
          source_id: number;
          amount_usd: number;
          amount_lbp: number;
          profit_usd: number | null;
          profit_lbp: number | null;
          exchange_rate: number | null;
          client_id: number | null;
          device_id: string | null;
          metadata_json: string | null;
        }
      | undefined;

    if (!refundTxn) {
      throw new NotFoundError("transaction", params.refundTransactionId);
    }
    if (refundTxn.type !== TRANSACTION_TYPES.REFUND) {
      throw new DatabaseError(
        "Undo refund only applies to a REFUND transaction.",
      );
    }
    if (refundTxn.status !== "ACTIVE") {
      throw new DatabaseError("This refund is not active — nothing to undo.");
    }

    let metadata: Record<string, unknown> = {};
    try {
      metadata = refundTxn.metadata_json
        ? (JSON.parse(refundTxn.metadata_json) as Record<string, unknown>)
        : {};
    } catch {
      metadata = {};
    }
    if (metadata.refundType !== "sessionItem") {
      throw new DatabaseError(
        metadata.refundType === "item"
          ? "This refund was made from a standalone sale — use the standard undo refund action."
          : "Undo refund only applies to a session-basket item refund.",
      );
    }

    const sessionId = Number(metadata.sessionId);
    if (!sessionId) {
      throw new DatabaseError(
        "This refund's record is missing the session it belongs to — cannot undo it safely.",
      );
    }

    const linesRaw = metadata.lines;
    if (!Array.isArray(linesRaw) || linesRaw.length === 0) {
      throw new DatabaseError(
        "This refund can't be undone — it was made before per-line detail was recorded, or it refunded a non-sale basket item (recharge/custom service), which undo refund does not yet support.",
      );
    }
    const lines = linesRaw as { saleItemId: number; quantity: number }[];

    // Already undone? — one ACTIVE REFUND_UNDO row may reference this
    // refund; a second one would double-restore every ledger above.
    const existingUndos = db
      .prepare(
        `SELECT id, metadata_json FROM transactions
         WHERE type = ? AND status = 'ACTIVE' AND tenant_id = ?`,
      )
      .all(TRANSACTION_TYPES.REFUND_UNDO, tenantId) as {
      id: number;
      metadata_json: string | null;
    }[];
    for (const row of existingUndos) {
      try {
        const m = row.metadata_json
          ? (JSON.parse(row.metadata_json) as Record<string, unknown>)
          : {};
        if (Number(m.refundTransactionId) === params.refundTransactionId) {
          throw new DatabaseError("This refund has already been undone.");
        }
      } catch (e) {
        if (e instanceof DatabaseError) throw e;
      }
    }

    // Dependent-activity guards — per line, same two checks
    // `undoSaleItemRefund` enforces: refunded_quantity still covers this
    // line, and the stock capacity this refund restored hasn't since been
    // consumed by other activity.
    const stockBatchRepo = getStockBatchRepository();
    for (const line of lines) {
      const item = db
        .prepare(
          `SELECT refunded_quantity FROM sale_items WHERE id = ? AND tenant_id = ?`,
        )
        .get(line.saleItemId, tenantId) as
        | { refunded_quantity: number }
        | undefined;
      if (!item) {
        throw new NotFoundError("sale_item", line.saleItemId);
      }
      if ((item.refunded_quantity ?? 0) < line.quantity) {
        throw new DatabaseError(
          "This item's refunded quantity no longer matches this refund — cannot undo it safely.",
        );
      }
      if (
        !stockBatchRepo.canUnrestoreForSaleItem(line.saleItemId, line.quantity)
      ) {
        throw new DatabaseError(
          "This refund can't be undone — the stock it restored has already been consumed by other activity since.",
        );
      }
    }

    // Resold-unit guard, across every line at once (the refund's own
    // `restoredUnitIds` stamp — see `refundSessionBasketItem`'s write).
    // Safe-direction fallback (same as `undoSaleItemRefund`): a refund made
    // before this stamp existed (no `restoredUnitIds` key at all) refuses
    // whenever ANY of its lines ever had unit-tracked product_units, rather
    // than risk a double-restore it can't precisely trace.
    if (this._productUnitsTableExists()) {
      const restoredUnitIdsRaw = metadata.restoredUnitIds;
      if (Array.isArray(restoredUnitIdsRaw) && restoredUnitIdsRaw.length > 0) {
        const placeholders = restoredUnitIdsRaw.map(() => "?").join(",");
        const stillAvailable = db
          .prepare(
            `SELECT COUNT(*) AS cnt FROM product_units
             WHERE id IN (${placeholders}) AND status = 'IN_STOCK' AND tenant_id = ?`,
          )
          .get(...restoredUnitIdsRaw, tenantId) as { cnt: number };
        if (stillAvailable.cnt < restoredUnitIdsRaw.length) {
          throw new DatabaseError(
            "This refund can't be undone — one or more of its returned units have already been sold again.",
          );
        }
      } else if (!("restoredUnitIds" in metadata)) {
        for (const line of lines) {
          const everLinked = db
            .prepare(
              `SELECT COUNT(*) AS cnt FROM product_units WHERE sale_item_id = ? AND tenant_id = ?`,
            )
            .get(line.saleItemId, tenantId) as { cnt: number };
          if (everLinked.cnt > 0) {
            const available = db
              .prepare(
                `SELECT COUNT(*) AS cnt FROM product_units
                 WHERE sale_item_id = ? AND status = 'IN_STOCK' AND tenant_id = ?`,
              )
              .get(line.saleItemId, tenantId) as { cnt: number };
            if (available.cnt < line.quantity) {
              throw new DatabaseError(
                "This refund can't be undone — one or more of its returned units have already been sold again.",
              );
            }
          }
        }
      }
    }

    return this.transaction(() => {
      const undoTxnId = this.createTransaction({
        type: TRANSACTION_TYPES.REFUND_UNDO,
        source_table: refundTxn.source_table,
        source_id: refundTxn.source_id,
        user_id: params.userId,
        amount_usd: -refundTxn.amount_usd,
        amount_lbp: -refundTxn.amount_lbp,
        profit_usd: refundTxn.profit_usd != null ? -refundTxn.profit_usd : 0,
        profit_lbp: refundTxn.profit_lbp != null ? -refundTxn.profit_lbp : 0,
        exchange_rate: refundTxn.exchange_rate,
        client_id: refundTxn.client_id,
        summary: `UNDO SESSION ITEM REFUND: undoes refund #${params.refundTransactionId} (session #${sessionId})`,
        metadata_json: {
          undoType: "sessionItem",
          refundTransactionId: params.refundTransactionId,
          sessionId,
          memberTransactionId: metadata.memberTransactionId,
          saleItemIds: lines.map((l) => l.saleItemId),
        },
        device_id: refundTxn.device_id ?? undefined,
      });

      // ITEM side — per line, the shared inverse routine (rule 14).
      const restoredUnitIdsRaw = metadata.restoredUnitIds;
      const restoredUnitIds = Array.isArray(restoredUnitIdsRaw)
        ? (restoredUnitIdsRaw as number[])
        : undefined;
      const salesRepo = getSalesRepository();
      for (const line of lines) {
        salesRepo.unapplySaleItemReversal({
          saleItemId: line.saleItemId,
          refundQuantity: line.quantity,
          restoredUnitIds,
        });
      }

      // ACCOUNT FIRST reversal — re-charge exactly what the refund credited
      // back to the basket's debt client.
      const creditRows = db
        .prepare(
          `SELECT id, client_id, amount_usd, amount_lbp, session_id FROM debt_ledger
           WHERE transaction_id = ? AND transaction_type = ? AND tenant_id = ?`,
        )
        .all(
          params.refundTransactionId,
          SESSION_ITEM_REFUND_CREDIT_TYPE,
          tenantId,
        ) as {
        id: number;
        client_id: number;
        amount_usd: number;
        amount_lbp: number;
        session_id: number | null;
      }[];
      for (const row of creditRows) {
        this.execute(
          `INSERT INTO debt_ledger (
             client_id, transaction_type, amount_usd, amount_lbp, transaction_id, session_id, note, created_by, tenant_id
           ) VALUES (?, 'Session Debt', ?, ?, ?, ?, ?, ?, ?)`,
          row.client_id,
          -row.amount_usd,
          -row.amount_lbp,
          undoTxnId,
          row.session_id,
          `Debt re-charged by undo refund #${params.refundTransactionId}`,
          params.userId,
          tenantId,
        );
      }

      // MONEY side — exact negated inverse of whatever the refund itself
      // posted (pool-split legs and the flat repaid-account cash-back leg
      // alike — both are plain `payments` rows under the refund's own
      // transaction id).
      const refundPayments = db
        .prepare(
          `SELECT method, drawer_name, currency_code, amount FROM payments WHERE transaction_id = ? AND tenant_id = ?`,
        )
        .all(params.refundTransactionId, tenantId) as {
        method: string;
        drawer_name: string;
        currency_code: string;
        amount: number;
      }[];
      for (const payment of refundPayments) {
        const negatedAmount = -payment.amount;
        insertPaymentRow(db, {
          transactionId: undoTxnId,
          method: payment.method,
          drawerName: payment.drawer_name,
          currencyCode: payment.currency_code,
          amount: negatedAmount,
          note: `Undo session item refund #${params.refundTransactionId}`,
          createdBy: params.userId,
          tenantId,
        });
        applyDrawerDelta(db, {
          drawerName: payment.drawer_name,
          currencyCode: payment.currency_code,
          delta: negatedAmount,
          tenantId,
        });
      }

      // Sale status — flip back from 'refunded' if this undo leaves
      // anything un-refunded again.
      const saleIdRow = db
        .prepare(
          `SELECT sale_id FROM sale_items WHERE id = ? AND tenant_id = ?`,
        )
        .get(lines[0].saleItemId, tenantId) as { sale_id: number } | undefined;
      if (saleIdRow) {
        const sale = db
          .prepare(`SELECT status FROM sales WHERE id = ? AND tenant_id = ?`)
          .get(saleIdRow.sale_id, tenantId) as { status: string } | undefined;
        if (sale?.status === "refunded") {
          const remaining = db
            .prepare(
              `SELECT COUNT(*) as count FROM sale_items
               WHERE sale_id = ? AND (quantity - refunded_quantity) > 0 AND tenant_id = ?`,
            )
            .get(saleIdRow.sale_id, tenantId) as { count: number } | undefined;
          if ((remaining?.count ?? 0) > 0) {
            db.prepare(
              `UPDATE sales SET status = 'completed' WHERE id = ? AND tenant_id = ?`,
            ).run(saleIdRow.sale_id, tenantId);
          }
        }
      }

      return undoTxnId;
    });
  }

  private _voidTransactionInternal(
    id: number,
    userId: number,
    opts: { allowSplitGroupMember?: boolean; allowSessionMember?: boolean },
  ): number {
    const original = this.findById(id);
    if (!original) {
      throw new NotFoundError("transactions", id);
    }
    if (original.status === "VOIDED") {
      throw new DatabaseError("Transaction is already voided", {
        entityId: id,
      });
    }
    this._assertReversible(original, opts);
    // LIRA-091: refuse up-front (before any write) if this transaction's own
    // auto supplier-ledger sibling has already been swept into a settlement —
    // see the method doc for why cascading through a settled sibling is
    // blocked rather than silently corrupting the settlement's netted math.
    this._assertSupplierSiblingsVoidable(original);
    // Owner decision 2026-10-07 — a supplier payment's bundled discount is
    // removed by the payment's void/refund; refuse up front if that
    // discount was already swept into a settlement.
    this._assertSupplierBundledDiscountVoidable(original);
    // EXCHANGE_LOT_SETTLEMENT.md Q12 — refuse up-front if this exchange's
    // acquired lot has already been partially/fully sold. No-op for every
    // non-EXCHANGE type.
    this._assertExchangeLotsVoidable(original);
    // This ticket's own guard — refuse up-front if its checkpoint has already
    // settled (see the method doc). No-op for every non-LOTO type.
    this._assertLotoTicketVoidable(original);
    // LIRA-201c — same up-front refusal for a LOTO_CASH_PRIZE basket member
    // whose prize was already reimbursed or its checkpoint settled. No-op
    // for every other type (including a solo LOTO_CASH_PRIZE, which never
    // reaches here — _assertReversible already threw above).
    this._assertLotoCashPrizeVoidable(original);
    const tenantId = getCurrentTenantId();
    // A transaction that already has an ACTIVE REFUND reverser had its cash
    // reversed once — voiding it too would double-reverse the drawers.
    const refunded = this.queryOne<{ id: number }>(
      `SELECT id FROM transactions WHERE reverses_id = ? AND type = 'REFUND' AND status = 'ACTIVE' AND tenant_id = ?`,
      id,
      tenantId,
    );
    if (refunded) {
      throw new DatabaseError(
        "Transaction has already been refunded — cannot void it too",
        { entityId: id },
      );
    }
    // Owner decision 2026-08-26 — refuse a WHOLE-sale void once any of the
    // sale's lines has been item-refunded. Placed AFTER the two guards above
    // so an already-voided/already-refunded transaction still gets its own
    // (more specific) message. See `_assertNoPartialItemRefunds`.
    this._assertNoPartialItemRefunds(original);

    return this.transaction(() => {
      // 1. Mark original as VOIDED
      this.execute(
        `UPDATE transactions SET status = 'VOIDED' WHERE id = ? AND tenant_id = ?`,
        id,
        tenantId,
      );

      // 2. Create reversal row
      const result = this.execute(
        `INSERT INTO transactions
          (type, status, source_table, source_id, user_id,
           amount_usd, amount_lbp, exchange_rate,
           client_id, reverses_id, summary, metadata_json, device_id, tenant_id)
         VALUES (?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        original.type,
        original.source_table,
        original.source_id,
        userId,
        -original.amount_usd,
        -original.amount_lbp,
        original.exchange_rate,
        original.client_id,
        id,
        `VOID: ${original.summary ?? original.type}`,
        original.metadata_json,
        original.device_id,
        tenantId,
      );

      const reversalId = result.lastInsertRowid as number;

      // 3. Reverse drawer balances — negate every payment from the original
      this._reversePayments(id, reversalId, userId);

      // 4. Mark source module record as voided/refunded
      this._markSourceRefunded(original.source_table, original.source_id);

      // 5. Cancel any module-charge debt booked against this transaction —
      // every account-charged flow (sale, recharge, financial/custom service,
      // maintenance), not just sales. No-op when nothing matches.
      this._cancelDebt(id, userId);

      // 5a. D3 (COUNTERPARTY_CONSOLIDATION_PLAN.md) — if the transaction
      // being voided IS a DEBT_REPAYMENT itself, restore the debt the
      // repayment paid down and unwind the FIFO coverage it applied. No-op
      // for every other transaction type (see the method doc for the
      // disjoint-trigger proof vs. _cancelDebt above).
      this._restoreRepaymentDebt(original, userId);

      // 5b. Reverse any partner_ledger rows tied to this transaction
      // (PFT-2, rule 20) — type-agnostic, so this also fixes the
      // pre-existing FOR_OMT/THROUGH_* void gap uniformly.
      this._reversePartnerLedger(original, userId, "void");

      // 5c. LIRA-091 — cascade-void any auto supplier-ledger sibling this
      // transaction's own event created (FinancialServiceRepository's BILL
      // commission / SEND-RECEIVE TOP_UP-PAYMENT auto rows). No-op when
      // there is none, or on a legacy (pre-v136) row with no link.
      this._cascadeSupplierSiblingVoid(original, userId);

      // 5c2. Owner decision 2026-09-06, rule 20 — cascade-void the auto SMS
      // transfer fee expense a CREDIT_TRANSFER recharge (or any other
      // v166-linked flow) booked as this transaction's own side effect. No-op
      // when there is none, or on a legacy (pre-v166) row with no link.
      this._cascadeExpenseSiblingVoid(original, userId);

      // 5d. LIRA-085 — if this transaction IS a PARTNER_SETTLEMENT/
      // PARTNER_PAYMENT, restore its own partner_ledger row (+ any bundled
      // CQ-10 discount) and unwind the FIFO covered_amount stamps it
      // applied. No-op for every other type.
      this._reversePartnerSettlementLedger(original, userId);

      // 5e. LIRA-085 — if this transaction IS a SUPPLIER_SETTLEMENT, reverse
      // the commission drawer funding, soft-void the linked SUPPLIER_PAYS_US
      // row, and un-stamp financial_services.settlement_id/is_settled. No-op
      // for every other type.
      this._reverseSupplierSettlement(original, userId);

      // 5e1. SUPPLIER_STOCK_INTAKE_PLAN.md, rule 20 — if this transaction IS
      // a SUPPLIER_STOCK_INTAKE (or, since LIRA-087, an ATTACHED
      // SUPPLIER_RECORDED_DEBT), delete the batch it created (REFUSING the
      // whole void if any unit was already sold) and take the delivered
      // stock back out. No-op for every other type.
      this._reverseSupplierStockIntake(original);

      // 5e2. EXCHANGE_LOT_SETTLEMENT.md rule 20 — if this transaction IS an
      // EXCHANGE, restore whatever it (as a SELL) FIFO-consumed from someone
      // else's lot and void whatever lot it (as a BUY) created — the guard
      // above already proved a voided BUY's lot carries no active
      // settlements. No-op for every other type.
      this._reverseExchangeLotEffects(original);

      // 5f. Rule 20 — if this transaction IS a LOTO ticket sale, soft-void
      // its supplier_ledger TOP_UP row and delta-adjust its checkpoint (if
      // still open). No-op for every other type; a settled checkpoint was
      // already refused by _assertLotoTicketVoidable before this transaction
      // opened.
      this._reverseLotoSupplierLedger(original);

      // 5f1. LIRA-201c, rule 20 — if this transaction IS a LOTO_CASH_PRIZE
      // basket member, soft-void its supplier_ledger CASH_PRIZE row, mark
      // the prize voided, and delta-adjust its checkpoint (if still open).
      // No-op for every other type (a solo LOTO_CASH_PRIZE never reaches
      // this transaction() block — _assertReversible already threw).
      this._reverseLotoCashPrize(original);

      // 5f2. LIRA-194, rule 20 — if this transaction IS a RECHARGE_TOPUP
      // (topUpFromSupplier), soft-void its link-mode supplier_ledger TOP_UP
      // row. No-op for every other type, and for the other three
      // RECHARGE_TOPUP writers (topUpApp/topUpFromPartner/topUpFromClient),
      // which never write one.
      this._reverseSupplierLedgerByTransactionLink(original);

      // 5g. LIRA-090 §8, rule 20 — reverse every carrier_line_movements row
      // tied to this transaction (Only Days credit-return, self-charge).
      // Type-agnostic, keyed by transaction_id; no-op when none match.
      this._reverseCarrierLineMovements(original);

      // 5e3. LIRA-143 phase 4, rule 20 — flip every SOLD product_unit tied to
      // this SALE back to IN_STOCK. Void never carries flag extras — the
      // phone-refund UI's defective/warranty-override flagging is REFUND-only
      // (owner decision 2026-07-04; extended 2026-09-26 to every refund path:
      // Transactions page whole-refund, POS whole-sale refund, POS per-item
      // refund — never void, on any of them). No-op for every non-SALE
      // transaction, or when product_units doesn't exist.
      this._reverseProductUnits(original);

      // 6. If SALE: cancel sale, restore stock
      if (original.source_table === "sales" && original.source_id) {
        this.execute(
          `UPDATE sales SET status = 'cancelled' WHERE id = ? AND tenant_id = ?`,
          original.source_id,
          tenantId,
        );
        this._restoreStock(original.source_id);
      }

      // 6a. FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §2 FINAL SPEC, rule 20 —
      // if this transaction IS a custom service that consumed inventory,
      // restore the 1 unit it decremented. Runs here (not duplicated in
      // CustomServiceRepository.deleteService) so a custom service voided
      // directly from the Transactions page — bypassing deleteService
      // entirely — still gets its stock back exactly once; deleteService
      // itself reaches this same code by calling voidTransaction. No-op for
      // every other source_table/a service with no linked product.
      if (original.source_table === "custom_services" && original.source_id) {
        this._restoreCustomServiceStock(original.source_id);
      }

      // 6b. LIRA-176 phase 4, rule 20 — if this transaction IS a maintenance
      // job that consumed parts, restore whatever units it drew. Runs here
      // (not duplicated in MaintenanceService/MaintenanceRepository) so a
      // maintenance job voided directly from the Transactions page —
      // bypassing the maintenance module entirely — still returns its parts
      // exactly once; the `stock_restored` guard inside
      // `restoreMaintenanceJobParts` is what makes "exactly once" true even
      // if the job is later edited or deleted. No-op for every other
      // source_table/a job with no attached parts.
      if (original.source_table === "maintenance" && original.source_id) {
        this._restoreMaintenancePartsStock(original.source_id);
      }

      // 6c. LIRA-262, rule 20 — if this transaction IS a "shop used its own
      // stock" inventory expense (EXPENSE_INVENTORY), put the units back on
      // the shelf and into the batches they came from. Lives here (not in
      // ExpenseRepository.deleteExpense) so a void straight from the
      // Transactions page gets it too; the `stock_restored` guard makes it
      // exactly once. No-op for every other expense / source_table.
      if (original.source_table === "expenses" && original.source_id) {
        this._restoreExpenseStock(original.source_id);
      }

      // 7. Supplier payment: un-apply the FIFO purchase coverage the payment
      // consumed (the ledger row itself is soft-voided by step 4).
      this._unapplySupplierPurchaseCoverage(original);

      // 7a. Owner decision 2026-10-07, rule 20 — remove the payment's
      // bundled discount (ledger soft-void, profit negated, its FIFO
      // coverage given back). No-op without a linked discount.
      this._reverseSupplierBundledDiscount(original, userId);

      return reversalId;
    });
  }

  /**
   * Create a refund transaction:
   * 1. Guard against double-refund.
   * 2. Create a REFUND row with reverses_id = original.id and negated amounts.
   * 3. Reverse drawer balances via negated payment rows.
   * 4. If the original is a SALE, mark sale status = 'refunded',
   *    set sale_items.is_refunded = 1, restore stock, and cancel debt.
   *
   * Returns the refund transaction's ID.
   */
  /**
   * Refund a sale by its sale ID (looks up the corresponding transaction).
   * This is the entry point from the POS / SaleDetailModal — the WHOLE-sale
   * "Refund Sale" button.
   *
   * LIRA-231: `opts.refundLegs` gives this the SAME operator-chosen
   * return-method override contract the Transactions page uses
   * (`refundTransaction`'s LIRA-078 `refundLegs`) — no override reproduces
   * today's exact mirror-verbatim reversal (rule 14, one code path).
   *
   * 2026-09-26 owner decision: `opts.refundUnitExtras` rides alongside it,
   * forwarded verbatim to `refundTransaction` — the SAME "Returned phones"
   * per-unit defective/warranty-override flagging the Transactions page's
   * whole-refund flow has always had, now also reachable from the POS
   * "Refund Sale" button.
   *
   * A session-basket sale is refused HERE, before `refundTransaction` (and
   * therefore `_assertReversible`) ever runs — same detection
   * (`isTransactionSessionLinked`), but with the POS-specific wording the
   * owner asked for instead of `_assertReversible`'s generic "session basket
   * #N" message (that message stays as-is for the Transactions page's own
   * bare-refund attempt).
   */
  refundBySaleId(
    saleId: number,
    userId: number,
    opts?: {
      refundLegs?: RefundLegOverride[];
      refundUnitExtras?: RefundUnitExtra[];
      /** LIRA-236 — see `refundTransaction`'s own doc. */
      exchangeRate?: number;
      /** Owner decision 2026-10-07 — refund kept change (POS "Refund
       *  Sale"); see `_refundTransactionInternal`. */
      keptChange?: KeptChange;
    },
  ): number {
    const txn = this.queryOne<{ id: number }>(
      `SELECT id FROM transactions
       WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE' AND tenant_id = ?
       ORDER BY id DESC LIMIT 1`,
      saleId,
      getCurrentTenantId(),
    );
    if (!txn) {
      throw new DatabaseError(`No SALE transaction found for sale #${saleId}`, {
        entityId: saleId,
      });
    }
    if (this.isTransactionSessionLinked(txn.id)) {
      throw new DatabaseError(
        "This sale was paid through a customer session — refund it from the session basket.",
        { entityId: saleId },
      );
    }
    return this.refundTransaction(txn.id, userId, {
      refundLegs: opts?.refundLegs,
      refundUnitExtras: opts?.refundUnitExtras,
      exchangeRate: opts?.exchangeRate,
      keptChange: opts?.keptChange,
    });
  }

  /**
   * LIRA-231 — POS refund preview: the WHOLE sale's own customer-facing
   * payment legs (`TransactionPaymentLeg[]`, the SAME shape RefundMethodModal
   * already consumes on the Transactions page) plus whether the sale is
   * session-linked. Read-only counterpart to `refundBySaleId`'s guard —
   * SaleDetailModal calls this to pre-fill/pre-flight the "Refund Sale"
   * button before opening RefundMethodModal.
   *
   * Round-2 finding #11 — also carries `sessionId`/`sessionTransactionId`
   * for a session-linked sale, so the UI can hand them straight to
   * `refundSessionBasketItem` without a second lookup. `sessionTransactionId`
   * is `txnId` itself, resolved via `getActiveSaleTransactionId` — which
   * filters `type = 'SALE' AND reverses_id IS NULL`, so it keeps resolving
   * to the SALE's own unified row even after a prior item refund has
   * written an ACTIVE REFUND row for the same sale (a "newest active row by
   * source_id" lookup would wrongly return THAT instead — the exact bug
   * this finding named as a HIGH finding elsewhere in this same round).
   */
  getSaleRefundPreview(saleId: number): {
    legs: TransactionPaymentLeg[];
    sessionLinked: boolean;
    sessionId?: number;
    sessionTransactionId?: number;
    /** LIRA-236 — the default rate the refund popup shows: this sale's own
     *  `exchange_rate_snapshot` (source "sale"), else the day's fallback. */
    bookedRate: number;
    bookedRateSource: "sale" | "transaction" | "fallback";
  } {
    const txnId = this.getActiveSaleTransactionId(saleId);
    if (txnId == null) {
      throw new NotFoundError("SALE transaction for sale", saleId);
    }
    const linkage = this.getSessionLinkage(txnId);
    const original = this.findById(txnId);
    const { bookedRate, bookedRateSource } = this._bookedRateFor(
      original?.exchange_rate,
      "sale",
    );
    return {
      legs: paymentRowsToLegs(this.getPaymentsByTransactionId(txnId)),
      sessionLinked: linkage != null,
      ...(linkage ?? {}),
      bookedRate,
      bookedRateSource,
    };
  }

  refundTransaction(
    id: number,
    userId: number,
    opts?: {
      refundLegs?: RefundLegOverride[];
      /** LIRA-143 phase 4 — phone-refund UI's per-unit defective/warranty-
       *  override flags, applied to the SAME sale being refunded as the
       *  units flip back to IN_STOCK. See `_reverseProductUnits`. */
      refundUnitExtras?: RefundUnitExtra[];
      /** LIRA-236 — see `_refundTransactionInternal`'s own doc. */
      exchangeRate?: number;
      /** Owner decision 2026-10-07 — see `_refundTransactionInternal`. */
      keptChange?: KeptChange;
    },
  ): number {
    return this._refundTransactionInternal(id, userId, {
      refundLegs: opts?.refundLegs,
      refundUnitExtras: opts?.refundUnitExtras,
      exchangeRate: opts?.exchangeRate,
      keptChange: opts?.keptChange,
    });
  }

  /**
   * LIRA-115: internal counterpart to `refundTransaction`, split out the same
   * way `voidTransaction` delegates to `_voidTransactionInternal` (rule 14 —
   * one shape, reused) so `refundSessionBasket` can bypass the session-basket
   * guard (`allowSessionMember: true`) for one item at a time while every
   * OTHER caller (the public `refundTransaction`, `refundBySaleId`) keeps the
   * guard enforced.
   */
  private _refundTransactionInternal(
    id: number,
    userId: number,
    opts: {
      refundLegs?: RefundLegOverride[];
      refundUnitExtras?: RefundUnitExtra[];
      allowSessionMember?: boolean;
      /** LIRA-236 — the cashier-typed exchange rate (LBP per 1 USD) driving
       *  BOTH `refundLegs`' value-based validation (cross-currency legs) and
       *  the audit stamp on the REFUND row's own metadata_json. Omitted:
       *  today's per-currency exact-match behavior, unchanged. */
      exchangeRate?: number;
      keptChange?: KeptChange;
    },
  ): number {
    const original = this.findById(id);
    if (!original) {
      throw new NotFoundError("transactions", id);
    }
    if (original.status === "VOIDED") {
      throw new DatabaseError("Cannot refund a voided transaction", {
        entityId: id,
      });
    }
    this._assertReversible(original, {
      allowSessionMember: opts.allowSessionMember,
    });
    // LIRA-091: same up-front settled-sibling guard as voidTransaction — see
    // _assertSupplierSiblingsVoidable's doc.
    this._assertSupplierSiblingsVoidable(original);
    // Owner decision 2026-10-07 — a supplier payment's bundled discount is
    // removed by the payment's void/refund; refuse up front if that
    // discount was already swept into a settlement.
    this._assertSupplierBundledDiscountVoidable(original);
    // Same up-front settled-lot guard as voidTransaction — see
    // _assertExchangeLotsVoidable's doc. No-op for every non-EXCHANGE type.
    this._assertExchangeLotsVoidable(original);
    // Same up-front settled-checkpoint guard as voidTransaction — see
    // _assertLotoTicketVoidable's doc. No-op for every non-LOTO type.
    this._assertLotoTicketVoidable(original);
    // LIRA-201c — same up-front refusal as voidTransaction's identical step.
    // No-op for every non-LOTO_CASH_PRIZE type.
    this._assertLotoCashPrizeVoidable(original);
    const tenantId = getCurrentTenantId();

    // Guard: prevent double-refund
    const existing = this.queryOne<{ id: number }>(
      `SELECT id FROM transactions WHERE reverses_id = ? AND type = 'REFUND' AND tenant_id = ?`,
      id,
      tenantId,
    );
    if (existing) {
      throw new DatabaseError("Transaction has already been refunded", {
        entityId: id,
      });
    }

    // Owner decision 2026-08-26 — refuse a WHOLE-sale refund once any of the
    // sale's lines has been item-refunded. Same placement rationale as
    // voidTransaction's identical step (after the double-refund guard, so the
    // more specific message wins). See `_assertNoPartialItemRefunds`.
    this._assertNoPartialItemRefunds(original);

    // LIRA-078: validate the operator's chosen return method(s) BEFORE any
    // row is written — a throw here never enters this.transaction(), so a
    // rejected override leaves nothing partial behind (same discipline as
    // reconcileLegs, moneyPosting.ts). No-op (existing mirror-verbatim
    // behavior, byte-identical to pre-LIRA-078) when opts/refundLegs is
    // omitted — this is what keeps every OTHER refund call site (refundBySaleId,
    // scripted callers, tests) unchanged.
    const refundLegs = opts.refundLegs;
    // Owner decision 2026-10-07 — refund kept change. Checked BEFORE any
    // write (same discipline as the override validation it feeds). No claim
    // → zeros and the unchanged path below.
    let kept: { usd: number; lbp: number } | undefined;
    if (refundLegs && refundLegs.length > 0) {
      if (isSwapTransactionType(original.type)) {
        throw new DatabaseError(
          "A currency exchange can only be refunded by swapping the money back — choosing return methods is not supported for it",
          { entityId: id },
        );
      }
      kept = this._validateRefundLegOverride(
        id,
        refundLegs,
        opts.exchangeRate,
        { original, claimed: opts.keptChange },
      );
    } else if (opts.keptChange) {
      // No return lines → the default mirror refund hands back everything;
      // a kept claim is refused with the shared helper's own message.
      this._resolveRefundKeptChange({
        owedNet: this._overridableNetByCurrency(
          this.getPaymentsByTransactionId(id),
        ),
        refundLegs: undefined,
        claimed: opts.keptChange,
        exchangeRate: this._refundKeptChangeRate(
          opts.exchangeRate,
          original.exchange_rate,
        ),
        isForPartner: this._isForPartnerTransaction(original),
        originalType: original.type,
        entityId: id,
      });
    }

    return this.transaction(() => {
      const refundId = this._reverseTransactionItemEffects(
        original,
        id,
        userId,
        {
          refundUnitExtras: opts.refundUnitExtras,
          exchangeRate: opts.exchangeRate,
          kept,
        },
      );

      // MONEY side — reverse drawer balances (negate every payment from the
      // original). LIRA-078: when refundLegs is present, the customer-facing
      // legs are replaced by the operator's chosen return method(s) instead
      // of being mirrored verbatim; every other (internal bookkeeping) leg
      // still mirrors exactly as before — see _reversePayments. Kept OUT of
      // `_reverseTransactionItemEffects` (LIRA-232 phase 1, rule 14) so
      // `refundSessionBasketItem` can reuse the ITEM side only and route
      // money back through the session's own account-first + leg logic.
      this._reversePayments(
        id,
        refundId,
        userId,
        refundLegs,
        opts.exchangeRate,
      );

      return refundId;
    });
  }

  /**
   * LIRA-232 phase 1 (rule 14): the ITEM side of a generic transaction
   * refund — everything `_refundTransactionInternal` used to do EXCEPT
   * reversing the original's own `payments` rows (`_reversePayments`, the
   * MONEY side). Creates the REFUND row (negated amount/profit, `reverses_id`
   * set), marks the source module record refunded, cancels any module-charge
   * debt/repayment/partner/supplier/loto/carrier-line/product-unit side
   * effect this transaction's own creation wrote (rule 20, unchanged from the
   * pre-split method), and marks a SALE/custom-service/maintenance source
   * refunded + restores its stock.
   *
   * Must run inside the caller's db.transaction(); opens none of its own.
   * Reused by `_refundTransactionInternal` (the public `refundTransaction`/
   * `refundBySaleId` path, which follows this with `_reversePayments`) and by
   * `refundSessionBasketItem` (a non-SALE session member, which follows this
   * with the session's own account-first + leg-override money path instead —
   * a session-linked FINANCIAL_SERVICE/RECHARGE/CUSTOM_SERVICE member's own
   * `payments` rows are empty, exactly like a session-linked SALE's, so
   * skipping `_reversePayments` here is a no-op difference in practice, not
   * just an architectural one).
   */
  /**
   * LIRA-232 phase 1 (rule 14): the row-creation half of a generic
   * transaction refund — a 1:1 negated mirror of `original`, linked via
   * `reverses_id`. Split out of `_reverseTransactionItemEffects` so
   * `refundSessionBasketItem`'s non-SALE branch can create ONE refund row
   * and then apply the rest of the item-side reversal onto it, without a
   * second caller (the SALE branch, which sums MULTIPLE lines into one
   * aggregate row) ever risking a duplicate INSERT.
   */
  private _createRefundRow(
    original: TransactionEntity,
    id: number,
    userId: number,
    /** LIRA-232 phase 1 (finding #6) — `refundSessionBasketItem`'s non-SALE
     *  branch merges `accountAttributedUsd`/`accountAttributedLbp` (and its
     *  own session-refund tag) into the refund row's own metadata_json, on
     *  top of whatever `original.metadata_json` already carried, so a LATER
     *  item refund on the same basket can recover it (see
     *  `_priorSessionItemRefundAccountAttributed`). Every other caller
     *  (the public refund path) omits this and gets byte-identical
     *  behavior to before this parameter existed. */
    extraMetadata?: Record<string, unknown>,
    /** Refund kept change (owner decision 2026-10-07), already checked by
     *  `_resolveRefundKeptChange`: ADDED to the negated profit, per
     *  currency, so the shop keeps it as profit and an undo/void of this
     *  row negates it with everything else. Omitted → plain negation. */
    kept?: { usd: number; lbp: number },
  ): number {
    const tenantId = getCurrentTenantId();
    let metadataStr = original.metadata_json;
    // LIRA-272 — the change THIS refund kept, under its own dedicated keys
    // (`REFUND_KEPT_CHANGE_META`), so the Profits page can show it for a
    // module whose refunded original it drops (FINANCIAL_SERVICE, RECHARGE,
    // CUSTOM_SERVICE, MAINTENANCE, LOTO). Never the copied
    // `kept_change_usd/lbp`, which may be the ORIGINAL's sale-time kept
    // change. One place for every caller: the generic refund and the
    // non-SALE session item refund both create their row here.
    const refundKeptMeta =
      kept && (kept.usd > 0 || kept.lbp > 0)
        ? {
            [REFUND_KEPT_CHANGE_META.usd]: kept.usd,
            [REFUND_KEPT_CHANGE_META.lbp]: kept.lbp,
          }
        : undefined;
    if (extraMetadata || refundKeptMeta) {
      let base: Record<string, unknown> = {};
      if (original.metadata_json) {
        try {
          base = JSON.parse(original.metadata_json) as Record<string, unknown>;
        } catch {
          base = {};
        }
      }
      metadataStr = JSON.stringify({
        ...base,
        ...extraMetadata,
        ...refundKeptMeta,
      });
    }
    // The refund carries NEGATED profit: the original stays ACTIVE (profit
    // queries sum SALE + REFUND rows), so without the negative stamp a
    // refunded transaction keeps its full profit forever.
    const result = this.execute(
      `INSERT INTO transactions
        (type, status, source_table, source_id, user_id,
         amount_usd, amount_lbp, exchange_rate, profit_usd, profit_lbp,
         client_id, reverses_id, summary, metadata_json, device_id, tenant_id)
       VALUES ('REFUND', 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      original.source_table,
      original.source_id,
      userId,
      -original.amount_usd,
      -original.amount_lbp,
      original.exchange_rate,
      kept ? -original.profit_usd + kept.usd : -original.profit_usd,
      kept ? -original.profit_lbp + kept.lbp : -original.profit_lbp,
      original.client_id,
      id,
      `REFUND: ${original.summary ?? original.type}`,
      metadataStr,
      original.device_id,
      tenantId,
    );
    return result.lastInsertRowid as number;
  }

  private _reverseTransactionItemEffects(
    original: TransactionEntity,
    id: number,
    userId: number,
    opts: {
      refundUnitExtras?: RefundUnitExtra[];
      exchangeRate?: number;
      /** Refund kept change (owner decision 2026-10-07), already checked by
       *  `_resolveRefundKeptChange` — added to the REFUND row's profit. */
      kept?: { usd: number; lbp: number };
    } = {},
  ): number {
    // LIRA-236, contract item 6 — every REFUND row records the rate it used
    // in metadata_json, even when the refund never actually needed to
    // convert currencies (the popup always shows/sends a rate, so this is
    // audit provenance, not a conditional "only when a conversion
    // happened" stamp). F12 (round-3 review) — this must be the rate that
    // ACTUALLY drove the refund's math even when the cashier never typed
    // an override: the booked rate (`original.exchange_rate`, what the
    // popup defaulted to and what the per-currency exact-match path
    // implicitly used), not just the typed one. Omitted entirely only when
    // neither exists (a very old row with no recorded rate at all).
    const rateUsed = opts.exchangeRate ?? original.exchange_rate ?? undefined;
    const keptUsd = opts.kept?.usd ?? 0;
    const keptLbp = opts.kept?.lbp ?? 0;
    const hasKept = keptUsd > 0 || keptLbp > 0;
    const extraMetadata =
      rateUsed != null || hasKept
        ? {
            ...(rateUsed != null ? { exchangeRate: rateUsed } : {}),
            ...(hasKept
              ? { kept_change_usd: keptUsd, kept_change_lbp: keptLbp }
              : {}),
          }
        : undefined;
    const refundId = this._createRefundRow(
      original,
      id,
      userId,
      extraMetadata,
      opts.kept,
    );
    this._applyGenericItemReversal(original, id, refundId, userId, opts);
    return refundId;
  }

  /**
   * LIRA-232 phase 1 (rule 14): everything `_reverseTransactionItemEffects`
   * does AFTER creating the refund row — split out so `refundSessionBasketItem`
   * can reuse it for a non-SALE session member (recharge/custom service)
   * against a refund row IT already created (and will NOT follow with
   * `_reversePayments` — money for a session member goes through the
   * session's own account-first + leg logic instead).
   */
  private _applyGenericItemReversal(
    original: TransactionEntity,
    id: number,
    refundId: number,
    userId: number,
    opts: { refundUnitExtras?: RefundUnitExtra[] } = {},
  ): void {
    const tenantId = getCurrentTenantId();

    // 3. Mark source module record as refunded
    this._markSourceRefunded(original.source_table, original.source_id);

    // 4. Cancel any module-charge debt booked against this transaction —
    // every account-charged flow (sale, recharge, financial/custom service,
    // maintenance), not just sales. No-op when nothing matches.
    this._cancelDebt(id, userId);

    // 4a. D3 (COUNTERPARTY_CONSOLIDATION_PLAN.md) — if the transaction
    // being refunded IS a DEBT_REPAYMENT itself, restore the debt the
    // repayment paid down and unwind the FIFO coverage it applied. No-op
    // for every other transaction type.
    this._restoreRepaymentDebt(original, userId);

    // 4b. Reverse any partner_ledger rows tied to this transaction
    // (PFT-2, rule 20) — type-agnostic, so this also fixes the
    // pre-existing FOR_OMT/THROUGH_* refund gap uniformly.
    this._reversePartnerLedger(original, userId, "refund");

    // 4c. LIRA-091 — cascade-void any auto supplier-ledger sibling this
    // transaction's own event created. See voidTransaction's identical step.
    this._cascadeSupplierSiblingVoid(original, userId);

    // 4c2. Owner decision 2026-09-06, rule 20 — cascade-void the auto SMS
    // transfer fee expense sibling. See voidTransaction's identical step.
    this._cascadeExpenseSiblingVoid(original, userId);

    // 4d. LIRA-085 — PARTNER_SETTLEMENT/PARTNER_PAYMENT ledger + coverage
    // restore. See voidTransaction's identical step.
    this._reversePartnerSettlementLedger(original, userId);

    // 4e. LIRA-085 — SUPPLIER_SETTLEMENT commission/ledger/fs-stamp
    // restore. See voidTransaction's identical step.
    this._reverseSupplierSettlement(original, userId);

    // 4e1. SUPPLIER_STOCK_INTAKE_PLAN.md, rule 20 — SUPPLIER_STOCK_INTAKE
    // (or ATTACHED SUPPLIER_RECORDED_DEBT, LIRA-087) batch delete (refuses
    // if already sold) + stock takeback. See voidTransaction's identical
    // step.
    this._reverseSupplierStockIntake(original);

    // 4e2. EXCHANGE_LOT_SETTLEMENT.md rule 20 — EXCHANGE lot restore/void.
    // See voidTransaction's identical step.
    this._reverseExchangeLotEffects(original);

    // 4f. Rule 20 — LOTO ticket TOP_UP soft-void + checkpoint delta-adjust.
    // See voidTransaction's identical step.
    this._reverseLotoSupplierLedger(original);

    // 4f1. LIRA-201c, rule 20 — LOTO_CASH_PRIZE basket member: supplier
    // CASH_PRIZE soft-void + voided flag + checkpoint delta-adjust. See
    // voidTransaction's identical step.
    this._reverseLotoCashPrize(original);

    // 4f2. LIRA-194, rule 20 — RECHARGE_TOPUP (topUpFromSupplier) link-mode
    // supplier_ledger soft-void. See voidTransaction's identical step.
    this._reverseSupplierLedgerByTransactionLink(original);

    // 4g. LIRA-090 §8, rule 20 — carrier_line_movements reversal. See
    // voidTransaction's identical step.
    this._reverseCarrierLineMovements(original);

    // 4e3. LIRA-143 phase 4, rule 20 — flip every SOLD product_unit tied
    // to this SALE back to IN_STOCK, applying the operator's chosen
    // defective/warranty-override flags (`opts.refundUnitExtras`) at the
    // same time. See voidTransaction's identical step (which never passes
    // extras). No-op for every non-SALE transaction.
    this._reverseProductUnits(original, opts.refundUnitExtras);

    // 5. If SALE: mark sale & items as refunded, restore stock
    if (original.source_table === "sales" && original.source_id) {
      this.execute(
        `UPDATE sales SET status = 'refunded' WHERE id = ? AND tenant_id = ?`,
        original.source_id,
        tenantId,
      );
      this.execute(
        `UPDATE sale_items SET is_refunded = 1 WHERE sale_id = ? AND tenant_id = ?`,
        original.source_id,
        tenantId,
      );
      this._restoreStock(original.source_id);
    }

    // 5a. Rule 20 — same custom-service stock restore as voidTransaction's
    // identical step. See that step's doc for why this lives here rather
    // than in CustomServiceRepository.
    if (original.source_table === "custom_services" && original.source_id) {
      this._restoreCustomServiceStock(original.source_id);
    }

    // 5b. LIRA-176 phase 4, rule 20 — same maintenance-parts stock restore
    // as voidTransaction's identical step. See that step's doc for why
    // this lives here rather than in the maintenance module.
    if (original.source_table === "maintenance" && original.source_id) {
      this._restoreMaintenancePartsStock(original.source_id);
    }

    // 5c. LIRA-262, rule 20 — same inventory-expense stock restore as
    // voidTransaction's identical step 6c.
    if (original.source_table === "expenses" && original.source_id) {
      this._restoreExpenseStock(original.source_id);
    }

    // 6. Supplier payment: un-apply the FIFO purchase coverage
    this._unapplySupplierPurchaseCoverage(original);

    // 6a. Owner decision 2026-10-07, rule 20 — same bundled-discount
    // removal as voidTransaction's identical step 7a.
    this._reverseSupplierBundledDiscount(original, userId);
  }

  /**
   * Shared void/refund gate: refuse types whose side effects the generic
   * reversal cannot undo, and refuse reversing a reversal row (a VOID
   * reversal keeps the original type but carries reverses_id).
   */
  private _assertReversible(
    original: TransactionEntity,
    opts: {
      allowSplitGroupMember?: boolean;
      allowSessionMember?: boolean;
    } = {},
  ): void {
    if (NON_REVERSIBLE_TRANSACTION_TYPES.has(original.type)) {
      // LIRA-201c: LOTO_CASH_PRIZE and KEPT_CHANGE stay blocked for a
      // standalone void/refund (the throw below still fires for those), but
      // a basket member gets a real reversal owner — see
      // SESSION_BASKET_BYPASSABLE_NON_REVERSIBLE_TYPES' doc comment. Every
      // OTHER NON_REVERSIBLE type (REFUND, CREDIT_CASH_IN/OUT, …) stays
      // blocked even inside a basket — this bypass is scoped to exactly the
      // two types with a dedicated basket-only owner, not to session
      // membership in general.
      const bypassable =
        opts.allowSessionMember &&
        SESSION_BASKET_BYPASSABLE_NON_REVERSIBLE_TYPES.has(original.type);
      if (!bypassable) {
        throw new DatabaseError(
          `${original.type} transactions cannot be voided or refunded — reverse them from their own module`,
          { entityId: original.id },
        );
      }
    }
    if (original.reverses_id != null) {
      throw new DatabaseError("Cannot void or refund a reversal transaction", {
        entityId: original.id,
      });
    }
    // CARRIER_LEGS_VOID_ASYMMETRY.md (design B+): a row stamped with
    // `split_group` is one unit of a multi-unit split-payment checkout
    // (KatchForm bills / FinancialForm catalog units) — the customer's full
    // tender + any CUSTOMER_ACCOUNT debt books against exactly ONE unit (the
    // carrier); every sibling defers its own price/cost only. Voiding ANY
    // single member alone (carrier OR sibling) leaves the checkout's money
    // non-zero across drawers/debt_ledger/profit. Blocked here for BOTH void
    // and refund; `voidCheckoutGroup` is the only legitimate way to reverse
    // one, and passes `allowSplitGroupMember: true` to bypass this check
    // per-member while it does so under one shared db transaction. Legacy
    // rows created before this fix carry no `split_group` marker and are NOT
    // covered by this guard — see the doc's legacy-row limitation.
    if (!opts.allowSplitGroupMember) {
      const group = this._getSplitGroup(original.metadata_json);
      if (group) {
        const size = group.units != null ? `${group.units}-unit` : "multi-unit";
        throw new DatabaseError(
          `This transaction is part of a ${size} checkout; void the whole checkout instead.`,
          { entityId: original.id },
        );
      }
    }
    // LIRA-115: a row linked to a customer-session basket
    // (customer_session_transactions.unified_transaction_id = this row) was
    // sold with `deferPayment` — its own customer-cash leg was skipped at
    // create time; the customer's ONE real payment (and/or the ONE pooled
    // 'Session Debt' charge) is POOLED across every item in the basket
    // (`payments`/`debt_ledger` rows keyed by `session_id`, `transaction_id`
    // NULL). Reversing this single item alone can only ever undo its own
    // transaction_id-scoped legs (e.g. the cost leg) — the pooled cash/debt
    // is invisible to a transaction_id-keyed query and is silently never
    // reversed (the exact money-loss bug this guard closes). Mirrors the
    // split_group guard immediately above in shape (rule 14): blocked for
    // BOTH void and refund; `voidSessionBasket`/`refundSessionBasket` are the
    // only legitimate way to reverse one, and pass `allowSessionMember: true`
    // to bypass this check per-item while they do so under one shared db
    // transaction.
    if (!opts.allowSessionMember) {
      const sessionId = this._sessionIdForTransaction(original.id);
      if (sessionId != null) {
        throw new DatabaseError(
          `This transaction is part of session basket #${sessionId}; void/refund the whole basket instead.`,
          { entityId: original.id },
        );
      }
    }
  }

  /**
   * Resolve the customer-session basket a transaction belongs to, or null.
   * `customer_session_transactions` is absent from many minimal/legacy test
   * fixtures (only ~7 of the ~90 repository test DBs declare it) — guarded
   * with the same `hasTable` pattern `_reversePartnerLedger` uses for
   * `partner_ledger`, so this stays safe to call unconditionally from
   * `_assertReversible` (every void/refund call site) without breaking any
   * fixture that never seeded session tables.
   */
  private _sessionIdForTransaction(transactionId: number): number | null {
    const hasTable = this.db
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'customer_session_transactions'`,
      )
      .get();
    if (!hasTable) return null;
    const tenantId = getCurrentTenantId();
    const row = this.queryOne<{ session_id: number }>(
      `SELECT session_id FROM customer_session_transactions
       WHERE unified_transaction_id = ? AND tenant_id = ?
       LIMIT 1`,
      transactionId,
      tenantId,
    );
    return row ? row.session_id : null;
  }

  /**
   * Public wrapper (rule 14) around the SAME session-basket-membership check
   * `_assertReversible` uses internally — lets other repositories
   * (SalesRepository's POS refund guard, LIRA-231) detect session-basket
   * membership without re-deriving the `customer_session_transactions` query.
   */
  isTransactionSessionLinked(transactionId: number): boolean {
    return this._sessionIdForTransaction(transactionId) != null;
  }

  /**
   * LIRA-232 round-3 adversarial review, finding #1 (BLOCKER) — rule 14: the
   * ONE place either refund-preview reader resolves a transaction's
   * session-basket membership for display, so a session-linked preview can
   * hand `sessionId`/`sessionTransactionId` straight to
   * `refundSessionBasketItem` without a second lookup. `getSaleRefundPreview`
   * (the whole-sale preview) already had this, added as round-2 finding #11;
   * `SalesRepository.getItemRefundPreview` (the per-item preview the POS
   * "Refund item" button actually calls) never did, so every "Refund item"
   * attempt on a session-paid sale had no session ids to hand to
   * `refundSessionBasketItem` and always failed. Both readers now share this
   * one method instead of one having its own copy that could drift.
   */
  getSessionLinkage(
    transactionId: number,
  ): { sessionId: number; sessionTransactionId: number } | null {
    const sessionId = this._sessionIdForTransaction(transactionId);
    return sessionId != null
      ? { sessionId, sessionTransactionId: transactionId }
      : null;
  }

  /**
   * Parse the `split_group` linkage a multi-unit split checkout stamps into
   * `metadata_json` at create time (CARRIER_LEGS_VOID_ASYMMETRY.md, design
   * B+: FinancialServiceRepository.createTransaction). Returns null for
   * ordinary rows and for legacy pre-fix split rows that predate this
   * marker (undetectable by design — see the doc).
   */
  private _getSplitGroup(metadataJson: string | null): {
    id: string;
    role: "carrier" | "sibling" | null;
    units: number | null;
  } | null {
    if (!metadataJson) return null;
    let meta: Record<string, unknown>;
    try {
      meta = JSON.parse(metadataJson) as Record<string, unknown>;
    } catch {
      return null;
    }
    const id = meta.split_group;
    if (typeof id !== "string" || id.length === 0) return null;
    const role =
      meta.split_role === "carrier" || meta.split_role === "sibling"
        ? meta.split_role
        : null;
    const units =
      typeof meta.split_units === "number" ? meta.split_units : null;
    return { id, role, units };
  }

  // ---------------------------------------------------------------------------
  // Private helpers for void / refund
  // ---------------------------------------------------------------------------

  /**
   * For each payment row linked to the original transaction, insert a negated
   * payment row linked to the reversal transaction and update drawer_balances.
   */
  /**
   * Get all payment rows linked to a transaction.
   * Used by the debt detail eye button to show a full payment breakdown
   * (Cash $50, WHISH $49.50 + PM fee $0.50, Debt $1.50, etc.)
   */
  getPaymentsByTransactionId(transactionId: number): PaymentRow[] {
    return this.query<PaymentRow>(
      `SELECT id, method, drawer_name, currency_code, amount, note, created_at
       FROM payments
       WHERE transaction_id = ? AND tenant_id = ?
       ORDER BY id ASC`,
      transactionId,
      getCurrentTenantId(),
    );
  }

  /**
   * Customer-facing payment legs for one transaction — the SAME filter the
   * LIRA-064 in/out summary uses (isInternalLegJs), so a receipt shows only
   * real customer cash (never the internal cost / crypto / system-reserve
   * legs). Direction is sign-derived (negative = paid OUT to the customer);
   * amount is the absolute value. Used by the RCP-3 service receipts.
   */
  getCustomerFacingLegs(transactionId: number): {
    method: string;
    currency_code: string;
    amount: number;
    direction: "IN" | "OUT";
  }[] {
    return this.getPaymentsByTransactionId(transactionId)
      .filter((p) => !isInternalLegJs(p))
      .map((p) => ({
        method: p.method,
        currency_code: p.currency_code,
        amount: Math.abs(p.amount),
        direction: p.amount < 0 ? "OUT" : "IN",
      }));
  }

  /**
   * LIRA-236 — the Transactions-page refund modal's generic (non-sale,
   * non-session) counterpart to `getSaleRefundPreview`/
   * `getSessionItemRefundPreview`'s `bookedRate`/`bookedRateSource`: the
   * transaction's own recorded `exchange_rate` (source "sale" when it's a
   * SALE row — `sales.exchange_rate_snapshot`, stamped onto
   * `transactions.exchange_rate` at creation, same as `getSaleRefundPreview`
   * reads; source "transaction" for every other type that recorded a rate),
   * else the day's fallback (source "fallback").
   */
  getRefundBookedRate(transactionId: number): {
    bookedRate: number;
    bookedRateSource: "sale" | "transaction" | "fallback";
  } {
    const original = this.findById(transactionId);
    if (!original) {
      throw new NotFoundError("transactions", transactionId);
    }
    const isSale =
      original.source_table === "sales" &&
      original.type === TRANSACTION_TYPES.SALE;
    return this._bookedRateFor(
      original.exchange_rate,
      isSale ? "sale" : "transaction",
    );
  }

  /**
   * Mark the source module record as refunded.
   * Tables with is_refunded column: recharges, financial_services,
   * exchange_transactions, custom_services, maintenance, expenses,
   * loto_tickets, debt_ledger, supplier_ledger, wallet_exchanges,
   * drawer_transfers.
   * Sales are handled separately (status + sale_items).
   *
   * Primary Cash Drawer plan §8.6 (rule 20): `system_float_topups` (v139) is
   * rebuilt by migration v140 as `drawer_transfers` (same `is_refunded` /
   * `refunded_at` columns, now supporting both General→PCD and PCD→General
   * directions) — the entry below is updated to the new table name so the
   * generic void/refund path keeps owning reversal of a drawer transfer.
   *
   * supplier_ledger uses this as a SOFT-VOID: balance/pool aggregates exclude
   * flagged rows (SupplierRepository), so voiding a supplier payment restores
   * the supplier balance without a compensating row — a compensator cannot
   * net the sign-bucketed FIFO pools, only excluding the original can.
   */
  private _markSourceRefunded(
    sourceTable: string,
    sourceId: number | null,
  ): void {
    if (!sourceId) return;
    // Only mark tables that have the is_refunded column
    const supported = [
      "recharges",
      "financial_services",
      "exchange_transactions",
      "custom_services",
      "maintenance",
      "expenses",
      "loto_tickets",
      "debt_ledger",
      "supplier_ledger",
      "wallet_exchanges",
      "drawer_transfers",
    ];
    if (!supported.includes(sourceTable)) return;
    // tenant_id predicate applies to every legal value of sourceTable above —
    // all are tenant-scoped tables (see scripts/check-tenant-scoping.mjs's
    // __UNRESOLVED__ fail-closed flag on this dynamic-table-name statement).
    this.execute(
      `UPDATE ${sourceTable} SET is_refunded = 1, refunded_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`,
      sourceId,
      getCurrentTenantId(),
    );
  }

  /**
   * Reversing a SUPPLIER_PAYMENT whose ledger entry was a manual PAYMENT must
   * also give back the FIFO purchase coverage the payment consumed
   * (SupplierRepository.recordSupplierCashflow PAY walks supplier_purchases
   * oldest-first and bumps paid_usd; nothing records the split, so we un-apply
   * the same USD-equivalent reverse-FIFO: newest-covered first, capped at each
   * purchase's paid_usd). No-op for every other transaction shape.
   *
   * OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §8.7 (LIRA-192) finding — `type ===
   * "SUPPLIER_PAYMENT" && source_table === "supplier_ledger"` is NOT unique
   * to a `recordSupplierCashflow` manual cash payment: `addLedgerEntry`'s
   * no-`drawer_name` branch stamps that SAME type/table pair for every
   * `entry_type: "PAYMENT"` ledger row that has no real drawer leg of its
   * own (e.g. `RechargeRepository.cashoutToSupplier`'s auto, cashless
   * account-credit sibling — is_auto:true, source_ref_table:"recharges").
   * That sibling never ran `_applyPurchaseFifoCoverage` — nothing in
   * `cashoutToSupplier` touches `supplier_purchases` — so without this
   * `is_auto` check, voiding it would "give back" FIFO coverage that was
   * never taken, corrupting `supplier_purchases.paid_usd` for whatever
   * unrelated purchases happen to be open on that supplier.
   * `recordSupplierCashflow`'s own ledger row is NEVER `is_auto` (its
   * INSERT never sets the column, default 0), so this stays a no-op change
   * for the manual-payment case this method exists for.
   */
  private _unapplySupplierPurchaseCoverage(original: TransactionEntity): void {
    if (
      original.type !== "SUPPLIER_PAYMENT" ||
      original.source_table !== "supplier_ledger" ||
      !original.source_id
    ) {
      return;
    }
    const tenantId = getCurrentTenantId();
    const ledger = this.queryOne<{
      supplier_id: number;
      entry_type: string;
      amount_usd: number;
      amount_lbp: number;
      is_auto: number;
    }>(
      `SELECT supplier_id, entry_type, amount_usd, amount_lbp, is_auto FROM supplier_ledger WHERE id = ? AND tenant_id = ?`,
      original.source_id,
      tenantId,
    );
    if (!ledger || ledger.entry_type !== "PAYMENT" || ledger.is_auto) return;

    const rate = original.exchange_rate || 89000;
    this._giveBackSupplierPurchaseCoverage(
      ledger.supplier_id,
      Math.abs(ledger.amount_usd) + Math.abs(ledger.amount_lbp) / rate,
      tenantId,
    );
  }

  /**
   * The ONE reverse-FIFO give-back of `supplier_purchases.paid_usd` (rule
   * 14) — the inverse of `SupplierRepository._applyPurchaseFifoCoverage`:
   * newest-covered first, capped at each purchase's `paid_usd`. Shared by a
   * supplier payment's own coverage (`_unapplySupplierPurchaseCoverage`) and
   * its bundled discount's (`_reverseSupplierBundledDiscount`), which run
   * back-to-back — the same walk as one combined budget.
   */
  private _giveBackSupplierPurchaseCoverage(
    supplierId: number,
    usdEquivalent: number,
    tenantId: number,
  ): void {
    let remaining = usdEquivalent;
    if (remaining <= 0) return;

    const covered = this.query<{ id: number; paid_usd: number }>(
      `SELECT id, paid_usd FROM supplier_purchases
       WHERE supplier_id = ? AND paid_usd > 0 AND tenant_id = ?
       ORDER BY created_at DESC, id DESC`,
      supplierId,
      tenantId,
    );
    for (const row of covered) {
      if (remaining <= 0) break;
      const giveBack = Math.min(remaining, row.paid_usd);
      this.execute(
        `UPDATE supplier_purchases SET paid_usd = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`,
        row.paid_usd - giveBack,
        row.id,
        tenantId,
      );
      remaining -= giveBack;
    }
  }

  /**
   * The bundled 'DISCOUNT' supplier_ledger row a manual supplier payment
   * (`SupplierRepository.recordSupplierCashflow` PAY + discount) wrote,
   * found ONLY through the link that payment stamps at create time
   * (`source_ref_table='supplier_ledger'`, `source_ref_id=<payment's ledger
   * row>`, `is_auto=0`). A discount written before that link existed has no
   * way back to its payment and is never guessed at — it stays booked after
   * the payment's void (correct it with a supplier adjustment). Not-yet-
   * reversed rows only (idempotent). Null for every other transaction.
   */
  private _linkedSupplierDiscount(original: TransactionEntity): {
    id: number;
    amount_usd: number;
    amount_lbp: number;
    settlement_id: number | null;
  } | null {
    if (
      original.type !== "SUPPLIER_PAYMENT" ||
      original.source_table !== "supplier_ledger" ||
      original.source_id == null ||
      !this._supplierLedgerHasSourceRefColumns()
    ) {
      return null;
    }
    const hasSettlementId = this._supplierLedgerHasSettlementIdColumn();
    return (
      this.queryOne<{
        id: number;
        amount_usd: number;
        amount_lbp: number;
        settlement_id: number | null;
      }>(
        `SELECT id, amount_usd, amount_lbp${hasSettlementId ? ", settlement_id" : ", NULL AS settlement_id"}
           FROM supplier_ledger
          WHERE source_ref_table = 'supplier_ledger' AND source_ref_id = ?
            AND entry_type = 'DISCOUNT' AND is_auto = 0
            AND COALESCE(is_refunded, 0) = 0 AND tenant_id = ?
          LIMIT 1`,
        original.source_id,
        getCurrentTenantId(),
      ) ?? null
    );
  }

  /** Up-front guard (before any write): a bundled discount already swept
   *  into a supplier settlement cannot be unwound by the payment's void —
   *  same "blocking beats corrupting" reasoning as
   *  `_assertSupplierSiblingsVoidable`. */
  private _assertSupplierBundledDiscountVoidable(
    original: TransactionEntity,
  ): void {
    const discount = this._linkedSupplierDiscount(original);
    if (discount?.settlement_id != null) {
      throw new DatabaseError(
        `Cannot void/refund — its bundled supplier discount has already been included in settlement #${discount.settlement_id}; correct the supplier balance with a manual adjustment instead.`,
        { entityId: original.id },
      );
    }
  }

  /**
   * Owner decision 2026-10-07 (rule 20, matching the Partners page's
   * `_reversePartnerSettlementLedger`) — the reversal OWNER of a supplier
   * payment's bundled discount is the payment's own void/refund. Runs inside
   * the caller's db.transaction():
   *   1. soft-voids the 'DISCOUNT' ledger row (`is_refunded`, the supplier
   *      ledger's void convention — the balance then excludes it, exactly
   *      as the payment's own row is excluded by `_markSourceRefunded`);
   *   2. negates the discount's COUNTERPARTY_DISCOUNT profit with a NEW
   *      compensating row (`_negateCounterpartyDiscountProfit`, shared with
   *      the partner sweep — never mutate the original);
   *   3. gives back the FIFO purchase coverage the discount applied.
   * Create + void therefore nets supplier, drawers (the discount never
   * moved one) and profit to 0, per currency.
   */
  private _reverseSupplierBundledDiscount(
    original: TransactionEntity,
    userId: number,
  ): void {
    const discount = this._linkedSupplierDiscount(original);
    if (!discount) return;
    const tenantId = getCurrentTenantId();
    this._markSourceRefunded("supplier_ledger", discount.id);
    this._negateCounterpartyDiscountProfit(
      "supplier_ledger",
      discount.id,
      `Discount reversed by supplier payment void/refund #${original.id}`,
      userId,
    );
    const supplier = this.queryOne<{ supplier_id: number }>(
      `SELECT supplier_id FROM supplier_ledger WHERE id = ? AND tenant_id = ?`,
      discount.id,
      tenantId,
    );
    if (!supplier) return;
    // Same rate convention as the payment's own give-back
    // (`_unapplySupplierPurchaseCoverage`).
    const rate = original.exchange_rate || 89000;
    this._giveBackSupplierPurchaseCoverage(
      supplier.supplier_id,
      Math.abs(discount.amount_usd) + Math.abs(discount.amount_lbp) / rate,
      tenantId,
    );
  }

  /**
   * The ONE way a bundled counterparty discount's profit is taken back
   * (rule 14 — shared by the partner settlement sweep and the supplier
   * payment's bundled-discount reversal): a NEW COUNTERPARTY_DISCOUNT row
   * with the negated stamp, `reverses_id` pointing at the original (which
   * stays ACTIVE, untouched). The counterparty-discount profit total sums
   * both rows, so they net to 0. No-op when the discount row has no
   * transaction.
   */
  private _negateCounterpartyDiscountProfit(
    sourceTable: "partner_ledger" | "supplier_ledger",
    sourceId: number,
    summary: string,
    userId: number,
  ): void {
    const discountTxn = this.getBySourceId(sourceTable, sourceId);
    if (!discountTxn) return;
    const reversalTxnId = this.createTransaction({
      type: "COUNTERPARTY_DISCOUNT",
      source_table: sourceTable,
      source_id: sourceId,
      user_id: userId,
      amount_usd: 0,
      amount_lbp: 0,
      profit_usd: -discountTxn.profit_usd,
      profit_lbp: -discountTxn.profit_lbp,
      // Owner decision 2026-10-07: the reversal carries the ORIGINAL row's
      // rate, copied verbatim like `voidTransaction`'s reversal row.
      exchange_rate: discountTxn.exchange_rate,
      client_id: null,
      summary,
      metadata_json: { reversed_discount_txn_id: discountTxn.id },
    });
    this.execute(
      `UPDATE transactions SET reverses_id = ? WHERE id = ? AND tenant_id = ?`,
      discountTxn.id,
      reversalTxnId,
      getCurrentTenantId(),
    );
  }

  /**
   * True when the connected `supplier_ledger` table already carries the v136
   * source_ref_table/source_ref_id columns. Mirrors `_reversePartnerLedger`'s
   * `sqlite_master` existence check — some hand-rolled test-fixture DBs (and,
   * defensively, any DB caught mid-upgrade) predate this migration; querying
   * a column that doesn't exist would throw and break every void/refund on
   * that connection, not just the supplier-sibling cascade. Absent columns
   * means "no siblings can possibly be linked" — genuinely no-op, not a
   * swallowed error.
   */
  private _supplierLedgerHasSourceRefColumns(): boolean {
    const hasTable = this.db
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'supplier_ledger'`,
      )
      .get();
    if (!hasTable) return false;
    const cols = this.db
      .prepare(`PRAGMA table_info(supplier_ledger)`)
      .all() as { name: string }[];
    return (
      cols.some((c) => c.name === "source_ref_table") &&
      cols.some((c) => c.name === "source_ref_id")
    );
  }

  /**
   * OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §9.3/§10.2 (LIRA-187, v176) — true when
   * the connected `supplier_ledger` table already carries the
   * account-settlement `settlement_id` column (D8's per-row selectable
   * queue: unlike `financial_services`, a raw ledger row — iPick/OMT App
   * TOP_UP, or an OMT App `WALLET_CASHOUT` PAYMENT row — had NO per-row
   * settled marker before this migration). Same schema-drift-guard shape as
   * `_supplierLedgerHasSourceRefColumns` above: a fixture predating v176
   * (most of this file's own hand-rolled test DBs) must degrade to "this row
   * can never be settled" rather than throwing `no such column`.
   */
  private _supplierLedgerHasSettlementIdColumn(): boolean {
    const cols = this.db
      .prepare(`PRAGMA table_info(supplier_ledger)`)
      .all() as { name: string }[];
    return cols.some((c) => c.name === "settlement_id");
  }

  /**
   * LIRA-091 — refuse a void/refund up-front (before any write) if this
   * transaction's own event booked an auto supplier-ledger sibling
   * (FinancialServiceRepository's is_auto:true BILL-commission /
   * SEND-RECEIVE TOP_UP-PAYMENT rows, linked via
   * supplier_ledger.source_ref_table/source_ref_id — migration v136) that has
   * ALREADY been swept into a supplier settlement
   * (SupplierRepository.settleTransactions). Cascading the sibling's void
   * anyway would unwind its TOP_UP/PAYMENT contribution to a settlement whose
   * SETTLEMENT/SUPPLIER_PAYS_US rows were computed assuming it stayed — the
   * ledger would no longer net to 0 for that batch and nothing here can
   * compensate for it. Blocking beats corrupting (mirrors the split-group
   * void guard's philosophy) — the owner corrects a mis-settled sibling with
   * a manual supplier adjustment instead. A no-op when there is no unrefunded
   * sibling at all (nothing to protect), so a settled WALLET-provider FS row
   * (which never books a sibling) stays voidable.
   *
   * LIRA-189 extension (OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §9.3/§10.2) — v176
   * lets an account settlement stamp `settlement_id` directly on a RAW
   * `supplier_ledger` row (D8's LEDGER-kind selection), which is exactly the
   * shape of an OMT App `WALLET_CASHOUT`'s auto sibling
   * (`RechargeRepository.cashoutToSupplier`: `source_ref_table: 'recharges'`,
   * NOT `'financial_services'`). `_supplierSourceSettlementId` below only
   * ever resolves the settlement stamp for a `financial_services`-anchored
   * parent (that is where `settleTransactions`/`settleAccount` stamp a
   * COUNTER row's settlement), so it always returns null for a
   * `recharges`-sourced parent and would silently let a settled cashout be
   * voided out from under an already-netted settlement batch — corrupting
   * its per-child math exactly the way this whole guard exists to prevent.
   * Checking the sibling row's OWN `settlement_id` first closes that gap for
   * ANY non-`financial_services` source table without touching the
   * FS-anchored path at all (a SEND/RECEIVE's own ledger sibling is never
   * independently selected/settled — only its `financial_services` parent
   * is — so this extra check is a harmless no-op for that case).
   */
  private _assertSupplierSiblingsVoidable(original: TransactionEntity): void {
    if (!original.source_table || original.source_id == null) return;
    if (!this._supplierLedgerHasSourceRefColumns()) return;
    const tenantId = getCurrentTenantId();
    const hasSettlementIdColumn = this._supplierLedgerHasSettlementIdColumn();
    const sibling = this.queryOne<{
      id: number;
      settlement_id: number | null;
    }>(
      `SELECT id${hasSettlementIdColumn ? ", settlement_id" : ", NULL AS settlement_id"} FROM supplier_ledger
        WHERE source_ref_table = ? AND source_ref_id = ? AND tenant_id = ?
          AND is_auto = 1 AND COALESCE(is_refunded, 0) = 0
        LIMIT 1`,
      original.source_table,
      original.source_id,
      tenantId,
    );
    if (!sibling) return;

    if (hasSettlementIdColumn && sibling.settlement_id != null) {
      throw new DatabaseError(
        `Cannot void/refund — its auto supplier-ledger entry has already been included in settlement #${sibling.settlement_id}; correct the supplier balance with a manual adjustment instead.`,
        { entityId: original.id },
      );
    }

    const settlementId = this._supplierSourceSettlementId(
      original.source_table,
      original.source_id,
    );
    if (settlementId != null) {
      throw new DatabaseError(
        `Cannot void/refund — its auto supplier-ledger entry has already been included in settlement #${settlementId}; correct the supplier balance with a manual adjustment instead.`,
        { entityId: original.id },
      );
    }
  }

  /**
   * Settlement marker for the row a source_ref_table/source_ref_id link
   * points at. Only `financial_services` stamps a settlement marker today
   * (SupplierRepository.settleTransactions sets settlement_id) — other
   * source tables have no settlement concept yet and are treated as never
   * settled (returns null), same honest-default shape as
   * `_markSourceRefunded`'s explicit supported-tables list.
   */
  private _supplierSourceSettlementId(
    sourceTable: string,
    sourceId: number,
  ): number | null {
    if (sourceTable !== "financial_services") return null;
    const row = this.queryOne<{ settlement_id: number | null }>(
      `SELECT settlement_id FROM financial_services WHERE id = ? AND tenant_id = ?`,
      sourceId,
      getCurrentTenantId(),
    );
    return row?.settlement_id ?? null;
  }

  /**
   * EXCHANGE_LOT_SETTLEMENT.md Q12 — refuse reversing an EXCHANGE transaction
   * up-front (before any write) when the lot it created (as a BUY, whenever
   * its `from_currency` was exotic) has already been partially or fully sold
   * by a later SELL. Voiding/refunding it anyway would silently corrupt the
   * FIFO chain those settlements already consumed from — a settlement's
   * frozen `unit_cost_usd` would point at a lot that no longer represents a
   * real acquisition. Mirrors `_assertSupplierSiblingsVoidable` (LIRA-091) —
   * blocking beats corrupting; the owner corrects with an admin position
   * adjustment (Q15) instead.
   *
   * A no-op for every non-EXCHANGE type, and for an EXCHANGE row that either
   * never created a lot (its `from_currency` wasn't exotic) or whose lot has
   * no ACTIVE settlement against it. Voiding/refunding a SELL is always
   * allowed regardless of what it consumed — a SELL never creates a lot of
   * its own for someone else to have settled against, so this check can
   * never block it; `_reverseExchangeLotEffects` below undoes what it took.
   *
   * Also a no-op when the `exchange_lots`/`exchange_lot_settlements` tables
   * don't exist on this connection (`_exchangeLotTablesExist`, same
   * `sqlite_master` defensive pattern as `_supplierLedgerHasSourceRefColumns`)
   * — every real DB has carried them since migration v156, but this guard
   * fires for EVERY EXCHANGE void/refund, including a plain USD<->LBP one
   * that never touches a lot; a minimal hand-rolled test schema predating
   * this feature must not have every exchange void/refund start hard-crashing
   * over a table it only reads defensively.
   */
  private _assertExchangeLotsVoidable(original: TransactionEntity): void {
    if (
      original.type !== "EXCHANGE" ||
      original.source_table !== "exchange_transactions" ||
      original.source_id == null ||
      !this._exchangeLotTablesExist()
    ) {
      return;
    }
    const settlerTables =
      getExchangeLotRepository().getActiveSettlerTablesAgainstSource({
        sourceTable: "exchange_transactions",
        sourceId: original.source_id,
      });
    if (settlerTables.length === 0) return;

    // Adversarial review FIX 5 — name the REAL blocker instead of always
    // claiming a sell exists to void. An admin write-off
    // (`exchange_position_adjustments`, Q15) has no sell to void and is
    // permanent, so it needs its own message; a mix of both settler tables
    // still can't be fully unblocked by voiding the sell(s) alone, so it
    // gets the same permanent-blocker message as adjustments-only.
    const hasAdjustmentSettler = settlerTables.includes(
      "exchange_position_adjustments",
    );
    if (hasAdjustmentSettler) {
      throw new DatabaseError(
        "Cannot void/refund — this exchange's acquired currency has been partially or fully written off by an admin position adjustment, which cannot be reversed; this exchange can no longer be voided.",
        { entityId: original.id },
      );
    }
    throw new DatabaseError(
      "Cannot void/refund — this exchange's acquired currency has already been partially or fully sold; void the consuming sell transaction(s) first.",
      { entityId: original.id },
    );
  }

  /**
   * Owner decision 2026-08-26 — refuse a WHOLE-sale void/refund up-front
   * (before any write) when ANY of the sale's lines has already been refunded
   * individually via `SalesRepository.refundSaleItem`.
   *
   * ## The money bug
   *
   * `refundSaleItem` refunds ONE line: it pro-rates the original tender
   * (`lineShareOfSale = refundAmount / sales.total_amount_usd` — the line's
   * share of the sale's PRE-discount total) across the SALE's
   * payment legs and debits the drawers by that share. The REFUND row it
   * writes deliberately carries NO `reverses_id` — it is a standalone row,
   * not a reversal of the SALE — so the double-refund guard immediately above
   * this call (`reverses_id = <sale txn> AND type = 'REFUND'`) never saw item
   * refunds at all. A whole-sale void/refund then mirrors the original's FULL
   * legs through `_reversePayments`, handing back the entire tender INCLUDING
   * the share already returned. Probe-proven on a $30 sale (3 x $10): a $10
   * item refund followed by a whole refund moved $40 out of the drawer, and
   * the void path did the same.
   *
   * The stock/unit halves of that same sequence were already fixed in place
   * (`_restoreStock` restores `quantity - refunded_quantity`;
   * `_reverseProductUnits` only touches units still `SOLD`) — the MONEY half
   * had no such netting, which is what made the drawer the only ledger that
   * went wrong.
   *
   * ## Why block rather than pro-rate (the alternative NOT taken)
   *
   * The money twin of `_restoreStock`'s netting would be to reverse only the
   * un-refunded remainder of each leg. Rejected by the owner: that remainder
   * is not reconstructible from the rows. An item refund's legs are a RATIO
   * of the original tender spread over every method/drawer/currency the
   * customer used, and LIRA-078's `refundLegs` overrides let the operator
   * hand money back through a DIFFERENT method than it came in on — so
   * "net out what's left" would have to guess which drawer still owes what,
   * and a wrong guess is a silent cash error instead of a visible refusal.
   * The per-item path refunds the remaining lines exactly and is itself
   * reversible, so no capability is lost — only the one-click shortcut.
   *
   * "Exactly" is load-bearing here — this guard makes the per-item route the
   * ONLY sanctioned one — and it was NOT true when this decision was taken.
   * `refundSaleItem` divided the leg ratio by `originalTxn.amount_usd`, the
   * POST-discount final, while its numerator is the line's PRE-discount value:
   * on a discounted sale the per-line shares summed to total/final > 1, so
   * refunding every line individually handed back the full pre-discount price
   * against a discounted tender — over by exactly the discount, in every
   * currency leg, and over-cancelling an on-account sale's debt into a phantom
   * credit of the same size. Fixed by pro-rating on `sales.total_amount_usd`
   * (the base the same function's PROFIT arm already used correctly), which
   * makes line-by-line refunding of a discounted sale net every ledger to 0.
   * Proven by `SalesRepository.discountItemRefundTender.test.ts` (failing-first
   * on the old denominator: $27 tender, $30 returned; 810,000 LBP tender,
   * 900,000 returned; $54 debt, $60 cancelled).
   *
   * ## Scope
   *
   * A no-op for every non-`sales` transaction (short-circuits before any
   * query), and for a sale whose lines are all untouched — which is every
   * ordinary void/refund, so the common path is byte-identical to before.
   *
   * A FULLY refunded sale is not this guard's job: whether it got there by a
   * whole-sale refund (which stamps `reverses_id`, caught by the double-
   * refund guard) or by item-refunding every line (which leaves
   * `sales.status = 'refunded'`), the existing guards and `refundSaleItem`'s
   * own "Cannot refund items from a fully refunded sale" already close it.
   * This predicate happens to cover the all-lines-item-refunded case too,
   * which is correct — it is the same double-refund.
   *
   * LIRA-146 — that shared throw used to be a dead end: an operator who had
   * already item-refunded every line got told to "refund the remaining items
   * individually", when nothing remained. The guard below still throws in
   * BOTH cases (the block itself is unchanged — see `SALE_ITEM_REFUND_TOUCHED`,
   * moved verbatim from the old single-query predicate), but now runs one
   * aggregate query counting `touched` lines against `SALE_ITEM_HAS_REFUNDABLE_REMAINDER`
   * lines so it can pick the message that matches reality: some lines still
   * refundable individually → the original message; zero lines left (every
   * touched line's `refunded_quantity` has caught up to `quantity`) → a
   * distinct "already fully refunded, nothing remains" message. The
   * touched/no-throw boundary itself is untouched by this change.
   *
   * The `is_refunded` half of the predicate is a legacy net, not the main
   * event: the ONLY writer of `sale_items.is_refunded = 1` is the whole-sale
   * refund path (which stamps every line at once, and stamps `reverses_id` on
   * the transaction), so on any DB written by current code the
   * `refunded_quantity > 0` half is what fires. It catches a pre-v44 row
   * (before `refunded_quantity` existed) whose transaction link was lost —
   * blocking a reversal there is the safe direction.
   */
  /** A line this guard already counts as "touched" by an item refund — the ORIGINAL predicate, unchanged (rule 14: named once, reused, not re-pasted). */
  private static readonly SALE_ITEM_REFUND_TOUCHED = `(COALESCE(refunded_quantity, 0) > 0
      OR (COALESCE(is_refunded, 0) <> 0
          AND COALESCE(refunded_quantity, 0) < quantity))`;

  /** A line that still has quantity left to refund individually from the sale detail. */
  private static readonly SALE_ITEM_HAS_REFUNDABLE_REMAINDER = `(COALESCE(is_refunded, 0) = 0 AND COALESCE(refunded_quantity, 0) < quantity)`;

  private _assertNoPartialItemRefunds(original: TransactionEntity): void {
    if (original.source_table !== "sales" || original.source_id == null) {
      return;
    }
    const counts = this.queryOne<{
      touched: number | null;
      remaining: number | null;
    }>(
      `SELECT
         SUM(CASE WHEN ${TransactionRepository.SALE_ITEM_REFUND_TOUCHED} THEN 1 ELSE 0 END) AS touched,
         SUM(CASE WHEN ${TransactionRepository.SALE_ITEM_HAS_REFUNDABLE_REMAINDER} THEN 1 ELSE 0 END) AS remaining
       FROM sale_items
       WHERE sale_id = ? AND tenant_id = ?`,
      original.source_id,
      getCurrentTenantId(),
    );
    const touched = counts?.touched ?? 0;
    if (touched === 0) return;
    const remaining = counts?.remaining ?? 0;
    if (remaining > 0) {
      throw new BusinessRuleError(
        "This sale was partially refunded — refund the remaining items individually from the sale detail (a whole-sale refund would double-refund the already-returned items)",
      );
    }
    throw new BusinessRuleError(
      "This sale has already been fully refunded item-by-item — nothing remains to refund.",
    );
  }

  /** See `_assertExchangeLotsVoidable`'s doc for why this check exists. */
  private _exchangeLotTablesExist(): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name IN ('exchange_lots', 'exchange_lot_settlements')`,
      )
      .all();
    return row.length === 2;
  }

  /**
   * LIRA-143 phase 4 — `product_units` table-existence guard, delegating to
   * `BaseRepository.tableExists` (rule 14: LIRA-148 collapsed this repo's
   * own hand-rolled `sqlite_master` probe + cache onto the one shared owner
   * — same probe `ProductUnitRepository.productUnitsTableExists()` now
   * exposes to `InventoryService`). Guards `_reverseProductUnits` so the
   * many hand-built test schemas that predate this phase (no `product_units`
   * table) stay byte-identical. Method name/call sites kept as-is to limit
   * blast radius.
   */
  private _productUnitsTableExists(): boolean {
    return this.tableExists("product_units");
  }

  /**
   * LIRA-091 — cascade-void every auto supplier-ledger sibling this
   * transaction's own event created. Reuses `_voidTransactionInternal` per
   * sibling (its own separate hidden SUPPLIER_PAYMENT transaction) so
   * drawer/ledger reversal runs through the EXACT same mechanics a manual
   * supplier-payment void uses (rule 14/20, not a second reversal path) —
   * soft-voiding the ledger row is already `_markSourceRefunded`'s job, fired
   * naturally when that recursive call reaches its own step 4 (the sibling's
   * source_table is 'supplier_ledger'). Filtered to `is_auto = 1` so this can
   * only ever touch genuine separate-hidden-transaction siblings, never a
   * link-mode row (whose supplier_ledger.transaction_id IS the caller's own
   * in-flight parent transaction — recursing into that would self-void).
   * Already-refunded siblings (voided independently beforehand, or by an
   * earlier pass of this same cascade) are excluded — idempotent re-entry.
   * A no-op for legacy (pre-v136) rows: they carry no source_ref link and can
   * never be found here — undetectable by design, same limitation LIRA-094
   * documented for its split_group marker. The settled-sibling case never
   * reaches this method — `_assertSupplierSiblingsVoidable` already blocked
   * it before the enclosing db.transaction() began.
   */
  private _cascadeSupplierSiblingVoid(
    original: TransactionEntity,
    userId: number,
  ): void {
    if (!original.source_table || original.source_id == null) return;
    if (!this._supplierLedgerHasSourceRefColumns()) return;
    const tenantId = getCurrentTenantId();
    const siblings = this.query<{ transaction_id: number | null }>(
      `SELECT transaction_id FROM supplier_ledger
        WHERE source_ref_table = ? AND source_ref_id = ? AND tenant_id = ?
          AND is_auto = 1 AND COALESCE(is_refunded, 0) = 0`,
      original.source_table,
      original.source_id,
      tenantId,
    );
    for (const sibling of siblings) {
      if (sibling.transaction_id == null) continue;
      this._voidTransactionInternal(sibling.transaction_id, userId, {
        allowSplitGroupMember: true,
      });
    }
  }

  /**
   * True when the connected `expenses` table already carries the v166
   * source_ref_table/source_ref_id columns. Same shape as
   * `_cascadeSupplierSiblingVoid`'s identical guard for the v136 migration —
   * many `packages/core` jest specs hand-roll a fresh in-memory schema per
   * file that predates v166.
   */
  private _expensesHasSourceRefColumns(): boolean {
    const cols = this.db.prepare(`PRAGMA table_info(expenses)`).all() as {
      name: string;
    }[];
    return (
      cols.some((c) => c.name === "source_ref_table") &&
      cols.some((c) => c.name === "source_ref_id")
    );
  }

  /**
   * Cascade-void every auto-generated `expenses` row this transaction's own
   * event created — currently only the SMS transfer fee expense a
   * CREDIT_TRANSFER recharge books via `ExpenseRepository.createExpense`'s
   * `source_ref_table`/`source_ref_id` link (owner decision 2026-09-06: the
   * SMS fee moved out of the recharge's net profit stamp into its own
   * expense — rule 20 requires a reversal owner for that new side-effect
   * row).
   *
   * Mirrors `_cascadeSupplierSiblingVoid` exactly: finds the sibling
   * `expenses` row by `source_ref_table`/`source_ref_id` (pointing back at
   * `original.source_table`/`source_id`), looks up ITS OWN unified
   * transaction via `getBySourceId('expenses', expense.id)` (expenses has no
   * `transaction_id` column of its own — unlike `supplier_ledger` — so the
   * link is the reverse direction), and reuses `_voidTransactionInternal` on
   * that transaction so the SAME drawer-reversal/`_markSourceRefunded`
   * machinery every other expense void uses fires here too (rule 14/20, not
   * a second reversal path).
   *
   * Already-refunded expense siblings and legacy (pre-v166) rows with no
   * link are excluded/undetectable by the same design as the supplier-ledger
   * cascade — see that method's doc.
   */
  private _cascadeExpenseSiblingVoid(
    original: TransactionEntity,
    userId: number,
  ): void {
    if (!original.source_table || original.source_id == null) return;
    if (!this._expensesHasSourceRefColumns()) return;
    const tenantId = getCurrentTenantId();
    const siblings = this.query<{ id: number }>(
      `SELECT id FROM expenses
        WHERE source_ref_table = ? AND source_ref_id = ? AND tenant_id = ?
          AND COALESCE(is_refunded, 0) = 0`,
      original.source_table,
      original.source_id,
      tenantId,
    );
    for (const sibling of siblings) {
      const siblingTxn = this.getBySourceId("expenses", sibling.id);
      if (!siblingTxn) continue;
      this._voidTransactionInternal(siblingTxn.id, userId, {
        allowSplitGroupMember: true,
      });
    }
  }

  /**
   * D3 (COUNTERPARTY_CONSOLIDATION_PLAN.md, owner-decided 2026-07-18) —
   * voiding/refunding a DEBT_REPAYMENT transaction must give the debt back,
   * not just the cash. `_reversePayments` already undoes the drawer side
   * (the customer's cash / provider RESERVE legs); this step undoes the
   * LEDGER side `DebtRepository.addRepayment` applied: the 'Repayment'
   * debt_ledger reduction itself, plus the FIFO coverage stamps it bumped
   * (`sales.paid_usd` via `_markSalesPaidFIFO`, `debt_ledger.covered_usd/lbp`
   * via `_coverServiceDebtsFIFO`). This was a long-documented, unowned gap
   * (COUNTERPARTY_LEDGERS.md §7, FEATURE_GUIDE §9) — this method is now its
   * owner.
   *
   * Trigger is DIFFERENT from `_cancelDebt`: this fires only when the
   * REVERSED transaction IS the repayment itself (type DEBT_REPAYMENT,
   * source_table 'debt_ledger'); `_cancelDebt` fires when a MODULE CHARGE
   * transaction (Sale/Recharge/Service/…) is reversed, and its whitelist
   * (MODULE_DEBT_TRANSACTION_TYPES) deliberately EXCLUDES 'Repayment' rows
   * (pinned by debtReversal.test.ts's "whitelist guard" case) so that
   * reversing a charge never un-pays an unrelated, later repayment. The two
   * never fire for the same call — no double-reversal risk, no conflict with
   * that existing pin.
   *
   * Boundary (CQ-10): a bundled 'Debt Discount' posts its OWN
   * COUNTERPARTY_DISCOUNT transaction — a DIFFERENT transaction_id, whose
   * source_id is the 'Debt Discount' ledger row, never the repayment's own
   * 'Repayment' row. This method only ever looks up `original.source_id`
   * (the repayment's row), so it can never see or touch the discount's row
   * or transaction. COUNTERPARTY_DISCOUNT is NON_REVERSIBLE by design
   * (correcting a discount is always an opposite discount, never a void) —
   * voiding the cash side of a discounted repayment must leave the bundled
   * discount exactly as forgiven as before.
   *
   * Exact path (2026-10-07): repayments now record the rows their coverage
   * landed on (`readRepaymentCoverage`, DebtRepository) and step 2 gives
   * back exactly that. The approximation below remains only for repayments
   * booked before that record existed.
   *
   * Approximation (same shape as `_unapplySupplierPurchaseCoverage`):
   * nothing records exactly which sale/charge rows THIS repayment's coverage
   * landed on, so the give-back budget is re-derived from the 'Repayment'
   * row's absolute amounts and applied newest-covered-first, capped at each
   * row's CURRENT coverage — mirroring `_markSalesPaidFIFO` →
   * `_coverServiceDebtsFIFO`'s oldest-first/remainder-chaining shape, run in
   * reverse. Exact when reversed in LIFO order (the common case: void/refund
   * soon after the repayment); interleaved repayments on the same client can
   * give back coverage a DIFFERENT repayment applied — the same accepted
   * imprecision as the supplier analog.
   *
   * Viewer note: the new 'Repayment Reversal' row is deliberately NOT added
   * to `ACCOUNT_CHARGE_PREDICATE`'s exclusion (unlike 'Refund Reversal').
   * The repayment's OWN 'Repayment' row already satisfies that predicate
   * (pre-existing, independent of this fix) and gets reconstructed as a
   * CUSTOMER_ACCOUNT leg on the repayment's row regardless; excluding the
   * reversal here would leave that pre-existing leg unbalanced (looking like
   * a standing on-account charge) instead of netting to zero. Cosmetic only
   * — no ledger amount is affected either way.
   */
  private _restoreRepaymentDebt(
    original: TransactionEntity,
    userId: number,
  ): void {
    if (
      original.type !== "DEBT_REPAYMENT" ||
      original.source_table !== "debt_ledger" ||
      !original.source_id
    ) {
      return;
    }
    const tenantId = getCurrentTenantId();
    const ledger = this.queryOne<{
      client_id: number;
      amount_usd: number;
      amount_lbp: number;
      transaction_type: string;
    }>(
      `SELECT client_id, amount_usd, amount_lbp, transaction_type
       FROM debt_ledger WHERE id = ? AND tenant_id = ?`,
      original.source_id,
      tenantId,
    );
    // Defensive: a DEBT_REPAYMENT transaction's source_id always points at
    // its own 'Repayment' row, but never trust a join blindly.
    if (!ledger || ledger.transaction_type !== "Repayment") return;

    // The 'Repayment' row stores NEGATIVE amounts (a debt reduction); the
    // give-back budget — and the compensating row below — use the absolute
    // value so the restore is a straightforward sign flip.
    const budgetUsd = Math.abs(ledger.amount_usd);
    const budgetLbp = Math.abs(ledger.amount_lbp);

    // 1. Restore the debt: a compensating row that negates the 'Repayment'
    // reduction. Named 'Repayment Reversal' — NOT '<Module> Debt' — so the
    // rule-20 guard (moduleDebtTypes.guard.test.ts), which only classifies
    // string literals ending in " Debt", never has to classify it; same
    // shape as the existing 'Refund Reversal' precedent used by _cancelDebt.
    // Linked via transaction_id = original.id (the DEBT_REPAYMENT's own id),
    // mirroring _cancelDebt's originalTxnId linking, not the reversal row's
    // own new id.
    this.execute(
      `INSERT INTO debt_ledger
        (client_id, transaction_type, amount_usd, amount_lbp, transaction_id, note, created_by, tenant_id)
       VALUES (?, 'Repayment Reversal', ?, ?, ?, ?, ?, ?)`,
      ledger.client_id,
      budgetUsd,
      budgetLbp,
      original.id,
      "Repayment reversed by refund/void",
      userId,
      tenantId,
    );

    // 2. Unwind the FIFO coverage this repayment applied. When the
    // repayment recorded exactly which rows it covered (addRepayment stamps
    // REPAYMENT_COVERAGE_KEY on its metadata), give back exactly that —
    // each take capped at the row's current coverage. Without the record,
    // the legacy newest-first re-derivation below reached into sales the
    // repayment never touched (any sale with paid_usd > 0, incl. sales paid
    // in cash at checkout) whenever its coverage had gone to module charges.
    const recorded = readRepaymentCoverage(original.metadata_json);
    if (recorded) {
      const updSale = this.db.prepare(
        // status = 'completed' mirrors the legacy unwind (and the forward
        // _markSalesPaidFIFO): a sale refunded since keeps its paid_usd.
        `UPDATE sales SET paid_usd = MAX(0, paid_usd - ?)
         WHERE id = ? AND tenant_id = ? AND status = 'completed'`,
      );
      for (const s of recorded.sales) {
        if (s.usd > 0) updSale.run(s.usd, s.id, tenantId);
      }
      const updCharge = this.db.prepare(
        `UPDATE debt_ledger
           SET covered_usd = MAX(0, covered_usd - ?), covered_lbp = MAX(0, covered_lbp - ?)
         WHERE id = ? AND client_id = ? AND tenant_id = ?`,
      );
      for (const c of recorded.charges) {
        if (c.usd > 0 || c.lbp > 0) {
          updCharge.run(c.usd, c.lbp, c.id, ledger.client_id, tenantId);
        }
      }
      return;
    }

    // Legacy (repayments booked before the record existed). Sales absorb first
    // (mirrors _markSalesPaidFIFO's priority in the forward direction); the
    // USD remainder plus the full LBP budget then unwinds module-debt
    // covered_usd/covered_lbp (mirrors _coverServiceDebtsFIFO). Same budget
    // chaining shape as the forward path, just newest-first and giving back
    // instead of taking.
    const consumedBySales = this._unwindSalesPaidFifo(
      ledger.client_id,
      budgetUsd,
      tenantId,
    );
    this._unwindServiceDebtCoverageFifo(
      ledger.client_id,
      Math.max(0, budgetUsd - consumedBySales),
      budgetLbp,
      tenantId,
    );
  }

  /**
   * Reverse-FIFO give-back for `sales.paid_usd` — the exact mirror of
   * `_markSalesPaidFIFO`, but newest-first (instead of oldest-first) and
   * subtracting (instead of adding). Returns the consumed amount so the
   * caller can chain the unconsumed remainder into the service-debt unwind,
   * exactly like the forward direction chains ITS remainder into
   * `_coverServiceDebtsFIFO`.
   *
   * `s.status = 'completed'` is REQUIRED here (not cosmetic) — it's what
   * _markSalesPaidFIFO's own SELECT carries and this query must keep: a sale
   * that has since been voided/refunded gets a SECOND `transactions` row
   * pointing at the same `source_id` (a VOID reversal keeps `type='SALE'`; a
   * REFUND row does too), so without this filter the JOIN would return that
   * sale TWICE and double-subtract its `paid_usd` on the SAME allocateFifo
   * pass. Excluding non-'completed' sales keeps the join 1:1, same as the
   * forward direction.
   */
  private _unwindSalesPaidFifo(
    clientId: number,
    budgetUsd: number,
    tenantId: number,
  ): number {
    if (budgetUsd <= 0) return 0;

    const paidSales = this.query<{ id: number; paid_usd: number }>(
      `SELECT s.id, s.paid_usd
       FROM sales s
       JOIN transactions t ON t.source_table = 'sales' AND t.source_id = s.id
         AND t.tenant_id = s.tenant_id
       WHERE t.client_id = ? AND s.status = 'completed' AND s.paid_usd > 0
         AND s.tenant_id = ?
       ORDER BY s.created_at DESC, s.id DESC`,
      clientId,
      tenantId,
    );

    // CQ-2 shared allocator; epsilon 0.01 matches _markSalesPaidFIFO's own
    // tolerance exactly.
    const takes = allocateFifo(
      paidSales.map((s) => ({ id: s.id, outstanding: s.paid_usd })),
      budgetUsd,
      0.01,
    );

    const upd = this.db.prepare(
      `UPDATE sales SET paid_usd = paid_usd - ? WHERE id = ? AND tenant_id = ?`,
    );
    let consumed = 0;
    for (const t of takes) {
      upd.run(t.take, t.id, tenantId);
      consumed += t.take;
    }
    return consumed;
  }

  /**
   * Reverse-FIFO give-back for `debt_ledger.covered_usd/covered_lbp` — the
   * exact mirror of `_coverServiceDebtsFIFO`: same MODULE-debt type set,
   * newest-first, each currency allocated independently via the shared
   * allocator and merged into one UPDATE per row.
   *
   * LIRA-258 / G17 (rule 20) — the type set is the SAME shared
   * REPAYMENT_COVERABLE_DEBT_TYPES the forward sweep covers, so a voided
   * repayment also gives back the coverage it put on a basket's
   * 'Session Debt' row (re-holding the basket items' profit). Same
   * accepted LIFO approximation as above: an interleaved give-back can
   * reach into a 'Session Debt' row's checkout pre-coverage, which only
   * ever DEFERS profit.
   */
  private _unwindServiceDebtCoverageFifo(
    clientId: number,
    budgetUsd: number,
    budgetLbp: number,
    tenantId: number,
  ): void {
    if (budgetUsd <= 0.005 && budgetLbp <= 1) return;

    const covered = this.query<{
      id: number;
      covered_usd: number;
      covered_lbp: number;
    }>(
      `SELECT id, covered_usd, covered_lbp
       FROM debt_ledger
       WHERE client_id = ? AND tenant_id = ?
         AND transaction_type IN (${repaymentCoverableTypesSqlList()})
         AND (covered_usd > 0 OR covered_lbp > 0)
       ORDER BY created_at DESC, id DESC`,
      clientId,
      tenantId,
    );

    const usdTakes = allocateFifo(
      covered.map((r) => ({ id: r.id, outstanding: r.covered_usd })),
      budgetUsd,
      0.005,
    );
    const lbpTakes = allocateFifo(
      covered.map((r) => ({ id: r.id, outstanding: r.covered_lbp })),
      budgetLbp,
      1,
    );
    const usdById = new Map(usdTakes.map((t) => [t.id, t.take]));
    const lbpById = new Map(lbpTakes.map((t) => [t.id, t.take]));

    const upd = this.db.prepare(
      `UPDATE debt_ledger SET covered_usd = covered_usd - ?, covered_lbp = covered_lbp - ?
       WHERE id = ? AND tenant_id = ?`,
    );
    for (const row of covered) {
      const takeUsd = usdById.get(row.id) ?? 0;
      const takeLbp = lbpById.get(row.id) ?? 0;
      if (takeUsd > 0 || takeLbp > 0) {
        upd.run(takeUsd, takeLbp, row.id, tenantId);
      }
    }
  }

  /**
   * ONE definition (rule 14) of "signed net customer-facing total per
   * currency, summed over overridable legs" — shared by
   * `_validateRefundLegOverride` (the pre-write guard) and the
   * override-application step in `_reversePayments`, so the sign the
   * reversal restores can never drift from the total the validator checked
   * against. `rows` is whatever the caller already fetched (either
   * `getPaymentsByTransactionId`'s result or the raw `payments` query
   * `_reversePayments` runs for its own mirror loop) — this never re-queries.
   */
  private _overridableNetByCurrency(
    rows: Array<{
      method: string;
      drawer_name: string;
      currency_code: string;
      amount: number;
      note: string | null;
    }>,
  ): Record<string, number> {
    return overridableNetByCurrency(rows);
  }

  /**
   * LIRA-078 (refund tender-selection modal, money contract): validate the
   * operator's chosen return legs against THIS transaction's own net
   * customer-facing total, per currency, BEFORE any row is written. Reuses
   * `isOverridableLeg` (rule 14) — the SAME predicate `_reversePayments`
   * below uses to decide which original rows the override replaces, so the
   * two can never disagree about what "customer-facing" means.
   *
   * NET-BASED OVERRIDE (BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md Phase B): the
   * override describes the MAGNITUDE of the row's net customer-facing
   * movement, never a per-leg mirror — the operator picks the METHOD(s), the
   * DIRECTION is always restored from the original net's sign (see
   * `_reversePayments`). This is why `originalNet` here is left SIGNED (a
   * plain SALE/SEND's net is positive — the customer paid in; a fee-on-top
   * RECEIVE's overridable legs are the payout leg (negative, the shop paid
   * the customer x) and the customer-paid fee leg (positive, +f) — netting to
   * `f - x`, negative whenever the fee is smaller than the payout, which it
   * always is) while `refundLegs[].amount` is validated to be a positive
   * MAGNITUDE (checked below) and `overrideNet` sums those positive
   * magnitudes. The check is therefore `|originalNet| == overrideNet` — NOT
   * `originalNet == overrideNet` (comparing a signed total to an unsigned one
   * would hard-reject every RECEIVE override, since a $95 override could
   * never equal a -$95 net) — matching the frontend's identical
   * `Math.abs(originalNet[c])` comparison in `validateRefundLines`
   * (refundLegOverride.ts) so the modal's Confirm gate and the backend's
   * authority never disagree about what's valid.
   *
   * Worked example (x=100 payout, f=5 customer-paid fee, CASH throughout):
   * originalNet.USD = f - x = 5 - 100 = -95. Operator overrides with ONE
   * CASH leg, amount 95 (a positive magnitude — matches |−95|). Applied in
   * `_reversePayments`, that leg is written with the ORIGINAL net's sign
   * negated: since originalNet is negative, the reversal leg posts +95 to the
   * chosen drawer — arithmetically identical to reversing the two original
   * legs individually (+100 payout given back, -5 fee returned = +95 net),
   * just collapsed into one line the way the operator sees it.
   */
  private _validateRefundLegOverride(
    transactionId: number,
    refundLegs: RefundLegOverride[],
    exchangeRate?: number,
    /** Owner decision 2026-10-07 — refund kept change. With a claim, the
     *  legs are validated against the net MINUS the checked kept amount
     *  (`_resolveRefundKeptChange`); without one, exactly as before. */
    keptCtx?: { original: TransactionEntity; claimed?: KeptChange },
  ): { usd: number; lbp: number } | undefined {
    const originalRows = this.getPaymentsByTransactionId(transactionId);
    const originalNet = this._overridableNetByCurrency(originalRows);
    const resolved = keptCtx
      ? this._resolveRefundKeptChange({
          owedNet: originalNet,
          refundLegs,
          claimed: keptCtx.claimed,
          exchangeRate: this._refundKeptChangeRate(
            exchangeRate,
            keptCtx.original.exchange_rate,
          ),
          isForPartner: this._isForPartnerTransaction(keptCtx.original),
          originalType: keptCtx.original.type,
          entityId: transactionId,
        })
      : undefined;
    validateRefundLegOverrideAmounts(
      resolved?.owedNetAfterKept ?? originalNet,
      refundLegs,
      transactionId,
      exchangeRate,
    );
    return resolved && (resolved.keptUsd > 0 || resolved.keptLbp > 0)
      ? { usd: resolved.keptUsd, lbp: resolved.keptLbp }
      : undefined;
  }

  /**
   * Owner decision 2026-10-07 — refund kept change. A refund of $20.12
   * handed back as $20 lets the shop keep the $0.12 as profit. This is the
   * refund side of `resolveKeptChange` (payer "payout": the shop hands money
   * to the customer) — the ONE check-and-split every kept-change flow uses
   * (rule 14); the refund adds only its own preconditions on top:
   *   - every return line is DRAWER money — cash or a wallet (OMT, WHISH,
   *     Binance, …), per `isDrawerAffectingMethod` — never a customer
   *     account or gift card (owner decision 2026-10-07, the same funding
   *     rule `resolveKeptChange` applies to payouts);
   *   - the refund is in exactly ONE currency (USD or LBP), and every
   *     return line is in it ("same currency", owner decision);
   *   - the refund moves money OUT of the shop (a money-IN original — a
   *     sale, a SEND). Refunding a payout original (a RECEIVE) takes money
   *     back FROM the customer, where "keeping" a shortfall would be a loss.
   * The cap (under $1 / 100,000 LBP), the real-shortfall check, and the
   * FOR-partner refusal are `resolveKeptChange`'s own.
   *
   * It is NOT a partial refund: the caller still reverses the item side in
   * full (stock, REFUND amount, debt); only the cash handed back is short,
   * and the returned `keptUsd/keptLbp` is ADDED to the REFUND row's own
   * profit stamp (−original + kept). The returned `owedNetAfterKept` is what
   * the caller then feeds `validateRefundLegOverrideAmounts`, so the
   * method/currency gate still runs exactly once.
   *
   * Nothing claimed (absent / both 0) → returns the input unchanged without
   * calling anything — every existing refund stays byte-identical.
   *
   * Throws before any write; callers run it before `this.transaction(...)`.
   */
  private _resolveRefundKeptChange(args: {
    /** Signed customer-facing net the refund gives back, per currency
     *  (positive = money the customer paid IN). */
    owedNet: Record<string, number>;
    refundLegs: RefundLegOverride[] | undefined;
    claimed: KeptChange | undefined;
    exchangeRate: number;
    isForPartner: boolean;
    /** The refunded transaction's type — see `REFUND_KEPT_CHANGE_TYPES`. */
    originalType: string;
    entityId: number;
  }): {
    keptUsd: number;
    keptLbp: number;
    owedNetAfterKept: Record<string, number>;
  } {
    const { owedNet, claimed, entityId } = args;
    const claimedUsd = claimed?.usd ?? 0;
    const claimedLbp = claimed?.lbp ?? 0;
    if (claimedUsd === 0 && claimedLbp === 0) {
      return { keptUsd: 0, keptLbp: 0, owedNetAfterKept: owedNet };
    }
    const context = "Refund";
    if (!REFUND_KEPT_CHANGE_TYPES.includes(args.originalType)) {
      throw new DatabaseError(
        `${context}: kept change is not available when refunding this kind of transaction yet — hand back the exact amount`,
        { entityId },
      );
    }
    const legs = args.refundLegs ?? [];
    // Funding rule (owner decision 2026-10-07): kept change must be drawer
    // money — cash OR wallet. `isDrawerAffectingMethod` is the ONE
    // definition (rule 14), the same predicate `resolveKeptChange`'s payout
    // branch applies; checked here first only for refund-worded refusal.
    for (const leg of legs) {
      if (!isDrawerAffectingMethod(leg.method)) {
        throw new DatabaseError(
          `${context}: change can only be kept on a cash or wallet refund — a customer account or gift card return line cannot keep change`,
          { entityId },
        );
      }
    }
    const currencies = Object.entries(owedNet).filter(
      ([currency, amount]) =>
        Math.abs(amount) > (REFUND_LEG_AMOUNT_EPSILON[currency] ?? 0.01),
    );
    const only = currencies.length === 1 ? currencies[0] : undefined;
    if (!only || (only[0] !== "USD" && only[0] !== "LBP")) {
      throw new DatabaseError(
        `${context}: kept change applies only to a refund in one currency (USD or LBP)`,
        { entityId },
      );
    }
    const [currency, net] = only;
    if (net <= 0) {
      throw new DatabaseError(
        `${context}: cannot keep change on a refund that takes money back from the customer`,
        { entityId },
      );
    }
    for (const leg of legs) {
      if (leg.currencyCode !== currency) {
        throw new DatabaseError(
          `${context}: kept change needs every return line in the refund's currency (${currency})`,
          { entityId },
        );
      }
    }
    const result = resolveKeptChange({
      payer: "payout",
      owed: net,
      owedCurrency: currency,
      payoutLegs: legs.map((l) => ({
        method: l.method,
        currencyCode: l.currencyCode,
        amount: l.amount,
      })),
      claimedKept: { usd: claimedUsd, lbp: claimedLbp },
      exchangeRate: args.exchangeRate,
      isForPartner: args.isForPartner,
      context,
    });
    const kept = currency === "USD" ? result.keptUsd : result.keptLbp;
    return {
      keptUsd: result.keptUsd,
      keptLbp: result.keptLbp,
      owedNetAfterKept: { ...owedNet, [currency]: net - kept },
    };
  }

  /**
   * Owner decision 2026-10-07 — refund kept change for a caller OUTSIDE this
   * repository that refunds part of a transaction: `SalesRepository.
   * refundSaleItem` (the POS per-item refund). It hands in the item's own
   * share of the sale's customer-facing net; everything else — the booked
   * rate fallback, the FOR-partner detection and the check itself — is the
   * SAME private code the whole-sale refund runs (rule 14: one gate, never
   * a copy). Nothing claimed → the input back unchanged. Throws before any
   * write; call it before opening a transaction.
   */
  resolvePartialRefundKeptChange(args: {
    originalTxnId: number;
    owedNet: Record<string, number>;
    refundLegs: RefundLegOverride[] | undefined;
    claimed: KeptChange | undefined;
    exchangeRate: number | undefined;
  }): {
    keptUsd: number;
    keptLbp: number;
    owedNetAfterKept: Record<string, number>;
  } {
    const claimedUsd = args.claimed?.usd ?? 0;
    const claimedLbp = args.claimed?.lbp ?? 0;
    if (claimedUsd === 0 && claimedLbp === 0) {
      return { keptUsd: 0, keptLbp: 0, owedNetAfterKept: args.owedNet };
    }
    const original = this.findById(args.originalTxnId);
    if (!original) {
      throw new NotFoundError("transactions", args.originalTxnId);
    }
    return this._resolveRefundKeptChange({
      owedNet: args.owedNet,
      refundLegs: args.refundLegs,
      claimed: args.claimed,
      exchangeRate: this._refundKeptChangeRate(
        args.exchangeRate,
        original.exchange_rate,
      ),
      isForPartner: this._isForPartnerTransaction(original),
      originalType: original.type,
      entityId: args.originalTxnId,
    });
  }

  /**
   * True when this transaction booked a FOR-partner obligation (a
   * `partner_ledger` `FOR_%` row referencing its source row — the same link
   * `_reversePartnerLedger` reverses). Kept change is refused on those
   * (owner decision 2026-10-07: FOR-partner needs the exact amount).
   */
  private _isForPartnerTransaction(original: TransactionEntity): boolean {
    if (!original.source_table || original.source_id == null) return false;
    if (!this.tableExists("partner_ledger")) return false;
    const row = this.queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM partner_ledger
        WHERE reference_table = ? AND reference_id = ? AND tenant_id = ?
          AND transaction_type LIKE 'FOR\\_%' ESCAPE '\\'`,
      original.source_table,
      original.source_id,
      getCurrentTenantId(),
    );
    return (row?.n ?? 0) > 0;
  }

  /** A usable rate for kept-change reconciliation: the cashier's typed
   *  rate, else the transaction's booked rate, else the day's rate. Same
   *  order `_reverseTransactionItemEffects` stamps (`rateUsed`). The
   *  refund's return lines are all in the refund's own currency, so the
   *  rate only scales `resolveKeptChange`'s cent tolerance. */
  private _refundKeptChangeRate(
    typed: number | undefined,
    booked: number | null | undefined,
  ): number {
    if (isUsableRefundExchangeRate(typed)) return typed;
    if (isUsableRefundExchangeRate(booked)) return booked;
    return dayRateFallback() ?? 89000;
  }

  /**
   * Primary Cash Drawer plan §8.2 (LIRA-078): the `{provider, baseSystem}`
   * context `resolveServiceCashDrawer` needs to route an OVERRIDDEN refund
   * leg back into the PCD instead of General, when the reversed transaction
   * IS a financial-service SEND/RECEIVE running on the shop's primary
   * system. Only `financial_services` rows carry a `provider` — every other
   * reversible source table (sales, recharges, custom services, ...) has no
   * primary-system concept, so this returns null for them and the caller
   * falls back to the plain `paymentMethodToDrawerName` mapping unchanged
   * (mirrors `_supplierSourceSettlementId`'s same "only FS rows are
   * relevant" shape). `resolveServiceCashDrawer` itself is a no-op whenever
   * `provider !== baseSystem` (secondary-system / partner-through legs), so
   * returning a context here never mis-routes those cases either.
   */
  private _financialServiceCashDrawerCtx(
    originalTxnId: number,
  ): ServiceCashDrawerContext | null {
    const tenantId = getCurrentTenantId();
    const original = this.queryOne<{
      source_table: string;
      source_id: number | null;
    }>(
      `SELECT source_table, source_id FROM transactions WHERE id = ? AND tenant_id = ?`,
      originalTxnId,
      tenantId,
    );
    if (
      !original ||
      original.source_table !== "financial_services" ||
      original.source_id == null
    ) {
      return null;
    }

    const fs = this.queryOne<{ provider: string }>(
      `SELECT provider FROM financial_services WHERE id = ? AND tenant_id = ?`,
      original.source_id,
      tenantId,
    );
    if (!fs) return null;

    // Same defensive shape as FinancialServiceRepository's own baseSystem
    // read: system_settings may be absent in minimal/test schemas, so a
    // missing/unreadable setting defaults to OMT rather than throwing and
    // breaking every refund override on that connection.
    let baseSystem: BaseSystem = "OMT";
    try {
      const row = this.db
        .prepare(
          `SELECT value FROM system_settings WHERE key_name = 'shop_base_system' AND tenant_id = ?`,
        )
        .get(tenantId) as { value?: string } | undefined;
      if (row?.value === "WHISH") baseSystem = "WHISH";
    } catch {
      // system_settings may be absent in minimal/test schemas — default to OMT.
    }

    return { provider: fs.provider, baseSystem };
  }

  private _reversePayments(
    originalTxnId: number,
    reversalTxnId: number,
    userId: number,
    refundLegOverride?: RefundLegOverride[],
    /** LIRA-236 — the cashier-typed rate, threaded through to
     *  `refundLegReversalSign` so a cross-currency override leg's direction
     *  follows the OVERALL transaction value, not just this currency's own
     *  (possibly unrepresentative) net. See that function's doc. */
    exchangeRate?: number,
  ): void {
    const tenantId = getCurrentTenantId();
    const payments = this.query<{
      method: string;
      drawer_name: string;
      currency_code: string;
      amount: number;
      note: string | null;
    }>(
      `SELECT method, drawer_name, currency_code, amount, note
       FROM payments WHERE transaction_id = ? AND tenant_id = ?`,
      originalTxnId,
      tenantId,
    );

    for (const p of payments) {
      // LIRA-078: when the operator chose override return method(s), skip
      // mirroring the customer-facing legs verbatim here — they are replaced
      // by refundLegOverride below instead. Every OTHER (internal
      // bookkeeping) leg — provider stock/reserve drawers, fee/transfer
      // markers, crypto legs, etc. — still mirrors exactly as before,
      // regardless of the override, since none of those represent "how the
      // operator hands the customer's money back."
      if (refundLegOverride && isOverridableLeg(p)) continue;

      const negatedAmount = -p.amount;
      insertPaymentRow(this.db, {
        transactionId: reversalTxnId,
        method: p.method,
        drawerName: p.drawer_name,
        currencyCode: p.currency_code,
        amount: negatedAmount,
        note: "Reversal",
        createdBy: userId,
        tenantId,
      });
      // LIRA-258 (G34): an audit-only row (PM_FEE) never moved a drawer on
      // create — its money is inside another leg — so mirror it for the
      // journal but apply no delta, or the void takes the fee back twice.
      if (isAuditOnlyPaymentMethod(p.method)) continue;
      applyDrawerDelta(this.db, {
        drawerName: p.drawer_name,
        currencyCode: p.currency_code,
        delta: negatedAmount,
        tenantId,
      });
    }

    if (refundLegOverride) {
      // Primary Cash Drawer plan §8.2 (LIRA-078): a replacement leg must NOT
      // blindly re-derive its drawer from the payment method alone — an
      // overridden CASH refund of a primary-system financial-service
      // SEND/RECEIVE has to land back in the PCD it came out of, not
      // General. Resolved ONCE per override call (not per leg) via the same
      // one-definition resolver every other primary-system cash leg uses
      // (rule 14); it falls through to plain `paymentMethodToDrawerName`
      // unchanged for every non-FS / non-primary-system transaction, so this
      // is safe even when `cashDrawerCtx` is null.
      const cashDrawerCtx = this._financialServiceCashDrawerCtx(originalTxnId);
      // BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md Phase B: the override leg carries
      // a positive MAGNITUDE only (validated in `_validateRefundLegOverride`)
      // — the DIRECTION it posts in must be restored from the sign of the
      // ORIGINAL overridable net for that currency, computed here from the
      // SAME `payments` rows the mirror loop above already fetched (rule 14 —
      // one query, one predicate, no drift between "what got skipped" and
      // "what sign the replacement gets"). A plain money-IN row (SALE/SEND: a
      // positive net, e.g. +100 cash) reverses by SUBTRACTING from the
      // chosen drawer — unchanged from pre-Phase-B behavior. A fee-on-top
      // RECEIVE's overridable legs net NEGATIVE (payout f-x, e.g. 5-100=-95:
      // the shop paid the customer more than the fee it collected back), so
      // its override reverses by ADDING to the chosen drawer instead — undoing
      // the OUT movement the original transaction made. See the worked
      // example in `_validateRefundLegOverride`'s doc comment. F1 (round-3
      // review): a currency the ORIGINAL never touched (a cross-currency
      // LIRA-236 refund) has no net of its own to reverse, and a currency
      // whose OWN net disagrees with the transaction's overall direction (a
      // payment + a differently-currencied change leg) must not be signed
      // in isolation either — `refundLegReversalSign` resolves both cases
      // from the OVERALL value when `exchangeRate` is given, falling back to
      // this currency's own net (the historic rule) otherwise.
      const originalNetByCurrency = this._overridableNetByCurrency(payments);
      for (const leg of refundLegOverride) {
        const drawerName = cashDrawerCtx
          ? resolveServiceCashDrawer(leg.method, cashDrawerCtx)
          : paymentMethodToDrawerName(leg.method);
        const reversalSign = refundLegReversalSign(
          originalNetByCurrency,
          leg.currencyCode,
          exchangeRate,
        );
        const signedAmount = reversalSign * leg.amount;
        insertPaymentRow(this.db, {
          transactionId: reversalTxnId,
          method: leg.method,
          drawerName,
          currencyCode: leg.currencyCode,
          amount: signedAmount,
          note: "Refund (method override)",
          createdBy: userId,
          tenantId,
        });
        applyDrawerDelta(this.db, {
          drawerName,
          currencyCode: leg.currencyCode,
          delta: signedAmount,
          tenantId,
        });
      }
    }
  }

  /**
   * Restore stock for all items in a sale.
   *
   * Restores `quantity - refunded_quantity` per line, NOT the raw `quantity`
   * (fixed LIRA-143 phase 4 — pre-existing bug, present since
   * `refunded_quantity` was introduced): a sale that was partially
   * item-refunded first (`SalesRepository.refundSaleItem`) already restored
   * `refunded_quantity` units of stock at THAT time. A later full void/refund
   * of the WHOLE sale calling this method would then re-add the FULL
   * `quantity` on top, double-crediting the already-returned units back to
   * stock. Floored at 0 (`Math.max`) so a defensive/duplicate call
   * (`refunded_quantity >= quantity`) can never push stock up.
   *
   * As of the owner's 2026-08-26 decision this netting is defence-in-depth
   * rather than the load-bearing fix: `_assertNoPartialItemRefunds` now
   * refuses the whole-sale void/refund outright when any line carries a
   * `refunded_quantity`, so neither caller can reach this method with a
   * nonzero one. Deliberately KEPT — it costs one subtraction, it is the only
   * thing standing between legacy/hand-repaired rows and an inflated stock
   * count, and removing it would make the netting depend on a guard living
   * 700 lines away.
   */
  private _restoreStock(saleId: number): void {
    const tenantId = getCurrentTenantId();
    const items = this.query<{
      id: number;
      product_id: number;
      quantity: number;
      refunded_quantity: number | null;
    }>(
      `SELECT id, product_id, quantity, refunded_quantity FROM sale_items WHERE sale_id = ? AND tenant_id = ?`,
      saleId,
      tenantId,
    );

    const restoreStmt = this.db.prepare(
      `UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ? AND tenant_id = ?`,
    );
    const batchRepo = getStockBatchRepository();

    for (const item of items) {
      const remaining = Math.max(
        0,
        item.quantity - (item.refunded_quantity ?? 0),
      );
      if (remaining === 0) continue;
      restoreStmt.run(remaining, item.product_id, tenantId);
      // Give the same "remaining" quantity back to the batches this line's
      // sale FIFO-consumed (Supplier Stock Intake, rule 20) — this method
      // restores `quantity - refunded_quantity`, not raw `quantity` (a
      // part-refunded item's already-refunded units already returned to
      // their batches via `SalesRepository.refundSaleItem`'s own
      // `restoreForSaleItem` call; restoring them again here would
      // double-credit those batches), so the batch-side restore must match
      // that exact "remaining" figure, not the full original quantity.
      batchRepo.restoreForSaleItem(item.id, remaining);
    }
  }

  /**
   * Restore the stock a custom service consumed (FOR_PARTNER_AND_COST_
   * UNIFICATION_PLAN.md §2 FINAL SPEC, rule 20). Unlike `_restoreStock`
   * (sales), a custom service is a single row, not a `sale_items` table, and
   * always consumed exactly 1 unit — CustomServiceRepository.createService
   * never lets the operator choose a quantity, so there is no `quantity`
   * column to read here either. No-op when the service never linked a
   * product (product_id NULL — preset/free-text, or any pre-v152 row).
   *
   * SUPPLIER_STOCK_INTAKE_PLAN.md, rule 20 — this is ALSO the reversal owner
   * for the batch unit `CustomServiceRepository.createService` FIFO-consumed
   * for this service (mirrors `_restoreStock`'s identical batch-restore
   * pairing for sales, just added later — see that build's coordinator
   * note: the batch table is a ledger too, and a create-then-void cycle that
   * restores `products.stock_quantity` without restoring the batch's
   * `quantity_remaining` leaks one unit of cover forever, silently pushing a
   * later sale onto fallback-priced, uncovered consumption with no error
   * anywhere). Keyed by `customServiceId` (not `sale_item_id` — a custom
   * service's consumption row has none) via
   * `StockBatchRepository.restoreForCustomService`, which does not exist yet
   * — see this build's handoffs.
   */
  private _restoreCustomServiceStock(customServiceId: number): void {
    const tenantId = getCurrentTenantId();
    const row = this.queryOne<{ product_id: number | null }>(
      `SELECT product_id FROM custom_services WHERE id = ? AND tenant_id = ?`,
      customServiceId,
      tenantId,
    );
    if (!row?.product_id) return;

    getStockBatchRepository().restoreForCustomService(customServiceId, 1);

    this.execute(
      `UPDATE products SET stock_quantity = stock_quantity + 1 WHERE id = ? AND tenant_id = ?`,
      row.product_id,
      tenantId,
    );
  }

  /**
   * LIRA-176 phase 4, rule 20 — restore every not-yet-restored part on a
   * maintenance job whose transaction is being voided/refunded.
   *
   * Delegates to the standalone `restoreMaintenanceJobParts` helper in
   * `maintenancePartsStock.js` rather than `MaintenanceRepository` directly:
   * `MaintenanceRepository` already imports `getTransactionRepository`, so
   * the reverse import here would create a cycle. This lives on
   * `TransactionRepository` (mirroring `_restoreCustomServiceStock`) so a
   * maintenance job voided directly from the Transactions page — bypassing
   * the maintenance module entirely — still returns its parts exactly once;
   * the `stock_restored` guard inside the shared helper is what makes
   * "exactly once" true even if the job is later edited or deleted.
   */
  private _restoreMaintenancePartsStock(maintenanceId: number): void {
    restoreMaintenanceJobParts(this.db, {
      maintenanceId,
      tenantId: getCurrentTenantId(),
    });
  }

  /**
   * LIRA-262, rule 20 — return a "shop used its own stock" inventory
   * expense's units (products.stock_quantity + the batches it consumed).
   * Delegates to the standalone `restoreExpenseStock` (expenseStock.ts) for
   * the same import-cycle reason as `_restoreMaintenancePartsStock`. No-op
   * for an ordinary or catalog expense — a catalog expense's only side
   * effect is its provider-drawer leg, which `_reversePayments` reverses.
   */
  private _restoreExpenseStock(expenseId: number): void {
    restoreExpenseStock(this.db, {
      expenseId,
      tenantId: getCurrentTenantId(),
    });
  }

  /**
   * Cancel the MODULE-CHARGE debt_ledger entries linked to a transaction by
   * inserting a reversing "Refund Reversal" entry per charge, negating BOTH
   * currencies (module debts are per-currency — an LBP recharge debt lives
   * entirely in amount_lbp).
   *
   * Scoped to MODULE_DEBT_TRANSACTION_TYPES, never a blanket transaction_id
   * match: 'Repayment' rows are back-linked to a transaction too and negating
   * one would un-pay a debt. No drawer is touched here — an account-charged
   * leg took no cash, so its reversal must be ledger-only.
   */
  private _cancelDebt(originalTxnId: number, userId: number): void {
    const tenantId = getCurrentTenantId();
    // Rule 20: also reverse 'CREDIT_DEPOSIT' rows carrying a REAL
    // transaction_id — the ones a flow writes as a side effect (change
    // returned as store credit, a RECEIVE cashed out to CUSTOMER_ACCOUNT, the
    // Binance/app-wallet equivalent — see DebtRepository.addCredit's doc).
    // Deliberately NOT added to the exported MODULE_DEBT_TRANSACTION_TYPES
    // whitelist: that constant is guarded by
    // constants/__tests__/moduleDebtTypes.guard.test.ts as "module CHARGE
    // types named '<Module> Debt'" — a credit isn't a charge and doesn't
    // match that naming convention, and 'CREDIT_DEPOSIT' would fail the
    // guard's dead-entry check. Local to this method only. A row with
    // transaction_id = NULL (standalone/manual credits, voucher deposits with
    // no originating transaction) never matches `transaction_id = ?` below,
    // so this stays surgical — see
    // TransactionRepository.debtReversal.test.ts's whitelist guard test and
    // ServiceStoreCreditReversal.test.ts's negative control.
    const CANCELLABLE_LEDGER_TYPES = [
      ...MODULE_DEBT_TRANSACTION_TYPES,
      "CREDIT_DEPOSIT",
    ];
    const typePlaceholders = CANCELLABLE_LEDGER_TYPES.map(() => "?").join(", ");
    const debts = this.query<{
      id: number;
      client_id: number;
      amount_usd: number;
      amount_lbp: number;
      transaction_type: string;
    }>(
      `SELECT id, client_id, amount_usd, amount_lbp, transaction_type FROM debt_ledger
       WHERE transaction_id = ? AND transaction_type IN (${typePlaceholders}) AND tenant_id = ?`,
      originalTxnId,
      ...CANCELLABLE_LEDGER_TYPES,
      tenantId,
    );

    const insertReversal = this.db.prepare(`
      INSERT INTO debt_ledger (
        client_id, transaction_type, amount_usd, amount_lbp, transaction_id, note, created_by, tenant_id
      ) VALUES (?, 'Refund Reversal', ?, ?, ?, 'Debt cancelled by refund/void', ?, ?)
    `);

    for (const d of debts) {
      insertReversal.run(
        d.client_id,
        -d.amount_usd,
        -d.amount_lbp,
        originalTxnId,
        userId,
        tenantId,
      );
    }

    // LIRA-258 / G37 — a gift card redeemed in this transaction: its deposit
    // to the owner was just cancelled above, so give the voucher itself back
    // (redeemed → pending). Ledgers AND voucher return to their pre-sale
    // state; before this the customer lost the voucher's value.
    // (Skips hand-rolled test DBs without a vouchers table.)
    if (
      debts.some((d) => d.transaction_type === "CREDIT_DEPOSIT") &&
      this.db
        .prepare(
          `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'vouchers'`,
        )
        .get()
    ) {
      getVoucherRepository().restoreRedeemedByTransaction(originalTxnId);
    }
  }

  /**
   * Reverse any `partner_ledger` rows tied to a voided/refunded transaction.
   *
   * Type-agnostic (rule 20) and looked up by `reference_table`/`reference_id`
   * — NOT a `transaction_id` FK like debt_ledger — because partner_ledger has
   * none. This is what closes a PRE-EXISTING gap: before this method existed,
   * neither `voidTransaction` nor `refundTransaction` touched partner_ledger
   * at all, so voiding/refunding ANY partner transaction (FOR_OMT, THROUGH_*,
   * and now FOR_POS) stranded its ledger row permanently.
   *
   * The reversal reuses the SAME `transaction_type` (never a generic
   * ADJUSTMENT) with the OPPOSITE `direction` — required so the balance nets
   * to zero within the specific FOR_%/THROUGH_% bucket the original row
   * counted against, not just the partner's grand total.
   */
  private _reversePartnerLedger(
    original: TransactionEntity,
    userId: number,
    reason: "void" | "refund",
  ): void {
    if (!original.source_table || original.source_id == null) return;
    // LIRA-085: a transaction whose OWN source_table IS 'partner_ledger'
    // (PARTNER_SETTLEMENT/PARTNER_PAYMENT — its source_id points at the
    // settlement/payment's own ledger row) is never a legitimate target for
    // THIS method's reference_table/reference_id scan. That scan exists to
    // find FOR_%/THROUGH_% rows tied back to the CAUSING transaction (source
    // tables like 'sales'/'financial_services') — never partner_ledger rows
    // that reference ANOTHER partner_ledger row. Since LIRA-085 stamped the
    // bundled CQ-10 discount's OWN reference_table='partner_ledger'/
    // reference_id=<settlement row id> link (so
    // `_reversePartnerSettlementLedger` can find and sweep it), without this
    // guard THIS method's identical reference_table/reference_id query would
    // match that SAME discount row and double-reverse it. No existing
    // behavior depends on this method running for a 'partner_ledger'-sourced
    // transaction — those types were all NON_REVERSIBLE before LIRA-085, so
    // this method was never reached with that source_table until now.
    if (original.source_table === "partner_ledger") return;
    const tenantId = getCurrentTenantId();

    // Only partner (FOR_*/THROUGH_*) transactions have rows to reverse; a void
    // with nothing to scan is a no-op. Skip cleanly when partner_ledger is
    // absent (some hand-rolled test DBs omit it) rather than hard-crash.
    const hasTable = this.db
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'partner_ledger'`,
      )
      .get();
    if (!hasTable) return;

    const entries = this.query<{
      partner_id: number;
      transaction_type: string | null;
      amount: number;
      currency: string;
      direction: "DEBIT" | "CREDIT";
    }>(
      `SELECT partner_id, transaction_type, amount, currency, direction
       FROM partner_ledger
       WHERE reference_table = ? AND reference_id = ? AND tenant_id = ?`,
      original.source_table,
      original.source_id,
      tenantId,
    );

    const insertReversal = this.db.prepare(`
      INSERT INTO partner_ledger (
        partner_id, transaction_type, reference_table, reference_id,
        amount, currency, direction, notes, user_id, tenant_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    const verb = reason === "void" ? "voided" : "refunded";
    for (const e of entries) {
      insertReversal.run(
        e.partner_id,
        e.transaction_type,
        original.source_table,
        original.source_id,
        e.amount,
        e.currency,
        e.direction === "DEBIT" ? "CREDIT" : "DEBIT",
        `Reversal of ${verb} txn #${original.id}`,
        userId,
        tenantId,
      );
    }
  }

  /**
   * LIRA-085 — reversal owner for PARTNER_SETTLEMENT / PARTNER_PAYMENT (rule
   * 20). These used to be flatly `NON_REVERSIBLE_TRANSACTION_TYPES` — the
   * documented blocker was "the FIFO covered_amount stamps a settlement
   * applies to FOR_% rows have no unwind mechanism." That mechanism now
   * exists (`_unwindPartnerSettlementCoverage` below, mirroring
   * `PartnerRepository.applySettlementCoverage` in reverse).
   *
   * Different lookup shape from `_reversePartnerLedger`: THIS transaction's
   * own `source_table`/`source_id` (`'partner_ledger'`/entry.id) point AT
   * the settlement/payment's own ledger row — it is not a row that
   * REFERENCES the transaction being reversed (which is what
   * `_reversePartnerLedger`'s `reference_table`/`reference_id` lookup finds
   * for FOR_%/THROUGH_% rows). Both methods run unconditionally on every
   * void/refund; each is a no-op unless its own shape matches.
   *
   * partner_ledger has no soft-void column — every reversal here is a NEW
   * compensating row (same `transaction_type`, opposite `direction`), same
   * convention `_reversePartnerLedger` already uses. Drawer/cash is handled
   * for free by the generic `_reversePayments` (the settlement's own
   * `payments` row(s) — single-leg or CQ-11 split — reverse before this
   * method runs); a CLIENT_ACCOUNT-method settlement moved no drawer cash at
   * all, so that step is simply a no-op for it, and this method's ledger/
   * coverage restore is identical either way.
   *
   * CQ-10 bundled discount: unlike D3's DEBT_REPAYMENT precedent (a bundled
   * discount stays untouched, a SEPARATE non-reversible transaction), THIS
   * ticket's own acceptance text requires the opposite — "COUNTERPARTY_
   * DISCOUNT bundled inside a settlement must be handled by that
   * settlement's reversal (net to 0)". Found via the discount's own
   * partner_ledger row's `reference_table='partner_ledger'`/`reference_id=
   * <settlement row id>` link (stamped by `PartnerService.settle()`,
   * LIRA-085 — previously these two rows were linked only by time
   * proximity, which a reversal method cannot rely on). Its ledger row gets
   * the same compensating-row treatment; its COUNTERPARTY_DISCOUNT
   * transaction's signed profit is negated by a NEW reversal transaction
   * (never mutate the original — same additive convention as
   * `_cancelDebt`/`_restoreRepaymentDebt`). PARTNER_PAYMENT never carries a
   * bundled discount (`recordPartnerTransaction` has no discount parameter),
   * so this step is naturally a no-op for that type.
   *
   * Coverage unwind budget = |settlement.amount| + |bundled discount.amount|
   * (both apply against the exact same targetDirection FOR_% bucket, per
   * `PartnerRepository.addLedgerEntry`'s coverage trigger) — combined into
   * ONE newest-covered-first give-back, mirroring the D3 repayment/
   * service-debt reverse-FIFO shape (same accepted imprecision under
   * interleaved settlements on the same partner — exact when reversed in
   * LIFO order, the common case).
   */
  private _reversePartnerSettlementLedger(
    original: TransactionEntity,
    userId: number,
  ): void {
    if (
      (original.type !== "PARTNER_SETTLEMENT" &&
        original.type !== "PARTNER_PAYMENT") ||
      original.source_table !== "partner_ledger" ||
      original.source_id == null
    ) {
      return;
    }
    const tenantId = getCurrentTenantId();
    const hasTable = this.db
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'partner_ledger'`,
      )
      .get();
    if (!hasTable) return;

    const entry = this.queryOne<{
      partner_id: number;
      transaction_type: string | null;
      amount: number;
      currency: string;
      direction: "DEBIT" | "CREDIT";
    }>(
      `SELECT partner_id, transaction_type, amount, currency, direction
       FROM partner_ledger WHERE id = ? AND tenant_id = ?`,
      original.source_id,
      tenantId,
    );
    if (!entry) return;

    const insertLedgerReversal = this.db.prepare(`
      INSERT INTO partner_ledger (
        partner_id, transaction_type, reference_table, reference_id,
        amount, currency, direction, notes, user_id, tenant_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    // 1. Reverse the settlement/payment's own ledger row.
    insertLedgerReversal.run(
      entry.partner_id,
      entry.transaction_type,
      "partner_ledger",
      original.source_id,
      entry.amount,
      entry.currency,
      entry.direction === "DEBIT" ? "CREDIT" : "DEBIT",
      `Reversal of settlement/payment txn #${original.id}`,
      userId,
      tenantId,
    );

    let coverageBudget = Math.abs(entry.amount);

    // 2. Sweep a bundled CQ-10 discount, if this settlement carried one.
    const discountEntry = this.queryOne<{
      id: number;
      amount: number;
      currency: string;
      direction: "DEBIT" | "CREDIT";
    }>(
      `SELECT id, amount, currency, direction FROM partner_ledger
       WHERE reference_table = 'partner_ledger' AND reference_id = ?
         AND transaction_type = 'DISCOUNT' AND tenant_id = ?`,
      original.source_id,
      tenantId,
    );
    if (discountEntry) {
      insertLedgerReversal.run(
        entry.partner_id,
        "DISCOUNT",
        "partner_ledger",
        original.source_id,
        discountEntry.amount,
        discountEntry.currency,
        discountEntry.direction === "DEBIT" ? "CREDIT" : "DEBIT",
        `Reversal of bundled discount for settlement/payment txn #${original.id}`,
        userId,
        tenantId,
      );
      coverageBudget += Math.abs(discountEntry.amount);

      // Negate the discount's own COUNTERPARTY_DISCOUNT transaction's
      // profit stamp via a NEW compensating transaction (never mutate the
      // original).
      this._negateCounterpartyDiscountProfit(
        "partner_ledger",
        discountEntry.id,
        `Discount reversed by settlement void/refund #${original.id}`,
        userId,
      );
    }

    // 3. Unwind the combined FIFO coverage both rows applied.
    this._unwindPartnerSettlementCoverage(
      entry.partner_id,
      entry.currency,
      entry.direction,
      coverageBudget,
      tenantId,
    );
  }

  /**
   * Reverse-FIFO give-back for `partner_ledger.covered_amount` — the exact
   * mirror of `PartnerRepository.applySettlementCoverage`: newest-first
   * (instead of oldest-first) and subtracting (instead of adding). `direction`
   * is the settlement/payment's OWN direction (same param
   * `applySettlementCoverage` takes) — the target bucket is derived
   * identically (opposite direction, obligation rows only — the SAME
   * `partnerObligationRowSql` fragment `applySettlementCoverage` uses: every
   * `FOR_%` row plus a Via-Partner payout's `THROUGH_CUSTOM_SERVICE` DEBIT,
   * LIRA-258; any other row is never covered, so never unwound either).
   */
  private _unwindPartnerSettlementCoverage(
    partnerId: number,
    currency: string,
    direction: "DEBIT" | "CREDIT",
    budget: number,
    tenantId: number,
  ): void {
    if (budget <= 0.005) return;
    const targetDirection = direction === "CREDIT" ? "DEBIT" : "CREDIT";
    // LIRA-258 / G36: the same obligation HEADS applySettlementCoverage
    // covers (constants/partnerObligation.ts); reversal and item-refund rows
    // are never covered, so they are never unwound either.
    const open = this.query<{ id: number; covered_amount: number }>(
      `SELECT pl_cov.id, pl_cov.covered_amount FROM partner_ledger pl_cov
       WHERE pl_cov.partner_id = ? AND pl_cov.tenant_id = ? AND pl_cov.currency = ?
         AND pl_cov.direction = ?
         AND ${partnerObligationHeadRowSql("pl_cov")}
         AND pl_cov.covered_amount > 0
       ORDER BY pl_cov.created_at DESC, pl_cov.id DESC`,
      partnerId,
      tenantId,
      currency,
      targetDirection,
    );
    const takes = allocateFifo(
      open.map((row) => ({ id: row.id, outstanding: row.covered_amount })),
      budget,
      0.005,
    );
    const upd = this.db.prepare(
      `UPDATE partner_ledger SET covered_amount = covered_amount - ? WHERE id = ? AND tenant_id = ?`,
    );
    for (const t of takes) {
      upd.run(t.take, t.id, tenantId);
    }
  }

  /**
   * LIRA-085 — reversal owner for SUPPLIER_SETTLEMENT (rule 20). This used
   * to be flatly `NON_REVERSIBLE_TRANSACTION_TYPES` alongside
   * LOTO_SETTLEMENT — the documented blocker was "settlement stamps stay in
   * place, and the commission credit to General has no payments row to
   * reverse."
   *
   * OMT/WHISH float model (owner-confirmed 2026-07-29) — updated: under the
   * fee-only model, `SupplierRepository.settleTransactions` no longer funds
   * a commission credit (no `General += commission` / settle-drawer
   * `-= commission` pair, no `SUPPLIER_PAYS_US` ledger row — see that
   * method's doc comment) — there is nothing bespoke left to reverse on the
   * commission side AT ALL. What's left:
   *
   * 1. `financial_services.settlement_id`/`is_settled` stamps — scoped by
   *    `settlement_id = <this settlement's ledger row id>` (never the
   *    metadata id list — only `settlement_id` proves a row STILL belongs
   *    to exactly this settlement at reversal time). `settlement_id` always
   *    clears to NULL. `is_settled` only resets to 0 (with `settled_at`
   *    cleared) for rows where `isPendingSupplierSettlement` (D2, the ONE
   *    shared predicate — `FinancialServiceRepository.ts`) is true — the
   *    EXACT condition `FinancialServiceRepository.createTransaction` used
   *    to decide `is_settled = 0` at creation (see that method's "NOTE on
   *    is_settled vs settlement_id" doc comment; COMMISSION_AT_SETTLEMENT_
   *    PLAN.md §3/Phase 0 — this branches on `commission_model` per row
   *    instead of `commission > 0`, so new-model rows born with
   *    commission = 0 still reverse correctly). Every other row (legacy
   *    cost/price-flow SEND, commission_model = 0 rows with commission = 0)
   *    was ALREADY `is_settled = 1` before this settlement, independent of
   *    `settlement_id` — resetting it would un-realize profit this
   *    settlement never gated in the first place.
   *
   * The SETTLEMENT ledger row itself soft-voids for free via the generic
   * `_markSourceRefunded('supplier_ledger', original.source_id)` step that
   * already runs for every voided/refunded transaction — under the fee-only
   * model that single soft-void is now sufficient to net the ledger back to
   * its pre-settlement (TOP_UP-only) balance, since there is no second
   * (SUPPLIER_PAYS_US) row masking it anymore. The net-payment legs
   * (settleTransactions step 4) DO write real `payments` rows through a real
   * payment-method drawer — under the Primary Cash Drawer plan (§1
   * "Settlement identity") a CASH leg for the primary provider now DOES
   * resolve to `OMT_System`/`Whish_System` (the PCD) instead of General, but
   * `_reversePayments` mirrors whatever `drawer_name` the row actually
   * carries and is drawer-agnostic by design (CLAUDE.md rule 20's generic
   * path), so the generic `_reversePayments` already reverses them for free
   * either way, with no bespoke step needed here.
   * `_assertSupplierSiblingsVoidable` (LIRA-091) already prevents any of
   * this settlement's `financial_service_ids` from being independently
   * voided/refunded while `settlement_id` stays stamped — once this method
   * clears it, those rows become correctable again too, by design (no new
   * guard needed for that direction).
   *
   * COMMISSION_AT_SETTLEMENT_PLAN.md D5/D6 (Phase 0) — a NEW-MODEL
   * (`commission_model` = 1) settlement DOES fund a real commission credit
   * again — the fee-only-model paragraph above is about the OLD embedded-
   * commission float, unrelated to this. This reversal method itself needs
   * NO bespoke code for either shape:
   *
   *   - Non-bills new-model batches (`SUPPLIER_PAYS_US`,
   *     `SupplierRepository._bookCommissionAtSettlement`'s original branch):
   *     that credit row is soft-voided for FREE by step 5c's existing
   *     LIRA-091 sibling cascade (linked via the SAME `source_ref_table`/
   *     `source_ref_id` shape as every other auto supplier sibling).
   *   - Bills-only batches (BILL_COMMISSION_SETTLEMENT_PLAN.md, LIRA-137) —
   *     the commission posts as a `payments` leg ON THIS SAME settlement
   *     transaction (`_bookBillsCommissionDrawerTopUp`, no `supplier_ledger`
   *     row at all) — reversed for FREE by the generic `_reversePayments`
   *     step that already runs for every voided/refunded transaction
   *     (rule 20); the transaction's own `profit_usd`/`profit_lbp` nets to 0
   *     the same generic way every other transaction's profit does.
   *
   * Either way, this method additionally deletes the settlement's
   * `supplier_settlements` + `settlement_commission_allocations` rows
   * (`_reverseCommissionAtSettlementRecords` — no soft-void column exists on
   * either table, so DELETE is the correct reversal, not a compensating row).
   *
   * LIRA-189 (OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §5/§9.4) — generalized for the
   * OMT ACCOUNT settlement (`SupplierRepository.settleAccount`), which
   * settles the counter + OMT App + iPick TOGETHER under ONE
   * SUPPLIER_SETTLEMENT transaction but writes ONE per-child PAYMENT/
   * SUPPLIER_PAYS_US `supplier_ledger` row PER CHILD touched (contract §1 —
   * never a single lump row on the parent, or one child stays overpaid and
   * another unpaid). That is N ledger rows under ONE transaction, where the
   * legacy single-supplier `settleTransactions` writes exactly one. The
   * primitive that makes both shapes reversible by the SAME code is already
   * proven by `settleTransactions` itself: its "Link ledger entry to unified
   * transaction" step stamps `supplier_ledger.transaction_id = <the
   * settlement's own transaction id>` on its lone SETTLEMENT row — i.e. that
   * row is findable BOTH by `original.source_id` (today's convention) AND by
   * `transaction_id = original.id`. Querying by `transaction_id = original.id`
   * therefore finds every per-child row an account settlement wrote for
   * free, while degrading to exactly the one row `original.source_id` already
   * named for an ordinary single-supplier settlement — NO behavior change
   * for `settleTransactions`, proven by that identity rather than assumed.
   * `original.source_id` is unioned in defensively (never assume
   * `transaction_id` was set on every row an as-yet-unlanded `settleAccount`
   * writes) so a settlement whose parent has no debt of its own (all debt on
   * children, no assumed parent row to anchor to — §1's own constraint)
   * still fully reverses as long as EITHER link names it.
   *
   * Each per-child row this settlement wrote is itself the anchor other
   * tables' settlement markers point at — exactly like `original.source_id`
   * already was for the single-row case:
   *   - `financial_services.settlement_id` (the OMT counter's own rows —
   *     the only child with FINANCIAL_SERVICE-kind selections) — the
   *     existing un-stamp loop below is untouched, only WHERE-scoped to
   *     every per-child id instead of the one `original.source_id`.
   *   - `supplier_ledger.settlement_id` (v176 — a RAW ledger row directly
   *     selected as D8's LEDGER-kind: iPick/OMT App TOP_UP rows, or an OMT
   *     App WALLET_CASHOUT PAYMENT row) — reset to NULL so the row re-enters
   *     the unsettled queue, mirroring the financial_services un-stamp.
   *     Schema-drift-guarded (`_supplierLedgerHasSettlementIdColumn`) for
   *     every fixture in this file that predates v176.
   *   - the settlement's OWN N per-child rows are soft-voided (is_refunded),
   *     never un-stamped — they are what THIS settlement wrote, not what it
   *     merely marked. The generic step 4 in `_voidTransactionInternal`/
   *     `refundTransaction` (`_markSourceRefunded('supplier_ledger',
   *     original.source_id)`) already does this for the ONE row
   *     `original.source_id` names; this method covers the rest.
   *
   * Deferred cashout commission (D14, §8.3a): summed and stamped onto THIS
   * settlement transaction's own `profit_usd`/`profit_lbp` by `settleAccount`
   * — needs NO bespoke reversal here. A VOID flips `original.status` to
   * VOIDED and its reversal row carries no profit columns at all (profit
   * aggregation reads ACTIVE rows only, so the original's profit simply
   * stops counting); a REFUND's reversal row explicitly negates
   * `profit_usd`/`profit_lbp` from the original (see the REFUND INSERT a few
   * hundred lines up). Both are the SAME generic mechanism every other
   * transaction's profit reversal already uses — this method never touches
   * `transactions.profit_usd`/`profit_lbp` directly.
   */
  private _reverseSupplierSettlement(
    original: TransactionEntity,
    userId: number,
  ): void {
    if (original.type !== "SUPPLIER_SETTLEMENT") {
      return;
    }
    const tenantId = getCurrentTenantId();

    // Every supplier_ledger row THIS settlement transaction wrote — see the
    // doc comment above for why `transaction_id = original.id` alone already
    // covers `settleTransactions`' single-row shape, and `original.source_id`
    // is unioned in defensively for a not-yet-landed `settleAccount` shape
    // that might not set `transaction_id` on every row it writes.
    const linkedLedgerRows =
      original.source_table === "supplier_ledger" && original.source_id != null
        ? this.query<{ id: number }>(
            `SELECT id FROM supplier_ledger
             WHERE (transaction_id = ? OR id = ?) AND tenant_id = ?`,
            original.id,
            original.source_id,
            tenantId,
          )
        : this.query<{ id: number }>(
            `SELECT id FROM supplier_ledger WHERE transaction_id = ? AND tenant_id = ?`,
            original.id,
            tenantId,
          );
    if (linkedLedgerRows.length === 0) {
      return;
    }
    const settlementLedgerIds = linkedLedgerRows.map((r) => r.id);
    const idPlaceholders = settlementLedgerIds.map(() => "?").join(",");

    // Soft-void every per-child settlement row this batch wrote — the
    // generic step 4 (`_markSourceRefunded`) already did this for the ONE
    // row `original.source_id` names; re-touching it here is a harmless
    // idempotent no-op (`is_refunded = 0` guard).
    this.execute(
      `UPDATE supplier_ledger SET is_refunded = 1, refunded_at = CURRENT_TIMESTAMP
       WHERE id IN (${idPlaceholders}) AND tenant_id = ? AND is_refunded = 0`,
      ...settlementLedgerIds,
      tenantId,
    );

    // Un-stamp financial_services rows THIS exact settlement touched —
    // scoped by settlement_id IN (every per-child row this batch wrote),
    // never the metadata id list (only settlement_id proves a row STILL
    // belongs to exactly this settlement at reversal time). Reduces to the
    // original `= original.source_id` behavior when only one id exists.
    const settled = this.query<{
      id: number;
      provider: string;
      service_type: string;
      commission: number;
      commission_model: number;
    }>(
      `SELECT id, provider, service_type, commission, commission_model FROM financial_services
       WHERE settlement_id IN (${idPlaceholders}) AND tenant_id = ?`,
      ...settlementLedgerIds,
      tenantId,
    );
    for (const fs of settled) {
      // COMMISSION_AT_SETTLEMENT_PLAN.md D2 — branch on the ONE shared
      // pending-settlement predicate (isPendingSupplierSettlement), not on
      // `commission > 0` directly. See its doc comment
      // (FinancialServiceRepository.ts) for why the old inline condition
      // breaks for new-model rows.
      //
      // LIRA-112 (D12) — `supplierCommissionEligible: true` here is a proven
      // invariant, not a re-derivation: this row has settlement_id SET,
      // meaning it was actually selected out of `getUnsettledBySupplier`'s
      // queue and successfully settled — a commission-ineligible supplier's
      // BILL (e.g. iPick) never enters that queue post-LIRA-112, so it can
      // never reach this loop. No new supplier lookup needed.
      const wasPendingSettlement = isPendingSupplierSettlement({
        ...fs,
        supplierCommissionEligible: true,
      });
      if (wasPendingSettlement) {
        this.execute(
          `UPDATE financial_services SET settlement_id = NULL, is_settled = 0, settled_at = NULL
           WHERE id = ? AND tenant_id = ?`,
          fs.id,
          tenantId,
        );
      } else {
        this.execute(
          `UPDATE financial_services SET settlement_id = NULL
           WHERE id = ? AND tenant_id = ?`,
          fs.id,
          tenantId,
        );
      }
    }

    // LIRA-189 (v176) — un-stamp raw supplier_ledger rows (D8's selectable
    // queue: iPick/OMT App TOP_UP rows, or an OMT App WALLET_CASHOUT PAYMENT
    // row) this batch marked settled. Excludes the settlement's OWN
    // per-child rows (settlementLedgerIds) — those are soft-voided above,
    // not un-stamped; a soft-voided row's settlement_id is irrelevant since
    // is_refunded already excludes it from every balance/queue read.
    // Schema-drift guarded like every other supplier_ledger column check in
    // this file — a hand-rolled pre-v176 jest fixture has no such column.
    if (this._supplierLedgerHasSettlementIdColumn()) {
      this.execute(
        `UPDATE supplier_ledger SET settlement_id = NULL
         WHERE settlement_id IN (${idPlaceholders}) AND id NOT IN (${idPlaceholders}) AND tenant_id = ?`,
        ...settlementLedgerIds,
        ...settlementLedgerIds,
        tenantId,
      );
    }

    // COMMISSION_AT_SETTLEMENT_PLAN.md D5/D6, rule 20 — the commission
    // credit ledger row itself (SUPPLIER_PAYS_US) is already soft-voided for
    // FREE by step 5c's generic LIRA-091 sibling cascade
    // (`_cascadeSupplierSiblingVoid`, which runs BEFORE this method and is
    // keyed off THIS exact `source_table`/`source_id` — the shape
    // `SupplierRepository._bookCommissionAtSettlement` links it with). What
    // remains: the derived audit/reporting records this settlement wrote —
    // per per-child ledger row, since an account settlement may stamp one
    // `supplier_settlements` record PER child (each keyed by ITS OWN
    // ledger_entry_id, `supplier_settlements.ledger_entry_id` being UNIQUE),
    // not just the one `original.source_id` named.
    for (const ledgerId of settlementLedgerIds) {
      this._reverseCommissionAtSettlementRecords(ledgerId, tenantId);
    }
  }

  /**
   * SUPPLIER_STOCK_INTAKE_PLAN.md, rule 20 reversal owner for
   * SUPPLIER_STOCK_INTAKE — and, since LIRA-087 (migration v189), for
   * SUPPLIER_RECORDED_DEBT too (type-widened below, rule 14: one reversal
   * routine for both, since an ATTACHED recorded debt's cost batch links to
   * its transaction_id exactly the same way a one-step intake's does —
   * `StockBatchRepository.findByTransactionId` cannot tell the two apart,
   * and doesn't need to). For an UNATTACHED recorded debt there is no batch
   * to find, so this is a pure no-op below (the ledger row still soft-voids
   * for free, same as every other type). The `supplier_ledger` row itself
   * soft-voids for
   * FREE via the generic `_markSourceRefunded('supplier_ledger',
   * original.source_id)` step every voided/refunded transaction already
   * runs (`source_table` is `'supplier_ledger'` for this type, same as
   * SUPPLIER_SETTLEMENT above) — there is no drawer/payments leg to reverse
   * either (this type funds no payments row, see the plan's cash-flow-badge
   * note). What is bespoke here is the BATCH this intake created:
   *
   * `StockBatchRepository.deleteBatchForVoid` REFUSES (returns `false`) when
   * any unit of the batch has already been consumed by a sale
   * (`quantity_remaining < quantity`) — a batch a sale already drew its cost
   * from cannot be silently erased without leaving that sale's
   * `cost_price_snapshot_usd` pointing at nothing. This method must REFUSE
   * THE WHOLE VOID/REFUND in that case (throw, not silently skip), naming
   * how many units were already sold so the operator understands why the
   * void is blocked — mirroring `_assertLotoTicketVoidable`/
   * `_assertSupplierSiblingsVoidable`'s "throw before any write happens"
   * shape used elsewhere in this file for the same reason (this repo's
   * `voidTransaction`/`refundTransaction` wrap every step in one
   * `this.transaction(...)`, so throwing here rolls back the reversal
   * transaction row + `_markSourceRefunded` this same call already wrote,
   * exactly like any other guard failure mid-sequence).
   *
   * On success (batch untouched or already void — no batch found is a
   * silent no-op, e.g. a legacy/hand-crafted transaction with no linked
   * batch row), owner decision D10: voiding a delivery takes that stock back
   * OUT — `products.stock_quantity` is lowered by the batch's original
   * `quantity` (not `quantity_remaining`, which for an untouched batch is
   * the same number, but naming the field that means "what this delivery
   * added" is the correct one to subtract).
   */
  private _reverseSupplierStockIntake(original: TransactionEntity): void {
    if (
      (original.type !== "SUPPLIER_STOCK_INTAKE" &&
        original.type !== "SUPPLIER_RECORDED_DEBT") ||
      original.source_table !== "supplier_ledger" ||
      original.source_id == null
    ) {
      return;
    }
    const tenantId = getCurrentTenantId();
    const batchRepo = getStockBatchRepository();
    const batch = batchRepo.findByTransactionId(original.id);
    if (!batch) return;

    const alreadySold = batch.quantity - batch.quantity_remaining;
    const deleted = batchRepo.deleteBatchForVoid(batch.id);
    if (!deleted) {
      throw new BusinessRuleError(
        `Cannot void this stock intake — ${alreadySold} unit(s) from this delivery have already been sold`,
      );
    }

    this.execute(
      `UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ? AND tenant_id = ?`,
      batch.quantity,
      batch.product_id,
      tenantId,
    );
  }

  /**
   * EXCHANGE_LOT_SETTLEMENT.md rule 20 reversal owner for an EXCHANGE
   * transaction's lot side effects — mirrors `_reverseSupplierSettlement`'s
   * template shape. Two independent, order-agnostic effects, both keyed off
   * this transaction's OWN `source_id` (never the reversal/refund row's id —
   * same convention every other `_reverseX` method here follows):
   *
   * 1. `restoreSettlements` — un-consumes whatever THIS exchange, acting as a
   *    SELL, took from someone else's lot: credits `remaining_qty` back and
   *    flags each settlement `is_refunded = 1`. Idempotent (a second call
   *    finds no more ACTIVE rows), so a for-partner sell's reversal composes
   *    for free with no special-casing.
   * 2. `voidLotsBySource` — voids whatever lot THIS exchange, acting as a
   *    BUY, created. Safe unconditionally: `_assertExchangeLotsVoidable`
   *    above already proved that lot carries no active settlement before
   *    this method is ever reached.
   *
   * Both calls are no-ops (match zero rows) for a currency pair that never
   * touched a lot (USD<->LBP) or for whichever side of THIS exchange wasn't
   * exotic — there is nothing conditional to branch on here, unlike the
   * guard's `hasActiveSettlements` check, because voiding/restoring
   * non-existent rows is already a correct no-op by construction. A no-op
   * for every non-EXCHANGE type, and (same reasoning as
   * `_assertExchangeLotsVoidable`) when the lot tables don't exist at all on
   * this connection.
   */
  private _reverseExchangeLotEffects(original: TransactionEntity): void {
    if (
      original.type !== "EXCHANGE" ||
      original.source_table !== "exchange_transactions" ||
      original.source_id == null ||
      !this._exchangeLotTablesExist()
    ) {
      return;
    }
    const lotRepo = getExchangeLotRepository();
    lotRepo.restoreSettlements({
      settledByTable: "exchange_transactions",
      settledById: original.source_id,
    });
    lotRepo.voidLotsBySource({
      sourceTable: "exchange_transactions",
      sourceId: original.source_id,
    });
  }

  /**
   * LIRA-143 phase 4, rule 20 — reversal owner for a SALE's `product_units`
   * side effects: every SOLD unit tied to this sale's `sale_items` flips
   * back to IN_STOCK, the unit-tracked counterpart to `_restoreStock`'s
   * quantity restore.
   *
   * `unitExtras` (refund-only — void never passes any) let the operator set
   * a returned unit's `is_defective`/`warranty_override_until` at the SAME
   * moment it flips back to stock. Originally wired only from the
   * Transactions page's whole-refund flow (owner decision 2026-07-04); the
   * 2026-09-26 owner decision extended the SAME "Returned phones" flagging
   * to the POS refund window (`SaleDetailModal`'s "Refund Sale" — via
   * `refundBySaleId`'s `opts.refundUnitExtras` below — and "Refund item" —
   * via `SalesRepository.refundSaleItem`'s own `unitExtras`, validated
   * against that ONE item's linked units instead of the whole sale's). Every
   * `unit_id` is validated against
   * this sale's own linked-unit set BEFORE any unit is touched —
   * `_validateRefundUnitExtras` — so an id from another sale (operator
   * error) throws before any partial effect, same discipline as
   * `_validateRefundLegOverride`.
   *
   * `ProductUnitRepository.markInStock` is idempotent by design: a unit an
   * EARLIER per-item refund (`SalesRepository.refundSaleItem`) already
   * flipped back to IN_STOCK is excluded by this method's own `status =
   * 'SOLD'` query below, so a later whole-sale void/refund simply finds
   * nothing left to flip for it — UNLESS extras were supplied for that same
   * unit, in which case the flag-only branch below applies them directly
   * (status stays IN_STOCK; only is_defective/warranty_override_until move).
   *
   * A no-op (before any write) for every non-SALE transaction, and when the
   * `product_units` table doesn't exist on this connection — every real DB
   * has carried it since migration v157, but this guard fires for EVERY
   * sale void/refund, including one that never touched a registered unit; a
   * minimal hand-rolled test schema predating this feature must not have
   * every sale void/refund start hard-crashing over a table it only reads
   * defensively.
   */
  private _reverseProductUnits(
    original: TransactionEntity,
    unitExtras?: RefundUnitExtra[],
  ): void {
    if (
      original.source_table !== "sales" ||
      original.source_id == null ||
      !this._productUnitsTableExists()
    ) {
      return;
    }
    const tenantId = getCurrentTenantId();

    // Validate BEFORE any flip — every unit_id must belong to THIS sale's
    // linked-unit set, never a foreign sale's unit (operator error, not data
    // to half-apply).
    if (unitExtras && unitExtras.length > 0) {
      this._validateRefundUnitExtras(original.source_id, unitExtras);
    }

    const soldUnits = this.query<{ id: number }>(
      `SELECT pu.id FROM product_units pu
       JOIN sale_items si ON si.id = pu.sale_item_id AND si.tenant_id = pu.tenant_id
       WHERE si.sale_id = ? AND pu.tenant_id = ? AND pu.status = 'SOLD'`,
      original.source_id,
      tenantId,
    );

    const extrasByUnitId = new Map<number, RefundUnitExtra>();
    for (const extra of unitExtras ?? []) {
      extrasByUnitId.set(extra.unit_id, extra);
    }

    const productUnitRepo = getProductUnitRepository();
    for (const { id } of soldUnits) {
      const extra = extrasByUnitId.get(id);
      productUnitRepo.markInStock(id, {
        isDefective: extra?.is_defective,
        warrantyOverrideUntil: extra?.warranty_override_until,
      });
      extrasByUnitId.delete(id);
    }

    // Anything left in `extrasByUnitId` targets a unit already flipped back
    // to IN_STOCK by an earlier per-item refund (excluded from `soldUnits`
    // above, whose WHERE clause is `status = 'SOLD'` only) — apply the flags
    // directly via a guarded UPDATE that never touches `status`.
    for (const [unitId, extra] of extrasByUnitId) {
      const setClauses: string[] = ["updated_at = CURRENT_TIMESTAMP"];
      const params: unknown[] = [];
      if (extra.is_defective !== undefined) {
        setClauses.push("is_defective = ?");
        params.push(extra.is_defective ? 1 : 0);
      }
      if (extra.warranty_override_until !== undefined) {
        setClauses.push("warranty_override_until = ?");
        params.push(extra.warranty_override_until);
      }
      if (setClauses.length === 1) continue; // nothing besides updated_at to set
      params.push(unitId, tenantId);
      this.execute(
        `UPDATE product_units SET ${setClauses.join(", ")} WHERE id = ? AND tenant_id = ?`,
        ...params,
      );
    }
  }

  /**
   * Throws BEFORE any unit is flipped if any `unit_id` in `unitExtras` isn't
   * part of THIS sale's linked-unit set — a `product_units` row whose
   * `sale_item_id` points at one of `saleId`'s own `sale_items`, regardless
   * of current status (a currently-SOLD unit awaiting this flip, OR one an
   * earlier per-item refund already flipped back to IN_STOCK — both are
   * legitimate extras targets, see `_reverseProductUnits`'s flag-only
   * branch). An id belonging to another sale is operator error, not data to
   * half-apply — same discipline as `_validateRefundLegOverride`.
   */
  private _validateRefundUnitExtras(
    saleId: number,
    unitExtras: RefundUnitExtra[],
  ): void {
    const tenantId = getCurrentTenantId();
    const linkedUnitIds = new Set(
      this.query<{ id: number }>(
        `SELECT pu.id FROM product_units pu
         JOIN sale_items si ON si.id = pu.sale_item_id AND si.tenant_id = pu.tenant_id
         WHERE si.sale_id = ? AND pu.tenant_id = ?`,
        saleId,
        tenantId,
      ).map((r) => r.id),
    );
    validateRefundUnitExtras(linkedUnitIds, unitExtras, saleId, "sale");
  }

  /**
   * COMMISSION_AT_SETTLEMENT_PLAN.md D5/D6, rule 20 — `supplier_settlements`
   * and `settlement_commission_allocations` have no soft-void column of
   * their own (unlike `supplier_ledger`'s `is_refunded`) — they are pure
   * derived/reporting records with no independent existence once their
   * settlement is voided, so the correct reversal is to DELETE them (not a
   * compensating row, not a flag). The permanent audit trail for "a
   * settlement happened and was voided" lives entirely on the
   * `supplier_ledger` rows (the SETTLEMENT row + the commission credit),
   * which stay forever with `is_refunded = 1` — this method never touches
   * them.
   *
   * Defensive against a pre-v150 connected schema (no such tables at all —
   * same schema-drift-guard shape as every other one in this file): a
   * no-op, which is exactly correct — a settlement on such a schema could
   * never have written to these tables in the first place.
   */
  private _reverseCommissionAtSettlementRecords(
    settlementLedgerId: number,
    tenantId: number,
  ): void {
    const hasAllocationsTable = this.db
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'settlement_commission_allocations'`,
      )
      .get();
    if (hasAllocationsTable) {
      this.execute(
        `DELETE FROM settlement_commission_allocations WHERE settlement_ledger_id = ? AND tenant_id = ?`,
        settlementLedgerId,
        tenantId,
      );
    }

    const hasSettlementsTable = this.db
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'supplier_settlements'`,
      )
      .get();
    if (hasSettlementsTable) {
      this.execute(
        `DELETE FROM supplier_settlements WHERE ledger_entry_id = ? AND tenant_id = ?`,
        settlementLedgerId,
        tenantId,
      );
    }
  }

  /**
   * Refuse a LOTO ticket void/refund up-front (before any write) if the
   * ticket's own checkpoint has already been SETTLED. `LotoCheckpointRepository
   * .settleCheckpoint` freezes `total_sales`/`total_commission`/`total_tickets`/
   * `total_prizes` into the settlement's net-to-zero math (`netSettlement =
   * totalCommission (+ totalCashPrizes) - totalSales`, stamped verbatim onto
   * the SETTLEMENT ledger row) — adjusting a ticket's contribution after that
   * point would desync the checkpoint's frozen totals from a settlement
   * that's already posted, and nothing in this repository can retroactively
   * re-post it. Blocking beats corrupting (same philosophy as
   * `_assertSupplierSiblingsVoidable`, LIRA-091) — the owner corrects a
   * mis-settled ticket with a manual supplier adjustment instead.
   *
   * A ticket that was never checkpointed (`checkpoint_id IS NULL`), or is
   * sitting in a checkpoint that hasn't settled yet, stays reversible —
   * `_reverseLotoSupplierLedger` (below) delta-adjusts the still-open
   * checkpoint's totals so ITS eventual settlement stays correct.
   */
  private _assertLotoTicketVoidable(original: TransactionEntity): void {
    if (
      original.type !== "LOTO" ||
      original.source_table !== "loto_tickets" ||
      original.source_id == null
    ) {
      return;
    }
    const tenantId = getCurrentTenantId();
    const row = this.queryOne<{
      checkpoint_id: number | null;
      is_settled: number | null;
      settlement_id: number | null;
      checkpoint_date: string | null;
    }>(
      `SELECT lc.id AS checkpoint_id, lc.is_settled, lc.settlement_id, lc.checkpoint_date
         FROM loto_tickets lt
         LEFT JOIN loto_checkpoints lc ON lc.id = lt.checkpoint_id AND lc.tenant_id = lt.tenant_id
        WHERE lt.id = ? AND lt.tenant_id = ?`,
      original.source_id,
      tenantId,
    );
    if (!row || row.checkpoint_id == null) return; // never checkpointed → reversible
    if (row.is_settled) {
      const when = row.checkpoint_date ? ` on ${row.checkpoint_date}` : "";
      throw new DatabaseError(
        `Cannot void/refund — this ticket's checkpoint #${row.checkpoint_id} has already been settled${when} (settlement #${row.settlement_id ?? "?"}); correct the supplier balance with a manual adjustment instead.`,
        { entityId: original.id },
      );
    }
  }

  /**
   * Reversal owner (rule 20) for a LOTO ticket sale's `supplier_ledger`
   * TOP_UP row — the one gap the generic void/refund path doesn't already
   * cover for a ticket sale. Everything else a ticket writes is handled
   * generically: `loto_tickets.is_refunded` by `_markSourceRefunded` (v68),
   * the `payments`/drawer legs by `_reversePayments`, the 'Loto Debt'
   * `debt_ledger` row by `_cancelDebt` (`MODULE_DEBT_TRANSACTION_TYPES`), and
   * any FOR_LOTO `partner_ledger` row by `_reversePartnerLedger`. Only the
   * TOP_UP row has no owner: `LotoTicketRepository.createTicket` (CQ-7,
   * a3d09e7, 2026-07-19) writes it in LINK mode
   * (`addLedgerEntry({ transaction_id: txnId })`), not as an
   * `is_auto`/`source_ref_*` sibling, so it is invisible to both
   * `_cascadeSupplierSiblingVoid` and `_assertSupplierSiblingsVoidable` (they
   * only ever scan `is_auto = 1` rows).
   *
   * By the time this runs, `_assertLotoTicketVoidable` has already refused a
   * settled checkpoint before `this.transaction()` even opened, so everything
   * below only ever touches an uncheckpointed ticket or a still-open one.
   *
   * 1. Soft-void (house convention — see `_reverseSupplierSettlement` step 2)
   *    the TOP_UP row keyed on `transaction_id = original.id`: the id
   *    `createTicket` stamped it with at sale time, never the new reversal
   *    row's id — the reversal row never gets a `supplier_ledger` row of its
   *    own, so there is nothing here to mis-target. Re-entrancy is closed
   *    upstream, not by this predicate: voiding an already-VOIDED row throws
   *    before reaching this method, and `_assertReversible` refuses to
   *    void/refund a row that already carries `reverses_id`, so the reversal
   *    row itself can never reach `_reverseLotoSupplierLedger` a second time.
   *    `COALESCE(is_refunded, 0) = 0` is belt-and-suspenders idempotency, the
   *    same guard `_reverseSupplierSettlement` uses.
   *
   * 2. If the ticket sits in a checkpoint that hasn't settled (a settled one
   *    was already blocked above), delta-adjust that checkpoint's frozen
   *    totals by exactly this ticket's own contribution: `total_sales`,
   *    `total_commission`, and `total_tickets` always; `total_prizes` only
   *    when `is_winner = 1` — mirroring
   *    `LotoTicketRepository.getUncheckpointedTotals`'s own
   *    `CASE WHEN is_winner = 1 THEN prize_amount ELSE 0 END` so an unwon
   *    ticket contributes (and so subtracts) 0. This keeps that checkpoint's
   *    OWN future `settleCheckpoint` call — which trusts caller-supplied
   *    totals verbatim — net-to-zero against the now-void ticket's balance
   *    contribution. `total_cash_prizes`/`total_cash_prizes_count` are left
   *    untouched: LOTO_CASH_PRIZE is a separate table/flow, out of scope here.
   */
  private _reverseLotoSupplierLedger(original: TransactionEntity): void {
    if (
      original.type !== "LOTO" ||
      original.source_table !== "loto_tickets" ||
      original.source_id == null
    ) {
      return;
    }
    const tenantId = getCurrentTenantId();

    // 1. Soft-void the link-mode TOP_UP row this ticket sale created.
    this.execute(
      `UPDATE supplier_ledger SET is_refunded = 1, refunded_at = CURRENT_TIMESTAMP
        WHERE transaction_id = ? AND entry_type = 'TOP_UP' AND COALESCE(is_refunded, 0) = 0 AND tenant_id = ?`,
      original.id,
      tenantId,
    );

    // 2. Delta-adjust an unsettled checkpoint (a settled one was already
    // blocked by _assertLotoTicketVoidable before this transaction opened).
    const ticket = this.queryOne<{
      checkpoint_id: number | null;
      sale_amount: number;
      commission_amount: number;
      is_winner: number;
      prize_amount: number;
    }>(
      `SELECT checkpoint_id, sale_amount, commission_amount, is_winner, prize_amount
         FROM loto_tickets WHERE id = ? AND tenant_id = ?`,
      original.source_id,
      tenantId,
    );
    if (ticket?.checkpoint_id != null) {
      this.execute(
        `UPDATE loto_checkpoints
            SET total_sales = total_sales - ?,
                total_commission = total_commission - ?,
                total_tickets = total_tickets - 1,
                total_prizes = total_prizes - ?,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND is_settled = 0 AND tenant_id = ?`,
        ticket.sale_amount,
        ticket.commission_amount,
        ticket.is_winner ? ticket.prize_amount : 0,
        ticket.checkpoint_id,
        tenantId,
      );
    }
  }

  /**
   * LIRA-201c (OWNER_NOTES_REMAINING_BUILD.md #11-C), rule 20 — refuse a
   * LOTO_CASH_PRIZE basket-member void/refund up-front (before any write) if
   * the prize was already reimbursed by LOTO, or its checkpoint has already
   * settled — mirroring `_assertLotoTicketVoidable`'s identical rationale
   * (a settled checkpoint's frozen `total_cash_prizes` cannot be safely
   * adjusted after the fact) plus the owner's own extra case for a prize:
   * `LotoCashPrizeRepository.markCashPrizeReimbursed` can stamp
   * `is_reimbursed = 1` independently of any checkpoint (a supplier
   * settlement can mark specific prizes reimbursed directly), so BOTH gates
   * are checked, with the SAME owner-worded message either way: "This prize
   * was already settled with Loto on <date>. Fix it from the Loto page."
   * Only ever reached via `allowSessionMember: true` — a solo
   * LOTO_CASH_PRIZE never gets this far (`_assertReversible` still throws
   * its generic NON_REVERSIBLE message first).
   */
  private _assertLotoCashPrizeVoidable(original: TransactionEntity): void {
    if (
      original.type !== "LOTO_CASH_PRIZE" ||
      original.source_table !== "loto_cash_prizes" ||
      original.source_id == null
    ) {
      return;
    }
    const tenantId = getCurrentTenantId();
    const prize = this.queryOne<{
      is_reimbursed: number;
      reimbursed_date: string | null;
      checkpoint_id: number | null;
      is_settled: number | null;
      checkpoint_date: string | null;
    }>(
      `SELECT p.is_reimbursed AS is_reimbursed, p.reimbursed_date AS reimbursed_date,
              lc.id AS checkpoint_id, lc.is_settled AS is_settled, lc.checkpoint_date AS checkpoint_date
         FROM loto_cash_prizes p
         LEFT JOIN loto_checkpoints lc ON lc.id = p.checkpoint_id AND lc.tenant_id = p.tenant_id
        WHERE p.id = ? AND p.tenant_id = ?`,
      original.source_id,
      tenantId,
    );
    if (!prize) return;
    if (prize.is_reimbursed) {
      const when = prize.reimbursed_date ? ` on ${prize.reimbursed_date}` : "";
      throw new DatabaseError(
        `This prize was already settled with Loto${when}. Fix it from the Loto page.`,
        { entityId: original.id },
      );
    }
    if (prize.checkpoint_id != null && prize.is_settled) {
      const when = prize.checkpoint_date ? ` on ${prize.checkpoint_date}` : "";
      throw new DatabaseError(
        `This prize was already settled with Loto${when}. Fix it from the Loto page.`,
        { entityId: original.id },
      );
    }
  }

  /**
   * LIRA-201c, rule 20 — reversal owner for a LOTO_CASH_PRIZE basket member
   * (the "solo type can stay NON_REVERSIBLE" bypass — see
   * `SESSION_BASKET_BYPASSABLE_NON_REVERSIBLE_TYPES`). Everything else a
   * prize writes is handled generically once the NON_REVERSIBLE bypass
   * applies: the `payments`/drawer leg (when the prize wasn't created under
   * `deferPayment`) by `_reversePayments`. Two things have no generic owner:
   *
   * 1. Soft-void the `supplier_ledger` CASH_PRIZE row this prize created
   *    (`LotoCashPrizeRepository.createCashPrize` writes it in LINK mode,
   *    `transaction_id: txnId` — same convention `_reverseLotoSupplierLedger`
   *    closes for a LOTO ticket's TOP_UP row, invisible to
   *    `_cascadeSupplierSiblingVoid`/`_assertSupplierSiblingsVoidable`, which
   *    only ever scan `is_auto = 1` rows).
   * 2. Mark `loto_cash_prizes.voided = 1` (migration v181) so prize
   *    totals/checkpoint gathering (`LotoCashPrizeRepository`'s
   *    `NOT_VOIDED_CASH_PRIZE_SQL`-gated queries) stop counting it — the
   *    owner's "Prize totals and checkpoints must exclude voided prizes".
   *
   * By the time this runs, `_assertLotoCashPrizeVoidable` has already
   * refused an already-reimbursed prize or a settled checkpoint before
   * `this.transaction()` even opened, so an unsettled checkpoint's totals
   * are still safe to delta-adjust here — same shape as
   * `_reverseLotoSupplierLedger`'s ticket-checkpoint delta-adjust.
   */
  private _reverseLotoCashPrize(original: TransactionEntity): void {
    if (
      original.type !== "LOTO_CASH_PRIZE" ||
      original.source_table !== "loto_cash_prizes" ||
      original.source_id == null
    ) {
      return;
    }
    const tenantId = getCurrentTenantId();

    // 1. Soft-void the link-mode CASH_PRIZE row this prize created.
    this.execute(
      `UPDATE supplier_ledger SET is_refunded = 1, refunded_at = CURRENT_TIMESTAMP
        WHERE transaction_id = ? AND entry_type = 'CASH_PRIZE' AND COALESCE(is_refunded, 0) = 0 AND tenant_id = ?`,
      original.id,
      tenantId,
    );

    // 2. Mark the prize voided, and delta-adjust an unsettled checkpoint (a
    // settled one was already blocked by _assertLotoCashPrizeVoidable
    // before this transaction opened).
    const prize = this.queryOne<{
      checkpoint_id: number | null;
      prize_amount: number;
    }>(
      `SELECT checkpoint_id, prize_amount FROM loto_cash_prizes WHERE id = ? AND tenant_id = ?`,
      original.source_id,
      tenantId,
    );
    this.execute(
      `UPDATE loto_cash_prizes
          SET voided = 1, voided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND tenant_id = ?`,
      original.source_id,
      tenantId,
    );
    if (prize?.checkpoint_id != null) {
      this.execute(
        `UPDATE loto_checkpoints
            SET total_cash_prizes = total_cash_prizes - ?,
                total_cash_prizes_count = total_cash_prizes_count - 1,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND is_settled = 0 AND tenant_id = ?`,
        prize.prize_amount,
        prize.checkpoint_id,
        tenantId,
      );
    }
  }

  /**
   * LIRA-194, rule 20 — reversal owner for `RechargeRepository
   * .topUpFromSupplier`'s `supplier_ledger` TOP_UP row. That row is written
   * in LINK MODE (`addLedgerEntry({ transaction_id: txnId })`), not as an
   * `is_auto`/`source_ref_*` sibling, so it is invisible to both
   * `_cascadeSupplierSiblingVoid` and `_assertSupplierSiblingsVoidable`
   * (they only ever scan `is_auto = 1` rows) — the exact gap
   * `_reverseLotoSupplierLedger` above already closes for a LOTO ticket
   * sale's own link-mode TOP_UP row.
   *
   * Deliberately GATED to RECHARGE_TOPUP, unlike `_reversePartnerLedger`/
   * `_cascadeSupplierSiblingVoid` (both fully type-agnostic): survey of
   * every `addLedgerEntry` call site with a `transaction_id` (link mode)
   * found `LotoTicketRepository.createTicket` writes its OWN link-mode
   * `entry_type: 'TOP_UP'` row the same shape, on a LOTO transaction —
   * already owned by `_reverseLotoSupplierLedger`, which also delta-adjusts
   * the ticket's checkpoint (a bare soft-void here would be insufficient for
   * it). Keying this method on `entry_type = 'TOP_UP' AND transaction_id = ?`
   * alone, with no type gate, would re-match that SAME row on every LOTO
   * void/refund too; `_reverseLotoSupplierLedger`'s own
   * `COALESCE(is_refunded, 0) = 0` guard means a second UPDATE here would
   * simply match zero rows today — but that's accidental safety from call
   * ORDER, not a contract either method's doc guarantees. The type gate
   * makes the two methods' scopes disjoint by construction instead.
   * (`LotoCashPrizeRepository`'s own link-mode row uses `entry_type:
   * 'CASH_PRIZE'`, not `'TOP_UP'`, and LOTO_CASH_PRIZE stays permanently
   * non-reversible anyway — never reaches either method.)
   *
   * Only `topUpFromSupplier` (iPick/Katsh/OMT_APP) writes a `supplier_ledger`
   * row at all; `topUpApp`, `topUpFromPartner`, and `topUpFromClient` — the
   * other three RECHARGE_TOPUP writers this ticket makes voidable — never
   * touch `supplier_ledger`, so this is a clean no-op for them (the UPDATE
   * simply matches no row).
   *
   * `hasTable` guard is load-bearing here, unlike `_reverseLotoSupplierLedger`
   * (only ever reached from a LOTO fixture, which always declares
   * `supplier_ledger`): RECHARGE_TOPUP is now reversible for ALL FOUR
   * writers, and several of their existing test fixtures never needed a
   * `supplier_ledger` table before this ticket. Mirrors
   * `_reversePartnerLedger`'s identical `sqlite_master` existence check.
   */
  private _reverseSupplierLedgerByTransactionLink(
    original: TransactionEntity,
  ): void {
    if (original.type !== "RECHARGE_TOPUP") return;
    const hasTable = this.db
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'supplier_ledger'`,
      )
      .get();
    if (!hasTable) return;
    const tenantId = getCurrentTenantId();
    this.execute(
      `UPDATE supplier_ledger SET is_refunded = 1, refunded_at = CURRENT_TIMESTAMP
        WHERE transaction_id = ? AND entry_type = 'TOP_UP' AND COALESCE(is_refunded, 0) = 0 AND tenant_id = ?`,
      original.id,
      tenantId,
    );
  }

  /**
   * LIRA-090 §8 — reversal owner for `carrier_line_movements` (rule 20).
   * `carrier_lines` has no `is_refunded` column and is absent from
   * `_markSourceRefunded`'s whitelist, so every automated credit/validity
   * mutation a telecom flow makes (`CarrierLineService.applyMovement` —
   * Only Days credit-return, self-charge) is undone HERE instead.
   *
   * Type-agnostic and keyed purely by `transaction_id` (same shape as
   * `_reversePartnerLedger`, not the type-gated shape of
   * `_reverseLotoSupplierLedger`) — the movements table was deliberately
   * designed so ANY flow that mutates a carrier line can hang a movement
   * off ANY transaction, not just one type. Runs unconditionally on every
   * void/refund; a no-op when the table doesn't exist (hand-rolled test
   * DBs predating v140) or when no movement rows match this transaction.
   *
   * Each unreversed movement is undone via
   * `CarrierLineService.reverseMovement` (H3/M2 fix, 2026-07-30 adversarial
   * review) — which restores `validity_expires_at` from the movement's own
   * stored `previous_validity_expires_at` snapshot verbatim, rather than
   * subtracting `validity_days_delta` off whatever the line's CURRENT
   * expiry happens to be. That closes two bugs the old direct
   * `reverseDelta` call had: (a) it silently skipped the validity restore
   * whenever the current expiry was null, with no error and no log, and
   * (b) even when non-null, a naive subtraction could not undo a forward step
   * that discarded days — §5.2's "already-expired lines extend from today"
   * rebasing then, the LIRA-157 grace rebase and 365-day clip now.
   * `reverseMovement`
   * also marks the movement `is_reversed = 1` itself, atomically with the
   * line update — this method no longer touches either table directly.
   *
   * Reuses `CarrierLineMovementRepository.getUnreversedByTransactionId`
   * (rule 14 — one definition of "unreversed movements for a transaction")
   * instead of hand-rolling the same predicate as a second SQL string.
   *
   * Scoped to `is_reversed = 0` so a defensive re-invocation is a no-op —
   * belt-and-suspenders on top of the fact that `voidTransaction`/
   * `refundTransaction` already refuse to run twice on the same original
   * transaction (their own up-front "already voided"/"already refunded"
   * guards), same convention `_reverseLotoSupplierLedger`'s
   * `COALESCE(is_refunded, 0) = 0` guard uses.
   */
  private _reverseCarrierLineMovements(original: TransactionEntity): void {
    const hasTable = this.db
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'carrier_line_movements'`,
      )
      .get();
    if (!hasTable) return;

    const movements =
      getCarrierLineMovementRepository().getUnreversedByTransactionId(
        original.id,
      );
    if (movements.length === 0) return;

    const carrierLineService = getCarrierLineService();
    for (const m of movements) {
      // LIRA-239 — propagate a refusal (e.g. the LIFO guard in
      // `CarrierLineRepository.reverseMovement`: a later validity movement
      // on the same line is still active) instead of silently swallowing
      // it. The caller (voidTransaction/_refundTransactionInternal) runs
      // this inside its own db transaction, so throwing here rolls the
      // WHOLE void/refund back — the transaction stays ACTIVE and nothing
      // partially reverses, rather than committing a void that quietly
      // left the carrier line's validity/days_owed wrong forever.
      //
      // Coordinator follow-up (2026-09-28) — pass `result.error` through
      // UNDECORATED (no "Failed to reverse carrier line movement #X:"
      // wrap): `reverseMovement`'s LIFO guard now hands back a
      // plain-language, cashier-facing message naming the LINE, not a
      // movement id (`CarrierLineRepository.reverseMovement`'s doc). A
      // wrapper prefix built from the same id the message deliberately
      // stopped mentioning would silently reintroduce the jargon it was
      // fixed to remove — same principle as `selfChargeTelecomItem`'s own
      // "pass the movement's own message through UNDECORATED" comment.
      const result = carrierLineService.reverseMovement(m.id);
      if (!result.success) {
        throw new Error(
          result.error ?? `Failed to reverse carrier line movement #${m.id}`,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Analytics
  // ---------------------------------------------------------------------------

  /**
   * Get a summary of all transactions for a given date.
   */
  getDailySummary(date: string): DailySummary {
    const tenantId = getCurrentTenantId();
    const byType = this.query<{
      type: string;
      count: number;
      total_usd: number;
      total_lbp: number;
    }>(
      `SELECT type,
              COUNT(*) AS count,
              SUM(amount_usd) AS total_usd,
              SUM(amount_lbp) AS total_lbp
       FROM transactions
       WHERE ${localDayExpr("created_at")} = ? AND status = 'ACTIVE' AND tenant_id = ?
       GROUP BY type`,
      date,
      tenantId,
    );

    const voids = this.queryOne<{
      void_count: number;
      void_usd: number;
      void_lbp: number;
    }>(
      `SELECT COUNT(*) AS void_count,
              COALESCE(SUM(amount_usd), 0) AS void_usd,
              COALESCE(SUM(amount_lbp), 0) AS void_lbp
       FROM transactions
       WHERE ${localDayExpr("created_at")} = ? AND status = 'VOIDED' AND tenant_id = ?`,
      date,
      tenantId,
    );

    return {
      date,
      total_usd: byType.reduce((sum, r) => sum + r.total_usd, 0),
      total_lbp: byType.reduce((sum, r) => sum + r.total_lbp, 0),
      by_type: byType,
      void_count: voids?.void_count ?? 0,
      void_usd: voids?.void_usd ?? 0,
      void_lbp: voids?.void_lbp ?? 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Debt Aging
  // ---------------------------------------------------------------------------

  /**
   * Get debt aging buckets for a specific client.
   * Buckets: current (0-30 days), 31-60, 61-90, over 90.
   */
  getClientDebtAging(clientId: number): DebtAgingBuckets {
    const tenantId = getCurrentTenantId();
    // Finding #9 (adversarial review, LIRA-232) — a 'Session Item Refund'
    // credit (SESSION_ITEM_REFUND_CREDIT_TYPE) is NEGATIVE and carries no
    // `due_date` of its own, so it both failed the old `due_date IS NOT
    // NULL` filter AND the old `(amount_usd > 0 OR amount_lbp > 0)` filter
    // below — a refunded session's 'Session Debt' charge kept aging at its
    // GROSS original amount forever (measured: amir's "current" bucket
    // stayed $1,635, never dropping to the correct $135 post-refund).
    // Targeted fix, scoped ONLY to this credit type: net it against its
    // OWN session's 'Session Debt' row before bucketing, via a correlated
    // subquery keyed on `session_id` (the credit's only link back to the
    // charge it reduces). Deliberately does NOT touch how ordinary
    // 'Repayment' rows are treated here — that's the pre-existing,
    // out-of-scope aging design (a repayment is a separate negative row
    // against the CLIENT, not against any one charge's `due_date`, and
    // aging has never netted it in) — only this ticket's own new credit
    // type gets bucket-level netting.
    const netAmountUsdExpr = `(amount_usd + COALESCE((
        SELECT SUM(c.amount_usd) FROM debt_ledger c
        WHERE c.session_id = debt_ledger.session_id
          AND c.transaction_type = '${SESSION_ITEM_REFUND_CREDIT_TYPE}'
          AND c.tenant_id = debt_ledger.tenant_id
      ), 0))`;
    const netAmountLbpExpr = `(amount_lbp + COALESCE((
        SELECT SUM(c.amount_lbp) FROM debt_ledger c
        WHERE c.session_id = debt_ledger.session_id
          AND c.transaction_type = '${SESSION_ITEM_REFUND_CREDIT_TYPE}'
          AND c.tenant_id = debt_ledger.tenant_id
      ), 0))`;
    const row = this.queryOne<{
      current_usd: number;
      current_lbp: number;
      days_31_60_usd: number;
      days_31_60_lbp: number;
      days_61_90_usd: number;
      days_61_90_lbp: number;
      over_90_usd: number;
      over_90_lbp: number;
    }>(
      `SELECT
        COALESCE(SUM(CASE WHEN julianday('now') - julianday(due_date) <= 0 THEN ${netAmountUsdExpr} ELSE 0 END), 0) AS current_usd,
        COALESCE(SUM(CASE WHEN julianday('now') - julianday(due_date) <= 0 THEN ${netAmountLbpExpr} ELSE 0 END), 0) AS current_lbp,
        COALESCE(SUM(CASE WHEN julianday('now') - julianday(due_date) BETWEEN 1 AND 30 THEN ${netAmountUsdExpr} ELSE 0 END), 0) AS days_31_60_usd,
        COALESCE(SUM(CASE WHEN julianday('now') - julianday(due_date) BETWEEN 1 AND 30 THEN ${netAmountLbpExpr} ELSE 0 END), 0) AS days_31_60_lbp,
        COALESCE(SUM(CASE WHEN julianday('now') - julianday(due_date) BETWEEN 31 AND 60 THEN ${netAmountUsdExpr} ELSE 0 END), 0) AS days_61_90_usd,
        COALESCE(SUM(CASE WHEN julianday('now') - julianday(due_date) BETWEEN 31 AND 60 THEN ${netAmountLbpExpr} ELSE 0 END), 0) AS days_61_90_lbp,
        COALESCE(SUM(CASE WHEN julianday('now') - julianday(due_date) > 60 THEN ${netAmountUsdExpr} ELSE 0 END), 0) AS over_90_usd,
        COALESCE(SUM(CASE WHEN julianday('now') - julianday(due_date) > 60 THEN ${netAmountLbpExpr} ELSE 0 END), 0) AS over_90_lbp
      FROM debt_ledger
      WHERE client_id = ?
        AND due_date IS NOT NULL
        AND (amount_usd > 0 OR amount_lbp > 0)
        AND transaction_type <> '${SESSION_ITEM_REFUND_CREDIT_TYPE}'
        AND tenant_id = ?`,
      clientId,
      tenantId,
    );

    return {
      client_id: clientId,
      current: { usd: row?.current_usd ?? 0, lbp: row?.current_lbp ?? 0 },
      days_31_60: {
        usd: row?.days_31_60_usd ?? 0,
        lbp: row?.days_31_60_lbp ?? 0,
      },
      days_61_90: {
        usd: row?.days_61_90_usd ?? 0,
        lbp: row?.days_61_90_lbp ?? 0,
      },
      over_90: { usd: row?.over_90_usd ?? 0, lbp: row?.over_90_lbp ?? 0 },
    };
  }

  /**
   * Get all clients with overdue debts (due_date < today AND net balance > 0).
   */
  getOverdueDebts(): OverdueDebtEntry[] {
    const tenantId = getCurrentTenantId();
    // Finding #9 — same root cause as `getClientDebtAging` immediately
    // above: a 'Session Item Refund' credit has no `due_date`, so it never
    // reaches this query's own rows and never nets against the 'Session
    // Debt' row it reduces. Fixed the SAME way (rule 14 — one netting
    // expression, reused): a per-row correlated SUM of same-session credits
    // folded into `d.amount_usd`/`amount_lbp` before the client-level SUM,
    // scoped to this credit type only (ordinary repayments stay untouched —
    // out of scope, same note as the aging method above).
    return this.query<OverdueDebtEntry>(
      `SELECT
        c.id AS client_id,
        c.full_name AS client_name,
        c.phone_number,
        SUM(d.amount_usd + COALESCE((
          SELECT SUM(cr.amount_usd) FROM debt_ledger cr
          WHERE cr.session_id = d.session_id
            AND cr.transaction_type = '${SESSION_ITEM_REFUND_CREDIT_TYPE}'
            AND cr.tenant_id = d.tenant_id
        ), 0)) AS total_usd,
        SUM(d.amount_lbp + COALESCE((
          SELECT SUM(cr.amount_lbp) FROM debt_ledger cr
          WHERE cr.session_id = d.session_id
            AND cr.transaction_type = '${SESSION_ITEM_REFUND_CREDIT_TYPE}'
            AND cr.tenant_id = d.tenant_id
        ), 0)) AS total_lbp,
        MIN(d.due_date) AS oldest_due_date,
        CAST(MAX(julianday('now') - julianday(d.due_date)) AS INTEGER) AS max_days_overdue,
        COUNT(*) AS entry_count
      FROM debt_ledger d
      JOIN clients c ON c.id = d.client_id AND c.tenant_id = ?
      WHERE d.due_date < datetime('now')
        AND d.due_date IS NOT NULL
        AND d.transaction_type <> '${SESSION_ITEM_REFUND_CREDIT_TYPE}'
        AND d.tenant_id = ?
      GROUP BY d.client_id
      -- Round-2 finding #6 (LOW) — this used to read the RAW gross sum,
      -- SUM(d.amount_usd) > 0, which never sees a Session Item Refund
      -- credit at all (excluded from d by the WHERE clause above, only
      -- pulled in via the correlated subquery that nets the SELECTed
      -- totals). A client whose overdue charge was fully credited away
      -- still passed this filter and stayed listed as "overdue" -- with a
      -- correctly-netted $0 total, but still a row. Reuse the SAME netted
      -- aliases the SELECT already computed (rule 14 -- one netting
      -- expression, not a second copy) so a fully-credited client is
      -- excluded exactly where a fully-repaid one already is.
      HAVING total_usd > 0 OR total_lbp > 0
      ORDER BY max_days_overdue DESC`,
      tenantId,
      tenantId,
    );
  }

  /**
   * Get revenue breakdown by module/type for a date range.
   */
  getRevenueByType(
    from: string,
    to: string,
  ): Array<{
    type: string;
    count: number;
    total_usd: number;
    total_lbp: number;
  }> {
    return this.query(
      `SELECT type,
              COUNT(*) AS count,
              SUM(amount_usd) AS total_usd,
              SUM(amount_lbp) AS total_lbp
       FROM transactions
       WHERE status = 'ACTIVE'
         AND created_at >= ? AND created_at <= ?
         AND tenant_id = ?
       GROUP BY type
       ORDER BY total_usd DESC`,
      from,
      to,
      getCurrentTenantId(),
    );
  }

  /**
   * Get revenue breakdown by user for a date range.
   */
  getRevenueByUser(
    from: string,
    to: string,
  ): Array<{
    user_id: number;
    username: string;
    count: number;
    total_usd: number;
    total_lbp: number;
  }> {
    const tenantId = getCurrentTenantId();
    return this.query(
      `SELECT t.user_id,
              u.username,
              COUNT(*) AS count,
              SUM(t.amount_usd) AS total_usd,
              SUM(t.amount_lbp) AS total_lbp
       FROM transactions t
       LEFT JOIN users u ON u.id = t.user_id AND u.tenant_id = ?
       WHERE t.status = 'ACTIVE'
         AND t.created_at >= ? AND t.created_at <= ?
         AND t.tenant_id = ?
       GROUP BY t.user_id
       ORDER BY total_usd DESC`,
      tenantId,
      from,
      to,
      tenantId,
    );
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let transactionRepositoryInstance: TransactionRepository | null = null;

export function getTransactionRepository(): TransactionRepository {
  if (!transactionRepositoryInstance) {
    transactionRepositoryInstance = new TransactionRepository();
  }
  return transactionRepositoryInstance;
}

/** Reset the singleton (for testing) */
export function resetTransactionRepository(): void {
  transactionRepositoryInstance = null;
}
