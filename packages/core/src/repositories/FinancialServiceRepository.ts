/**
 * Financial Service Repository
 *
 * Handles all financial_services table operations (OMT, WHISH, BOB, etc.).
 * Uses BaseRepository for common functionality.
 */
import { BaseRepository } from "./BaseRepository.js";
import {
  paymentMethodToDrawerName,
  isDrawerAffectingMethod,
  isNonCashDrawerMethod,
  partitionLegs,
  resolveServiceCashDrawer,
  type ServiceCashDrawerContext,
  type BaseSystem,
} from "../utils/payments.js";
import { primaryCashDrawerName } from "../constants/systemFloatDrawers.js";
import { getServiceProviderRepository } from "./ServiceProviderRepository.js";
import { getSupplierRepository } from "./SupplierRepository.js";
import {
  getPartnerRepository,
  type CreateLedgerEntryData,
} from "./PartnerRepository.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { getVoucherRepository } from "./VoucherRepository.js";
import { getMobileServiceItemRepository } from "./MobileServiceItemRepository.js";
import {
  getCarrierLineRepository,
  type CarrierKey,
} from "./CarrierLineRepository.js";
import { getCarrierLineService } from "../services/CarrierLineService.js";
import {
  maxReturnableCredits,
  isTelecomSplitComplete,
} from "../utils/telecomCredit.js";
import {
  reconcileLegs,
  expectedTotalIn,
  applyDrawerDelta,
  insertPaymentRow,
  bookClientDebtCharge,
  assertPartnerIdRequired,
  assertNoCounterPayment,
  assertNoCustomerAccountLeg,
  postPayoutLegs,
  resolveStampedExchangeRate,
} from "./moneyPosting.js";
import { getDebtService } from "../services/DebtService.js";
import { getUsdLbpSellRate } from "../utils/exchangeRate.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import {
  isWalletProvider,
  WALLET_PROVIDERS_SQL_LIST,
} from "../constants/walletProviders.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { BusinessRuleError } from "../utils/errors.js";
import {
  calculateCommission,
  lookupOmtFee,
  type OmtServiceType,
} from "../utils/omtFees.js";
import { lookupWhishFee } from "../utils/whishFees.js";
import { financialLogger } from "../utils/logger.js";

/**
 * The FOR-partner ledger transaction types, narrowed from
 * `CreateLedgerEntryData["transaction_type"]` (which also carries legacy/
 * settlement members and `undefined`). Used to type the FOR-partner
 * dispatch's ledger-type locals so they type-check against
 * `PartnerRepository.addLedgerEntry` without widening to plain `string`.
 */
type ForPartnerLedgerType = NonNullable<
  CreateLedgerEntryData["transaction_type"]
>;

export interface FinancialServiceEntity {
  id: number;
  provider:
    | "OMT"
    | "WHISH"
    | "BOB"
    | "OTHER"
    | "iPick"
    | "Katsh"
    | "WHISH_APP"
    | "OMT_APP"
    | "BINANCE";
  service_type: "SEND" | "RECEIVE";
  amount: number;
  currency: string;
  commission: number;
  cost: number;
  price: number;
  paid_by: string | null;
  /** Amount the customer actually paid (in `paid_currency`). Null when payment legs span multiple currencies. */
  paid_amount: number | null;
  /** Currency of `paid_amount`. May differ from `currency` (the service-denominated currency). */
  paid_currency: string | null;
  client_id: number | null;
  client_name: string | null;
  reference_number: string | null;
  phone_number: string | null;
  sender_name: string | null;
  sender_phone: string | null;
  receiver_name: string | null;
  receiver_phone: string | null;
  sender_client_id: number | null;
  receiver_client_id: number | null;
  omt_service_type: string | null;
  omt_fee: number | null;
  whish_fee: number | null;
  profit_rate: number | null;
  pay_fee: number | null;
  item_key: string | null;
  note: string | null;
  /** 1 = commission already realized (SEND or zero-commission RECEIVE); 0 = pending settlement */
  is_settled: number;
  settled_at: string | null;
  settlement_id: number | null;
  /** Surcharge collected from customer for paying via non-cash method (immediately realized profit) */
  payment_method_fee: number;
  /** Rate used to calculate payment_method_fee (e.g. 0.01 = 1%) */
  payment_method_fee_rate: number | null;
  created_at: string;
  created_by: number | null;
  edited_by: string | null;
  edited_at: string | null;
  partner_id: number | null;
  partner_mode: "THROUGH" | "FOR" | null;
  /**
   * Computed (SUPPLIER_OWED_EXPR / grossOwedDelta, Primary Cash Drawer plan
   * §8.3): what this row adds to the supplier payable — 0 for wallet-provider
   * transfers, sale cost for a LEGACY cost-flow row (`supplier_debt_booked =
   * 1`) and 0 for a post-C5 one (LIRA-122 — `supplier_debt_booked = 0`, the
   * default since migration v115: the debt already lives in the TOP_UP entry
   * booked at top-up time, so a per-sale row owes nothing on its own),
   * `+(amount + fee − commission)` for OMT/WHISH SEND, `−(amount − fee +
   * commission)` for OMT/WHISH RECEIVE (a signed negative — reduces what the
   * shop owes), bare amount otherwise.
   */
  supplier_owed: number;
  /**
   * COMMISSION_AT_SETTLEMENT_PLAN.md D3 — the per-row cutover flag (0 =
   * EMBEDDED legacy, 1 = AT_SETTLEMENT). Exposed on read so the Settlement
   * UI (Suppliers page) can group a selected batch by model client-side and
   * warn/disable BEFORE hitting `_resolveSettlementBatchModel`'s hard-reject
   * (D4) — the same real column `settleTransactions` itself branches on,
   * never re-derived from provider/commission (that was the marker collapse
   * D2 was written to retire).
   */
  commission_model: number;
}

export interface UnsettledSummary {
  provider: string;
  count: number;
  pending_commission_usd: number;
  pending_commission_lbp: number;
  total_owed_usd: number;
  total_owed_lbp: number;
  bill_count: number;
}

/**
 * LIRA-090 §6 bug 2 (walk-in aggregated payload) groundwork — one entry per
 * Only-Days catalog line. See `CreateFinancialServiceData.telecomCreditReturns`
 * for the full contract this array participates in.
 */
export interface TelecomCreditReturnLine {
  /** 'alfa' | 'mtc' (case-insensitive) — which drawer/carrier this line's
   *  return belongs to. Falls back to the resolved item's own `category`
   *  when omitted and `mobileServiceItemId` is present. */
  itemCategory?: string;
  /** The catalog item (`mobile_service_items.id`) this line is selling. */
  mobileServiceItemId?: number;
  /** Operator override for this line; omit to use the computed default
   *  (`maxReturnableCredits(item.credits)`) whenever the item's split is
   *  complete. */
  returnedCreditsUsd?: number;
}

export interface CreateFinancialServiceData {
  provider:
    | "OMT"
    | "WHISH"
    | "BOB"
    | "OTHER"
    | "iPick"
    | "Katsh"
    | "WHISH_APP"
    | "OMT_APP"
    | "BINANCE";
  serviceType: "SEND" | "RECEIVE" | "BILL";
  amount: number;
  currency?: string;
  commission: number;
  cost?: number;
  price?: number;
  paidByMethod?: string;
  /** Multi-payment support: when provided, overrides paidByMethod */
  payments?: Array<{
    method: string;
    currencyCode: string;
    amount: number;
    /** Set when method === 'GIFT_CARD' — the voucher code being redeemed. */
    voucherCode?: string;
    /** IN (customer pays, default) or OUT (shop returns change to customer). */
    direction?: "IN" | "OUT";
  }>;
  /**
   * BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §1.2/§1.4, Phase A — fee-on-top
   * RECEIVE ONLY (owner decision #1, 2026-08-06): the customer's provider fee
   * `f` (`resolvedProviderFee`) collected via operator-chosen legs — split
   * allowed, any real tender method including CUSTOMER_ACCOUNT (charges
   * `debt_ledger` 'Service Debt', requires a resolved client). No
   * `direction` (always customer-paid IN, never change) and no
   * `voucherCode` (GIFT_CARD redemption isn't wired for fee collection).
   * Σ(feePayments) MUST equal `f` — enforced by a SECOND `reconcileLegs`
   * hard-reject (same ±$0.05 epsilon as the payout reconcile); a mismatch
   * throws before any row is written.
   *
   * BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §6bis (adversarial review, findings
   * 1/2/4/5): the REPOSITORY — not the validator schema — is the
   * authoritative enforcement layer for this field. `createTransaction`
   * hard-rejects a non-empty `feePayments` unless ALL of: `serviceType ===
   * "RECEIVE"`, `includingFees !== true`, the resolved provider fee is
   * `> 0`, no `partnerId` (covers both FOR and THROUGH partner modes), and
   * not `deferPayment` — checked once, right after the fee resolves and
   * before the FOR-partner early-return dispatch, so every branch hits it.
   * The core validator (`validators/financial.ts`) and the electron-app
   * schema duplicate both ALSO refine against partner/zero-fee combinations
   * as a second layer, but neither is a substitute for this guard: internal
   * callers (and, before this fix, the FOR-partner/THROUGH-partner/
   * deferPayment/zero-fee combinations) can reach `createTransaction`
   * without ever going through Zod, and silently dropping the legs there —
   * success returned, no booking, no reconcile — is exactly the bug class
   * this guard closes. Omitted with `f > 0` falls back to the legacy single
   * implicit leg on the collapsed cashout method (`feeMethod`) — the real
   * tender method is stored (owner decision #9: the `"FEE"` method literal
   * is retired for new rows), the note `"<provider> RECEIVE fee
   * (customer-paid)"` is the discriminator.
   *
   * BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase D (owner decision Q7,
   * 2026-08-06: "yes, it happens — the customer can pay the fee separately
   * in different payment methods"): extended to the app-wallet OMT_APP/
   * WHISH_APP RECEIVE branch (mode C — "customer pays separately"), same
   * contract, one difference — the fee source for the presence guard is
   * `data.omtFee`/`data.whishFee` (not `resolvedProviderFee`, which only
   * resolves for the SYSTEM providers "OMT"/"WHISH"). When present on an app
   * wallet, `payoutAmount = cryptoAmount` (no fee netted out of the payout —
   * modes A/B still net it via the wallet spread; mode C never does) and the
   * legs are booked by the SAME shared `bookFeeCollectionLegs` helper the
   * system branch uses (rule 14). §10.2: BINANCE reaches the same mode C —
   * its fee source for the presence guard is `Math.abs(calculatedCommission)`
   * (it has no `omtFee`/`whishFee` field of its own); the cash side is
   * always denominated in USD (`cashCurrency`), never the crypto
   * `currency`/USDT.
   */
  feePayments?: Array<{
    method: string;
    currencyCode: string;
    amount: number;
  }>;
  clientId?: number;
  clientName?: string;
  referenceNumber?: string;
  phoneNumber?: string;
  senderName?: string;
  senderPhone?: string;
  receiverName?: string;
  receiverPhone?: string;
  senderClientId?: number;
  receiverClientId?: number;
  omtServiceType?: string;
  omtFee?: number;
  /** WHISH fee (user-entered or auto-looked-up from WHISH_FEE_TIERS) */
  whishFee?: number;
  profitRate?: number;
  payFee?: boolean;
  itemKey?: string;
  itemCategory?: string;
  note?: string;
  /** For SEND transactions: whether the entered amount already includes the fee.
   *  - true  → sentAmount = amount (already deducted by frontend), System drawer gets amount + fee
   *  - false → fee is on top, System drawer gets amount + fee
   */
  includingFees?: boolean;
  /**
   * Surcharge collected from the customer for paying via a non-cash payment method
   * (e.g. WHISH Wallet, OMT Wallet, Binance). This is the shop's immediately realized profit.
   * Only applies to SEND transactions where paidByMethod is non-cash.
   * Default: 0 (no surcharge for cash payments).
   */
  paymentMethodFee?: number;
  /**
   * Rate used to calculate paymentMethodFee (e.g. 0.01 = 1%).
   * Stored for audit/reporting purposes.
   */
  paymentMethodFeeRate?: number;
  /**
   * Returned credits in USD when an iPick/Katsh telecom voucher is sold as
   * "only days" (LIRA-090 spec §5.1, §6.1 — the identical checkbox used to
   * book NOTHING on the iPick tab; both reseller apps sell the same
   * alfa/mtc catalog now). The credits are topped-up to the Alfa or MTC
   * drawer (based on `itemCategory`) minus SMS sending costs (0.16 USD per
   * SMS, max 3 USD per SMS in 0.5 USD increments — `maxReturnableCredits`).
   *
   * When explicitly supplied (including `0`), this is an OPERATOR OVERRIDE
   * and always wins — the real SMS transfer sometimes differs from the
   * computed max (spec §2.2). When OMITTED and `mobileServiceItemId`
   * resolves to a catalog item whose Only-Days split is complete
   * (`isTelecomSplitComplete`), the repository computes the default itself
   * via `maxReturnableCredits(item.credits)` — the caller no longer has to.
   * Omitted with no resolvable split-complete item (every caller before
   * this ticket, and every split-incomplete item after it) books nothing —
   * byte-identical to pre-ticket behavior (spec §9, no regression).
   */
  returnedCreditsUsd?: number;
  /**
   * LIRA-090 §2/§5.1: the catalog item (`mobile_service_items.id`) this
   * cost/price line is selling. Drives the computed `returnedCreditsUsd`
   * default above (see that field's doc) AND the primary-carrier-line
   * movement (spec §5.1/§8) — both read the SAME resolved item, once
   * (rule 14). Presence of this field is itself the "this line is an
   * Only-Days telecom sale" signal; a normal (non-only-days) catalog sale
   * never needs to send it.
   */
  mobileServiceItemId?: number;
  /**
   * LIRA-090 §6 bug 2 groundwork: a walk-in checkout that bundles several
   * Only-Days catalog lines into ONE `financial_services` row (the
   * aggregated cart total: `amount: discountedTotal`, `cost:
   * aggregatedCost`) cannot represent a PER-LINE returned-credit amount via
   * the single `returnedCreditsUsd`/`itemCategory`/`mobileServiceItemId`
   * fields above — there is only one of each per transaction. When THIS
   * array is present (one entry per Only-Days line in the cart), every
   * entry is booked and the single-scalar fields above are ignored for the
   * credit-return leg (they may still carry whatever the aggregate flow
   * happens to set). Absent (every caller today — the session-cart path
   * submits one `createFinancialService` call PER line already, so it never
   * needs this), the single-scalar fields apply unchanged. See
   * `FinancialServiceRepository.processTelecomCreditReturn`'s doc for the
   * exact fallback contract.
   */
  telecomCreditReturns?: TelecomCreditReturnLine[];
  /** T3 keep-change (KC-4): kept change per currency → profit stamp. */
  kept_change_usd?: number;
  kept_change_lbp?: number;
  transaction_time?: string;
  /**
   * Cashout method for RECEIVE transactions: how the shop pays the customer.
   * - 'CASH' (default): debit General drawer (current behavior)
   * - 'CUSTOMER_ACCOUNT': don't debit drawer, create credit in debt_ledger
   */
  cashoutMethod?: "CASH" | "CUSTOMER_ACCOUNT" | "OMT" | "WHISH" | "BINANCE";
  /**
   * USD→LBP rate-of-record for this transaction. When omitted, the repository
   * stamps the current configured sell rate (Money IN). Provide it to capture an
   * operator-edited rate from the payment UI.
   */
  exchangeRate?: number;
  /**
   * Payment-Legs Integrity plan: the USD→LBP rate MultiPaymentInput actually
   * converted the customer's TENDER at (e.g. the buy rate for a form that
   * passes `exchangeRate={buyRate}` to its PaymentSheet, per the owner's
   * 2026-07-06 MPI-buy-rate decision) — this can differ from `exchangeRate`
   * above, which is the transaction's stamped rate-of-record (sell-side for
   * money-in flows). When present, leg reconciliation (`reconcileLegs`)
   * converts at THIS rate instead of `exchangeRate` — the till's own change
   * math must be compared at the SAME rate it used, or a legitimate
   * buy/sell-spread checkout false-rejects (lira-095). Falls back to
   * `exchangeRate` (then a live sell-rate lookup) when omitted — every
   * existing caller that doesn't send it is unaffected.
   *
   * Owner decision (2026-08-08, repro: buy 89,000 vs. sell 90,000): ALSO used
   * to stamp `transactions.exchange_rate` — via `resolveStampedExchangeRate`
   * (moneyPosting.ts), a non-throwing sibling of the reconciliation
   * band-check that falls back to the server rate silently outside the ±10%
   * band or when absent. This does NOT change what `reconcileLegs`/
   * `postPayoutLegs` reconcile against — they keep anchoring at the server
   * rate (`exchangeRate`), unchanged.
   */
  tender_exchange_rate?: number;
  /** Partner ID: when set, this transaction involves a partner */
  partnerId?: number;
  /** Partner Mode: specifies if we use their system ('THROUGH') or they use our system ('FOR') */
  partnerMode?: "THROUGH" | "FOR";
  /**
   * Session-basket deferred payment mode (LIRA basket payment).
   * When true, the customer-cash side of this transaction is owned by the
   * customer-session basket recorder, NOT this transaction:
   *  - Cost/price flow: KEEP the cost outflow (provider drawer −cost) + crypto
   *    USDT leg; SKIP the price/cash inflow legs and any CUSTOMER_ACCOUNT debt.
   *  - OMT/WHISH SEND: KEEP the reserve transfer (General −totalCollected /
   *    *_System +totalCollected); SKIP the customer cash-in leg, pmFee handling,
   *    change, and debt. (The basket supplies the customer cash separately.)
   *  - OMT/WHISH/BINANCE RECEIVE (cashout): SKIP the customer cash-OUT payout
   *    leg (the basket handles the net OUT); KEEP the provider/system/crypto side.
   * Internal legs, the unified transaction, profit and exchange_rate are always
   * created. Non-session callers leave this falsy → behavior is unchanged.
   */
  deferPayment?: boolean;
  /**
   * Payment-Legs Integrity plan (Wave 8, owner decision 2026-07-18): the
   * bills/catalog cart flow (KatchForm / FinancialForm) submits ONE
   * legs-carrying CARRIER transaction per checkout — every sibling unit in
   * the same cart submits `deferPayment: true` and carries no legs (see
   * docs/plans/done_plans/CARRIER_LEGS_VOID_ASYMMETRY.md). The carrier's own
   * `price` is only ONE unit's share of the cart, so reconciling legs
   * against `price` alone would hard-reject every legitimate multi-unit
   * checkout. `checkoutTotal` is the FULL amount the customer owes for the
   * entire checkout, split by the currencies the cart was denominated in.
   * When present alongside `payments`, the cost/price flow reconciles legs
   * against THIS instead of `price` (S2's hard-reject invariant, applied to
   * the right total). Omitted → unchecked legacy behavior (single-unit
   * checkouts, scripted callers) — same no-op-on-absence contract as every
   * other `reconcileLegs` call site.
   */
  checkoutTotal?: { usd: number; lbp: number };
  /**
   * Authenticated user id stamped on the unified transaction, payment, and
   * debt_ledger rows this transaction writes (all three carry a
   * `FOREIGN KEY … REFERENCES users(id)` enforced at runtime). Callers MUST
   * pass the acting user; when absent the repository resolves a real user id
   * so the FK never fails on a DB whose admin isn't id 1.
   */
  userId?: number;
  /**
   * CARRIER_LEGS_VOID_ASYMMETRY.md (design B+): identifies which multi-unit
   * split checkout this unit belongs to. The frontend (KatchForm bills /
   * FinancialForm catalog units) generates ONE uuid per checkout and sends
   * it with EVERY unit — carrier and siblings alike — so the void path can
   * find and guard the whole group (TransactionRepository._getSplitGroup /
   * voidCheckoutGroup). Omitted on single-unit checkouts (no metadata
   * noise). Snake_case to match the metadata_json key it's stored under
   * (same convention as kept_change_usd/lbp above).
   */
  split_group?: string;
  /**
   * Whether THIS unit carries the checkout's payment legs ('carrier') or
   * deferred them to the carrier ('sibling', i.e. `deferPayment: true`).
   * Only meaningful alongside split_group.
   */
  split_role?: "carrier" | "sibling";
  /** Total unit count in the checkout this split_group belongs to (≥ 2). */
  split_units?: number;
}

// =============================================================================
// Self-charge (LIRA-090 spec §5.2) — charge a telecom catalog item to the
// SHOP'S OWN carrier line instead of a customer.
// =============================================================================

export interface SelfChargeTelecomItemData {
  /** The catalog item (`mobile_service_items.id`) being self-charged — its
   *  `cost_lbp`/`credits`/`validity_days` drive every leg (see
   *  `FinancialServiceRepository.selfChargeTelecomItem`'s doc). */
  mobileServiceItemId: number;
  /** Target carrier line. Defaults to the item's carrier's primary line
   *  (spec §3 decision 8) when omitted — overridable per call. */
  carrierLineId?: number;
  userId?: number;
  transaction_time?: string;
}

export interface SelfChargeTelecomItemResult {
  transactionId: number;
  carrierLineId: number;
  costLbp: number;
  creditsAdded: number;
  validityDaysAdded: number;
}

export interface ProviderStats {
  provider: string;
  commission: number;
  currency: string;
  count: number;
}

export interface CurrencyStats {
  currency: string;
  commission: number;
  count: number;
}

export interface FinancialServiceAnalytics {
  today: {
    commission: number;
    pending_commission: number;
    count: number;
    byCurrency: CurrencyStats[];
  };
  month: {
    commission: number;
    pending_commission: number;
    count: number;
    byCurrency: CurrencyStats[];
  };
  byProvider: ProviderStats[];
}

/**
 * Operator-facing provider label for item/bill summaries and Service Debt
 * notes — the raw "WHISH_APP"/"OMT_APP" enums read like codes next to
 * iPick/Katsh. Transfer summaries and ledger matching keep the raw enum
 * (e2e specs and existing rows match on "WHISH_APP SEND: …").
 */
function providerDisplayLabel(
  provider: CreateFinancialServiceData["provider"],
): string {
  switch (provider) {
    case "WHISH_APP":
      return "Whish App";
    case "OMT_APP":
      return "OMT App";
    default:
      return provider;
  }
}

/**
 * Debt-ledger note for a Service Debt (cost/price flow) entry. Prefers the
 * operator-facing `note` (e.g. selected iPick/Katsh items) over the raw
 * `item_key`, which is only ever set on the session per-item booking path.
 */
function serviceDebtNote(data: CreateFinancialServiceData): string {
  const label = providerDisplayLabel(data.provider);
  if (data.note) return `${label} service: ${data.note}`;
  return `${label} service${data.itemKey ? ` [${data.itemKey}]` : ""}`;
}

/**
 * Debt-ledger note for a wallet-transfer SEND charged to the customer's
 * account. The wallet-transfer branch serves Binance AND the app wallets
 * (OMT_APP / WHISH_APP) — the note must name the actual provider and its
 * denomination (Binance is USDT; app wallets use the service currency), and
 * when a fee was charged the headline number is the TOTAL the customer owes
 * (transfer + fee), with the breakdown in parentheses — a bare "$20" note on
 * a $22 debt read as if the fee had been dropped.
 * Was hardcoded "Binance SEND — $X USDT", so an OMT App debt read as Binance.
 */
function walletSendDebtNote(
  provider: CreateFinancialServiceData["provider"],
  amount: number,
  currency: string,
  fee: number,
): string {
  if (provider === "BINANCE") {
    // Binance is denominated in USDT while the fee is charged in the cash
    // currency — the two can't be summed into one headline number.
    return fee > 0
      ? `Binance SEND — $${amount} USDT (+$${fee} fee)`
      : `Binance SEND — $${amount} USDT`;
  }
  const fmt = (n: number) =>
    currency === "LBP" ? `${n.toLocaleString()} LBP` : `$${n}`;
  return fee > 0
    ? `${provider} SEND — ${fmt(amount + fee)} (${fmt(amount)} + ${fmt(fee)} fee)`
    : `${provider} SEND — ${fmt(amount)}`;
}

// =============================================================================
// Financial Service Repository Class
// =============================================================================

/**
 * Primary Cash Drawer plan §8.3 (docs/plans/todo_plans/PRIMARY_CASH_DRAWER_PLAN.md),
 * replacing PR #66's `feeOwedDelta` (CLAUDE.md rule 14 — the ONE definition,
 * replacing the two independent copies that used to compute "what this
 * financial_services row adds to the supplier's payable": SUPPLIER_OWED_EXPR
 * (the SQL projection just below, generated FROM this same shape — consumed
 * by the row projections in getColumns/Settle tab, Suppliers Outstanding/FIFO
 * status, and getUnsettledSummaryByProvider) and the JS `ledgerAmount` used to
 * book the auto supplier_ledger TOP_UP entry (createTransaction, "Auto-record
 * supplier debt" below).
 *
 * Owner verdict 2026-07-30: OMT_System/Whish_System is NOT a spendable float
 * inside the provider's own books — it is the shop's physical cash drawer.
 * No leg tracks a principal balance there anymore, so the supplier ledger
 * goes back to the GROSS amount owed the provider on each transfer:
 * principal `x`, customer fee `f`, shop commission `c` (`c ≤ f`, `c = 0` for
 * WHISH):
 *
 *   SEND    → +(x + f − c)   (the shop drew x+f in cash, owes the provider
 *                              everything except its own cut)
 *   RECEIVE → −(x − f + c)   (the shop paid out x−f in cash, is owed back
 *                              everything except its own cut — a negative
 *                              entry, reducing what the shop owes)
 *
 * `amount` is the repo's existing bare principal (`data.amount` — the
 * frontend pre-nets fee-included SEND/RECEIVE before this repo ever sees it,
 * so no fee-mode branch is needed here; see the doc comments on `sentAmount`/
 * `receiveAmount` below). Worked example (USD, x=100, f=5, c=0.5): SEND
 * +104.5, RECEIVE −95.5 (§8.3).
 *
 *  - Wallet-provider transfers (OMT_APP / WHISH_APP / BINANCE, prepaid
 *    balance the shop owns) owe NOTHING — Fix B, unchanged.
 *  - Cost-flow SEND rows (legacy per-sale supplier debt) owe the sale cost —
 *    unchanged.
 *  - Anything else owes the bare amount — unchanged.
 */
function grossOwedDelta(params: {
  serviceType: CreateFinancialServiceData["serviceType"];
  provider: CreateFinancialServiceData["provider"];
  fee: number;
  commission: number;
  cost: number;
  amount: number;
}): number {
  if (isWalletProvider(params.provider) && params.cost <= 0) return 0;
  if (params.serviceType === "SEND" && params.cost > 0) return params.cost;
  if (params.provider === "OMT" || params.provider === "WHISH") {
    const principal = Math.abs(params.amount);
    const fee = Math.abs(params.fee);
    const commission = Math.abs(params.commission);
    if (params.serviceType === "SEND") return principal + fee - commission;
    if (params.serviceType === "RECEIVE")
      return -(principal - fee + commission);
    // BILL/other on an OMT/WHISH supplier never reaches this booking site
    // today (the BILL branch below books a hardcoded LBP entry instead) —
    // kept structurally close to the old fee-only fallback in case a future
    // caller adds one.
    return fee - commission;
  }
  return Math.abs(params.amount);
}

// SQL mirror of grossOwedDelta (see its doc comment for the shared shape
// this must stay structurally identical to — rule 14: same branch order,
// same terms, generated from the same WALLET_PROVIDERS_SQL_LIST constant).
//
// COMMISSION_AT_SETTLEMENT_PLAN.md §4 Phase 1 — the `service_type = 'BILL'`
// branch below is NEW and deliberately has NO twin in grossOwedDelta: BILL
// rows never call grossOwedDelta (the write path's BILL branch, above, books
// its own commission entry directly and never reaches the generic
// `else`/ledgerAmount site grossOwedDelta feeds) — this WHEN only affects the
// READ-side `supplier_owed` projection getColumns()/getUnsettledSummaryByProvider
// expose. Before Phase 1, this branch could never be reached either: a bill
// was always born `is_settled = 1` (never queried by anything
// SUPPLIER_OWED_EXPR feeds). Now that new-model bills join the unsettled
// queue (D2), the pre-existing `ELSE ABS(amount)` would surface the bill's
// FACE AMOUNT as "owed" — wrong, because a bill's principal already left the
// shop via the provider-drawer cost leg at creation (a prepaid balance, not
// a ledger receivable); the plan's "Bills settlement note" is explicit that
// settling a bill books ONLY the commission credit. Not a ±commission term
// of any existing branch — a new, additive case for a service_type that
// never hit this expression's business logic before.
//
// LIRA-122 — the cost-flow SEND branch used to return bare `cost`
// unconditionally, which is only actually owed for LEGACY rows (migration
// v115, `supplier_debt_booked = 1` — the pre-C5 model where every cost/price
// sale through Katsh/iPick/Whish App/OMT App booked its own SALE_COST ledger
// entry). Every sale since v115 is born `supplier_debt_booked = 0` (C5
// prepaid-units: the debt is booked once at top-up time via
// `topUpFromSupplier`'s TOP_UP entry; the sale itself only draws down the
// provider drawer) — `getUnsettledBySupplier`'s own cost-flow UNION branch
// already requires `supplier_debt_booked = 1` before offering a row for
// settlement. Reporting `supplier_owed = cost` regardless told the Suppliers
// page's Transactions tab a post-C5 sale was still "Unpaid" even though
// nothing is owed for it — the supplier's aggregate balance
// (`SupplierRepository.getSupplierBalances`, a plain `supplier_ledger` SUM,
// never touches this expression) correctly showed "Settled" the whole time.
// Gating on the SAME flag `getUnsettledBySupplier` already uses keeps this
// ONE "is this owed" definition (rule 14) instead of two disagreeing ones.
const SUPPLIER_OWED_EXPR = `CASE
  WHEN provider IN (${WALLET_PROVIDERS_SQL_LIST}) AND cost <= 0 THEN 0
  WHEN service_type = 'SEND' AND cost > 0 AND supplier_debt_booked = 1 THEN cost
  WHEN service_type = 'SEND' AND cost > 0 THEN 0
  WHEN service_type = 'BILL' THEN 0
  WHEN provider = 'OMT' AND service_type = 'SEND' THEN ABS(amount) + ABS(COALESCE(omt_fee, 0)) - ABS(COALESCE(commission, 0))
  WHEN provider = 'OMT' AND service_type = 'RECEIVE' THEN -(ABS(amount) - ABS(COALESCE(omt_fee, 0)) + ABS(COALESCE(commission, 0)))
  WHEN provider = 'WHISH' AND service_type = 'SEND' THEN ABS(amount) + ABS(COALESCE(whish_fee, 0)) - ABS(COALESCE(commission, 0))
  WHEN provider = 'WHISH' AND service_type = 'RECEIVE' THEN -(ABS(amount) - ABS(COALESCE(whish_fee, 0)) + ABS(COALESCE(commission, 0)))
  ELSE ABS(amount)
END`;

// ═══════════════════════════════════════════════════════════════════════════
// COMMISSION_AT_SETTLEMENT_PLAN.md §3/Phase 0, decision D2 — the ONE
// pending-supplier-settlement predicate (rule 14). It replaces FOUR
// independent `commission > 0` copies that doubled as an implicit
// "pending settlement" marker: creation `is_settled` (this file, below),
// the settle-tab query (`getUnsettledBySupplier`), the pending summary
// (`getUnsettledSummaryByProvider`), and the reversal `wasPendingSettlement`
// branch (`TransactionRepository._reverseSupplierSettlement`). That marker
// breaks the moment a new-model row is born with `commission = 0` —
// commission is now ENTERED at settlement, not guessed at creation — so a
// new-model OMT/WHISH row would silently be born `is_settled = 1`,
// invisible to the settle tab, and unreversible.
//
// A row is pending supplier settlement when:
//   - `commission_model = 1` (AT_SETTLEMENT, D3) AND it's one of the
//     in-scope kinds named by the plan's §0 scope fence: OMT/WHISH system
//     transfers (SEND/RECEIVE), or iPick/Katsh BILLs (Phase 1); OR
//   - `commission_model = 0` (legacy EMBEDDED) AND it's an OMT/WHISH row
//     with `commission > 0` — the pre-existing legacy marker, preserved
//     verbatim so old rows keep their exact historical behavior (cutover,
//     not restatement — plan header).
//
// `isPendingSupplierSettlement` (JS) and `pendingSettlementSql()` (SQL
// twin) MUST stay structurally identical — same branch order, same terms —
// same lockstep discipline as `grossOwedDelta`/`SUPPLIER_OWED_EXPR` above.
//
// LIRA-112 (COMMISSION_AT_SETTLEMENT_PLAN.md D12) — the BILL branch used to
// hardcode `provider IN ('iPick', 'Katsh')`, treating both identically. That
// is the exact bug: owner: "i said ipick bills gives us no comission, but
// katsh does." Replaced by `supplierCommissionEligible` — the caller's own
// lookup of `suppliers.commission_eligible` (v151) for THIS row's provider —
// so eligibility is a per-supplier config bit (rule 14's "ONE definition"),
// never a provider name inside this function. iPick's supplier row is
// commission_eligible = 0, Katsh's is 1; a hypothetical future bill
// provider inherits whatever ITS OWN supplier row says, correct by default,
// no repository edit required.
export function isPendingSupplierSettlement(row: {
  commission_model: number;
  provider: string;
  service_type: string;
  commission: number;
  supplierCommissionEligible: boolean;
}): boolean {
  if (row.commission_model === 1) {
    if (
      (row.provider === "OMT" || row.provider === "WHISH") &&
      (row.service_type === "SEND" || row.service_type === "RECEIVE")
    ) {
      return true;
    }
    return row.service_type === "BILL" && row.supplierCommissionEligible;
  }
  return (
    (row.provider === "OMT" || row.provider === "WHISH") && row.commission > 0
  );
}

/**
 * SQL twin of `isPendingSupplierSettlement` — see that function's doc
 * comment for the LIRA-112 rationale. `supportsCommissionEligibility` gates
 * the BILL branch's `suppliers.commission_eligible` (v151) lookup: `true`
 * on any real/fully-migrated schema; `false` only for the handful of
 * hand-rolled jest fixtures (pre-dating v151) that construct a minimal
 * `suppliers` table without that column — a bare `1 = 1` there reproduces
 * the exact PRE-fix behavior (any BILL provider pending) for those fixtures'
 * unrelated assertions, mirroring `SupplierRepository`'s own
 * `_suppliersHasCommissionPrefColumns()` schema-drift guard. Callers get
 * the boolean cheaply via `FinancialServiceRepository`'s own PRAGMA check —
 * never assume `true` from application code.
 */
export function pendingSettlementSql(
  supportsCommissionEligibility: boolean,
): string {
  const billEligibilityClause = supportsCommissionEligibility
    ? `NOT EXISTS (
         SELECT 1 FROM suppliers s
         WHERE s.provider = financial_services.provider
           AND s.tenant_id = financial_services.tenant_id
           AND s.commission_eligible = 0
       )`
    : "1 = 1";
  return `(
  (commission_model = 1 AND (
    (provider IN ('OMT', 'WHISH') AND service_type IN ('SEND', 'RECEIVE'))
    OR (service_type = 'BILL' AND ${billEligibilityClause})
  ))
  OR (commission_model = 0 AND provider IN ('OMT', 'WHISH') AND commission > 0)
)`;
}

// COMMISSION_AT_SETTLEMENT_PLAN.md §4 Phase 1, rule 14 — the ONE
// notRefunded fragment for financial_services rows. A pre-existing leak
// (not specific to bills — any pending-settlement row): `_markSourceRefunded`
// (TransactionRepository.ts) stamps `is_refunded = 1` on a voided/refunded
// row's own `financial_services` record but never touches `is_settled` —
// that reset is `_reverseSupplierSettlement`'s job, gated on the row still
// carrying a live `settlement_id`, which a row voided BEFORE ever being
// settled never had. Neither unsettled query filtered on `is_refunded`
// before this fix, so a voided/refunded row that was `is_settled = 0` at
// creation stayed visible (and settleable) in the settle tab forever.
// `COALESCE(...)` guards rows from before v120 added the column, mirroring
// `SupplierRepository.ts`'s own `notRefunded` helper style for supplier_ledger.
const NOT_REFUNDED_SQL = `COALESCE(is_refunded, 0) = 0`;

export class FinancialServiceRepository extends BaseRepository<FinancialServiceEntity> {
  constructor() {
    super("financial_services", { softDelete: false });
  }

  // Override getColumns() to use explicit columns instead of SELECT *
  protected getColumns(): string {
    return `id, provider, service_type, amount, currency, commission, cost, price, paid_by, paid_amount, paid_currency, client_id, client_name, reference_number, phone_number, sender_name, sender_phone, receiver_name, receiver_phone, sender_client_id, receiver_client_id, omt_service_type, omt_fee, whish_fee, profit_rate, pay_fee, item_key, note, is_settled, settled_at, settlement_id, payment_method_fee, payment_method_fee_rate, created_at, created_by, edited_by, edited_at, partner_id, partner_mode, commission_model, ${SUPPLIER_OWED_EXPR} AS supplier_owed`;
  }

  // ---------------------------------------------------------------------------
  // Transaction Operations
  // ---------------------------------------------------------------------------

  // resolveFallbackUserId() now lives on BaseRepository (rule 14 — shared by
  // ExchangeRepository, CustomServiceRepository, MaintenanceRepository too).

  /**
   * FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b phase 2 — reads
   * `service_providers` (via `ServiceProviderRepository.getByCode()`) first;
   * the switch below is kept as the offline/missing-row fallback, same shape
   * as `paymentMethodToDrawerName()` (`utils/payments.ts`): try the repo, and
   * on either a thrown error (DB/table unavailable) or a falsy result (no
   * row for this code — deleted, unseeded, or a code the table has never
   * heard of) fall through to the literal map. Characterized byte-for-byte
   * against the pre-phase-2 hardcoded switch by
   * `FinancialServiceRepository.mapDrawerName.characterization.test.ts` —
   * do NOT edit this fallback's return values without re-running that file
   * and confirming it still needs no changes.
   */
  private mapDrawerName(
    provider: CreateFinancialServiceData["provider"],
  ): string {
    try {
      const sp = getServiceProviderRepository().getByCode(provider);
      if (sp) return sp.drawer_name;
    } catch {
      // service_providers not migrated yet / DB unavailable — hardcoded map.
    }
    switch (provider) {
      case "OMT":
        return "OMT_System";
      case "WHISH":
        return "Whish_System";
      case "iPick":
        return "iPick";
      case "Katsh":
        return "Katsh";
      case "WHISH_APP":
        return "Whish_App";
      case "OMT_APP":
        return "OMT_App";
      case "BINANCE":
        return "Binance";
      case "BOB":
      case "OTHER":
      default:
        return "General";
    }
  }

  /**
   * Resolve (or create) the client to debt-charge for a Binance CUSTOMER_ACCOUNT
   * payment leg, and link the unified transaction row to that client.
   *
   * Throws if name/phone are missing and no clientId is available.
   */
  private resolveBinanceDebtClient(
    data: CreateFinancialServiceData,
    txnId: number,
  ): number {
    let resolvedClientId = data.clientId;
    const tenantId = getCurrentTenantId();
    if (!resolvedClientId) {
      if (!data.clientName?.trim()) {
        throw new Error("Client name is required when paying by debt");
      }
      if (!data.phoneNumber?.trim()) {
        throw new Error("Phone number is required when paying by debt");
      }
      const existing = this.db
        .prepare(
          `SELECT id FROM clients WHERE phone_number = ? AND tenant_id = ? LIMIT 1`,
        )
        .get(data.phoneNumber, tenantId) as { id: number } | undefined;
      if (existing) {
        resolvedClientId = existing.id;
      } else {
        const insertResult = this.db
          .prepare(
            `INSERT INTO clients (full_name, phone_number, notes, tenant_id)
             VALUES (?, ?, ?, ?)`,
          )
          .run(
            data.clientName,
            data.phoneNumber,
            "Auto-created from Binance debt",
            tenantId,
          );
        resolvedClientId = Number(insertResult.lastInsertRowid);
      }
    }
    this.db
      .prepare(
        `UPDATE transactions SET client_id = ? WHERE id = ? AND tenant_id = ?`,
      )
      .run(resolvedClientId, txnId, tenantId);
    return resolvedClientId;
  }

  /**
   * Create a new financial service transaction.
   *
   * Two modes:
   * - **Cost/Price mode** (cost > 0): iPick/Katsh/WishApp/OMT_App with cost outflow,
   *   price inflow, optional DEBT, and real profit tracking.
   * - **Legacy mode** (no cost): OMT/WHISH/BOB/OTHER with signed amount + commission.
   */
  createTransaction(data: CreateFinancialServiceData): {
    id: number;
    drawer: string;
  } {
    const legacyDrawerLabel = this.mapDrawerName(data.provider);
    const useCostPriceFlow = data.cost !== undefined && data.cost > 0;
    const tenantId = getCurrentTenantId();

    return this.db.transaction(() => {
      const currency = data.currency ?? "USD";

      // Payment-Legs Integrity plan (false-reject fix, 2026-07-2x):
      // `stampedExchangeRate` is the server rate-of-record — the reconciliation
      // ANCHOR every reconcileLegs call site in this method passes as
      // `exchangeRate`, alongside `data.tender_exchange_rate` (as
      // `tenderExchangeRate`) — the gate itself (moneyPosting.ts's
      // reconcileLegs/resolveReconciliationRate) decides which one to
      // reconcile at, banding the tender rate against this one (±10%) so an
      // implausible tender value can't launder a real leg discrepancy as
      // "just a rate difference". This anchor is UNCHANGED by the owner's
      // 2026-08-08 stamping decision below — only the value written to
      // `transactions.exchange_rate` differs from it now, never the
      // reconciliation math.
      const stampedExchangeRate =
        data.exchangeRate ?? getUsdLbpSellRate(this.db);
      // Owner decision (2026-08-08, repro: buy 89,000 vs. sell 90,000): the
      // `transactions.exchange_rate` stamp should reflect what the operator
      // actually tendered, when that's a plausible edit — within
      // `TENDER_RATE_BAND_PCT` of the server rate. Outside that band (or
      // absent), falls back to `stampedExchangeRate` SILENTLY — this never
      // throws (see `resolveStampedExchangeRate`'s doc); the hard-reject path
      // for an implausible tender rate stays exclusively in `reconcileLegs`/
      // `postPayoutLegs` below, which keep anchoring at `stampedExchangeRate`.
      const recordExchangeRate = resolveStampedExchangeRate(
        stampedExchangeRate,
        data.tender_exchange_rate,
      );

      const cost = data.cost ?? 0;
      const price = data.price ?? (useCostPriceFlow ? data.amount : 0);
      const paidBy =
        data.serviceType === "RECEIVE" && data.cashoutMethod
          ? data.cashoutMethod
          : data.paidByMethod || "CASH";

      const isThroughPartner = !!(
        data.partnerId &&
        (!data.partnerMode || data.partnerMode === "THROUGH")
      );
      const isForPartner = !!(data.partnerId && data.partnerMode === "FOR");

      // LIRA-124 (2026-08-10): `skipGeneralDrawer`/`skipSystemDrawer` — the
      // old isForPartner/isThroughPartner drawer-suppression flags — are
      // RETIRED. They used to gate the RECEIVE payout + fee-collection
      // postings further down this method (the fee leg, the wallet-cashout
      // debit, the CASH-cashout `postPayoutLegs` call) under a mental model
      // that stopped being true on 2026-07-30: back when OMT_System/
      // Whish_System was a spendable float held INSIDE the provider's own
      // books (PR #66), "skip the system drawer for THROUGH" meant "don't
      // credit/debit that float — the partner's float moved instead," which
      // was correct. That float was deleted by the Primary Cash Drawer plan;
      // OMT_System/Whish_System is now just the PHYSICAL cash drawer, and the
      // postings these flags gated are the shop's REAL payout to the
      // customer (cash handed over the counter, or a wallet debit) — money
      // that leaves a real drawer regardless of partner mode. The owner's
      // 2026-08-10 rule is explicit: "in all cases yes we hand the customer
      // the cash/or money via other payment methods — we are paying." A
      // THROUGH-partner RECEIVE is, in fact, the ONLY way to RECEIVE on the
      // shop's secondary system at all (walk-in is rejected without a
      // partner, see the guard a few lines below) — so this was not a rare
      // edge case, it was the mandatory path silently understating cash
      // outflow every time it ran.
      //
      // `isForPartner` never reaches those gates in the first place — its own
      // early-return dispatch a few dozen lines down handles disbursement via
      // `processReturnLegs("Partner disbursement")` and returns before this
      // code is reached — so removing these flags changes THROUGH-partner
      // RECEIVE behavior only; FOR-partner and walk-in are byte-for-byte
      // unchanged (proven by the regression guard in
      // FinancialServiceRepository.partner.test.ts).
      //
      // What is NOT retired, and does NOT need a new flag: the actual "our
      // balance with the provider" entity — the auto supplier-ledger TOP_UP
      // booking further down ("Auto-record supplier debt") — was never gated
      // by `skipSystemDrawer` to begin with. It is (and remains) gated by
      // `skipSecondarySupplierLedger` (below, provider !== baseSystem), which
      // already keeps the provider relationship untouched for every
      // secondary-system THROUGH transaction — the two concerns (real payout
      // drawer vs. provider-obligation ledger) were always separate
      // mechanisms; only the payout side was wrongly gated.

      // FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §3 "Also" — close the
      // asymmetry moneyPosting.ts's `assertPartnerIdRequired` doc documents:
      // `isForPartner` above is deliberately gated on `partnerId` (it drives
      // the early FOR-partner dispatch return below, so widening ITS
      // definition would ripple through the whole method) — meaning a bare
      // `partnerMode: "FOR"` with no `partnerId` used to silently fall
      // through to the walk-in dispatch below and run as an ordinary,
      // non-partner transaction. Checked here, gated on `partnerMode` alone
      // (not `isForPartner`), before any row is written — mirrors how
      // Sales/Recharge/Loto already call this same guard.
      if (data.partnerMode === "FOR") {
        assertPartnerIdRequired(data.partnerId);
      }

      // Only the shop's PRIMARY (base) system owes its provider directly. The
      // secondary OMT/WHISH system runs via a partner, whose obligation is
      // captured in partner_ledger — recording it as a supplier debt too
      // double-counts it and pollutes the suppliers/settlement page.
      // Resolved here (rule 14 — the one definition, reused unchanged by the
      // supplier-ledger booking below) so the walk-in-secondary-provider
      // rejection below can run BEFORE any row is written.
      let baseSystem: BaseSystem = "OMT";
      try {
        const baseSystemRow = this.db
          .prepare(
            "SELECT value FROM system_settings WHERE key_name = 'shop_base_system' AND tenant_id = ?",
          )
          .get(tenantId) as { value: string } | undefined;
        if (baseSystemRow?.value === "WHISH") baseSystem = "WHISH";
      } catch {
        // system_settings may be absent in minimal/test schemas — default to OMT.
      }

      // Primary Cash Drawer plan §8.2: the ONE context every
      // resolveServiceCashDrawer call site in this method shares — reuses
      // this same `baseSystem` local (D7 — no second settings read).
      const cashDrawerCtx: ServiceCashDrawerContext = {
        provider: data.provider,
        baseSystem,
      };

      const skipSecondarySupplierLedger =
        (data.provider === "OMT" || data.provider === "WHISH") &&
        data.provider !== baseSystem;

      // Orchestrator default (2026-07-29): a walk-in transaction on the
      // SECONDARY provider (provider !== shop_base_system) with no
      // partnerId used to silently skip the supplier-ledger entry above
      // (skipSecondarySupplierLedger) and book NOTHING anywhere — the
      // obligation vanished into no ledger at all. Reject it outright
      // instead: a secondary-system transfer only makes sense THROUGH a
      // partner (whose partner_ledger entry captures the obligation).
      // Thrown before any INSERT in this method runs, so nothing is written
      // — and even if it weren't first, `this.db.transaction(...)` rolls
      // back every statement executed so far on any throw.
      if (
        (data.provider === "OMT" || data.provider === "WHISH") &&
        data.provider !== baseSystem &&
        !data.partnerId
      ) {
        throw new Error(
          `${data.provider} is the secondary system (shop base system is ${baseSystem}) — a walk-in transaction cannot be booked directly against it; route it through a partner (set partnerId)`,
        );
      }

      // The secondary SYSTEM provider can be reached THROUGH a partner only.
      // FOR-partner means "the partner's customer, OUR system" (that is the
      // Services page's own wording next to the toggle) — and the entire
      // reason a provider is *secondary* is that the shop has no account on
      // its rails, so it cannot run anything FOR anyone there.
      //
      // The UI already enforces this: the "For Partner" toggle renders only
      // when `provider !== partnerSystem`. This guard closes the same hole on
      // the API surface, which matters because REST is directly reachable
      // (rule 19) — and because a FOR-partner RECEIVE on the secondary system
      // booked a supplier obligation against a supplier row that
      // `listSuppliers` deliberately HIDES ("no direct supplier relationship
      // — its obligations live in partner_ledger"), i.e. money real in the
      // database and invisible in the app.
      //
      // SYSTEM providers only. OMT_App / Whish_App / Binance FOR-partner are
      // untouched: those wallets hold money the shop genuinely owns, whichever
      // system is primary.
      if (
        (data.provider === "OMT" || data.provider === "WHISH") &&
        data.provider !== baseSystem &&
        data.partnerMode === "FOR"
      ) {
        throw new BusinessRuleError(
          `${data.provider} is the secondary system (shop base system is ${baseSystem}) — it can be used THROUGH a partner, not FOR one: a FOR-partner transaction runs on the shop's own rails, which it does not have on ${data.provider}`,
        );
      }

      // Session-basket deferred payment: the customer-cash side is owned by the
      // basket recorder (recordBasketPayment), so this transaction must skip its
      // own customer cash-in/out legs, pmFee handling, change, and debt. Internal
      // legs (cost outflow, crypto USDT, OMT/WHISH reserve transfer + system
      // drawer) are still written so the ledger and settlement stay correct.
      const deferPayment = data.deferPayment === true;

      // ═══════════════════════════════════════════════════════════════════════
      // AUTO-CALCULATE COMMISSION FOR OMT SERVICES
      // ═══════════════════════════════════════════════════════════════════════
      let calculatedCommission = data.commission || 0;

      if (data.provider === "OMT" && data.omtServiceType) {
        const serviceType = data.omtServiceType as OmtServiceType;
        if (serviceType === "OMT_WALLET") {
          // OMT Wallet: no fee to customer, shop earns 0.1% of transfer amount
          calculatedCommission = calculateCommission(
            serviceType,
            0,
            data.amount,
          );
        } else if (serviceType === "ONLINE_BROKERAGE") {
          // Flat $3 per transaction
          calculatedCommission = calculateCommission(serviceType, 0);
        } else {
          // Standard OMT services: resolve fee from table or user-entered value,
          // then commission = resolvedFee × commissionRate.
          // If omtFee is explicitly 0, no commission (no fee → no commission).
          const resolvedFee =
            data.omtFee != null
              ? data.omtFee
              : (lookupOmtFee(serviceType, data.amount, currency) ?? 0);
          if (resolvedFee > 0) {
            calculatedCommission = calculateCommission(
              serviceType,
              resolvedFee,
            );
          }
        }
      }

      // ═══════════════════════════════════════════════════════════════════════
      // WHISH SYSTEM: No commission (profit = $0)
      // ═══════════════════════════════════════════════════════════════════════
      if (data.provider === "WHISH") {
        calculatedCommission = 0;
      }

      // For BINANCE with payFee=true, calculate commission if omtFee and omtServiceType provided
      if (
        data.provider === "BINANCE" &&
        data.payFee &&
        data.omtFee &&
        data.omtServiceType
      ) {
        const serviceType = data.omtServiceType as OmtServiceType;
        if (
          serviceType !== "OMT_WALLET" &&
          serviceType !== "ONLINE_BROKERAGE"
        ) {
          calculatedCommission = calculateCommission(serviceType, data.omtFee);
        }
      }

      const commission = useCostPriceFlow ? price - cost : calculatedCommission;

      // COMMISSION_AT_SETTLEMENT_PLAN.md D3 — commission_model is stamped per
      // row at creation, gated on `service_type` (rule 14 — service_type is
      // ALSO what identifies a BILL everywhere else in this file: the
      // isPendingSupplierSettlement BILL branch, SUPPLIER_OWED_EXPR's
      // `service_type = 'BILL'` WHEN, and the -20,000 legacy gate below all
      // key off it).
      //
      // Only Phase 1 (bills) has actually shipped the AT_SETTLEMENT booking
      // path (the -20,000 legacy credit is skipped below and the row instead
      // joins the unsettled queue for a real commission entered at
      // settlement). Phase 2 (OMT/WHISH gross-payable flip, D1) has NOT
      // shipped: `grossOwedDelta`/`SUPPLIER_OWED_EXPR` above still NET the
      // commission auto-calculated a few lines up
      // (`calculatedCommission`/`commission`) out of the supplier_owed
      // figure for OMT/WHISH SEND/RECEIVE — i.e. those rows are still
      // EMBEDDED in every sense that matters to settlement math. Stamping
      // commission_model = 1 on them here (as an earlier draft of this file
      // did) would make `isPendingSupplierSettlement` route them into the
      // new-model settlement path, which subtracts the operator's entered
      // commission AGAIN on top of the commission already netted out of
      // supplier_owed — a double subtraction from what's paid to the
      // provider. So: BILL is born commission_model = 1 (AT_SETTLEMENT);
      // every other service_type (OMT/WHISH SEND/RECEIVE, BINANCE, BOB, app
      // wallets, ...) is born commission_model = 0 (legacy EMBEDDED) until
      // Phase 2 actually ships the gross flip for them.
      const commissionModel: number = data.serviceType === "BILL" ? 1 : 0;

      // LIRA-112 (D12) — the row's OWN supplier's commission_eligible bit
      // (v151), looked up ONLY for BILL rows (the one kind the predicate's
      // eligibility branch actually consults — OMT/WHISH SEND/RECEIVE and
      // the legacy commission_model=0 branch never read this field, so
      // skipping the lookup for them is correct, not just an optimization).
      // Gated on the same schema-drift guard as the read queries below —
      // defaults to eligible (today's pre-fix behavior) on a hand-rolled
      // test fixture that pre-dates v151.
      const supplierCommissionEligible =
        data.serviceType === "BILL" &&
        this._suppliersHasCommissionEligibleColumn()
          ? ((
              this.db
                .prepare(
                  `SELECT commission_eligible FROM suppliers WHERE provider = ? AND tenant_id = ? LIMIT 1`,
                )
                .get(data.provider, tenantId) as
                | { commission_eligible: number }
                | undefined
            )?.commission_eligible ?? 1) === 1
          : true;

      // Determine settlement status at creation time via the ONE shared
      // predicate (D2) — see its doc comment above for why the old
      // `isOmtOrWhish && commission > 0` marker breaks for new-model rows
      // (commission is entered AT settlement now, so a new-model row is born
      // with commission = 0 and must still be flagged pending by kind, not by
      // a nonzero commission).
      const isPendingSettlement = isPendingSupplierSettlement({
        commission_model: commissionModel,
        provider: data.provider,
        service_type: data.serviceType,
        commission,
        supplierCommissionEligible,
      });
      const isSettled = isPendingSettlement ? 0 : 1;
      const settledAt = isSettled ? new Date().toISOString() : null;

      // 1. Insert the financial_services row
      // Resolve the stored whish_fee: user-entered or auto-looked-up (classic
      // WHISH uses the tier table; WHISH_APP's flat 1% auto-fee is computed by
      // the frontend, so it's stored as-is with no tier fallback here).
      const storedWhishFee =
        data.provider === "WHISH"
          ? data.whishFee != null
            ? data.whishFee
            : (lookupWhishFee(data.amount) ?? null)
          : data.provider === "WHISH_APP"
            ? (data.whishFee ?? null)
            : null;

      // f — the provider's per-transfer customer fee, resolved ONCE and
      // shared (rule 14) by: the SEND/RECEIVE cash legs, the RECEIVE
      // customer-fee leg, and the gross supplier-ledger booking
      // (grossOwedDelta) below. Direction-agnostic — OMT/WHISH read the same
      // fee field regardless of serviceType (no SEND-only gate exists on
      // omtFee/whishFee in the validator either). Defaults to 0, which is
      // what makes "f defaults to 0 on RECEIVE" true with no schema change:
      // RECEIVE never had a fee field before this fix, so a RECEIVE payload
      // that omits omtFee/whishFee resolves this to 0 and every downstream
      // formula collapses to its pre-fix shape.
      const resolvedProviderFee =
        data.provider === "OMT"
          ? (data.omtFee ?? 0)
          : data.provider === "WHISH"
            ? (storedWhishFee ?? 0)
            : 0;

      // ═══════════════════════════════════════════════════════════════════
      // BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §6bis findings 1/2/4/5 — the
      // REPOSITORY is the single authoritative enforcement layer for
      // `feePayments[]`. Checked HERE — right after `resolvedProviderFee`
      // resolves, before the PFT-3b FOR-partner early return (~:1464 below)
      // — so EVERY dispatch branch (FOR-partner, THROUGH-partner,
      // deferPayment, legacy walk-in) hits the same guard before a single
      // row is written. Previously the only gate lived inside the RECEIVE
      // fee-leg block itself (`!deferPayment && !receiveFeeIncluded &&
      // receiveFeeAmt > 0 && !skipSystemDrawer`); every path where that
      // compound condition was false silently discarded `feePayments` —
      // success returned, no booking, no reconcile — which is exactly the
      // adversarial-review defect class. That inner gate stays (belt and
      // braces — LIRA-124 dropped its `!skipSystemDrawer` clause, see that
      // site, but `!deferPayment && !receiveFeeIncluded && receiveFeeAmt > 0`
      // remains); this is the one that actually rejects instead of dropping.
      if (data.feePayments && data.feePayments.length > 0) {
        if (data.partnerId) {
          // Covers BOTH partner modes: FOR (PFT-3b dispatch never reads
          // feePayments at all) and THROUGH. LIRA-124 removed the
          // `skipSystemDrawer` gate from the fee leg further down — THROUGH
          // now DOES collect a single synthesized fee leg on the cashout
          // method — but the SPLIT shape (`feePayments[]`, multiple legs
          // across different methods) stays rejected for every partner
          // transaction: a THROUGH RECEIVE's fee still only ever posts via
          // the single-leg legacy fallback below, never `bookFeeCollectionLegs`.
          // Widening that is a separate, un-asked-for feature, not this fix.
          throw new Error(
            "feePayments cannot be used on a partner transaction — the partner handles the fee",
          );
        }
        if (data.deferPayment === true) {
          throw new Error(
            "feePayments is not supported in a session basket — the pooled basket payment collects the fee",
          );
        }
        // Phase D (BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 / owner decision Q7,
        // 2026-08-06): app wallets (OMT_APP/WHISH_APP) reach this guard too
        // now. `resolvedProviderFee` above is ALWAYS 0 for them — it only
        // resolves omtFee/whishFee for the SYSTEM providers "OMT"/"WHISH"
        // (see its own comment a few lines up) — so the fee-presence check
        // must read the app wallet's OWN fee field instead. The app form
        // already sends `omtFee`/`whishFee` for display/persistence even
        // though the wallet's profit is carried by `commission` (unchanged
        // contract). §10.2: BINANCE is now wired the same way — its payload
        // builder in the Recharge crypto form (`Recharge/index.tsx`) was the
        // only blocker and has since landed (carrier-lines workstream), so
        // BINANCE mode C ("customer pays the RECEIVE fee separately, over
        // the counter, via any payment method") is live. Any OTHER provider
        // not yet wired for counter-collected fees still falls into the
        // named rejection below.
        if (
          data.provider !== "OMT" &&
          data.provider !== "WHISH" &&
          data.provider !== "OMT_APP" &&
          data.provider !== "WHISH_APP" &&
          data.provider !== "BINANCE"
        ) {
          throw new Error(
            `feePayments is not yet supported for ${data.provider}`,
          );
        }
        // BINANCE has no `omtFee`/`whishFee` field of its own — its
        // customer-facing fee is `calculatedCommission` (resolved above,
        // mutated by the BINANCE `payFee` branch when applicable). This MUST
        // match exactly what the wallet-transfer branch below computes as
        // `fee` (`Math.abs(calculatedCommission)`) — one resolution, two
        // consumers, rule 14.
        const feePresenceSource =
          data.provider === "OMT_APP"
            ? (data.omtFee ?? 0)
            : data.provider === "WHISH_APP"
              ? (data.whishFee ?? 0)
              : data.provider === "BINANCE"
                ? Math.abs(calculatedCommission)
                : resolvedProviderFee;
        if (
          data.serviceType !== "RECEIVE" ||
          data.includingFees === true ||
          !(feePresenceSource > 0)
        ) {
          throw new Error(
            "feePayments requires a fee-on-top RECEIVE with a non-zero omtFee/whishFee",
          );
        }
      }

      const pmFee = data.paymentMethodFee ?? 0;
      const pmFeeRate = data.paymentMethodFeeRate ?? null;

      // Derive what the customer actually paid (amount + currency).
      // - Multi-payment lines, single currency  → sum + that currency
      // - Multi-payment lines, mixed currencies → null/null (caller must read payment legs)
      // - No payments array (legacy)            → service price in service currency
      let paidAmount: number | null;
      let paidCurrency: string | null;
      if (data.payments && data.payments.length > 0) {
        const currencies = new Set(data.payments.map((p) => p.currencyCode));
        if (currencies.size === 1) {
          paidAmount = data.payments.reduce((s, p) => s + p.amount, 0);
          paidCurrency = data.payments[0].currencyCode;
        } else {
          paidAmount = null;
          paidCurrency = null;
        }
      } else {
        paidAmount = price > 0 ? price : data.amount;
        paidCurrency = currency;
      }

      // Determine primary client info for backward compatibility
      // For SEND: primary client is sender; for RECEIVE: primary client is receiver
      const primaryClientId =
        data.serviceType === "SEND"
          ? data.senderClientId || data.clientId
          : data.receiverClientId || data.clientId;
      const primaryClientName =
        data.serviceType === "SEND"
          ? data.senderName || data.clientName
          : data.receiverName || data.clientName;
      const primaryClientPhone =
        data.serviceType === "SEND"
          ? data.senderPhone || data.phoneNumber
          : data.receiverPhone || data.phoneNumber;

      const stmt = this.db.prepare(`
        INSERT INTO financial_services (
          provider, service_type, amount, currency,
          commission, cost, price, paid_by, paid_amount, paid_currency, client_id,
          client_name, reference_number, phone_number,
          sender_name, sender_phone, receiver_name, receiver_phone,
          sender_client_id, receiver_client_id,
          omt_service_type, omt_fee, whish_fee, profit_rate, pay_fee,
          item_key, note, is_settled, settled_at,
          payment_method_fee, payment_method_fee_rate, commission_model,
          tenant_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
      `);

      const result = stmt.run(
        data.provider,
        data.serviceType,
        data.amount,
        currency,
        commission,
        cost,
        price,
        paidBy,
        paidAmount,
        paidCurrency,
        primaryClientId || null,
        primaryClientName || null,
        data.referenceNumber || null,
        primaryClientPhone || null,
        data.senderName || null,
        data.senderPhone || null,
        data.receiverName || null,
        data.receiverPhone || null,
        data.senderClientId || null,
        data.receiverClientId || null,
        data.omtServiceType || null,
        data.omtFee || null,
        storedWhishFee,
        data.profitRate || null,
        data.payFee ? 1 : 0,
        data.itemKey || null,
        data.note || null,
        isSettled,
        settledAt,
        pmFee,
        pmFeeRate,
        commissionModel,
        tenantId,
        data.transaction_time ?? null,
      );
      const id = Number(result.lastInsertRowid);

      // Store partner_id and partner_mode on the record if provided
      if (data.partnerId) {
        this.db
          .prepare(
            `UPDATE financial_services SET partner_id = ?, partner_mode = ? WHERE id = ? AND tenant_id = ?`,
          )
          .run(data.partnerId, data.partnerMode || "THROUGH", id, tenantId);
      }

      // The unified transaction, every payment leg, and any debt_ledger row
      // below are all stamped with `createdBy` and all carry a FK to
      // users(id) that the app enforces (main.ts: PRAGMA foreign_keys=ON).
      // Hardcoding 1 threw "FOREIGN KEY constraint failed" (surfaced as
      // "Statement execution failed") on any DB whose admin isn't user 1.
      // Prefer the acting user; fall back to a real user id, never a literal.
      const createdBy = data.userId ?? this.resolveFallbackUserId();
      const note = data.note || null;

      // Resolve primary client ID: look up by phone number if not provided
      let resolvedPrimaryClientId = primaryClientId;
      const primaryPhone =
        data.serviceType === "SEND"
          ? data.senderPhone || data.phoneNumber
          : data.receiverPhone || data.phoneNumber;
      const primaryName =
        data.serviceType === "SEND"
          ? data.senderName || data.clientName
          : data.receiverName || data.clientName;

      if (!resolvedPrimaryClientId && primaryName) {
        if (primaryPhone) {
          // Try to find existing client by phone number
          const existing = this.db
            .prepare(
              `SELECT id FROM clients WHERE phone_number = ? AND tenant_id = ? LIMIT 1`,
            )
            .get(primaryPhone, tenantId) as { id: number } | undefined;
          if (existing) {
            resolvedPrimaryClientId = existing.id;
          } else {
            // Auto-create client with phone
            const insertResult = this.db
              .prepare(
                `INSERT INTO clients (full_name, phone_number, notes, tenant_id)
                        VALUES (?, ?, ?, ?)`,
              )
              .run(
                primaryName,
                primaryPhone,
                "Auto-created from OMT/WHISH service",
                tenantId,
              );
            resolvedPrimaryClientId = Number(insertResult.lastInsertRowid);
          }
        } else {
          // No phone — try to find existing client by name
          const existing = this.db
            .prepare(
              `SELECT id FROM clients WHERE full_name = ? AND tenant_id = ? LIMIT 1`,
            )
            .get(primaryName, tenantId) as { id: number } | undefined;
          if (existing) {
            resolvedPrimaryClientId = existing.id;
          }
        }
      }

      // Create unified transaction row
      //
      // App-wallet SEND (OMT_APP / WHISH_APP): the row carries the TOTAL the
      // customer is charged (transfer + fee), not the bare transfer. This
      // matches recharge (row amount = customer-paid price) and app-wallet
      // RECEIVE (data.amount is already the gross wallet inflow incl. fee) —
      // a $20+$2-fee SEND used to read "↓ $20" in the table while the
      // customer owed $22. Profit reports are unaffected (fsRevenue reads the
      // financial_services row, not this amount). Binance is excluded: its
      // `currency` is USDT so its amount fields are 0 and the summary carries
      // the figure.
      const isAppWalletSend =
        (data.provider === "OMT_APP" || data.provider === "WHISH_APP") &&
        data.serviceType === "SEND";
      const unifiedAmount = isAppWalletSend
        ? data.amount + Math.abs(commission)
        : data.amount;

      const txnId = getTransactionRepository().createTransaction({
        type: TRANSACTION_TYPES.FINANCIAL_SERVICE,
        source_table: "financial_services",
        source_id: id,
        user_id: createdBy,
        amount_usd: useCostPriceFlow
          ? currency === "USD"
            ? price
            : 0
          : currency === "USD"
            ? unifiedAmount
            : 0,
        amount_lbp: useCostPriceFlow
          ? currency === "LBP"
            ? price
            : 0
          : currency === "LBP"
            ? unifiedAmount
            : 0,
        // Commission (service currency) + kept change (T3, tender-native).
        profit_usd:
          (currency === "USD" ? commission : 0) + (data.kept_change_usd ?? 0),
        profit_lbp:
          (currency === "LBP" ? commission : 0) + (data.kept_change_lbp ?? 0),
        client_id: resolvedPrimaryClientId ?? null,
        // For-partner services label the row with the partner (owner ask: the
        // transactions table shows "<partner> [partner]" in the client column).
        client_name: isForPartner
          ? `${
              (
                this.db
                  .prepare(
                    `SELECT name FROM partners WHERE id = ? AND tenant_id = ?`,
                  )
                  .get(data.partnerId, tenantId) as { name: string } | undefined
              )?.name ?? `#${data.partnerId}`
            } [partner]`
          : null,
        summary: (() => {
          // iPick/Katsh: a catalog item purchase or bill payment, not a
          // sender/receiver transfer — surface the selected item(s)
          // (category + label, via `data.note`) or call out a bill payment
          // explicitly, instead of the generic provider+amount line below.
          const isKatchLike =
            data.provider === "iPick" || data.provider === "Katsh";
          // Wallet-provider catalog items (Whish App / OMT App grid sales)
          // are cost/price rows, not transfers — they get the same item-style
          // line. Real transfers never send cost > 0 (OmtWhishAppTransferForm),
          // so useCostPriceFlow cleanly separates the two; without this a
          // Whish App item sale read "WHISH_APP SEND: 150000 LBP (+30,383 LBP
          // fee)" — a transfer line whose "fee" was actually the item margin.
          const isItemSale = useCostPriceFlow && !!note;
          // Friendly provider label for the item/bill lines only; the generic
          // transfer line below keeps the raw enum (see providerDisplayLabel).
          const providerLabel = providerDisplayLabel(data.provider);
          let head =
            isKatchLike && data.serviceType === "BILL"
              ? `${providerLabel} Bill: ${data.amount} ${currency}`
              : (isKatchLike || isItemSale) && note
                ? `${providerLabel}: ${note} — ${data.amount} ${currency}`
                : `${data.provider} ${data.serviceType}: ${primaryName ? `${primaryName} — ` : ""}${data.amount} ${currency}`;

          // Wallet transfers (Binance / OMT App / Whish App): the fee the shop
          // charges on top is the commission — surface it, otherwise the audit
          // row reads "20 USD" while the customer was charged 22 and the fee
          // is invisible anywhere in the table. Cost/price rows are excluded:
          // there the commission is the price − cost margin already inside the
          // amount the customer paid, not a fee on top.
          const isWalletProviderTransfer =
            data.provider === "BINANCE" ||
            data.provider === "OMT_APP" ||
            data.provider === "WHISH_APP";
          if (isWalletProviderTransfer && !useCostPriceFlow && commission > 0) {
            const fmtFee =
              currency === "LBP"
                ? `${Math.round(commission).toLocaleString()} LBP`
                : `$${commission}`;
            head += ` (+${fmtFee} fee)`;
          }

          // When the customer paid in a currency different from the service-denominated
          // currency, surface that on the audit row so it's visible at a glance.
          if (paidCurrency && paidAmount != null && paidCurrency !== currency) {
            const fmtPaid =
              paidCurrency === "LBP"
                ? `${Math.round(paidAmount).toLocaleString()} LBP`
                : `$${paidAmount.toFixed(2)}`;
            return `${head} (paid ${fmtPaid})`;
          }
          return head;
        })(),
        metadata_json: {
          provider: data.provider,
          service_type: data.serviceType,
          amount: data.amount,
          currency,
          commission,
          cost,
          price,
          paid_by: paidBy,
          paid_amount: paidAmount,
          paid_currency: paidCurrency,
          item_key: data.itemKey,
          // CARRIER_LEGS_VOID_ASYMMETRY.md (design B+): multi-unit split
          // checkouts (KatchForm bills / FinancialForm catalog units) stamp
          // these so the generic void/refund guard can detect and block a
          // single-unit void, and voidCheckoutGroup can find every sibling.
          // Absent on single-unit checkouts (no metadata noise).
          ...(data.split_group
            ? {
                split_group: data.split_group,
                split_role: data.split_role,
                split_units: data.split_units,
              }
            : {}),
        },
        // Stamped rate-of-record — `recordExchangeRate`, which reflects the
        // operator's tendered rate when it's within `TENDER_RATE_BAND_PCT` of
        // the server rate (owner decision 2026-08-08), else falls back to
        // `stampedExchangeRate` (see the field's doc and the comment at this
        // method's top). The RECONCILIATION anchor below is unaffected —
        // every `reconcileLegs`/`postPayoutLegs` call in this method still
        // passes `exchangeRate: stampedExchangeRate`, never this value.
        exchange_rate: recordExchangeRate,
        transaction_time: data.transaction_time,
      });

      // insertPayment / upsertBalanceDelta are shared wrapper objects used by
      // ~50 call sites throughout this transaction. Rather than touch every
      // call site to thread `tenant_id` through, each is wrapped so the
      // existing `.run(...)` call sites (all money-flow control logic —
      // untouched) transparently carry the current tenant. CQ-3: the SQL
      // itself now lives in the shared moneyPosting helpers, called from
      // inside these same wrappers — every call site below is unchanged.
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

      // BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4, rule 14 — the ONE per-leg
      // fee-collection booking loop, shared by the system OMT/WHISH RECEIVE
      // branch (Phase A, ~:2712 below) and the app-wallet OMT_APP/WHISH_APP
      // RECEIVE mode-C branch (Phase D, owner decision Q7 2026-08-06: "the
      // customer can pay the fee separately in different payment methods").
      // Reconciles `feePayments` (S2 hard-reject) against the transaction's
      // OWN fee, then books each leg:
      //  - CUSTOMER_ACCOUNT  → `bookClientDebtCharge('Service Debt')`
      //    (requires a resolved client — rule 20: already in
      //    MODULE_DEBT_TRANSACTION_TYPES, so the generic `_cancelDebt`
      //    reversal covers it, no new charge type needed).
      //  - Drawer-affecting  → payment row + drawer delta via
      //    `resolveServiceCashDrawer`, which correctly falls through to
      //    `paymentMethodToDrawerName` for app-wallet transactions
      //    ("OMT_APP" !== ctx.baseSystem ever, so the fee never misroutes
      //    into the PCD — verified against the resolver's own doc, not
      //    assumed).
      //  - Anything else (e.g. GIFT_CARD) → hard-reject. `reconcileLegs`
      //    already counted the leg toward the fee total, so silently
      //    dropping the booking would pass reconciliation while nothing
      //    collects the fee — the phantom-fee bug class (plan §2 bug 1)
      //    reintroduced inside a new path.
      const bookFeeCollectionLegs = (params: {
        feePayments: NonNullable<CreateFinancialServiceData["feePayments"]>;
        feeAmount: number;
        currency: string;
        provider: string;
        noteSuffix: string;
        contextLabel: string;
      }) => {
        reconcileLegs({
          inLegs: params.feePayments,
          expectedTotals: expectedTotalIn(params.feeAmount, params.currency),
          exchangeRate: stampedExchangeRate,
          tenderExchangeRate: data.tender_exchange_rate,
          context: params.contextLabel,
        });
        for (const leg of params.feePayments) {
          const legAmount = Math.abs(leg.amount);
          if (legAmount <= 0) continue;
          const note = `${params.provider} ${params.noteSuffix}`;
          if (leg.method === "CUSTOMER_ACCOUNT") {
            if (!resolvedPrimaryClientId) {
              throw new Error(
                "Client is required to charge the RECEIVE fee to a customer account",
              );
            }
            bookClientDebtCharge(this.db, {
              clientId: resolvedPrimaryClientId,
              transactionType: "Service Debt",
              amountUsd: leg.currencyCode === "USD" ? legAmount : 0,
              amountLbp: leg.currencyCode === "LBP" ? legAmount : 0,
              transactionId: txnId,
              note,
              createdBy,
              tenantId,
            });
          } else if (isDrawerAffectingMethod(leg.method)) {
            const legDrawer = resolveServiceCashDrawer(
              leg.method,
              cashDrawerCtx,
            );
            insertPayment.run(
              txnId,
              leg.method,
              legDrawer,
              leg.currencyCode,
              legAmount,
              note,
              createdBy,
            );
            upsertBalanceDelta.run(legDrawer, leg.currencyCode, legAmount);
          } else {
            throw new Error(
              `${leg.method} is not a valid fee-collection method — use a drawer-affecting method or CUSTOMER_ACCOUNT`,
            );
          }
        }
      };

      // Separate shop→customer change (OUT) legs up front so every inflow branch
      // below operates on customer-paid (IN) legs only. OUT legs are processed
      // once at the end of the transaction.
      const { inLegs: inPayments, outLegs: returnLegs } = partitionLegs(
        data.payments,
      );
      if (returnLegs.length > 0) {
        data.payments = inPayments;
      }

      // Shared OUT-leg processor — the ONE loop that debits drawer-affecting
      // OUT legs (rule 16: no flow-specific branch may iterate them again).
      // Legacy path: change handed back to the customer. FOR-partner path:
      // the shop's own disbursement legs (note relabeled accordingly).
      const processReturnLegs = (noteLabel = "Change returned") => {
        for (const r of deferPayment ? [] : returnLegs) {
          const amt = Math.abs(r.amount);
          if (amt <= 0) continue;
          if (r.method === "CUSTOMER_ACCOUNT") {
            if (!resolvedPrimaryClientId) {
              throw new Error(
                "Client is required to return change as store credit",
              );
            }
            getDebtService().addCredit({
              clientId: resolvedPrimaryClientId,
              amountUsd: r.currencyCode === "USD" ? amt : 0,
              amountLbp: r.currencyCode === "LBP" ? amt : 0,
              note: noteLabel,
              userId: createdBy,
              transactionId: txnId,
            });
          } else if (isDrawerAffectingMethod(r.method)) {
            // Primary Cash Drawer plan §8.2/§2#2: a primary-system change/
            // return leg (classic walk-in change, or a FOR-partner SEND's
            // disbursement OUT legs — see the FOR-partner dispatch below)
            // comes back out of the PCD, not General.
            const drawerName = resolveServiceCashDrawer(
              r.method,
              cashDrawerCtx,
            );
            insertPayment.run(
              txnId,
              r.method,
              drawerName,
              r.currencyCode,
              -amt,
              noteLabel,
              createdBy,
            );
            upsertBalanceDelta.run(drawerName, r.currencyCode, -amt);
          }
        }
      };

      // Telecom "Only Days" returned credits (LIRA-090 spec §5.1/§6.1) — an
      // internal shop credit return (Alfa/MTC drawer top-up + the shop's
      // primary carrier line for that carrier, spec §5.1/§8) tied to the
      // ITEM, independent of who pays, so it runs for the normal cost/price
      // flow AND the FOR-partner catalog arm below.
      //
      // Renamed from processKatshReturnedCredits (LIRA-090 bug 1, spec
      // §6.1): the identical Only-Days checkbox on the iPick tab used to
      // book NOTHING because this was hard-gated on `provider === "Katsh"`
      // — both reseller apps sell the same alfa/mtc catalog, so both must
      // book the SAME leg (rule 16: re-gate the existing leg, never add a
      // second one beside it — there is still exactly one `insertPayment`
      // call for the credit-return leg below).
      const processTelecomCreditReturn = () => {
        const isTelecomResellerApp =
          data.provider === "Katsh" || data.provider === "iPick";
        if (!isTelecomResellerApp) return;

        // Bug 2 groundwork (spec §6, walk-in aggregated payload): a walk-in
        // checkout that bundles several Only-Days lines into ONE
        // transaction sends `telecomCreditReturns`, one entry per line.
        // Every other caller (today's session-cart path — one transaction
        // per line — and every existing test) instead sends the single
        // scalar fields, normalized here into the same one-element shape
        // so ONE loop books both shapes (rule 14).
        const lines: TelecomCreditReturnLine[] =
          data.telecomCreditReturns && data.telecomCreditReturns.length > 0
            ? data.telecomCreditReturns
            : [
                {
                  itemCategory: data.itemCategory,
                  mobileServiceItemId: data.mobileServiceItemId,
                  returnedCreditsUsd: data.returnedCreditsUsd,
                },
              ];

        for (const line of lines) {
          // The catalog item this line is selling — resolved so the
          // split-completeness gate and the computed default (spec §2/
          // §5.1) can both read its cost_lbp/days_cost_lbp/credits. Absent
          // for every caller that hasn't been migrated to send
          // `mobileServiceItemId` yet (no regression, spec §9).
          const item =
            line.mobileServiceItemId != null
              ? getMobileServiceItemRepository().getById(
                  line.mobileServiceItemId,
                )
              : null;

          // spec §2/§5.1: an explicitly supplied value (including 0 — the
          // operator dialing the return down to nothing) is an override
          // that ALWAYS wins; omitted means "compute the default" — but
          // ONLY when the item's split is complete (rule 14: the ONE
          // shared gate predicate, imported, never re-derived). A
          // split-incomplete item (the default state today) has no default
          // to fall back to and keeps today's fully-manual behavior.
          let resolvedCredits: number;
          if (line.returnedCreditsUsd !== undefined) {
            resolvedCredits = line.returnedCreditsUsd;
          } else if (item && isTelecomSplitComplete(item)) {
            resolvedCredits = maxReturnableCredits(item.credits as number);
          } else {
            resolvedCredits = 0;
          }
          if (!(resolvedCredits > 0)) continue;

          const categoryRaw = line.itemCategory ?? item?.category;
          const isAlfa = categoryRaw === "alfa" || categoryRaw === "Alfa";
          const isMtc =
            categoryRaw === "mtc" ||
            categoryRaw === "Mtc" ||
            categoryRaw === "MTC";
          if (!isAlfa && !isMtc) {
            // No way to tell which drawer/carrier this belongs to —
            // nothing safe to book. Should not happen for a real telecom
            // sale (itemCategory is always sent today); defensive only.
            financialLogger.warn(
              { line },
              "processTelecomCreditReturn: could not resolve alfa/mtc category — skipping this line",
            );
            continue;
          }
          const creditDrawer = isAlfa ? "Alfa" : "MTC";

          insertPayment.run(
            txnId,
            "CREDIT_RETURN",
            creditDrawer,
            "USD",
            resolvedCredits,
            `Returned credits: ${resolvedCredits} USD`,
            createdBy,
          );
          upsertBalanceDelta.run(creditDrawer, "USD", resolvedCredits);

          // spec §5.1/§8: the return also lands on the shop's primary line
          // for this carrier, tied to THIS transaction (rule 20 reversal
          // owner — carrier_line_movements). CarrierLineService is
          // deliberately "informational only" (no drawer legs) by its own
          // doc — a shop that hasn't configured a primary line yet still
          // gets the (mandatory) drawer credit above; only this
          // informational side effect is skipped + logged, never blocks
          // the sale (Phase 3b explicitly left this empty-state UX
          // decision to Phase 4 — see CarrierLineRepository.getPrimary's
          // doc).
          const carrier: CarrierKey = isAlfa ? "alfa" : "mtc";
          const primaryLine = getCarrierLineRepository().getPrimary(carrier);
          if (primaryLine) {
            const movement = getCarrierLineService().applyMovement({
              carrierLineId: primaryLine.id,
              creditsDelta: resolvedCredits,
              reason: "ONLY_DAYS_RETURN",
              transactionId: txnId,
            });
            if (!movement.success) {
              throw new Error(
                `Failed to apply carrier line movement: ${movement.error}`,
              );
            }
          } else {
            financialLogger.warn(
              { carrier },
              "processTelecomCreditReturn: no primary carrier line configured — drawer credited, carrier-line movement skipped",
            );
          }
        }
      };

      // ═══════════════════════════════════════════════════════════════════════
      // PFT-3b — FOR-PARTNER DISPATCH (early return)
      // ═══════════════════════════════════════════════════════════════════════
      // Owner-validated catalog (docs/plans/done_plans/PARTNER_FOR_TRANSACTIONS_PLAN.md,
      // "⭐ VALIDATED FLOW CATALOG"): a for-partner financial service has NO
      // walk-in customer — no customer cash-in, no payout, no client debt, no
      // pm-fee row, no supplier auto-record, no commission cash inflow. The
      // partner owes (SEND → DEBIT) or is owed (RECEIVE → CREDIT) on
      // partner_ledger, settled later on the Partners page. Returning here
      // means the entire legacy walk-in dispatch below never runs in FOR mode
      // — normal + THROUGH-partner behavior is byte-for-byte untouched.
      //
      // Profit note: commission/margin stays stamped on the FS + txn rows
      // exactly as the normal path stamps it (iPick/Katsh keep is_settled = 1
      // for the supplier-settlement machinery). Recognition, however, is
      // deferred until the PARTNER settles — ProfitRepository's partner gate
      // (notPartnerPending / txnNotPartnerPending, no provider carve-out as of
      // 2026-07-14) zeroes every FOR_% source until settlement FIFO covers it.
      // Deferral is read-side (PFT-6), not faked by withholding the stamp here.
      if (isForPartner) {
        const partnerId = data.partnerId as number;
        const serviceDrawer = this.mapDrawerName(data.provider);
        const amountAbs = Math.abs(data.amount);
        const fee = Math.abs(calculatedCommission);

        // No walk-in customer: any customer-paid IN leg is a modeling error —
        // reject rather than book a phantom cash-in (mirrors SalesRepository /
        // RechargeRepository / LotoTicketRepository, PFT-R).
        // FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §3 slice 2: `paidBy`
        // (line ~897) already unifies `data.cashoutMethod` (RECEIVE) and
        // `data.paidByMethod` (SEND/BILL) — passing it here closes the exact
        // gap the plan named for this repo ("misses paidByMethod /
        // cashoutMethod"). Safe against every branch below: the cost/price
        // catalog branch, the BINANCE SEND branch, and the RECEIVE branch
        // all hard-require `returnLegs.length === 0` (no legs of any kind) —
        // none of them has a legitimate use for `paidBy`, so a non-CASH
        // value reaching this point is always dead/stale data (the owner's
        // RECEIVE-shaped repro: a "Cashout" method left on
        // CUSTOMER_ACCOUNT from before the operator ticked "For Partner").
        // The ONE branch with a genuine disbursement-source concept —
        // OMT/WHISH-family SEND transfers — carries that selection through
        // `returnLegs` (its own `returnLegs.length === 0` check, below),
        // never through this field: every live caller (FinancialForm.tsx,
        // OmtWhishAppTransferForm.tsx, Services/index.tsx) sends the chosen
        // disbursement method as the OUT leg's own `method`, not as a
        // top-level `paidByMethod`/`cashoutMethod` — verified against
        // Services/index.tsx's state management, which guarantees
        // `paidByMethod` only leaves "CASH" when a payment line exists,
        // which is exactly when `payments[]` supersedes the top-level field
        // and it is never sent at all.
        assertNoCounterPayment(
          inPayments.length > 0,
          paidBy,
          "financial service",
        );
        // CUSTOMER_ACCOUNT has no meaning without a customer.
        assertNoCustomerAccountLeg(
          returnLegs.some((r) => r.method === "CUSTOMER_ACCOUNT"),
          "A partner financial service cannot carry a CUSTOMER_ACCOUNT leg",
        );

        // Ledger notes carry the human detail the Partners page shows: the
        // catalog item label for cost/price rows (e.g. "alfa: 7.58 (Prepaid)")
        // or the provider + direction for transfers (owner ask 2026-07-14).
        const ledgerNotes = note ?? `${data.provider} ${data.serviceType}`;

        const insertPartnerLedger = (
          transactionType: ForPartnerLedgerType,
          ledgerAmount: number,
          ledgerCurrency: string,
          direction: "DEBIT" | "CREDIT",
        ) => {
          // CQ-7: routed through PartnerRepository.addLedgerEntry instead of
          // a raw INSERT — same row values (reference_table is always
          // 'financial_services' here, matching the prior literal), plus
          // tenant stamping via getCurrentTenantId() inside addLedgerEntry
          // (same tenant as this transaction's `tenantId`, read from the
          // same fixed/request-scoped context). addLedgerEntry's coverage
          // hook only fires for transaction_type === 'SETTLEMENT' or
          // applyCoverage === true — neither applies to FOR_% rows, so no
          // FIFO coverage runs here (verified in PartnerRepository.ts).
          getPartnerRepository().addLedgerEntry({
            partner_id: partnerId,
            transaction_type: transactionType,
            reference_table: "financial_services",
            reference_id: id,
            amount: ledgerAmount,
            currency: ledgerCurrency,
            direction,
            notes: ledgerNotes,
            user_id: createdBy,
            created_at: data.transaction_time ?? undefined,
          });
        };

        if (useCostPriceFlow) {
          // ── Catalog items + bills (iPick / Katsh / app-wallet grids): the
          // shop consumes provider stock at cost as normal; the partner owes
          // the SELLING price (margin immediate — is_settled = 1 already).
          const forType =
            data.provider === "iPick"
              ? "FOR_IPICK"
              : data.provider === "Katsh"
                ? "FOR_KATSH"
                : data.provider === "OMT_APP"
                  ? "FOR_OMT_APP_SEND"
                  : data.provider === "WHISH_APP"
                    ? "FOR_WHISH_APP_SEND"
                    : null;
          if (!forType) {
            throw new Error(
              `FOR-partner is not supported for provider ${data.provider} on the cost/price flow`,
            );
          }
          if (returnLegs.length > 0) {
            throw new Error(
              "A partner catalog sale has no payment legs — the full selling price goes on the partner's tab",
            );
          }
          if (cost > 0) {
            insertPayment.run(
              txnId,
              data.provider,
              serviceDrawer,
              currency,
              -Math.abs(cost),
              `Cost: ${data.provider}`,
              createdBy,
            );
            upsertBalanceDelta.run(serviceDrawer, currency, -Math.abs(cost));
          }
          insertPartnerLedger(forType, Math.abs(price), currency, "DEBIT");
          processTelecomCreditReturn();
        } else if (data.serviceType === "SEND") {
          if (data.provider === "BINANCE") {
            // The USDT leaves the shop's Binance drawer (real payment row so
            // void reverses it); the partner owes the USD SELL PRICE
            // (amount + fee — normal pricing, no surcharge). Partner debt is
            // USD, never USDT (owner decision — a partner never carries a
            // USDT balance).
            if (returnLegs.length > 0) {
              throw new Error(
                "A partner Binance SEND has no payment legs — the USDT leaves the Binance drawer and the USD price goes on the partner's tab",
              );
            }
            insertPayment.run(
              txnId,
              data.provider,
              serviceDrawer,
              "USDT",
              -amountAbs,
              "Crypto sent (for partner)",
              createdBy,
            );
            upsertBalanceDelta.run(serviceDrawer, "USDT", -amountAbs);
            insertPartnerLedger(
              "FOR_BINANCE_SEND",
              amountAbs + fee,
              "USD",
              "DEBIT",
            );
          } else if (
            data.provider === "OMT" ||
            data.provider === "WHISH" ||
            data.provider === "OMT_APP" ||
            data.provider === "WHISH_APP"
          ) {
            // The shop fronts the transfer via the OUT-payment form — each
            // leg's drawer follows its method (cash→General, OMT_APP→OMT_App,
            // …) and the fee is already inside what the form disburses. The
            // partner owes EXACTLY what the shop paid, mirrored per currency
            // (native, never converted — the T2 lesson). No system-drawer
            // reserve/credit: the disbursement legs ARE the money movement.
            if (returnLegs.length === 0) {
              throw new Error(
                "A partner SEND must include the shop's disbursement as OUT payment legs",
              );
            }
            const forType =
              data.provider === "OMT"
                ? "FOR_OMT_SEND"
                : data.provider === "WHISH"
                  ? "FOR_WHISH_SEND"
                  : data.provider === "OMT_APP"
                    ? "FOR_OMT_APP_SEND"
                    : "FOR_WHISH_APP_SEND";
            const byCurrency = new Map<string, number>();
            for (const r of returnLegs) {
              const amt = Math.abs(r.amount);
              if (amt <= 0) continue;
              if (!isDrawerAffectingMethod(r.method)) {
                throw new Error(
                  "A partner SEND disbursement leg must use a drawer-affecting method",
                );
              }
              if (r.currencyCode !== "USD" && r.currencyCode !== "LBP") {
                throw new Error(
                  "Partner debt must be USD or LBP — pick a USD/LBP disbursement method",
                );
              }
              byCurrency.set(
                r.currencyCode,
                (byCurrency.get(r.currencyCode) ?? 0) + amt,
              );
            }
            for (const [legCurrency, total] of byCurrency) {
              insertPartnerLedger(forType, total, legCurrency, "DEBIT");
            }
            // The legs themselves are debited ONCE by processReturnLegs below.
          } else {
            throw new Error(
              `FOR-partner is not supported for provider ${data.provider}`,
            );
          }
        } else if (data.serviceType === "RECEIVE") {
          // Money arrives INTO the shop's service drawer; the shop OWES the
          // partner (CREDIT). No payout leg at receive time — the partner is
          // paid at settlement on the Partners page.
          if (returnLegs.length > 0) {
            throw new Error(
              "A partner RECEIVE has no payout legs — the shop owes the partner on their tab and pays at settlement",
            );
          }
          let forType: ForPartnerLedgerType;
          let creditAmount: number;
          let creditCurrency: string;
          let drawerCurrency: string;
          if (data.provider === "OMT") {
            // Full amount, no fee (owner: OMT system receive has no fee; the
            // shop's system commission is stamped as profit, not deducted).
            forType = "FOR_OMT_RECEIVE";
            creditAmount = amountAbs;
            creditCurrency = currency;
            drawerCurrency = currency;
          } else if (data.provider === "WHISH") {
            forType = "FOR_WHISH_RECEIVE";
            creditAmount = amountAbs;
            creditCurrency = currency;
            drawerCurrency = currency;
          } else if (data.provider === "OMT_APP") {
            forType = "FOR_OMT_APP_RECEIVE";
            creditAmount = amountAbs - fee;
            creditCurrency = currency;
            drawerCurrency = currency;
          } else if (data.provider === "WHISH_APP") {
            forType = "FOR_WHISH_APP_RECEIVE";
            creditAmount = amountAbs - fee;
            creditCurrency = currency;
            drawerCurrency = currency;
          } else if (data.provider === "BINANCE") {
            // Drawer moves in USDT; the partner is owed USD (owner decision).
            forType = "FOR_BINANCE_RECEIVE";
            creditAmount = amountAbs - fee;
            creditCurrency = "USD";
            drawerCurrency = "USDT";
          } else {
            throw new Error(
              `FOR-partner is not supported for provider ${data.provider}`,
            );
          }

          // Primary Cash Drawer plan §2#6 / decision #6 (2026-07-30 follow-up):
          // a FOR-partner RECEIVE runs on the shop's OWN primary system but
          // moves NO drawer at transaction time — no real cash arrived in
          // the PCD (the partner's customer dealt with the partner's own
          // counter, not the shop's till). Obligations only: the provider
          // still owes/is owed on the real OMT/WHISH rails (gross supplier
          // ledger, same formula a walk-in RECEIVE books) and the partner
          // owes the shop on their tab (partner ledger, below). The
          // partner's later collection pays out of the PCD via the normal
          // partner-settlement payment legs (resolveServiceCashDrawer at
          // settlement time — SupplierRepository/PartnerRepository, not
          // owned by this slice).
          //
          // App-wallet/Binance FOR-partner RECEIVE is UNCHANGED (decision
          // #5): those wallet balances are real money the shop owns, not a
          // float, so the wallet drawer still moves here exactly as before.
          const isPrimarySystemProvider =
            data.provider === "OMT" || data.provider === "WHISH";
          if (isPrimarySystemProvider) {
            try {
              const supplierRepo = getSupplierRepository();
              const supplier = supplierRepo.getByProvider(data.provider);
              if (supplier) {
                const ledgerAmount = grossOwedDelta({
                  serviceType: "RECEIVE",
                  provider: data.provider,
                  fee: resolvedProviderFee,
                  commission: calculatedCommission,
                  cost: 0,
                  amount: data.amount,
                });
                supplierRepo.addLedgerEntry({
                  supplier_id: supplier.id,
                  entry_type: "TOP_UP",
                  amount_usd: currency === "USD" ? ledgerAmount : 0,
                  amount_lbp: currency === "LBP" ? ledgerAmount : 0,
                  note: `Auto: RECEIVE via ${data.provider} (for partner)${data.itemKey ? ` [${data.itemKey}]` : ""}`,
                  created_by: createdBy,
                  is_auto: true,
                  source_ref_table: "financial_services",
                  source_ref_id: id,
                });
              }
            } catch {
              // Supplier auto-record is non-critical; don't fail the transaction
              // (mirrors the general "Auto-record supplier debt" site below).
            }
          } else {
            insertPayment.run(
              txnId,
              data.provider,
              serviceDrawer,
              drawerCurrency,
              amountAbs,
              `${data.provider} received (for partner)`,
              createdBy,
            );
            upsertBalanceDelta.run(serviceDrawer, drawerCurrency, amountAbs);
          }

          if (creditAmount > 0) {
            insertPartnerLedger(
              forType,
              creditAmount,
              creditCurrency,
              "CREDIT",
            );
          }
        } else {
          // Bills (serviceType "BILL") without a cost/price pair have no
          // FOR_* mapping yet — follow-up, not silently mis-booked.
          throw new Error(
            `FOR-partner is not supported for service type ${data.serviceType}`,
          );
        }

        // The shop's disbursement OUT legs (transfer SEND) — debited exactly
        // once by the ONE shared OUT-leg processor.
        processReturnLegs("Partner disbursement");
        return { id, drawer: legacyDrawerLabel };
      }

      if (useCostPriceFlow) {
        // ─── COST/PRICE FLOW (iPick, Katsh, WHISH_APP, OMT_APP, BINANCE) ───
        const providerDrawer = this.mapDrawerName(data.provider);

        // Cost outflow: shop pays the provider
        if (cost > 0) {
          insertPayment.run(
            txnId,
            data.provider,
            providerDrawer,
            currency,
            -Math.abs(cost),
            `Cost: ${data.provider}`,
            createdBy,
          );
          upsertBalanceDelta.run(providerDrawer, currency, -Math.abs(cost));
        }

        // S2 hard-reject reconciliation (Payment-Legs Integrity plan, Wave 8,
        // owner decision 2026-07-18): a multi-unit cart checkout (KatchForm
        // bills / FinancialForm catalog items) books ALL of its legs against
        // exactly ONE carrier transaction — this unit's own `price` is only
        // that unit's share of the cart, not what the legs need to cover.
        // Reconcile against `checkoutTotal` (the full cart total) INSTEAD of
        // `price` when the caller supplied it. No-ops (same as every other
        // `reconcileLegs` site) when `data.payments` is empty/undefined
        // (deferPayment siblings never carry legs) or when `checkoutTotal`
        // is absent — legacy single-unit checkouts and scripted callers are
        // unaffected.
        if (!deferPayment && data.checkoutTotal) {
          reconcileLegs({
            inLegs: data.payments,
            outLegs: returnLegs,
            keptChange: {
              usd: data.kept_change_usd,
              lbp: data.kept_change_lbp,
            },
            expectedTotals: {
              usd: data.checkoutTotal.usd,
              lbp: data.checkoutTotal.lbp,
            },
            exchangeRate: stampedExchangeRate,
            tenderExchangeRate: data.tender_exchange_rate,
            context: `${data.provider} ${data.serviceType} checkout`,
          });
        }

        // Price inflow: customer pays the shop.
        // Deferred (session basket): the basket recorder owns the customer-cash
        // inflow + any on-account debt, so skip the whole inflow block here.
        if (deferPayment) {
          // no-op: customer cash + debt handled by recordBasketPayment
        } else if (data.payments && data.payments.length > 0) {
          // Multi-payment: iterate each payment leg
          let hasDebt = false;
          for (const p of data.payments) {
            if (p.method === "GIFT_CARD") {
              if (!p.voucherCode) {
                throw new Error("Gift card payment requires a voucher code");
              }
              // Deposit the voucher's full value to the owner's account; the leg
              // below is non-drawer, so the charge is consumed from that account
              // as CREDIT_USED.
              getVoucherRepository().redeemByCode({
                code: p.voucherCode.trim().toUpperCase(),
                context: "financial_service",
                transactionId: txnId,
                userId: createdBy,
              });
            }
            if (!isDrawerAffectingMethod(p.method)) {
              hasDebt = true;
              continue;
            }
            const paidByDrawer = paymentMethodToDrawerName(p.method);
            insertPayment.run(
              txnId,
              p.method,
              paidByDrawer,
              p.currencyCode,
              Math.abs(p.amount),
              note,
              createdBy,
            );
            upsertBalanceDelta.run(
              paidByDrawer,
              p.currencyCode,
              Math.abs(p.amount),
            );
          }

          // Create debt for any CUSTOMER_ACCOUNT payment legs.
          // Split by the payment leg's own currency — NOT the service currency —
          // so a USD payment debits USD credit and an LBP payment debits LBP credit.
          if (hasDebt) {
            if (!data.clientId) {
              throw new Error("Cannot create debt without a client");
            }
            let debtUsd = 0;
            let debtLbp = 0;
            for (const p of data.payments) {
              if (isDrawerAffectingMethod(p.method)) continue;
              if (p.currencyCode === "USD") debtUsd += Math.abs(p.amount);
              else if (p.currencyCode === "LBP") debtLbp += Math.abs(p.amount);
            }
            bookClientDebtCharge(this.db, {
              clientId: data.clientId,
              transactionType: "Service Debt",
              amountUsd: debtUsd,
              amountLbp: debtLbp,
              transactionId: txnId,
              note: serviceDebtNote(data),
              createdBy,
              tenantId: getCurrentTenantId(),
            });
          }
        } else {
          // Single payment (backwards-compatible)
          if (price > 0 && isDrawerAffectingMethod(paidBy)) {
            const paidByDrawer = paymentMethodToDrawerName(paidBy);
            insertPayment.run(
              txnId,
              paidBy,
              paidByDrawer,
              currency,
              Math.abs(price),
              note,
              createdBy,
            );
            upsertBalanceDelta.run(paidByDrawer, currency, Math.abs(price));
          }

          // DEBT: create debt_ledger entry
          if (paidBy === "CUSTOMER_ACCOUNT") {
            if (!data.clientId) {
              throw new Error("Cannot create debt without a client");
            }
            bookClientDebtCharge(this.db, {
              clientId: data.clientId,
              transactionType: "Service Debt",
              amountUsd: currency === "USD" ? price : 0,
              amountLbp: currency === "LBP" ? price : 0,
              transactionId: txnId,
              note: serviceDebtNote(data),
              createdBy,
              tenantId: getCurrentTenantId(),
            });
          }
        }

        // ─── RETURNED CREDITS (iPick/Katsh "Only Days" telecom vouchers) ───
        // When a telecom voucher (alfa/mtc) is sold as "only days", the credit
        // portion is returned to the shop — see processTelecomCreditReturn
        // (shared with the FOR-partner catalog arm above).
        processTelecomCreditReturn();
      } else {
        // OMT uses 3-drawer cash-reserve: payment +amount, General -amount, OMT_System +amount
        // WHISH uses 2-drawer: payment +amount, Whish_System +amount (no General)
        // Other providers: single drawer movement (backwards-compatible)
        const systemDrawer = this.mapDrawerName(data.provider);
        const isOMT = data.provider === "OMT";
        const isWHISH = data.provider === "WHISH";
        const useSystemDrawerFlow = isOMT || isWHISH;
        const isBINANCE = data.provider === "BINANCE";
        // App-wallet transfers (OMT_APP / WHISH_APP without a cost/price pair)
        // move money the same way Binance does: the shop's wallet balance on one
        // side, customer cash on the other. Before C4 they fell through to the
        // generic single-drawer path, so the app drawer never moved on SEND and
        // RECEIVE credited the wrong side.
        const isAppWallet =
          data.provider === "OMT_APP" || data.provider === "WHISH_APP";

        if (isBINANCE || isAppWallet) {
          // ─── WALLET TRANSFER (BINANCE / OMT_APP / WHISH_APP) ───
          //
          // The wallet leg moves against the provider's wallet drawer; the cash
          // leg moves in the customer's payment currency against the cash /
          // wallet drawer. For Binance these are two DIFFERENT currencies —
          // never conflate `currency` (USDT, the crypto denomination) with the
          // cash drawer. App wallets are denominated in the service currency.
          //
          // SEND: shop sends from its wallet/account to a customer.
          //   - Wallet drawer: -walletAmount   (funds leave the account)
          //   - Cash drawer:   +(walletAmount + fee)  (customer pays cash in)
          //   - Fee is shop profit, captured implicitly (cash in − wallet out).
          //
          // RECEIVE: someone sends funds to the shop's wallet/account.
          //   - Wallet drawer: +walletAmount   (funds arrive)
          //   - Cash drawer:   -(walletAmount - fee)  (shop pays customer out)
          //   - Fee is shop profit, captured implicitly (wallet in − cash out).
          //   - Contract (Whish App RECEIVE): `data.amount` is the GROSS wallet
          //     inflow and `commission` is the FULL customer fee — the caller
          //     (frontend) is responsible for folding a "fee included/excluded"
          //     toggle into `amount` before it reaches here. The shop keeps the
          //     entire fee as profit; a fee of 0 means no profit and the full
          //     amount is paid out.
          const cryptoAmount = Math.abs(data.amount);
          const fee = Math.abs(calculatedCommission);
          // The Binance drawer always tracks the crypto denomination (USDT),
          // regardless of what `currency` was passed; app wallets track the
          // service currency. The cash side is denominated in the SERVICE
          // currency (Binance: USD — USDT cashes in/out in dollars). When
          // structured legs are present each leg carries its OWN currency
          // and is posted per-leg; `cashCurrency` is only the no-legs
          // fallback (and store-credit) denomination. NEVER guess it from
          // `payments[0].currencyCode`: `payoutAmount`/`cashTotal` are
          // service-currency magnitudes, and pairing them with the first
          // leg's currency booked a 20,000,000 LBP Whish App payout as
          // General USD −20,000,000 when the operator entered the $100
          // split line first (owner-reported 2026-07-30).
          const cryptoCurrency = isBINANCE ? "USDT" : currency;
          const cashCurrency = isBINANCE ? "USD" : currency;

          // S2 hard-reject reconciliation (Payment-Legs Integrity plan): the
          // customer's cash legs must cover the FULL amount the caller's own
          // UI charged the customer. This branch used to GUESS that total as
          // `cryptoAmount + fee` (fee always added on top) — wrong for a SEND
          // whose fee is instead carved OUT of the entered amount (a $137.31
          // net transfer with a $2 fee already deducted owes $137.31, not
          // $139.31 — see lira-108's raw payload, and
          // omtWhishAppFees.ts's fee-mode divergence the guess never
          // modeled). Rather than track every fee-mode combination a caller
          // might use, the caller (whose own UI already computed the real
          // customer-owed total — e.g. OmtWhishAppTransferForm's own
          // `totalAmount`) supplies it explicitly as `checkoutTotal`, the
          // SAME contract the cost/price checkout branch above uses. Absent
          // that, the check is skipped entirely (no guess) — matching every
          // other `reconcileLegs` site's no-op-on-absence contract; every
          // legacy/scripted caller (incl. this repo's own jest fixtures) is
          // unaffected. Passes both `stampedExchangeRate` and
          // `data.tender_exchange_rate` — the gate bands the tender rate
          // against the stamped one, same as the checkout branch above.
          if (
            data.serviceType === "SEND" &&
            !deferPayment &&
            data.checkoutTotal
          ) {
            reconcileLegs({
              inLegs: data.payments,
              outLegs: returnLegs,
              keptChange: {
                usd: data.kept_change_usd,
                lbp: data.kept_change_lbp,
              },
              expectedTotals: data.checkoutTotal,
              exchangeRate: stampedExchangeRate,
              tenderExchangeRate: data.tender_exchange_rate,
              context: `${data.provider} SEND`,
            });
          }

          if (data.serviceType === "SEND") {
            // 1. Debit Binance drawer (USDT): crypto leaves the shop's account
            insertPayment.run(
              txnId,
              data.provider,
              systemDrawer, // "Binance" / "OMT_App" / "Whish_App"
              cryptoCurrency,
              -cryptoAmount,
              isBINANCE
                ? `Crypto sent to customer`
                : `Sent from ${systemDrawer} wallet`,
              createdBy,
            );
            upsertBalanceDelta.run(systemDrawer, cryptoCurrency, -cryptoAmount);

            // 2. Credit the cash the customer hands over (cryptoAmount + fee).
            //    Multi-payment: credit each drawer-affecting leg in full; route
            //    CUSTOMER_ACCOUNT legs to debt. Single-payment: credit the whole
            //    total to the chosen drawer, or to debt for CUSTOMER_ACCOUNT.
            //    Deferred (session basket): the basket recorder owns the cash-in
            //    side, so skip it here (crypto USDT leg above is still written).
            if (deferPayment) {
              // no-op: customer cash + debt handled by recordBasketPayment
            } else if (data.payments && data.payments.length > 0) {
              for (const p of data.payments) {
                if (p.method === "CUSTOMER_ACCOUNT") continue;
                if (!isDrawerAffectingMethod(p.method)) continue;
                const drawerName = paymentMethodToDrawerName(p.method);
                insertPayment.run(
                  txnId,
                  p.method,
                  drawerName,
                  p.currencyCode,
                  Math.abs(p.amount),
                  `${data.provider} SEND payment`,
                  createdBy,
                );
                upsertBalanceDelta.run(
                  drawerName,
                  p.currencyCode,
                  Math.abs(p.amount),
                );
              }
              // CUSTOMER_ACCOUNT legs → debt for the full on-account amount
              const debtLegs = data.payments.filter(
                (p) => p.method === "CUSTOMER_ACCOUNT",
              );
              if (debtLegs.length > 0) {
                const debtClientId = this.resolveBinanceDebtClient(data, txnId);
                for (const debtLeg of debtLegs) {
                  bookClientDebtCharge(this.db, {
                    clientId: debtClientId,
                    transactionType: "Service Debt",
                    amountUsd:
                      debtLeg.currencyCode === "USD"
                        ? Math.abs(debtLeg.amount)
                        : 0,
                    amountLbp:
                      debtLeg.currencyCode === "LBP"
                        ? Math.abs(debtLeg.amount)
                        : 0,
                    transactionId: txnId,
                    note: walletSendDebtNote(
                      data.provider,
                      data.amount,
                      currency,
                      fee,
                    ),
                    createdBy,
                    tenantId,
                  });
                }
              }
            } else {
              // Single-payment fallback: customer pays cryptoAmount + fee.
              const cashTotal = cryptoAmount + fee;
              if (paidBy === "CUSTOMER_ACCOUNT") {
                const debtClientId = this.resolveBinanceDebtClient(data, txnId);
                bookClientDebtCharge(this.db, {
                  clientId: debtClientId,
                  transactionType: "Service Debt",
                  amountUsd: cashCurrency === "USD" ? cashTotal : 0,
                  amountLbp: cashCurrency === "LBP" ? cashTotal : 0,
                  transactionId: txnId,
                  note: walletSendDebtNote(
                    data.provider,
                    data.amount,
                    currency,
                    fee,
                  ),
                  createdBy,
                  tenantId,
                });
              } else if (isDrawerAffectingMethod(paidBy)) {
                const cashDrawer = paymentMethodToDrawerName(paidBy);
                insertPayment.run(
                  txnId,
                  paidBy,
                  cashDrawer,
                  cashCurrency,
                  cashTotal,
                  `${data.provider} SEND payment`,
                  createdBy,
                );
                upsertBalanceDelta.run(cashDrawer, cashCurrency, cashTotal);
              }
            }
          } else {
            // ─── RECEIVE ─────────────────────────────────────────────────────
            // 1. Credit Binance drawer (USDT): crypto arrives in the shop's account
            insertPayment.run(
              txnId,
              data.provider,
              systemDrawer, // "Binance" / "OMT_App" / "Whish_App"
              cryptoCurrency,
              cryptoAmount,
              isBINANCE
                ? `Crypto received from customer`
                : `Received into ${systemDrawer} wallet`,
              createdBy,
            );
            upsertBalanceDelta.run(systemDrawer, cryptoCurrency, cryptoAmount);

            // 2. Cash payout: shop pays customer (cryptoAmount - fee) in cash
            //    — or, for app wallets AND BINANCE, the FULL cryptoAmount
            //    when the fee is instead collected separately over the
            //    counter (mode C, BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4
            //    Phase D / §10.2, owner decision Q7 2026-08-06: "the customer
            //    can pay the fee separately in different payment methods").
            //    BINANCE's only difference from the app wallets is that its
            //    cash side is ALWAYS denominated in USD via `cashCurrency`
            //    (never the crypto `currency`/USDT — see `cashCurrency`
            //    above) — `bookFeeCollectionLegs` below is otherwise
            //    identical for all three providers.
            //    Deferred (session basket): the item's negative CASH amount is
            //    NOT netted into a single basket number (Phase F,
            //    BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4) — the checkout modal
            //    computes the GROSS payout bucket separately from the GROSS
            //    charge bucket and emits an explicit per-currency
            //    `kind: "PAYOUT"` OUT leg (operator-chosen method), which
            //    `SessionPaymentService.recordBasketPayment` posts — the
            //    loto-prize pattern. Self-posting here too would double-debit
            //    the till (and for app wallets it DID, since their cart items
            //    always netted into the pooled totals pre-Phase-F).
            const isFeeCollectedSeparately =
              (isAppWallet || isBINANCE) &&
              !!data.feePayments &&
              data.feePayments.length > 0;
            const payoutAmount = isFeeCollectedSeparately
              ? cryptoAmount
              : cryptoAmount - fee;
            const cashoutMethod = data.cashoutMethod || "CASH";

            // Mode C fee-collection legs: the customer hands the fee over
            // the counter via operator-chosen legs, booked with the SAME
            // per-leg semantics Phase A built for the system OMT/WHISH
            // RECEIVE branch (rule 14 — shared `bookFeeCollectionLegs`
            // helper, defined once near `insertPayment`/`upsertBalanceDelta`
            // above). `resolveServiceCashDrawer` inside that helper falls
            // through to `paymentMethodToDrawerName` here — an app-wallet or
            // BINANCE fee never lands in the PCD, exactly like every other
            // app-wallet/Binance leg (`ctx.provider` is
            // "OMT_APP"/"WHISH_APP"/"BINANCE", which never equals
            // `ctx.baseSystem` "OMT"/"WHISH" — verified against the
            // resolver's own contract, not assumed). `deferPayment` +
            // `partnerId` combinations are already excluded by the
            // createTransaction guard before `feePayments` can be non-empty
            // here, so no extra gate is needed for those.
            if (isFeeCollectedSeparately && !deferPayment) {
              bookFeeCollectionLegs({
                feePayments: data.feePayments!,
                feeAmount: fee,
                currency: cashCurrency,
                provider: data.provider,
                noteSuffix: "RECEIVE fee (customer-paid)",
                contextLabel: `${data.provider} RECEIVE fee collection`,
              });
            }

            if (payoutAmount > 0 && !deferPayment) {
              if (cashoutMethod === "CUSTOMER_ACCOUNT") {
                // Credit customer's account instead of paying cash
                if (!resolvedPrimaryClientId) {
                  throw new Error(
                    "Client is required for CUSTOMER_ACCOUNT cashout",
                  );
                }
                const debtService = getDebtService();
                debtService.addCredit({
                  clientId: resolvedPrimaryClientId,
                  amountUsd: cashCurrency === "USD" ? payoutAmount : 0,
                  amountLbp: cashCurrency === "LBP" ? payoutAmount : 0,
                  note: `${data.provider === "BINANCE" ? "Binance" : data.provider} RECEIVE cashout — credited to account`,
                  userId: createdBy,
                  transactionId: txnId,
                });
              } else {
                // Split payout (owner-reported 2026-07-30): post EACH IN leg
                // in its OWN currency against its own drawer — §4/lira-074,
                // the same rule the OMT/WHISH RECEIVE cash branch below
                // follows. The old code posted ONE lump of `payoutAmount` (a
                // service-currency magnitude) tagged with the FIRST leg's
                // currency. Reconcile first (S2 hard-reject) so a mis-keyed
                // split throws inside this db.transaction instead of
                // mis-booking; the tender rate (when sent) absorbs the
                // sheet's buy/sell spread (lira-095). `data.payments` is
                // already the IN set (rule 16 — OUT legs were partitioned
                // off at the top of createTransaction). CUSTOMER_ACCOUNT
                // legs count toward the payout total but route to store
                // credit, not a drawer — mirroring the SEND leg loop above.
                const payoutLegs = data.payments ?? [];
                reconcileLegs({
                  inLegs: payoutLegs,
                  expectedTotals: expectedTotalIn(payoutAmount, cashCurrency),
                  exchangeRate: stampedExchangeRate,
                  tenderExchangeRate: data.tender_exchange_rate,
                  context: `${data.provider} RECEIVE cashout`,
                });
                if (payoutLegs.length > 0) {
                  const providerLabel =
                    data.provider === "BINANCE" ? "Binance" : data.provider;
                  for (const leg of payoutLegs) {
                    const legAmount = Math.abs(leg.amount);
                    if (legAmount <= 0) continue;
                    if (leg.method === "CUSTOMER_ACCOUNT") {
                      if (!resolvedPrimaryClientId) {
                        throw new Error(
                          "Client is required for CUSTOMER_ACCOUNT cashout",
                        );
                      }
                      getDebtService().addCredit({
                        clientId: resolvedPrimaryClientId,
                        amountUsd: leg.currencyCode === "USD" ? legAmount : 0,
                        amountLbp: leg.currencyCode === "LBP" ? legAmount : 0,
                        note: `${providerLabel} RECEIVE cashout — credited to account`,
                        userId: createdBy,
                        transactionId: txnId,
                      });
                    } else if (isDrawerAffectingMethod(leg.method)) {
                      const legDrawer = paymentMethodToDrawerName(leg.method);
                      insertPayment.run(
                        txnId,
                        leg.method,
                        legDrawer,
                        leg.currencyCode,
                        -legAmount,
                        `${leg.method} paid to customer (${providerLabel} RECEIVE)`,
                        createdBy,
                      );
                      upsertBalanceDelta.run(
                        legDrawer,
                        leg.currencyCode,
                        -legAmount,
                      );
                    }
                  }
                } else {
                  // No structured legs (legacy/scripted callers): single
                  // lump in the service cash currency via the cashout
                  // method's drawer.
                  const cashoutDrawer =
                    paymentMethodToDrawerName(cashoutMethod);
                  insertPayment.run(
                    txnId,
                    cashoutMethod,
                    cashoutDrawer,
                    cashCurrency,
                    -payoutAmount,
                    `${cashoutMethod} paid to customer (Binance RECEIVE)`,
                    createdBy,
                  );
                  upsertBalanceDelta.run(
                    cashoutDrawer,
                    cashCurrency,
                    -payoutAmount,
                  );
                }
              }
            }
          }

          // Commission row for profit reporting (fee = commission for
          // Binance/app wallets). Reporting-only — always carries a 0 drawer
          // delta because the fee is already realized elsewhere: modes A/B
          // implicitly, via the cash-vs-crypto spread above (`payoutAmount =
          // cryptoAmount - fee`); mode C (app wallets, `isFeeCollectedSeparately`)
          // explicitly, via `bookFeeCollectionLegs` above. Either way this row
          // never double-books the fee — it exists purely so profit
          // reporting can see it.
          if (fee > 0) {
            insertPayment.run(
              txnId,
              "COMMISSION",
              systemDrawer,
              cashCurrency,
              0, // No drawer delta — fee already realized (spread or fee legs) above
              `Commission (${data.provider} fee: $${fee})`,
              createdBy,
            );
          }
        } else if (data.serviceType === "SEND") {
          // ─── SEND: customer gives money to shop, shop sends via provider ───
          //
          // Primary Cash Drawer plan (owner verdict 2026-07-30):
          // OMT_System/Whish_System is the shop's PHYSICAL CASH DRAWER, not a
          // balance held inside the provider's own books (PR #66's float
          // model, rejected). There is no separate "draw the float down"
          // posting anymore — the customer's cash leg itself (below, routed
          // through `resolveServiceCashDrawer`) lands directly in the PCD
          // when the transaction runs on the primary system. The provider
          // relationship is captured purely in the supplier ledger
          // (`grossOwedDelta`, §8.3), never in a drawer leg.
          //
          // Fee handling (`data.amount` is always the pre-netted principal —
          // see the note on `totalCollected` below): the customer hands over
          // principal + fee (+ any payment-method surcharge); every cent of
          // that lands in a real drawer (PCD for cash, the wallet's own
          // drawer for non-cash) — see OmtSystemFeeCharacterization.test.ts
          // for the per-case invariant this must satisfy.
          const sentAmount = Math.abs(data.amount);
          // f — resolved once, above (resolvedProviderFee), shared with the
          // RECEIVE branch and the supplier-ledger booking (rule 14).
          const providerFeeAmt = resolvedProviderFee;

          // Amount the customer owes BEFORE any payment-method surcharge
          // (pmFee) = principal + f, in BOTH fee modes.
          //
          // Do NOT branch on `data.includingFees` here. `data.amount` that
          // reaches this repository is ALWAYS the net principal: the frontend
          // back-calculates `sentAmount = budget − fee` before the IPC call
          // when the fee-included toggle is on (Services/index.tsx). So a
          // $100 budget with a $1 fee arrives as amount=99, omtFee=1, and the
          // customer's leg is $100 — subtracting f again here made the
          // reconciler expect $99 against a $100 leg and hard-reject every
          // fee-included SEND (owner-reported 2026-07-30):
          //   "expected $99.00 … got $100.00 … diff $1.00"
          // Guarded by the fee-included cases in
          // OmtSystemFeeCharacterization.test.ts, which send the REAL
          // frontend payload shape (pre-netted amount + separate fee).
          const totalCollected = sentAmount + providerFeeAmt;

          // Amount the customer physically hands over = totalCollected + pmFee.
          // The pmFee stays in the payment method's wallet drawer as immediate shop profit.
          const totalCustomerPays = totalCollected + pmFee;

          // Per-leg PM fee helper — defined here so it's available in both
          // the payment crediting block and the TRANSFER block below.
          // Distributes the total pmFee proportionally across non-cash legs.
          const totalNonCashPaid = data.payments
            ? data.payments
                .filter((p) => isNonCashDrawerMethod(p.method))
                .reduce((s, p) => s + Math.abs(p.amount), 0)
            : 0;
          const perLegPmFee = (leg: {
            method: string;
            currencyCode: string;
            amount: number;
          }): number => {
            if (
              !data.payments ||
              !isNonCashDrawerMethod(leg.method) ||
              totalNonCashPaid === 0
            )
              return 0;
            return (Math.abs(leg.amount) / totalNonCashPaid) * pmFee;
          };

          // S2 hard-reject reconciliation (Payment-Legs Integrity plan): the
          // customer's legs must cover totalCustomerPays (sent amount +
          // provider fee + payment-method fee) — the same total this branch
          // credits to drawers/debt below. No-ops on an empty `data.payments`
          // (legacy single-payment fallback) or under deferPayment (session
          // basket owns the customer-cash side).
          if (!deferPayment) {
            reconcileLegs({
              inLegs: data.payments,
              outLegs: returnLegs,
              keptChange: {
                usd: data.kept_change_usd,
                lbp: data.kept_change_lbp,
              },
              expectedTotals: expectedTotalIn(totalCustomerPays, currency),
              exchangeRate: stampedExchangeRate,
              tenderExchangeRate: data.tender_exchange_rate,
              context: `${data.provider} SEND`,
            });
          }

          if (deferPayment) {
            // Deferred (session basket): skip ALL customer cash-in legs,
            // pmFee rows, and debt creation — the basket recorder
            // (SessionPaymentService.recordBasketPayment) owns the entire
            // customer-cash side for a deferred item. Primary Cash Drawer
            // plan §3 Phase D (a separate agent's slice, not this file):
            // under the old float model this branch's SEND still posted an
            // unconditional internal float leg even when deferred (the
            // "reserve stays on the transaction" the old comment here
            // described); that leg no longer exists — there is nothing
            // internal left to post, because the PCD only moves via real
            // cash legs now. The basket recorder must itself split each cash
            // leg's PCD-eligible pro-rata share (item-provider === baseSystem)
            // from the General remainder and post both sides directly.
          } else if (data.payments && data.payments.length > 0) {
            // Validate: DEBT leg requires client name + phone (for debt_ledger client_id)
            const hasDebtLeg = data.payments.some(
              (p) => p.method === "CUSTOMER_ACCOUNT",
            );
            if (hasDebtLeg && !data.clientId) {
              if (!data.clientName?.trim()) {
                throw new Error("Client name is required when paying by debt");
              }
              if (!data.phoneNumber?.trim()) {
                throw new Error("Phone number is required when paying by debt");
              }
            }

            // Multi-payment mode:
            // The frontend bakes PM fee INTO the non-cash leg amounts before sending.
            // e.g. WHISH wallet $49.50 + $0.50 PM fee → sent as $50.00
            // We need to:
            //   1. Credit the FULL leg amount to the wallet drawer (customer payment in)
            //   2. Insert a PM_FEE row for the pm fee portion (for profit reporting)
            //   3. Transfer only (leg.amount - pmFee) to the system drawer

            for (const p of data.payments) {
              if (p.method === "CUSTOMER_ACCOUNT") continue; // Debt handled separately below
              if (!isDrawerAffectingMethod(p.method)) continue;
              // Primary Cash Drawer plan §2#2: a cash-family leg on a
              // primary-system SEND lands in the PCD, not General.
              const drawerName = resolveServiceCashDrawer(
                p.method,
                cashDrawerCtx,
              );
              const legPmFee = perLegPmFee(p);
              // Credit FULL amount (incl. PM fee) to wallet drawer
              insertPayment.run(
                txnId,
                p.method,
                drawerName,
                p.currencyCode,
                Math.abs(p.amount),
                note,
                createdBy,
              );
              upsertBalanceDelta.run(
                drawerName,
                p.currencyCode,
                Math.abs(p.amount),
              );
              // Insert PM_FEE audit row for non-cash legs (for profit page reporting)
              if (legPmFee > 0) {
                insertPayment.run(
                  txnId,
                  "PM_FEE",
                  drawerName,
                  p.currencyCode,
                  legPmFee,
                  `Payment method fee (${pmFeeRate ? `${(pmFeeRate * 100).toFixed(2)}%` : "flat"})`,
                  createdBy,
                );
                // Note: no extra balance delta — PM_FEE is already in the credited amount above
              }
            }

            // Handle DEBT legs: insert into debt_ledger linked to this transaction
            const debtLegs = data.payments.filter(
              (p) => p.method === "CUSTOMER_ACCOUNT",
            );
            if (debtLegs.length > 0) {
              // Resolve clientId — use existing or find/create from name+phone
              let resolvedClientId = data.clientId;
              if (!resolvedClientId && data.clientName && data.phoneNumber) {
                // Try to find existing client by phone number
                const existing = this.db
                  .prepare(
                    `SELECT id FROM clients WHERE phone_number = ? AND tenant_id = ? LIMIT 1`,
                  )
                  .get(data.phoneNumber, tenantId) as
                  | { id: number }
                  | undefined;
                if (existing) {
                  resolvedClientId = existing.id;
                } else {
                  // Auto-create client — use the DB directly to get lastInsertRowid
                  const insertResult = this.db
                    .prepare(
                      `INSERT INTO clients (full_name, phone_number, notes, tenant_id)
                       VALUES (?, ?, ?, ?)`,
                    )
                    .run(
                      data.clientName,
                      data.phoneNumber,
                      "Auto-created from service debt payment",
                      tenantId,
                    );
                  resolvedClientId = Number(insertResult.lastInsertRowid);
                }
              }

              if (!resolvedClientId) {
                throw new Error(
                  "Could not resolve client for debt — name and phone are required",
                );
              }

              // Update the unified transaction's client_id so it appears correctly
              // in profits by-client, activity logs, and debt detail eye button
              this.db
                .prepare(
                  `UPDATE transactions SET client_id = ? WHERE id = ? AND tenant_id = ?`,
                )
                .run(resolvedClientId, txnId, tenantId);

              for (const debtLeg of debtLegs) {
                const debtAmtUsd =
                  debtLeg.currencyCode === "USD" ? Math.abs(debtLeg.amount) : 0;
                const debtAmtLbp =
                  debtLeg.currencyCode === "LBP" ? Math.abs(debtLeg.amount) : 0;
                const debtNote = `${data.provider} ${data.serviceType}${data.omtServiceType ? ` (${data.omtServiceType})` : ""} — $${data.amount}`;
                bookClientDebtCharge(this.db, {
                  clientId: resolvedClientId,
                  transactionType: "Service Debt",
                  amountUsd: debtAmtUsd,
                  amountLbp: debtAmtLbp,
                  transactionId: txnId,
                  note: debtNote,
                  createdBy,
                  tenantId,
                });
              }
            }
          } else {
            // Single payment: customer hands over totalCustomerPays (includes PM fee)
            if (paidBy === "CUSTOMER_ACCOUNT") {
              // DEBT single payment: validate + find/create client + insert debt_ledger
              if (!data.clientName?.trim()) {
                throw new Error("Client name is required when paying by debt");
              }
              if (!data.phoneNumber?.trim()) {
                throw new Error("Phone number is required when paying by debt");
              }

              // Find or auto-create client
              const existingClient = this.db
                .prepare(
                  `SELECT id FROM clients WHERE phone_number = ? AND tenant_id = ? LIMIT 1`,
                )
                .get(data.phoneNumber, tenantId) as { id: number } | undefined;
              const debtClientId = existingClient
                ? existingClient.id
                : Number(
                    this.db
                      .prepare(
                        `INSERT INTO clients (full_name, phone_number, notes, tenant_id)
                         VALUES (?, ?, ?, ?)`,
                      )
                      .run(
                        data.clientName,
                        data.phoneNumber,
                        "Auto-created from service debt payment",
                        tenantId,
                      ).lastInsertRowid,
                  );

              // Update the unified transaction's client_id so it appears
              // correctly in profits by-client, activity logs, and debt detail
              this.db
                .prepare(
                  `UPDATE transactions SET client_id = ? WHERE id = ? AND tenant_id = ?`,
                )
                .run(debtClientId, txnId, tenantId);

              bookClientDebtCharge(this.db, {
                clientId: debtClientId,
                transactionType: "Service Debt",
                amountUsd: currency === "USD" ? totalCollected : 0,
                amountLbp: currency === "LBP" ? totalCollected : 0,
                transactionId: txnId,
                note: `${data.provider} ${data.serviceType}${data.omtServiceType ? ` (${data.omtServiceType})` : ""} — $${data.amount}`,
                createdBy,
                tenantId,
              });
            } else {
              // Non-debt single payment: credit to drawer
              // Skip for partner transactions: the partner handles their customer directly,
              // no cash flows through the shop's General drawer.
              // Primary Cash Drawer plan §2#2: primary-system cash → PCD.
              const paidByDrawer = resolveServiceCashDrawer(
                paidBy,
                cashDrawerCtx,
              );
              if (isDrawerAffectingMethod(paidBy) && !data.partnerId) {
                insertPayment.run(
                  txnId,
                  paidBy,
                  paidByDrawer,
                  currency,
                  totalCustomerPays,
                  note,
                  createdBy,
                );
                upsertBalanceDelta.run(
                  paidByDrawer,
                  currency,
                  totalCustomerPays,
                );
              }
            }
          }

          // Record PM_FEE payment row for immediate profit tracking (single non-cash only;
          // for multi-payment the frontend already baked it into each leg's amount).
          // Deferred (session basket): pmFee is owned by the basket — skip it here.
          if (
            !deferPayment &&
            pmFee > 0 &&
            !(data.payments && data.payments.length > 0)
          ) {
            // Primary Cash Drawer plan §2#2: route the PM_FEE audit row's
            // drawer through the same resolver (a no-op fallthrough here in
            // practice — pmFee is only > 0 for non-cash/wallet methods, and
            // the resolver only reroutes cash-family methods — kept for
            // consistency with every other paymentMethodToDrawerName site on
            // this path).
            const walletDrawer = resolveServiceCashDrawer(
              paidBy,
              cashDrawerCtx,
            );
            insertPayment.run(
              txnId,
              "PM_FEE",
              walletDrawer,
              currency,
              pmFee,
              `Payment method fee (${pmFeeRate ? `${(pmFeeRate * 100).toFixed(2)}%` : "flat"})`,
              createdBy,
            );
            // Note: no extra upsertBalanceDelta here — the PM fee is already included
            // in the totalCustomerPays credited to the wallet drawer above.
            // This row is purely for reporting/profit visibility.
          }

          // Primary Cash Drawer plan §2#1: the SEND float leg (SEND drew the
          // system drawer down by the principal, modeling OMT_System/
          // Whish_System as a spendable balance inside the provider's own
          // books, PR #66) is DELETED. There is no balance to track inside
          // the provider's system anymore — the drawer now moves ONLY
          // because real cash physically moved, and every cash leg above
          // (the split-leg loop and the single-payment branch) already
          // routes through `resolveServiceCashDrawer`, which lands a
          // primary-system CASH leg in the PCD directly. No separate
          // "reserve" posting is needed or correct under this model.
        } else {
          // ─── RECEIVE: provider sends money to customer, shop pays cash out ───
          //
          // Primary Cash Drawer plan §2#1: the RECEIVE float leg (RECEIVE
          // filled the system drawer back up by the bare principal, modeling
          // OMT_System/Whish_System as a spendable balance inside the
          // provider's own books, PR #66) is DELETED — there is no balance
          // to track inside the provider's system anymore. The drawer moves
          // only via the real cash legs below (fee leg, cashout payout),
          // each routed through `resolveServiceCashDrawer`.
          //
          // Customer fee f (resolvedProviderFee, shared with SEND and the
          // supplier-ledger booking below, rule 14). Defaults to 0, which
          // collapses every formula below to bare principal / no fee leg.
          //   includingFees=false (fee ON TOP)  → the shop pays out the FULL
          //     receiveAmount; the customer additionally PAYS the fee f via
          //     a separate leg below.
          //   includingFees=true (fee INCLUDED) → the fee is netted OUT of
          //     the payout instead: the shop pays out only
          //     (receiveAmount − f).
          const receiveAmount = Math.abs(data.amount);
          const receiveFeeAmt = resolvedProviderFee;
          const receiveFeeIncluded = data.includingFees === true;
          const payoutAmount = receiveFeeIncluded
            ? Math.max(0, receiveAmount - receiveFeeAmt)
            : receiveAmount;
          const cashoutMethod = data.cashoutMethod || "CASH";

          // Customer-paid fee leg (fee-on-top only): collected in the same
          // drawer the payout itself would use — CASH/CUSTOMER_ACCOUNT both
          // resolve as a cash-family charge (a debt credit has no drawer of
          // its own, but the fee itself is still real cash the customer
          // hands over), routed through the resolver so a primary-system
          // RECEIVE's fee lands in the PCD (plan §2#2 — this site was
          // previously HARDCODED to "General"). Skipped under deferPayment —
          // no session-basket caller sends a RECEIVE fee today (new
          // capability, not yet wired into the basket path).
          //
          // LIRA-124 (2026-08-10): USED to also skip this leg for a
          // THROUGH-partner transaction (`!skipSystemDrawer`,
          // BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §2 bug 5) on the theory that
          // "the partner handles the payout, not our cash." That theory is
          // wrong under the owner's rule: the customer is standing at THIS
          // shop's counter, paying THIS shop's fee, regardless of which
          // system rail the transfer rides on — skipping the fee leg while
          // still handing the customer their (full, un-netted) payout below
          // was foregone revenue, not a phantom-credit guard. The
          // fee-on-top leg now posts unconditionally (same as walk-in);
          // `!skipSystemDrawer` removed.
          if (!deferPayment && !receiveFeeIncluded && receiveFeeAmt > 0) {
            if (data.feePayments && data.feePayments.length > 0) {
              // Phase A (owner decision #1, 2026-08-06): operator-chosen fee
              // legs — split allowed, any real tender method including
              // CUSTOMER_ACCOUNT. Reconciled hard-reject (S2) against the
              // transaction's OWN fee, mirroring the payout reconcile below.
              // Rule 14 (Phase D extraction): booked by the SAME shared
              // `bookFeeCollectionLegs` helper the app-wallet mode-C branch
              // (isAppWallet, above) uses — this used to be its own inline
              // reconcile+loop; the two are now one definition.
              bookFeeCollectionLegs({
                feePayments: data.feePayments,
                feeAmount: receiveFeeAmt,
                currency,
                provider: data.provider,
                noteSuffix: "RECEIVE fee (customer-paid)",
                contextLabel: `${data.provider} RECEIVE fee collection`,
              });
            } else {
              // Legacy fallback (no operator-chosen fee legs): synthesize ONE
              // leg on the collapsed cashout method — same drawer routing as
              // before, except the leg's `method` column now stores the REAL
              // tender ("CASH" or the wallet cashoutMethod) instead of the
              // retired "FEE" literal (owner decision #9) — the note is the
              // discriminator, not the method string.
              const feeMethod =
                cashoutMethod === "CASH" || cashoutMethod === "CUSTOMER_ACCOUNT"
                  ? "CASH"
                  : cashoutMethod;
              const feeDrawer = resolveServiceCashDrawer(
                feeMethod,
                cashDrawerCtx,
              );
              insertPayment.run(
                txnId,
                feeMethod,
                feeDrawer,
                currency,
                receiveFeeAmt,
                `${data.provider} RECEIVE fee (customer-paid)`,
                createdBy,
              );
              upsertBalanceDelta.run(feeDrawer, currency, receiveFeeAmt);
            }
          }

          if (cashoutMethod === "CUSTOMER_ACCOUNT") {
            // CUSTOMER_ACCOUNT: don't debit any drawer, create credit in
            // debt_ledger — net of the fee when fee-included (payoutAmount
            // already reflects that).
            if (!deferPayment) {
              if (!resolvedPrimaryClientId) {
                throw new Error(
                  "Client is required for CUSTOMER_ACCOUNT cashout",
                );
              }
              const debtService = getDebtService();
              debtService.addCredit({
                clientId: resolvedPrimaryClientId,
                amountUsd: currency === "USD" ? payoutAmount : 0,
                amountLbp: currency === "LBP" ? payoutAmount : 0,
                note: `${data.provider} RECEIVE cashout — credited to account`,
                userId: createdBy,
                transactionId: txnId,
              });
            }
          } else {
            // Non-CUSTOMER_ACCOUNT: debit the appropriate drawer based on cashout method
            // For CASH → PCD (primary system) / General (otherwise),
            // OMT → OMT_App, WHISH → Whish_App, BINANCE → Binance — plan §2#2.
            const cashoutDrawer = resolveServiceCashDrawer(
              cashoutMethod,
              cashDrawerCtx,
            );

            if (!useSystemDrawerFlow) {
              // Other providers (BOB/OTHER/etc.): single drawer, positive
              // (money coming in) — the PCD only ever applies to OMT/WHISH
              // (useSystemDrawerFlow), so these providers never route here.
              const drawerName = data.paidByMethod
                ? paymentMethodToDrawerName(data.paidByMethod)
                : systemDrawer;
              const paymentMethod = data.paidByMethod || data.provider;
              insertPayment.run(
                txnId,
                paymentMethod,
                drawerName,
                currency,
                receiveAmount,
                note,
                createdBy,
              );
              upsertBalanceDelta.run(drawerName, currency, receiveAmount);
            }

            // Debit the cashout drawer for the payout to customer — net of
            // the fee when fee-included (payoutAmount already reflects
            // that). Deferred (session basket): an OMT/WHISH RECEIVE is a
            // NEGATIVE cart item, but Phase F (BIDIRECTIONAL_PAYMENT_LEGS_
            // PLAN.md §4) no longer nets it into a single basket number —
            // the checkout modal computes the GROSS payout bucket
            // separately from the GROSS charge bucket and emits an explicit
            // per-currency `kind: "PAYOUT"` OUT leg (operator-chosen
            // method), which `SessionPaymentService.recordBasketPayment`
            // posts (PCD/General split by the basket's payout-side share —
            // bug 7). Skip the payout here regardless — to avoid
            // double-counting it, the basket recorder's own leg is the ONLY
            // posting for this item (no separate internal float side exists
            // anymore to fall back on; see the Phase D note on the SEND
            // branch's deferPayment comment above). Non-session callers
            // post it normally.
            if (
              !deferPayment &&
              cashoutMethod !== "CASH" &&
              useSystemDrawerFlow
            ) {
              // Wallet cashouts (OMT/WHISH/BINANCE): debit the wallet drawer.
              // LIRA-124: used to also require `!skipSystemDrawer`, skipping
              // this for THROUGH-partner mode. Removed — `isForPartner` never
              // reaches this branch (its own early return handles the payout
              // via `processReturnLegs` and exits before this code runs), so
              // the only mode that used to hit this gate was THROUGH, and the
              // owner's rule is that a THROUGH-partner RECEIVE's payout is
              // real money the shop hands the customer, from the operator's
              // chosen drawer, exactly like a walk-in. This is the wallet the
              // shop OWNS (OMT_App/Whish_App/Binance) — distinct from
              // OMT_System/Whish_System (the PCD) and from the supplier
              // ledger (the provider-obligation tracking, gated separately by
              // `skipSecondarySupplierLedger` and untouched by this change).
              insertPayment.run(
                txnId,
                cashoutMethod,
                cashoutDrawer,
                currency,
                -payoutAmount,
                `${cashoutMethod} paid to customer (${data.provider} RECEIVE)`,
                createdBy,
              );
              upsertBalanceDelta.run(cashoutDrawer, currency, -payoutAmount);
            } else if (
              !deferPayment &&
              cashoutMethod === "CASH" &&
              useSystemDrawerFlow
            ) {
              // CASH cashout: shop physically pays the customer from the PCD
              // (or General, off the primary system).
              //
              // LIRA-124 (2026-08-10): used to ALSO require `!skipSystemDrawer
              // && !skipGeneralDrawer`, with this comment claiming the branch
              // was "skipped for FOR-partner mode (partner handles the
              // payout, not our cash)." That was stale/mislabeled on two
              // counts: (1) `skipGeneralDrawer` (`= isForPartner`) can never
              // be false here — `isForPartner` takes its own early-return
              // dispatch above and never reaches this code, so
              // `!skipGeneralDrawer` was always true, a no-op; (2) the live
              // half of the old condition, `!skipSystemDrawer`
              // (`= isThroughPartner`), was blocking THROUGH-partner RECEIVEs
              // instead — and a THROUGH-partner RECEIVE on the shop's
              // secondary system is the ONLY way to RECEIVE there at all (see
              // the walk-in-secondary-system rejection above), so this
              // "skip" fired on the mandatory path, not an edge case. The
              // owner's rule: the operator-chosen payout method decides which
              // of OUR drawers is debited, and it must be debited, in every
              // partner mode a walk-in customer is being paid in cash. Both
              // conditions removed; this branch now runs exactly like a
              // walk-in RECEIVE's CASH cashout, whether or not a partner is
              // attached.
              //
              // A split payout (e.g. 190 USD + 540,000 LBP for one transfer) arrives
              // as multi-currency IN legs (the "Cashout" payment lines). Deduct EACH
              // in its own currency so both drawers move — otherwise the non-primary
              // currency leg is silently dropped and the drawer over-counts the primary
              // currency. Only the IN legs are the payout: OUT/return (change) legs are
              // debited exactly once by the return-leg loop later in this transaction,
              // so they must NOT be included here (doing so double-debits them).
              //
              // Primary Cash Drawer plan §8.5 — OWNER REVERSAL 2026-08-01:
              // decision #11 originally BLOCKED a payout the primary cash
              // drawer could not cover. The owner reversed it: every drawer in
              // this system may already go negative, blocking a live payout
              // strands the operator with a customer at the counter, and a
              // negative simply means cash was physically taken from another
              // drawer without the transfer being recorded yet. Deliberately
              // no balance check here.
              //
              // CARRIER_LINES_VALIDITY_PLAN.md Phase 6: this loop is now the
              // SHARED `postPayoutLegs` (moneyPosting.ts), reused by the
              // telecom credit buy-back (RechargeRepository) — rule 14. Its
              // per-leg CUSTOMER_ACCOUNT branch (modeled on the app-wallet
              // payout loop above, `onCustomerAccountLeg`) also fixes a
              // latent bug this exact shape had: the old inline loop filtered
              // CUSTOMER_ACCOUNT legs OUT of the posting set while
              // `reconcileLegs` still counted them in its sum, so a mixed
              // CASH+CUSTOMER_ACCOUNT payout reconciled successfully yet the
              // account was never credited AND the "no legs" fallback then
              // paid the full amount a second time in cash.
              postPayoutLegs({
                db: this.db,
                legs: data.payments,
                payoutAmount,
                currency,
                exchangeRate: stampedExchangeRate,
                tenderExchangeRate: data.tender_exchange_rate,
                context: `${data.provider} RECEIVE cashout`,
                txnId,
                tenantId,
                createdBy,
                resolveDrawer: (method) =>
                  resolveServiceCashDrawer(method, cashDrawerCtx),
                note: `Cash paid to customer (${data.provider} RECEIVE)`,
                onCustomerAccountLeg: (usd, lbp) => {
                  if (!resolvedPrimaryClientId) {
                    throw new Error(
                      "Client is required for CUSTOMER_ACCOUNT cashout",
                    );
                  }
                  getDebtService().addCredit({
                    clientId: resolvedPrimaryClientId,
                    amountUsd: usd,
                    amountLbp: lbp,
                    note: `${data.provider} RECEIVE cashout — credited to account`,
                    userId: createdBy,
                    transactionId: txnId,
                  });
                },
              });
            }
          }
        }

        // Commission inflow:
        // - OMT/WHISH (SEND or RECEIVE): commission is pending settlement → NO drawer movement
        //   The commission will be credited to General when the shop settles with OMT/WHISH.
        // - BINANCE: handled in the BINANCE-specific block above
        // - Other providers (BOB, etc.) SEND: commission earned immediately → General
        if (
          calculatedCommission &&
          calculatedCommission !== 0 &&
          !isBINANCE &&
          !isAppWallet
        ) {
          const isOmtWhishProvider =
            data.provider === "OMT" || data.provider === "WHISH";
          if (!isOmtWhishProvider) {
            // Non-OMT/WHISH: immediate commission inflow to drawer
            const commDrawer = useSystemDrawerFlow
              ? "General"
              : data.paidByMethod
                ? paymentMethodToDrawerName(data.paidByMethod)
                : systemDrawer;
            const delta = Math.abs(calculatedCommission);
            insertPayment.run(
              txnId,
              "COMMISSION",
              commDrawer,
              currency,
              delta,
              "Commission",
              createdBy,
            );
            upsertBalanceDelta.run(commDrawer, currency, delta);
          }
          // OMT/WHISH: commission stored on financial_services row for reporting only.
          // No drawer movement until settlement (SupplierRepository.settleTransactions).
        }
      }

      // Auto-record supplier debt (both flows). baseSystem /
      // skipSecondarySupplierLedger are resolved earlier (right after
      // isThroughPartner/isForPartner, alongside the walk-in-secondary
      // rejection) — rule 14, one definition, reused here unchanged.
      try {
        const supplierRepo = getSupplierRepository();
        const supplier = supplierRepo.getByProvider(data.provider);
        if (!supplier) {
          financialLogger.debug(
            { provider: data.provider },
            `Skipping supplier ledger for inactive provider: ${data.provider}`,
          );
        } else {
          // Ledger amount — grossOwedDelta (rule 14, see its doc comment):
          // gross principal+fee-commission for OMT/WHISH (plan §8.3).
          // resolvedProviderFee is the same `f` the SEND cash leg, the
          // RECEIVE fee leg, and this booking share (hoisted earlier
          // alongside storedWhishFee) — one resolution, several consumers.
          const ledgerAmount = grossOwedDelta({
            serviceType: data.serviceType,
            provider: data.provider,
            fee: resolvedProviderFee,
            commission: calculatedCommission,
            cost,
            amount: data.amount,
          });

          // Ledger entry_type (C5 prepaid-units model):
          //   RECEIVE                  → PAYMENT (supplier settles with shop, reduces debt)
          //   SEND, legacy system flow → TOP_UP  (per-transfer supplier debt)
          //   SEND, cost/price flow    → NO ENTRY. The supplier debt was booked
          //     once at top-up time (TOP_UP via topUpFromSupplier); the sale only
          //     draws down the provider drawer (`cost` leg above). Booking a
          //     per-sale SALE_COST double-counted the same debt. Loto is the
          //     exception and books its own ledger in LotoTicketRepository.
          if (data.serviceType === "BILL") {
            // COMMISSION_AT_SETTLEMENT_PLAN.md §4 Phase 1 — the legacy
            // hardcoded 20,000 LBP bill commission is booked HERE only for
            // `commission_model = 0` rows (legacy replay paths — this
            // branches on the FLAG, not the date, per the plan's explicit
            // instruction). Every BILL this repository creates today is born
            // `commission_model = 1` (the stamp above gates on
            // `service_type === "BILL"` specifically — no OTHER service_type
            // is born commission_model = 1 yet, since Phase 2's OMT/WHISH
            // gross flip hasn't shipped; see that stamp's own comment), so in
            // practice this `=== 0` branch is dead for NEW bills and only
            // fires when replaying/backfilling legacy rows. New-model bills
            // book NOTHING at creation: they join the unsettled queue instead
            // (`isPendingSupplierSettlement` / `pendingSettlementSql()`) and
            // the shop enters the real commission at settlement, which books
            // its own SUPPLIER_PAYS_US credit
            // (`SupplierRepository.settleTransactions`). Booking the legacy
            // 20,000 here AND the settlement's entered commission would
            // double the supplier's credit for the exact same bill.
            if (commissionModel === 0 && !skipSecondarySupplierLedger) {
              // Bill commission: 20,000 LBP fixed, supplier owes shop (negative = credit to us).
              // No SALE_COST — the provider drawer debit already accounts for the bill amount.
              supplierRepo.addLedgerEntry({
                supplier_id: supplier.id,
                entry_type: "SUPPLIER_PAYS_US",
                amount_usd: 0,
                amount_lbp: -20000,
                note: `Auto: BILL commission from ${data.provider}`,
                created_by: createdBy,
                is_auto: true,
                // LIRA-091: back-link to THIS financial_services row so
                // TransactionRepository can cascade-void this auto sibling
                // (its own separate hidden SUPPLIER_PAYMENT transaction) when
                // the parent BILL is voided/refunded.
                source_ref_table: "financial_services",
                source_ref_id: id,
              });
            }
          } else if (data.serviceType === "SEND" && useCostPriceFlow) {
            // Prepaid-units sale: drawer draw-down only — no supplier ledger entry.
          } else if (isWalletProvider(data.provider)) {
            // Fix B: wallet providers (OMT_APP / WHISH_APP / BINANCE) are
            // prepaid balances the shop owns — a transfer consumes/grows the
            // wallet drawer and creates NO debt in either direction. Booking
            // TOP_UP ("we owe them") on SEND / PAYMENT ("they owe us") on
            // RECEIVE here wrote phantom rows into the app suppliers'
            // balances (owner-confirmed model, 2026-07-19; see
            // FinancialServiceRepository.appWalletTransfer.test.ts "Fix B").
          } else {
            // Gross supplier ledger (plan §8.3, rule 14, grossOwedDelta doc):
            // SEND books +(x+f−c), RECEIVE books a SIGNED −(x−f+c) — both use
            // entry_type TOP_UP (never PAYMENT here) because
            // `SupplierRepository.addLedgerEntry` FORCE-NEGATES every PAYMENT
            // amount (its own sign-convention enforcement, "PAYMENT amounts
            // stored as negative"). `grossOwedDelta` already returns the
            // correctly-signed RECEIVE number (negative), so a PAYMENT entry
            // would force-negate it AGAIN and flip the sign back positive —
            // silently INCREASING what the shop owes on a RECEIVE instead of
            // reducing it. Signed TOP_UP is the verified-correct convention
            // (plan §6 open item 7 / §8.3 — `addLedgerEntry` passes TOP_UP
            // through as-is) — this is the same mechanism #66 used for its
            // fee-only entries, re-verified against the new gross numbers by
            // OmtSystemFeeCharacterization.test.ts.
            const entryType = "TOP_UP";
            if (!skipSecondarySupplierLedger) {
              supplierRepo.addLedgerEntry({
                supplier_id: supplier.id,
                entry_type: entryType,
                amount_usd: currency === "USD" ? ledgerAmount : 0,
                amount_lbp: currency === "LBP" ? ledgerAmount : 0,
                note: `Auto: ${data.serviceType} via ${data.provider}${data.itemKey ? ` [${data.itemKey}]` : ""}`,
                created_by: createdBy,
                is_auto: true,
                // LIRA-091: back-link to THIS financial_services row so
                // TransactionRepository can cascade-void this auto sibling
                // (its own separate hidden SUPPLIER_PAYMENT transaction) when
                // the parent SEND/RECEIVE is voided/refunded.
                source_ref_table: "financial_services",
                source_ref_id: id,
              });
            }
          }
        }
      } catch {
        // Supplier auto-record is non-critical; don't fail the transaction
      }

      // Auto-create partner ledger entry for THROUGH-partner transactions.
      // FOR-partner rows are booked in the early FOR dispatch above (PFT-3b)
      // — its per-provider transaction_type map replaced the old collapsed
      // OMT/WHISH mapping that mis-typed OMT_APP/WHISH_APP/BINANCE rows.
      if (isThroughPartner) {
        const providerKey =
          data.provider === "OMT" || data.provider === "OMT_APP"
            ? "OMT"
            : "WHISH";
        // Template-composed, not a literal (see partnerLedgerTypes.guard.test.ts) —
        // only OMT/OMT_APP→OMT and WHISH/WHISH_APP→WHISH map, so in practice
        // the result is always one of the four THROUGH_* union members; typed
        // as plain `string` here (not inferred as a template-literal type)
        // because a hypothetical BILL serviceType would widen beyond the
        // union, and this must stay a narrowing (not same-widening) cast.
        const ledgerType: string = `THROUGH_${providerKey}_${data.serviceType}`;
        const direction = data.serviceType === "SEND" ? "CREDIT" : "DEBIT";
        const ledgerAmount = Math.abs(data.amount);
        // CQ-7: routed through PartnerRepository.addLedgerEntry instead of a
        // raw INSERT — same row values (reference_table fixed to
        // 'financial_services', matching the prior literal; `notes` stays
        // unset/NULL, matching the prior column list which omitted it).
        getPartnerRepository().addLedgerEntry({
          partner_id: data.partnerId as number,
          transaction_type: ledgerType as ForPartnerLedgerType,
          reference_table: "financial_services",
          reference_id: id,
          amount: ledgerAmount,
          currency,
          direction,
          user_id: createdBy,
          created_at: data.transaction_time ?? undefined,
        });
      }

      // Return (OUT) legs: change handed back to the customer via a chosen
      // method, or kept as store credit — see processReturnLegs (the ONE
      // shared OUT-leg processor, also used by the FOR-partner dispatch).
      processReturnLegs();

      return { id, drawer: legacyDrawerLabel };
    })();
  }

  // ---------------------------------------------------------------------------
  // Self-charge (LIRA-090 spec §5.2)
  // ---------------------------------------------------------------------------

  /**
   * Charge a telecom catalog item (an MTC/Alfa "cart") to the SHOP'S OWN
   * carrier line — the mirror image of the Only-Days customer sale (§5.1).
   * No customer, no `financial_services` row ("no sale row"), no profit
   * stamp ("no profit row"): the two legs are the shop moving its own money
   * between its own drawers, in DIFFERENT currencies (iPick/Katsh's LBP cost
   * vs MTC/Alfa's USD-only credit):
   *
   *   - iPick/Katsh drawer: −cost_lbp (LBP)
   *   - MTC/Alfa drawer:    +credits  (USD, the FULL face value — no SMS
   *     transfer happens when the shop charges its own line, so nothing is
   *     burned; contrast the Only-Days return, which nets
   *     `maxReturnableCredits(credits)`)
   *   - The target `carrier_lines` row: +credits, validity extended by
   *     +validity_days (via `CarrierLineService.applyMovement` — rule 20
   *     reversal owner, `carrier_line_movements`, tied to this transaction).
   *
   * A unified `transactions` row IS still created (type
   * `TRANSACTION_TYPES.TELECOM_SELF_CHARGE`, source_table
   * 'mobile_service_items') even though there is no sale row — `payments`
   * rows need a transaction to hang off, and the carrier-line movement
   * needs a `transaction_id` to be reversible (rule 20; the reversal is
   * otherwise type-agnostic, see
   * `TransactionRepository._reverseCarrierLineMovements`). Its
   * `profit_usd`/`profit_lbp` are always 0.
   *
   * Review finding M3: this row used to reuse `TRANSACTION_TYPES
   * .FINANCIAL_SERVICE`, which masquerades as a real customer-facing
   * financial service everywhere that type is assumed to be backed by a
   * `financial_services` row (ProfitRepository's revenue-by-user/-client
   * queries, the frontend's receipt gating) — see the dedicated
   * `TELECOM_SELF_CHARGE` type's doc comment in
   * `constants/transactionTypes.ts` for the full before/after. The
   * dedicated type is deliberately excluded from
   * `ProfitRepository`'s `PROFIT_TXN_TYPES` (no revenue/profit
   * contribution, matching "no profit row") and from
   * `NON_REVERSIBLE_TRANSACTION_TYPES` (stays reversible via the generic
   * void/refund path — payment legs and `carrier_line_movements` are both
   * type-agnostic).
   *
   * Spec §5.2 is silent on supplier-ledger booking for the cost leg (unlike
   * the normal cost/price sale flow, which auto-records a prepaid-units
   * supplier debit) — none is booked here, matching the literal §5.2 leg
   * table verbatim. Flagged for owner confirmation, not decided unilaterally.
   */
  selfChargeTelecomItem(
    data: SelfChargeTelecomItemData,
  ): SelfChargeTelecomItemResult {
    const tenantId = getCurrentTenantId();

    return this.db.transaction(() => {
      const item = getMobileServiceItemRepository().getById(
        data.mobileServiceItemId,
      );
      if (!item) {
        throw new Error(
          `Mobile service item #${data.mobileServiceItemId} not found`,
        );
      }

      const categoryLower = item.category.toLowerCase();
      if (categoryLower !== "alfa" && categoryLower !== "mtc") {
        throw new Error(
          `Self-charge only applies to alfa/mtc telecom items (item #${item.id} has category "${item.category}")`,
        );
      }
      const carrier = categoryLower as CarrierKey;

      if (item.provider !== "iPick" && item.provider !== "Katsh") {
        throw new Error(
          `Self-charge only applies to iPick/Katsh catalog items (item #${item.id} has provider "${item.provider}")`,
        );
      }
      if (!(item.cost_lbp > 0)) {
        throw new Error(`Item #${item.id} has no cost_lbp configured`);
      }
      if (!(typeof item.credits === "number" && item.credits > 0)) {
        throw new Error(`Item #${item.id} has no credits configured`);
      }
      if (!(typeof item.validity_days === "number" && item.validity_days > 0)) {
        throw new Error(`Item #${item.id} has no validity_days configured`);
      }

      const targetLine = data.carrierLineId
        ? getCarrierLineRepository().getById(data.carrierLineId)
        : getCarrierLineRepository().getPrimary(carrier);
      if (!targetLine) {
        throw new Error(
          data.carrierLineId
            ? `Carrier line #${data.carrierLineId} not found`
            : `No primary ${carrier} line configured — set one in Carrier Lines settings or pass carrierLineId explicitly`,
        );
      }
      if (targetLine.carrier !== carrier) {
        throw new Error(
          `Carrier line #${targetLine.id} is ${targetLine.carrier}, not ${carrier}`,
        );
      }

      const createdBy = data.userId ?? this.resolveFallbackUserId();
      const providerDrawer = this.mapDrawerName(
        item.provider as CreateFinancialServiceData["provider"],
      );
      const creditDrawer = carrier === "alfa" ? "Alfa" : "MTC";
      const stampedExchangeRate = getUsdLbpSellRate(this.db);
      const costLbp = item.cost_lbp;
      // Casts are safe: the guards above threw unless both are positive
      // numbers — re-reading `item.credits`/`item.validity_days` this far
      // from those checks isn't guaranteed to stay narrowed by every
      // TypeScript version's control-flow analysis across the intervening
      // repository calls.
      const credits = item.credits as number;
      const validityDays = item.validity_days as number;

      const txnId = getTransactionRepository().createTransaction({
        type: TRANSACTION_TYPES.TELECOM_SELF_CHARGE,
        source_table: "mobile_service_items",
        source_id: item.id,
        user_id: createdBy,
        amount_usd: credits,
        amount_lbp: -costLbp,
        profit_usd: 0,
        profit_lbp: 0,
        summary: `Self-charge: ${item.label} → ${targetLine.phone_number} (+$${credits}, +${validityDays}d)`,
        metadata_json: {
          provider: item.provider,
          category: carrier,
          mobile_service_item_id: item.id,
          carrier_line_id: targetLine.id,
          cost_lbp: costLbp,
          credits,
          validity_days: validityDays,
        },
        exchange_rate: stampedExchangeRate,
        transaction_time: data.transaction_time,
      });

      insertPaymentRow(this.db, {
        transactionId: txnId,
        method: "SELF_CHARGE",
        drawerName: providerDrawer,
        currencyCode: "LBP",
        amount: -costLbp,
        note: `Self-charge cost: ${item.label}`,
        createdBy,
        tenantId,
      });
      applyDrawerDelta(this.db, {
        drawerName: providerDrawer,
        currencyCode: "LBP",
        delta: -costLbp,
        tenantId,
      });

      insertPaymentRow(this.db, {
        transactionId: txnId,
        method: "SELF_CHARGE",
        drawerName: creditDrawer,
        currencyCode: "USD",
        amount: credits,
        note: `Self-charge credit: ${item.label}`,
        createdBy,
        tenantId,
      });
      applyDrawerDelta(this.db, {
        drawerName: creditDrawer,
        currencyCode: "USD",
        delta: credits,
        tenantId,
      });

      const movement = getCarrierLineService().applyMovement({
        carrierLineId: targetLine.id,
        creditsDelta: credits,
        validityDaysDelta: validityDays,
        reason: "SELF_CHARGE",
        transactionId: txnId,
      });
      if (!movement.success) {
        throw new Error(
          `Failed to apply carrier line movement: ${movement.error}`,
        );
      }

      return {
        transactionId: txnId,
        carrierLineId: targetLine.id,
        costLbp,
        creditsAdded: credits,
        validityDaysAdded: validityDays,
      };
    })();
  }

  // ---------------------------------------------------------------------------
  // Query Operations
  // ---------------------------------------------------------------------------

  /**
   * Get transaction history, optionally filtered by provider
   */
  getHistory(provider?: string, limit = 50): FinancialServiceEntity[] {
    let query = `SELECT ${this.getColumns()} FROM financial_services WHERE tenant_id = ?`;
    const params: (string | number)[] = [getCurrentTenantId()];

    if (provider) {
      query += " AND provider = ?";
      params.push(provider);
    }

    query += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);

    return this.db.prepare(query).all(...params) as FinancialServiceEntity[];
  }

  // ---------------------------------------------------------------------------
  // Settlement Queries
  // ---------------------------------------------------------------------------

  /**
   * Get all unsettled financial_services rows for a given supplier (by provider name).
   *
   * Two kinds of rows are returned, both shaped as FinancialServiceEntity so the
   * Settle tab's "total owed − commission = net pay" math nets correctly
   * (owed per row = supplier_owed, the SUPPLIER_OWED_EXPR projection):
   *
   *  1. Pending-settlement rows — `pendingSettlementSql()` (D2, LIRA-112 D12)
   *     AND is_settled = 0: legacy-model (commission_model = 0) OMT/WHISH rows
   *     with commission > 0, or new-model (commission_model = 1) OMT/WHISH
   *     SEND/RECEIVE and commission-eligible BILL rows (per the row's OWN
   *     supplier's `commission_eligible`, e.g. Katsh — never iPick) regardless
   *     of commission (COMMISSION_AT_SETTLEMENT_PLAN.md §3/Phase 0 — commission is entered
   *     AT settlement for these, so it's 0 at creation and can't be the
   *     marker anymore). Owed = the GROSS amount (SUPPLIER_OWED_EXPR /
   *     grossOwedDelta, plan §8.3): SEND owes +(x+f−c), RECEIVE owes
   *     −(x−f+c). OMT_System/
   *     Whish_System is the shop's physical cash drawer (owner verdict
   *     2026-07-30), not a balance tracked inside the provider's own books —
   *     so the provider relationship covers the full transfer, net of the
   *     shop's own commission cut, exactly as it did before PR #66's float
   *     model (which this supersedes).
   *
   *  2. LEGACY cost/price-flow sale costs — SEND rows written through a cost/price
   *     provider (iPick / Katsh / Whish App / OMT App) BEFORE the C5 prepaid-units
   *     redesign (supplier_debt_booked = 1), where cost > 0 and the supplier debt is
   *     not yet settled (settlement_id IS NULL). Those rows booked a per-sale
   *     SALE_COST ledger entry; settling one writes a negative SETTLEMENT entry that
   *     nets it to zero. Post-C5 sales (supplier_debt_booked = 0) book NO per-sale
   *     debt — the debt lives in the top-up TOP_UP entry — so they are excluded:
   *     settling one would write a SETTLEMENT with no offsetting SALE_COST and
   *     corrupt getSupplierBalances().
   *
   * NOTE on is_settled vs settlement_id: cost-flow SEND rows are created with
   * is_settled = 1 (their price−cost profit is realized immediately, so analytics keep
   * counting it as realized). Supplier reconciliation is therefore keyed off
   * settlement_id (NULL = supplier debt still outstanding), independent of is_settled.
   * Cost-flow sale costs can also be reconciled in bulk via a cumulative-balance
   * pay-down (Manual Entry → PAYMENT), which nets the SALE_COST entries directly.
   */
  /**
   * LIRA-112 (v151) — cheap PRAGMA check (not a hot path) for whether the
   * connected `suppliers` table carries `commission_eligible` yet. Feeds
   * `pendingSettlementSql()`'s guard — see that function's doc comment.
   * Mirrors `SupplierRepository._suppliersHasCommissionEligibilityColumns()`
   * (duplicated rather than shared: the two repositories don't otherwise
   * depend on each other's private schema-introspection helpers).
   */
  private _suppliersHasCommissionEligibleColumn(): boolean {
    const cols = this.db.prepare(`PRAGMA table_info(suppliers)`).all() as {
      name: string;
    }[];
    return cols.some((c) => c.name === "commission_eligible");
  }

  getUnsettledBySupplier(provider: string): FinancialServiceEntity[] {
    const tenantId = getCurrentTenantId();
    const pendingSql = pendingSettlementSql(
      this._suppliersHasCommissionEligibleColumn(),
    );
    return this.db
      .prepare(
        `SELECT ${this.getColumns()} FROM financial_services
           WHERE provider = ?
             AND is_settled = 0
             AND ${pendingSql}
             AND ${NOT_REFUNDED_SQL}
             AND tenant_id = ?
         UNION ALL
         SELECT ${this.getSaleCostSettleColumns()} FROM financial_services
           WHERE provider = ?
             AND service_type = 'SEND'
             AND cost > 0
             AND settlement_id IS NULL
             AND supplier_debt_booked = 1
             AND ${NOT_REFUNDED_SQL}
             AND tenant_id = ?
         ORDER BY created_at ASC`,
      )
      .all(provider, tenantId, provider, tenantId) as FinancialServiceEntity[];
  }

  /**
   * Column projection for cost/price-flow SEND rows in the Settle tab AND
   * the read-only Transactions history (getAllByProvider). Identical to
   * getColumns() except `amount` is replaced by the sale `cost` (the amount
   * actually owed to the supplier, when it's owed at all — see below) and
   * `commission` is forced to 0 (cost-flow sales carry no supplier
   * commission — the price−cost margin is the shop's own profit, not
   * deducted from the supplier payment). This makes the frontend's
   * `owed = amount + commission`, `net = owed − commission` resolve to
   * net = cost.
   *
   * `supplier_owed` reuses `SUPPLIER_OWED_EXPR` (rule 14 — the SAME "is this
   * owed" definition getColumns() uses, not a second copy that hardcoded
   * `cost` unconditionally): 0 for a post-C5 sale (`supplier_debt_booked = 0`,
   * the default since migration v115 — the debt already lives in the TOP_UP
   * entry booked at top-up time), `cost` only for a LEGACY row
   * (`supplier_debt_booked = 1`) that still carries its own per-sale
   * SALE_COST ledger entry. LIRA-122: the old unconditional `cost` made the
   * Transactions tab show "Unpaid" on a prepaid, nothing-owed sale.
   */
  private getSaleCostSettleColumns(): string {
    return `id, provider, service_type, cost AS amount, currency, 0 AS commission, cost, price, paid_by, paid_amount, paid_currency, client_id, client_name, reference_number, phone_number, sender_name, sender_phone, receiver_name, receiver_phone, sender_client_id, receiver_client_id, omt_service_type, omt_fee, whish_fee, profit_rate, pay_fee, item_key, note, is_settled, settled_at, settlement_id, payment_method_fee, payment_method_fee_rate, created_at, created_by, edited_by, edited_at, partner_id, partner_mode, commission_model, ${SUPPLIER_OWED_EXPR} AS supplier_owed`;
  }

  /**
   * Get ALL financial_services rows for a given supplier provider, ordered by
   * created_at DESC. Returns up to `limit` rows (default 200).
   *
   * Row projection rules (mirrors getUnsettledBySupplier):
   *  - SEND rows with cost > 0 (cost-flow sales) → amount = cost, commission = 0
   *    via getSaleCostSettleColumns(), so the frontend's math stays consistent.
   *  - All other rows → full columns via getColumns().
   */
  getAllByProvider(provider: string, limit = 200): FinancialServiceEntity[] {
    const tenantId = getCurrentTenantId();
    return this.db
      .prepare(
        `SELECT ${this.getColumns()} FROM financial_services
           WHERE provider = ?
             AND NOT (service_type = 'SEND' AND cost > 0)
             AND tenant_id = ?
         UNION ALL
         SELECT ${this.getSaleCostSettleColumns()} FROM financial_services
           WHERE provider = ?
             AND service_type = 'SEND'
             AND cost > 0
             AND tenant_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(
        provider,
        tenantId,
        provider,
        tenantId,
        limit,
      ) as FinancialServiceEntity[];
  }

  /**
   * Get a per-provider summary of unsettled commissions and total amounts owed.
   * Used by the Dashboard pending note and Profits pending tab.
   */
  getUnsettledSummaryByProvider(): UnsettledSummary[] {
    const pendingSql = pendingSettlementSql(
      this._suppliersHasCommissionEligibleColumn(),
    );
    return this.db
      .prepare(
        `SELECT
           provider,
           COUNT(*) as count,
           -- COMMISSION_AT_SETTLEMENT_PLAN.md §4 Phase 1 — count of unsettled
           -- BILL rows only, so RATE-mode settlement (rate × unit_count) has
           -- a count to read without pulling the full unsettled row array.
           COALESCE(SUM(CASE WHEN service_type = 'BILL' THEN 1 ELSE 0 END), 0) as bill_count,
           COALESCE(SUM(CASE WHEN currency != 'LBP' THEN commission ELSE 0 END), 0) as pending_commission_usd,
           COALESCE(SUM(CASE WHEN currency  = 'LBP' THEN commission ELSE 0 END), 0) as pending_commission_lbp,
           -- total_owed per row = SUPPLIER_OWED_EXPR = the GROSS amount owed
           -- the provider (plan §8.3): SEND +(x+f−c), RECEIVE −(x−f+c).
           -- Same single definition grossOwedDelta() uses at write time.
           -- BILL rows contribute 0 (SUPPLIER_OWED_EXPR's BILL branch) — a
           -- bill's principal never reaches the ledger (plan's "Bills
           -- settlement note"); only its settlement commission does.
           COALESCE(SUM(CASE WHEN currency != 'LBP' THEN ${SUPPLIER_OWED_EXPR} ELSE 0 END), 0) as total_owed_usd,
           COALESCE(SUM(CASE WHEN currency  = 'LBP' THEN ${SUPPLIER_OWED_EXPR} ELSE 0 END), 0) as total_owed_lbp
         FROM financial_services
         WHERE is_settled = 0
           AND ${pendingSql}
           AND ${NOT_REFUNDED_SQL}
           AND tenant_id = ?
         GROUP BY provider`,
      )
      .all(getCurrentTenantId()) as UnsettledSummary[];
  }

  // ---------------------------------------------------------------------------
  // Analytics
  // ---------------------------------------------------------------------------

  /**
   * Get comprehensive analytics for financial services (all currencies)
   */
  getAnalytics(providers?: string[]): FinancialServiceAnalytics {
    const tenantId = getCurrentTenantId();

    // Build optional provider filter clause
    const providerFilter =
      providers && providers.length > 0
        ? ` AND provider IN (${providers.map(() => "?").join(",")})`
        : "";
    const providerParams = providers && providers.length > 0 ? providers : [];

    // Today's totals — split realized (settled) vs pending
    const todayStats = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(CASE WHEN is_settled = 1 THEN commission ELSE 0 END), 0) as today_commission,
          COALESCE(SUM(CASE WHEN is_settled = 0 THEN commission ELSE 0 END), 0) as today_pending,
          COUNT(*) as today_count
        FROM financial_services
        WHERE tenant_id = ? AND DATE(created_at) = DATE('now', 'localtime')${providerFilter}`,
      )
      .get(tenantId, ...providerParams) as {
      today_commission: number;
      today_pending: number;
      today_count: number;
    };

    // Today's breakdown by currency (realized only)
    const todayByCurrency = this.db
      .prepare(
        `SELECT
          currency,
          COALESCE(SUM(CASE WHEN is_settled = 1 THEN commission ELSE 0 END), 0) as commission,
          COUNT(*) as count
        FROM financial_services
        WHERE tenant_id = ? AND DATE(created_at) = DATE('now', 'localtime')${providerFilter}
        GROUP BY currency`,
      )
      .all(tenantId, ...providerParams) as CurrencyStats[];

    // This month's totals — split realized vs pending
    const monthStats = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(CASE WHEN is_settled = 1 THEN commission ELSE 0 END), 0) as month_commission,
          COALESCE(SUM(CASE WHEN is_settled = 0 THEN commission ELSE 0 END), 0) as month_pending,
          COUNT(*) as month_count
        FROM financial_services
        WHERE tenant_id = ? AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')${providerFilter}`,
      )
      .get(tenantId, ...providerParams) as {
      month_commission: number;
      month_pending: number;
      month_count: number;
    };

    // This month's breakdown by currency (realized only)
    const monthByCurrency = this.db
      .prepare(
        `SELECT
          currency,
          COALESCE(SUM(CASE WHEN is_settled = 1 THEN commission ELSE 0 END), 0) as commission,
          COUNT(*) as count
        FROM financial_services
        WHERE tenant_id = ? AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')${providerFilter}
        GROUP BY currency`,
      )
      .all(tenantId, ...providerParams) as CurrencyStats[];

    // By Provider Today (all currencies, realized only)
    const byProvider = this.db
      .prepare(
        `SELECT
          provider,
          COALESCE(SUM(CASE WHEN is_settled = 1 THEN commission ELSE 0 END), 0) as commission,
          currency,
          COUNT(*) as count
        FROM financial_services
        WHERE tenant_id = ? AND DATE(created_at) = DATE('now', 'localtime')${providerFilter}
        GROUP BY provider, currency`,
      )
      .all(tenantId, ...providerParams) as ProviderStats[];

    return {
      today: {
        commission: todayStats.today_commission,
        pending_commission: todayStats.today_pending,
        count: todayStats.today_count,
        byCurrency: todayByCurrency,
      },
      month: {
        commission: monthStats.month_commission,
        pending_commission: monthStats.month_pending,
        count: monthStats.month_count,
        byCurrency: monthByCurrency,
      },
      byProvider,
    };
  }

  /**
   * Update non-financial metadata on a financial service record.
   * Only metadata fields are allowed — financial data is immutable.
   */
  updateMetadata(
    id: number,
    data: {
      client_name?: string;
      phone_number?: string;
      sender_name?: string;
      sender_phone?: string;
      receiver_name?: string;
      receiver_phone?: string;
      note?: string;
    },
    editedBy: string,
  ): FinancialServiceEntity | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const fields: string[] = [];
    const values: unknown[] = [];

    if (data.client_name !== undefined) {
      fields.push("client_name = ?");
      values.push(data.client_name);
    }
    if (data.phone_number !== undefined) {
      fields.push("phone_number = ?");
      values.push(data.phone_number);
    }
    if (data.sender_name !== undefined) {
      fields.push("sender_name = ?");
      values.push(data.sender_name);
    }
    if (data.sender_phone !== undefined) {
      fields.push("sender_phone = ?");
      values.push(data.sender_phone);
    }
    if (data.receiver_name !== undefined) {
      fields.push("receiver_name = ?");
      values.push(data.receiver_name);
    }
    if (data.receiver_phone !== undefined) {
      fields.push("receiver_phone = ?");
      values.push(data.receiver_phone);
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
        `UPDATE financial_services SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`,
      )
      .run(...values);

    return this.findById(id);
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let financialServiceRepositoryInstance: FinancialServiceRepository | null =
  null;

export function getFinancialServiceRepository(): FinancialServiceRepository {
  if (!financialServiceRepositoryInstance) {
    financialServiceRepositoryInstance = new FinancialServiceRepository();
  }
  return financialServiceRepositoryInstance;
}

/** Reset the singleton (for testing) */
export function resetFinancialServiceRepository(): void {
  financialServiceRepositoryInstance = null;
}
