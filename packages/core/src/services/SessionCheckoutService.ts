/**
 * SessionCheckoutService — the customer-session basket checkout money flow.
 *
 * Extracted verbatim from electron-app/handlers/sessionHandlers.ts (WP4 of the
 * sessions web-parity plan) so the Electron IPC handler and the REST route call
 * ONE shared implementation (rules 13/14). Behavior is intentionally identical
 * to the pre-extraction handler; the only changes are:
 *   - the DB transaction boundary + session-close write now go through
 *     CustomerSessionRepository.runCheckoutTransaction / recordCheckoutClose
 *     (rule 13: no getDatabase()/raw SQL in a service);
 *   - the closing operator's username is passed in by the caller instead of
 *     resolved from the Electron session.
 *
 * Money invariants (FEATURE_GUIDE §11): each cart item is replayed in
 * deferPayment mode so only recordBasketPayment posts to drawers / books the
 * one basket debt row; the session customer is injected into each item's
 * formData for client propagation (lira-094); per-item profit is accumulated
 * and stamped; the operator exchange rate is threaded onto every item.
 */
import { CustomerSessionService } from "./CustomerSessionService.js";
import { getSalesService } from "./SalesService.js";
import { getRechargeService } from "./RechargeService.js";
import { getFinancialService } from "./FinancialService.js";
import { getLotoService } from "./LotoService.js";
import { getCustomServiceService } from "./CustomServiceService.js";
import { getMaintenanceService } from "./MaintenanceService.js";
import {
  getSessionPaymentService,
  hasKeptChangeClaim,
  resolveBasketKeptChange,
} from "./SessionPaymentService.js";
import {
  getCustomerSessionRepository,
  type SessionCartItem,
} from "../repositories/CustomerSessionRepository.js";
import { getTransactionRepository } from "../repositories/TransactionRepository.js";
import { cashierRateStamp } from "../repositories/moneyPosting.js";
import { getClientRepository } from "../repositories/ClientRepository.js";
import { clientLogger } from "../utils/logger.js";
import { isSessionPooledFeeReceive } from "../utils/sessionFeeOnTop.js";
import { sessionBasketCustomerAmount } from "../utils/sessionForPartnerItem.js";
import {
  customServiceCartLineHasSellingPrice,
  isCustomServiceCartChannel,
  NO_SELLING_PRICE_ERROR,
} from "../utils/customServiceSellingPrice.js";
import {
  DISCOUNT_AND_EXTRA_MESSAGE,
  EXTRA_ABOVE_TOTAL_MESSAGE,
} from "../validators/common.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import { buildPaymentSnapshot } from "../utils/paymentSnapshot.js";
import {
  TRANSACTION_DETAILS_VERSION,
  type TransactionDetails,
} from "../validators/transactionDetails.js";

export interface CheckoutCartItem {
  id: string;
  module: string;
  label: string;
  amount: number;
  currency: string;
  formData: Record<string, unknown>;
  ipcChannel: string;
}

export interface CheckoutPayment {
  method: string;
  currency_code: string;
  amount: number;
  /** IN = customer paid the shop; OUT = change handed back. Defaults to IN. */
  direction?: "IN" | "OUT";
  /**
   * BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase F wire contract (frozen):
   * meaningful only on a `direction: "OUT"` leg. "PAYOUT" = the shop pays the
   * customer for a basket item (session RECEIVE/Loto-prize cashout);
   * "CHANGE"/absent = legacy overpayment change. See `BasketPaymentLeg.kind`
   * (SessionPaymentService) for the full note/PCD-split contract.
   */
  kind?: "PAYOUT" | "CHANGE";
  /** Owner decision #11-A (netted session checkout) — see
   *  `BasketPaymentLeg.payoutOrigin` (SessionPaymentService) for the full
   *  contract. Meaningful only on a `kind: "PAYOUT"` leg. */
  payoutOrigin?: "SYSTEM" | "GENERAL";
  voucher_code?: string;
}

export interface CheckoutRequest {
  sessionId: number;
  cartItems: CheckoutCartItem[];
  paidByMethod?: string;
  payments?: CheckoutPayment[];
  exchangeRate?: number;
  clientId?: number;
  clientName?: string;
  /** T3 keep-change: kept change per currency → standalone KEPT_CHANGE row.
   *  A CLAIM only — verified server-side against the basket's net charge
   *  (G42, `resolveBasketKeptChange`) before anything is booked. */
  kept_change_usd?: number;
  kept_change_lbp?: number;
  /** LIRA-310 Waive: the gap the shop accepts not to collect, per currency
   *  → standalone WAIVED_SHORTFALL row (profit −waived). A CLAIM only —
   *  verified against the basket's net charge (`resolveBasketKeptChange`),
   *  capped at SHORTFALL_MAX, before anything is booked. */
  waived_usd?: number;
  waived_lbp?: number;
  /** LIRA-319: the ONE extra for the whole basket, per currency → a
   *  standalone EXTRA_CHARGE row linked with a POSITIVE amount, so the
   *  basket charge includes it. Verified against the basket's own charge
   *  (`resolveBasketExtra`) before anything is written. */
  extra_usd?: number;
  extra_lbp?: number;
  userId: number;
}

export interface CheckoutItemResult {
  cartItemId: string;
  module: string;
  transactionId: number;
  success: boolean;
  error?: string;
}

// Exported (like processCartItem below) only because `declaration: true`
// requires it once processCartItem's return type is public — no behavior
// change, still internal-only in intent.
export interface ProcessedItem {
  sourceId: number;
  sourceTable: string;
  transactionType: string;
}

export interface CheckoutResult {
  success: boolean;
  results?: CheckoutItemResult[];
  checkoutTotalUsd?: number;
  checkoutTotalLbp?: number;
  checkoutProfitUsd?: number;
  checkoutProfitLbp?: number;
  itemCount?: number;
  error?: string;
}

type SessionSiblingDetails = Extract<
  TransactionDetails,
  { kind: "session_sibling" }
>;

/**
 * LIRA-329 (T037) — the details of a row the checkout writes for the WHOLE
 * basket (the extra, the kept change, the waived gap): the session, the
 * row's role, and the payment method exactly as the checkout window sent it
 * (`paidByMethod` — informational only: the money goes by the payment
 * lines, unchanged). A blank method is omitted, never saved blank.
 */
export function buildSessionSiblingDetails(input: {
  sessionId: number;
  role: SessionSiblingDetails["role"];
  paidByMethod?: string | null;
}): SessionSiblingDetails {
  const method = input.paidByMethod?.trim();
  return {
    v: TRANSACTION_DETAILS_VERSION,
    kind: "session_sibling",
    sessionId: input.sessionId,
    ...(input.role ? { role: input.role } : {}),
    ...(method ? { paidByMethod: method } : {}),
  };
}

/**
 * LIRA-329 (T022) — the session customer's phone on a Mobile Recharge item
 * whose client is the session customer (its name was just injected), in the
 * key that module reads for the CUSTOMER's phone: `clientPhone` on a
 * recharge (its `phoneNumber` is the number being recharged), `phoneNumber`
 * on a financial service. Never overwrites a phone the item already has.
 */
function injectSessionCustomerPhone(
  formData: Record<string, unknown>,
  channel: string,
  phone: string,
): void {
  if (channel === "recharge:process" || channel === "recharge:create") {
    if (!formData.clientPhone) formData.clientPhone = phone;
  } else if (
    channel === "financial:create" ||
    channel === "omt:add-transaction"
  ) {
    if (!formData.phoneNumber && !formData.senderPhone) {
      formData.phoneNumber = phone;
    }
  }
}

/**
 * Process a single cart item by calling the appropriate service in
 * SESSION-BASKET deferred mode (deferPayment: true) — each service creates its
 * record + side effects + internal legs but SKIPS the customer-cash legs /
 * drawer post / debt; recordBasketPayment owns the single customer payment.
 *
 * Exported for tests (same rationale as resolveSessionClientForCheckout
 * above): the narrowest seam that exercises the ipcChannel dispatch switch
 * without standing up the full checkout() transaction.
 */
export function processCartItem(
  item: CheckoutCartItem,
  exchangeRate: number | undefined,
  userId: number,
  /** LIRA-329: the session whose basket payment covers this item. */
  sessionId?: number,
): ProcessedItem {
  const data = { ...item.formData, deferPayment: true } as Record<
    string,
    unknown
  >;
  // LIRA-329 (T022, T037): every item's transaction says which session paid
  // for it (`details.paid_in_session`, and the session on its payment
  // snapshot). Server-injected for EVERY channel, like `deferPayment` —
  // never accepted from the wire.
  if (sessionId) {
    data.paid_in_session = sessionId;
  }
  if (exchangeRate && exchangeRate > 0) {
    if (data.exchange_rate === undefined) data.exchange_rate = exchangeRate;
    if (data.exchangeRate === undefined) data.exchangeRate = exchangeRate;
  }

  switch (item.ipcChannel) {
    case "sales:create":
    case "sales:process": {
      const salesService = getSalesService();
      const result = salesService.processSale(data as never, userId);
      if (!result.success || !result.id) {
        throw new Error(result.error || "Failed to process sale");
      }
      return {
        sourceId: result.id,
        sourceTable: "sales",
        transactionType: "sale",
      };
    }

    case "recharge:create":
    case "recharge:process": {
      data.userId = userId;
      const rechargeService = getRechargeService();
      const result = rechargeService.processRecharge(data as never);
      if (!result.success || !result.id) {
        throw new Error(result.error || "Failed to process recharge");
      }
      return {
        sourceId: result.id,
        sourceTable: "recharges",
        transactionType:
          item.module === "recharge_mtc" ? "recharge_mtc" : "recharge_alfa",
      };
    }

    case "omt:add-transaction":
    case "financial:create": {
      data.userId = userId;
      const financialService = getFinancialService();
      const result = financialService.addTransaction(data as never);
      if (!result.success || !result.id) {
        throw new Error(result.error || "Failed to add financial transaction");
      }
      const moduleToType: Record<string, string> = {
        omt_app: "omt_app",
        whish_app: "whish_app",
        omt_system: "omt_system",
        whish_system: "whish_system",
        ipick: "ipick",
        katsh: "katsh",
        binance_send: "binance",
        binance_receive: "binance",
      };
      return {
        sourceId: result.id,
        sourceTable: "financial_services",
        transactionType: moduleToType[item.module] || "financial_service",
      };
    }

    case "loto:sell": {
      data.userId = userId;
      const lotoService = getLotoService();
      const ticket = lotoService.sellTicket(data as never);
      return {
        sourceId: ticket.id,
        sourceTable: "loto_tickets",
        transactionType: "loto_ticket",
      };
    }

    // Legacy spelling (BIDIRECTIONAL_PAYMENT_LEGS_PLAN §2 bug 3): the frontend
    // used to enqueue camelCase "loto:cashPrize:create"; session_cart_items.
    // ipc_channel is persisted in the DB, so a session basket opened before
    // this fix (item already added, checkout not yet run) may still hold the
    // old string — keep accepting it so that checkout doesn't throw.
    case "loto:cashPrize:create":
    case "loto:cash-prize:create": {
      data.userId = userId;
      const lotoService = getLotoService();
      const prize = lotoService.recordCashPrize(data as never);
      return {
        sourceId: prize.id,
        sourceTable: "loto_cash_prizes",
        transactionType: "loto_prize",
      };
    }

    case "customService:create":
    case "custom-services:add": {
      const customService = getCustomServiceService();
      const result = customService.addService(data as never);
      if (!result.success || !result.id) {
        throw new Error(result.error || "Failed to add custom service");
      }
      return {
        sourceId: result.id,
        sourceTable: "custom_services",
        transactionType: "custom_service",
      };
    }

    case "maintenance:save": {
      const maintenanceService = getMaintenanceService();
      // actorUserId (LIRA-246a): the session-basket checkout operator.
      const result = maintenanceService.saveJob(data as never, userId);
      if (!result.success || !result.id) {
        throw new Error(result.error || "Failed to save maintenance job");
      }
      return {
        sourceId: result.id,
        sourceTable: "maintenance",
        transactionType: "maintenance",
      };
    }

    default:
      throw new Error(
        `Unknown IPC channel for session checkout: ${item.ipcChannel}`,
      );
  }
}

/**
 * Owner rule (2026-10-07): a custom service with no selling price has nothing
 * to pay, so it cannot go through a basket. Checkout replays the cart items
 * the CLIENT sends, not the saved `session_cart_items` rows, so the cart-add
 * refusal (CustomerSessionRepository.addCartItem) alone would not stop a
 * hand-built checkout.
 *
 * Owner decision (same day): baskets opened BEFORE this rule that already
 * hold such a line are left as they are. A no-price custom-service line is
 * therefore accepted only when this session already has it saved (same
 * `item_id`) AND the saved row itself has no price — a line saved before
 * cart-add started refusing. Everything else (never saved, or borrowing the
 * id of a saved priced line) is a new line and is refused.
 *
 * Returns the first refused line, or null. Exported for its test.
 */
export function findUnpricedNewCustomServiceLine(
  cartItems: CheckoutCartItem[],
  savedRows: SessionCartItem[],
): CheckoutCartItem | null {
  for (const item of cartItems) {
    if (!isCustomServiceCartChannel(item.ipcChannel)) continue;
    if (customServiceCartLineHasSellingPrice(item.formData)) continue;
    const saved = savedRows.find(
      (row) =>
        row.item_id === item.id && isCustomServiceCartChannel(row.ipc_channel),
    );
    let savedFormData: unknown = null;
    if (saved) {
      try {
        savedFormData = JSON.parse(saved.form_data);
      } catch {
        savedFormData = null;
      }
    }
    const isLegacySavedLine =
      !!saved && !customServiceCartLineHasSellingPrice(savedFormData);
    if (!isLegacySavedLine) return item;
  }
  return null;
}

/** Process _batch items (FinancialForm/KatshForm) — multiple sub-items. */
function processBatchCartItem(
  item: CheckoutCartItem,
  exchangeRate: number | undefined,
  userId: number,
  sessionId?: number,
): ProcessedItem[] {
  const results: ProcessedItem[] = [];
  const items = item.formData.items as Array<Record<string, unknown>>;
  if (!items || !Array.isArray(items)) {
    throw new Error(
      `Batch cart item ${item.id} has no items array in formData`,
    );
  }
  for (const subItem of items) {
    const subCartItem: CheckoutCartItem = { ...item, formData: subItem };
    results.push(processCartItem(subCartItem, exchangeRate, userId, sessionId));
  }
  return results;
}

/** Map checkout legs (snake_case) to the camelCase shape the basket recorder
 *  expects (with IN/OUT direction + Phase F's payout/change `kind`). */
function checkoutPaymentsToBasketLegs(payments: CheckoutPayment[]) {
  return payments.map((p) => ({
    method: p.method,
    currencyCode: p.currency_code,
    amount: p.amount,
    direction: p.direction ?? ("IN" as const),
    kind: p.kind,
    payoutOrigin: p.payoutOrigin,
    voucherCode: p.voucher_code,
  }));
}

/**
 * Bug 7's third component (BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase F):
 * is this cart item a fee-on-top RECEIVE (the fee is collected via the
 * pooled CHARGE legs, not netted from the payout)? This is the ONLY layer
 * that ever sees `includingFees`/`serviceType` — they live in the cart
 * item's formData and are never persisted on the financial_services row —
 * so `checkout()` resolves this gate once per item and hands the matching
 * financial_services ids down to `getSessionCashSplitContext` (via
 * `recordBasketPayment`), which reads the fee VALUE itself from the
 * persisted `omt_fee`/`whish_fee` columns (rule 14 — one source of truth,
 * never re-derived here).
 */
// Exported for direct unit coverage (SessionCheckoutService.feeOnTopGate.test.ts)
// — the narrowest seam that pins this gate's condition without standing up
// the full async checkout() transaction.
//
// LIRA-271: delegates to the ONE shared rule (`utils/sessionFeeOnTop.ts`)
// the checkout modal also uses, so the two can never disagree about what
// the customer owes. It used to flag EVERY fee-on-top RECEIVE (OMT, app
// wallets included) and rely on the SQL's provider gate in
// `getSessionCashSplitContext` to zero the non-WHISH ones — that gate stays
// as a second line of defence.
export function isFeeOnTopReceiveItem(
  formData: Record<string, unknown>,
): boolean {
  return isSessionPooledFeeReceive(formData);
}

/**
 * LIRA-319 — verify the basket extra BEFORE any write. The extra sits on top
 * of the basket's own charge (what the customer pays for the charge lines,
 * `sessionBasketCustomerAmount` per line — the same figure the checkout
 * totals use, rule 14) and may not exceed it (FR-006), compared at the
 * basket rate when the currencies differ. It may not ride with a Waive —
 * the basket's discount analogue ("a discount or an extra, not both").
 * Returns the extra to book, or throws a plain-sentence refusal. Exported
 * for its test.
 */
export function resolveBasketExtra(input: {
  cartItems: CheckoutCartItem[];
  extraUsd: number;
  extraLbp: number;
  waivedUsd: number;
  waivedLbp: number;
  exchangeRate: number | undefined;
}): { usd: number; lbp: number } {
  const usd = input.extraUsd > 0 ? input.extraUsd : 0;
  const lbp = input.extraLbp > 0 ? input.extraLbp : 0;
  if (usd === 0 && lbp === 0) return { usd: 0, lbp: 0 };
  if (input.waivedUsd > 0 || input.waivedLbp > 0) {
    throw new Error(DISCOUNT_AND_EXTRA_MESSAGE);
  }
  let chargeUsd = 0;
  let chargeLbp = 0;
  for (const item of input.cartItems) {
    // Charge lines only (a payout line is the shop paying out, never what
    // the extra sits on) — the same base the item-refund share divides by.
    const amount = sessionBasketCustomerAmount(item);
    if (!(amount > 0)) continue;
    if (item.currency === "LBP") chargeLbp += amount;
    else chargeUsd += amount;
  }
  const rate =
    input.exchangeRate && input.exchangeRate > 0 ? input.exchangeRate : null;
  const EPS = 0.000001;
  if (rate == null) {
    // No rate: only a same-currency comparison is possible.
    const crossCurrency =
      (lbp > 0 && Math.abs(chargeUsd) > EPS) ||
      (usd > 0 && Math.abs(chargeLbp) > EPS);
    if (crossCurrency) {
      throw new Error(
        "The extra can't be checked without the exchange rate. (Session checkout: an extra needs the exchange rate the basket was paid at)",
      );
    }
    if (usd > chargeUsd + EPS || lbp > chargeLbp + EPS) {
      throw new Error(EXTRA_ABOVE_TOTAL_MESSAGE);
    }
    return { usd, lbp };
  }
  const chargeUsdEq = chargeUsd + chargeLbp / rate;
  const extraUsdEq = usd + lbp / rate;
  if (!(chargeUsdEq > 0) || extraUsdEq > chargeUsdEq + EPS) {
    throw new Error(EXTRA_ABOVE_TOTAL_MESSAGE);
  }
  return { usd, lbp };
}

/** Resolve the unified transactions.id for a just-created source record. */
function resolveUnifiedTransactionId(
  sourceTable: string,
  sourceId: number,
): number | null {
  const txn = getTransactionRepository().getBySourceId(sourceTable, sourceId);
  return txn ? txn.id : null;
}

/**
 * Resolve the session customer to a client id for debt booking and
 * transaction stamping. Exported for tests.
 *
 * - name+phone → the phone owner, REGISTERING the client if unknown
 *   (FEATURE_GUIDE §6: unknown name+phone auto-creates). This also covers
 *   sessions whose phone was added after start (session edit) and sessions
 *   started before auto-registration existed — without it, an on-account
 *   basket died with "Cannot create basket debt without a client".
 * - name only → EXACT full-name match or nothing. Never fuzzy: the old
 *   `search(name, {limit: 1})` fallback ran `LIKE '%name%'` and stamped the
 *   alphabetically-first hit — a session typed as "amir" put the purchase on
 *   "AMIR SHNEIF"'s history.
 */
export function resolveSessionClientForCheckout(
  customerName: string | undefined,
  customerPhone: string | undefined,
  userId: number,
): number | undefined {
  const name = customerName?.trim();
  const phone = customerPhone?.trim();
  if (!name) return undefined;

  try {
    const clientRepo = getClientRepository();
    if (phone) {
      return clientRepo.findOrCreateByPhone(name, phone, userId).id;
    }
    const byName = clientRepo.findByName(name);
    return byName ? byName.id : undefined;
  } catch (error) {
    // Best-effort: a clientless basket still checks out (cash paths);
    // CUSTOMER_ACCOUNT baskets fail later with an explicit error.
    clientLogger.error(
      { error, name, phone },
      "Session checkout client resolution failed",
    );
    return undefined;
  }
}

export class SessionCheckoutService {
  private sessionService = new CustomerSessionService();

  /**
   * Check out a customer-session basket. `ctx.username` is the operator name to
   * stamp as closed_by; `request.userId` is the acting user for created records
   * (matches the pre-extraction handler exactly).
   */
  async checkout(
    request: CheckoutRequest,
    ctx: { username: string },
  ): Promise<CheckoutResult> {
    try {
      const {
        sessionId,
        cartItems,
        payments,
        exchangeRate,
        userId,
        kept_change_usd,
        kept_change_lbp,
        waived_usd,
        waived_lbp,
        extra_usd,
        extra_lbp,
        paidByMethod,
      } = request;

      if (!cartItems || cartItems.length === 0) {
        return { success: false, error: "Cart is empty" };
      }

      const sessionResult =
        await this.sessionService.getSessionDetails(sessionId);
      if (!sessionResult.success || !sessionResult.session) {
        return {
          success: false,
          error: sessionResult.error || "Session not found",
        };
      }
      if (!sessionResult.session.is_active) {
        return { success: false, error: "Session is already closed" };
      }

      // Owner rule (2026-10-07): refuse a NEW no-price custom-service line
      // before anything is written; baskets saved before the rule are left
      // as they are (see findUnpricedNewCustomServiceLine).
      if (cartItems.some((i) => isCustomServiceCartChannel(i.ipcChannel))) {
        const refused = findUnpricedNewCustomServiceLine(
          cartItems,
          getCustomerSessionRepository().getCartItems(sessionId),
        );
        if (refused) {
          return { success: false, error: NO_SELLING_PRICE_ERROR };
        }
      }

      // G42: a kept-change claim is reconciled at the basket's rate — never
      // at a silent fallback of 1.
      const keptClaim = {
        usd: kept_change_usd ?? 0,
        lbp: kept_change_lbp ?? 0,
      };
      const claimsKept = hasKeptChangeClaim(keptClaim);
      if (claimsKept && !(exchangeRate && exchangeRate > 0)) {
        return {
          success: false,
          error:
            "Session checkout: keeping change needs the exchange rate the basket was paid at",
        };
      }
      // LIRA-310: the Waive claim — same rule (checked at the basket's rate).
      const waivedClaim = { usd: waived_usd ?? 0, lbp: waived_lbp ?? 0 };
      const claimsWaived = hasKeptChangeClaim(waivedClaim);
      if (claimsWaived && !(exchangeRate && exchangeRate > 0)) {
        return {
          success: false,
          error:
            "The waived amount can't be checked without the exchange rate. (Session checkout: waiving needs the exchange rate the basket was paid at)",
        };
      }

      // LIRA-319: the basket extra, verified before anything is written.
      const extra = resolveBasketExtra({
        cartItems,
        extraUsd: extra_usd ?? 0,
        extraLbp: extra_lbp ?? 0,
        waivedUsd: waived_usd ?? 0,
        waivedLbp: waived_lbp ?? 0,
        exchangeRate,
      });

      const repo = getCustomerSessionRepository();
      const itemResults: CheckoutItemResult[] = [];
      let checkoutTotalUsd = 0;
      let checkoutTotalLbp = 0;
      let checkoutProfitUsd = 0;
      let checkoutProfitLbp = 0;
      // Bug 7's third component (BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase
      // F): financial_services ids of every fee-on-top RECEIVE item in this
      // basket, handed to recordBasketPayment → getSessionCashSplitContext
      // so the fee counts toward the basket's CHARGE-side PCD split.
      const feeOnTopReceiveFsIds: number[] = [];

      const sessionCustomerName =
        sessionResult.session.customer_name || undefined;
      const sessionCustomerPhone =
        sessionResult.session.customer_phone || undefined;

      // Resolve (or register) the session customer's client id for DEBT
      // payments and transaction stamping — see resolveSessionClientForCheckout.
      const sessionClientId = resolveSessionClientForCheckout(
        sessionCustomerName,
        sessionCustomerPhone,
        userId,
      );
      // LIRA-329 (T037): the session customer's phone on the basket's own
      // rows (extra / kept change / waived), next to the name — never
      // without it ("client_phone requires client_name").
      const siblingClientPhone =
        sessionCustomerName && sessionCustomerPhone
          ? sessionCustomerPhone
          : null;

      // Inject session customer into cart items lacking a client name.
      //
      // LIRA-232 investigation fix: request shapes disagree on naming —
      // RechargeRequest/FinancialServiceRequest read camelCase
      // `clientId`/`clientName`, but SalesRepository's `SaleRequest` reads
      // snake_case `client_id`/`client_name` only. Stamping just the
      // camelCase form (the original code) silently dropped the walk-in
      // session customer off every SALE transaction row — `sale.client_id`/
      // `sale.client_name` stayed whatever the cart item's formData already
      // had (often explicit `client_id: null`), so the SALE never linked to
      // the client the session had just resolved/created, and the
      // Transactions/POS pages showed no name at all for that row (rule 21:
      // this is the same "second definition of the contract" trap — one
      // injection has to speak every downstream module's shape, not the
      // shape of whichever module was tested first). Setting BOTH forms is
      // safe: whichever key a module's own request type reads picks up the
      // value, and the other key is simply ignored by services that don't
      // look at it.
      if (sessionCustomerName) {
        for (const item of cartItems) {
          const fd = item.formData;
          if (fd._batch && Array.isArray(fd.items)) {
            for (const sub of fd.items as Record<string, unknown>[]) {
              if (!sub.clientName && !sub.senderName && !sub.client_name) {
                sub.clientName = sessionCustomerName;
                sub.client_name = sessionCustomerName;
                if (sessionCustomerPhone) {
                  injectSessionCustomerPhone(
                    sub,
                    item.ipcChannel,
                    sessionCustomerPhone,
                  );
                }
              }
              if (!sub.clientId && !sub.client_id && sessionClientId) {
                sub.clientId = sessionClientId;
                sub.client_id = sessionClientId;
              }
            }
          } else {
            if (!fd.clientName && !fd.senderName && !fd.client_name) {
              fd.clientName = sessionCustomerName;
              fd.client_name = sessionCustomerName;
              if (sessionCustomerPhone) {
                injectSessionCustomerPhone(
                  fd,
                  item.ipcChannel,
                  sessionCustomerPhone,
                );
              }
            }
            if (!fd.clientId && !fd.client_id && sessionClientId) {
              fd.clientId = sessionClientId;
              fd.client_id = sessionClientId;
            }
          }
        }
      }

      // ONE atomic transaction (rule 13: boundary owned by the repository)
      repo.runCheckoutTransaction(() => {
        for (const item of cartItems) {
          try {
            const isBatch = item.formData._batch === true;
            // What the walk-in customer pays (+) / is paid (−) for this item:
            // 0 for a For-Partner item, whatever amount the client sent — its
            // obligation is the partner's and is booked by the item itself
            // (one shared rule with the checkout modal, rule 14).
            const customerAmount = sessionBasketCustomerAmount(item);

            if (isBatch) {
              const batchResults = processBatchCartItem(
                item,
                exchangeRate,
                userId,
                sessionId,
              );
              const batchItems = item.formData.items as
                | Array<Record<string, unknown>>
                | undefined;
              for (let bi = 0; bi < batchResults.length; bi++) {
                const result = batchResults[bi];
                let subProfitUsd = 0;
                let subProfitLbp = 0;
                if (batchItems && batchItems[bi]) {
                  const sub = batchItems[bi];
                  const comm = Number(sub.commission) || 0;
                  const subCurrency =
                    (sub.currency as string) || item.currency || "USD";
                  if (subCurrency === "LBP") subProfitLbp = comm;
                  else subProfitUsd = comm;
                  if (
                    result.sourceTable === "financial_services" &&
                    isFeeOnTopReceiveItem(sub)
                  ) {
                    feeOnTopReceiveFsIds.push(result.sourceId);
                  }
                }
                const unifiedId = resolveUnifiedTransactionId(
                  result.sourceTable,
                  result.sourceId,
                );
                repo.linkTransaction(
                  sessionId,
                  result.transactionType,
                  result.sourceId,
                  // F4 (round-3 review) — any NON-LBP currency (including a
                  // netted USDT/Binance cash-out) is USD-equivalent for this
                  // link's purposes, matching the SAME bucketing this
                  // function's own checkoutTotalUsd/Lbp accumulation uses a
                  // few lines below (rule 14) — a strict `=== "USD"` check
                  // silently dropped a USDT item to 0/0, making it invisible
                  // to the sign-based `isSessionPayoutMember` guard.
                  item.currency !== "LBP"
                    ? customerAmount / batchResults.length
                    : 0,
                  item.currency === "LBP"
                    ? customerAmount / batchResults.length
                    : 0,
                  subProfitUsd,
                  subProfitLbp,
                  unifiedId,
                );
                itemResults.push({
                  cartItemId: item.id,
                  module: item.module,
                  transactionId: result.sourceId,
                  success: true,
                });
              }
            } else {
              const result = processCartItem(
                item,
                exchangeRate,
                userId,
                sessionId,
              );

              if (
                result.sourceTable === "financial_services" &&
                isFeeOnTopReceiveItem(item.formData)
              ) {
                feeOnTopReceiveFsIds.push(result.sourceId);
              }

              let itemProfitUsd = 0;
              let itemProfitLbp = 0;
              const comm =
                Number(item.formData.commission) ||
                Number(item.formData.totalProfitUsd) ||
                Number(item.formData.profitUsd) ||
                0;
              const commLbp =
                Number(item.formData.profitLbp) ||
                Number(item.formData.commissionLbp) ||
                0;
              if (item.currency === "LBP") {
                itemProfitLbp = comm || commLbp;
              } else {
                itemProfitUsd = comm;
                itemProfitLbp = commLbp;
              }

              const unifiedId = resolveUnifiedTransactionId(
                result.sourceTable,
                result.sourceId,
              );
              repo.linkTransaction(
                sessionId,
                result.transactionType,
                result.sourceId,
                // F4 (round-3 review) — see the batch branch's identical
                // comment above: any NON-LBP currency (a netted USDT/Binance
                // cash-out included) is USD-equivalent here, matching
                // checkoutTotalUsd/Lbp's own bucketing a few lines below
                // (rule 14). A strict `=== "USD"` check made a USDT item's
                // real (negative, netted) value invisible to every
                // sign-based payout reader — it was stamped 0/0 instead.
                item.currency !== "LBP" ? customerAmount : 0,
                item.currency === "LBP" ? customerAmount : 0,
                itemProfitUsd,
                itemProfitLbp,
                unifiedId,
              );

              itemResults.push({
                cartItemId: item.id,
                module: item.module,
                transactionId: result.sourceId,
                success: true,
              });
            }

            if (item.currency === "LBP") checkoutTotalLbp += customerAmount;
            else checkoutTotalUsd += customerAmount;

            if (item.formData._batch && Array.isArray(item.formData.items)) {
              for (const sub of item.formData.items as Array<
                Record<string, unknown>
              >) {
                const comm = Number(sub.commission) || 0;
                const subCurrency =
                  (sub.currency as string) || item.currency || "USD";
                if (subCurrency === "LBP") checkoutProfitLbp += comm;
                else checkoutProfitUsd += comm;
              }
            } else {
              const comm =
                Number(item.formData.commission) ||
                Number(item.formData.totalProfitUsd) ||
                Number(item.formData.profitUsd) ||
                0;
              const commLbp =
                Number(item.formData.profitLbp) ||
                Number(item.formData.commissionLbp) ||
                0;
              if (item.currency === "LBP") {
                checkoutProfitLbp += comm || commLbp;
              } else {
                checkoutProfitUsd += comm;
                checkoutProfitLbp += commLbp;
              }
            }
          } catch (err) {
            throw new Error(
              `Failed to process cart item "${item.label}" (${item.module}): ${err instanceof Error ? err.message : "Unknown error"}`,
            );
          }
        }

        // LIRA-319: the basket extra — ONE EXTRA_CHARGE row (amount = extra,
        // profit 0, extra_* = extra; "Extra charges" reads extra_*), linked
        // with a POSITIVE amount BEFORE the payment below so the basket
        // charge it is checked against (getSessionCashSplitContext: kept
        // change, waive, nothing-to-collect, PCD split) includes it. No legs
        // of its own — the basket's payment legs carry the money ("no-money"
        // posting rule, like KEPT_CHANGE). Reversal owner: the basket's own
        // void/refund, and a basket item refund returns its share (rule 20).
        if (extra.usd > 0 || extra.lbp > 0) {
          const extraTxnId = getTransactionRepository().createTransaction({
            type: TRANSACTION_TYPES.EXTRA_CHARGE,
            source_table: "customer_sessions",
            source_id: sessionId,
            user_id: userId,
            amount_usd: extra.usd,
            amount_lbp: extra.lbp,
            profit_usd: 0,
            profit_lbp: 0,
            extra_usd: extra.usd,
            extra_lbp: extra.lbp,
            ...cashierRateStamp(exchangeRate),
            client_id: sessionClientId ?? null,
            // Same reason as KEPT_CHANGE below (LIRA-230): no formData to
            // inject the session's walk-in name into.
            client_name: sessionCustomerName ?? null,
            client_phone: siblingClientPhone,
            // LIRA-329 (T037): the session, the role and the method as sent;
            // the basket's payment lines own the money.
            details: buildSessionSiblingDetails({
              sessionId,
              role: "EXTRA",
              paidByMethod,
            }),
            payment_snapshot: buildPaymentSnapshot({ sessionId }),
            summary: `Extra (session checkout): ${[
              extra.usd > 0 ? `$${extra.usd}` : null,
              extra.lbp > 0 ? `${extra.lbp.toLocaleString()} LBP` : null,
            ]
              .filter(Boolean)
              .join(" + ")}`,
            metadata_json: {
              session_id: sessionId,
              extra_usd: extra.usd,
              extra_lbp: extra.lbp,
            },
          });
          repo.linkTransaction(
            sessionId,
            "extra_charge",
            extraTxnId,
            extra.usd,
            extra.lbp,
            0,
            0,
            extraTxnId,
          );
          checkoutTotalUsd += extra.usd;
          checkoutTotalLbp += extra.lbp;
          // The extra is profit (the Profits page's "Extra charges"); the
          // Sessions page reads this stamp first, so it carries it too —
          // matching the linked-rows total (extraChargeProfit).
          checkoutProfitUsd += extra.usd;
          checkoutProfitLbp += extra.lbp;
        }

        // AFTER all items (deferred mode): record the ONE customer payment for
        // the whole basket — posts each leg to its drawer once, one debt row
        // for the CUSTOMER_ACCOUNT portion, redeems gift cards, back-fills SALEs.
        // G42: it also verifies the kept-change claim before its first write.
        let keptUsd = 0;
        let keptLbp = 0;
        let waivedUsd = 0;
        let waivedLbp = 0;
        if (payments && payments.length > 0) {
          const basket = getSessionPaymentService().recordBasketPayment(
            sessionId,
            {
              legs: checkoutPaymentsToBasketLegs(payments),
              exchangeRate: exchangeRate && exchangeRate > 0 ? exchangeRate : 1,
              userId,
              clientId: sessionClientId ?? null,
              feeOnTopReceiveFsIds,
              keptChange: claimsKept ? keptClaim : null,
              waived: claimsWaived ? waivedClaim : null,
            },
          );
          keptUsd = basket.keptUsd;
          keptLbp = basket.keptLbp;
          waivedUsd = basket.waivedUsd;
          waivedLbp = basket.waivedLbp;
        } else if (claimsKept || claimsWaived) {
          // No payment lines: the helper refuses ("nothing to keep it from").
          // Called rather than hand-thrown so the refusal text has one source.
          resolveBasketKeptChange({
            legs: [],
            ctx: {
              chargeTotalUsd: checkoutTotalUsd,
              chargeTotalLbp: checkoutTotalLbp,
              payoutTotalUsd: 0,
              payoutTotalLbp: 0,
            },
            claimedKept: keptClaim,
            claimedWaived: claimsWaived ? waivedClaim : null,
            exchangeRate: exchangeRate as number,
          });
        }

        // T3 keep-change (owner decision 2026-07-13): a standalone profit-only
        // KEPT_CHANGE row, session-linked, NOT attached to any item — amount 0
        // because the tender is already booked by the basket's payment legs.
        // Non-reversible (see transactionTypes.ts); aggregated by the
        // "Other / kept change" profits bucket alongside debt repayments.
        // Books the VERIFIED kept (G42), never the raw request values.
        if (keptUsd > 0 || keptLbp > 0) {
          const keptTxnId = getTransactionRepository().createTransaction({
            type: "KEPT_CHANGE",
            source_table: "customer_sessions",
            source_id: sessionId,
            user_id: userId,
            amount_usd: 0,
            amount_lbp: 0,
            profit_usd: keptUsd,
            profit_lbp: keptLbp,
            // Owner decision 2026-10-07: the row saves the rate the cashier
            // actually used — the basket's checkout rate (never the `1`
            // placeholder recordBasketPayment gets above when none is sent).
            ...cashierRateStamp(exchangeRate),
            client_id: sessionClientId ?? null,
            // LIRA-230: every OTHER cart item in this basket gets
            // `sessionCustomerName` injected into its own formData above
            // ("Inject session customer into cart items lacking a client
            // name") before its module repository stamps it onto the
            // resulting transaction row. This standalone KEPT_CHANGE row has
            // no formData/item to inject into, so it must stamp the same
            // name directly here — otherwise a named walk-in with no
            // resolvable client_id (no phone, no exact existing-client
            // match) leaves this row's client_name null, and
            // ProfitRepository.getByClient's walk-in grouping
            // (`COALESCE(t.client_name, orig.client_name, '')`) silently
            // folds it into the unnamed "Walk-in" bucket instead of the
            // customer's own name.
            client_name: sessionCustomerName ?? null,
            client_phone: siblingClientPhone,
            // LIRA-329 (T037): the session, the role, the method as sent and
            // the change the customer left with the shop.
            details: buildSessionSiblingDetails({
              sessionId,
              role: "KEPT_CHANGE",
              paidByMethod,
            }),
            payment_snapshot: buildPaymentSnapshot({
              sessionId,
              keptChange: { usd: keptUsd, lbp: keptLbp },
            }),
            summary: `Kept change (session checkout): ${[
              keptUsd > 0 ? `$${keptUsd}` : null,
              keptLbp > 0 ? `${keptLbp.toLocaleString()} LBP` : null,
            ]
              .filter(Boolean)
              .join(" + ")}`,
            metadata_json: {
              session_id: sessionId,
              kept_change_usd: keptUsd,
              kept_change_lbp: keptLbp,
            },
          });
          // Sessions link via session_transactions (no session_id column on
          // transactions) — link so the session sweep/detail sees the row.
          repo.linkTransaction(
            sessionId,
            "kept_change",
            keptTxnId,
            0,
            0,
            keptUsd,
            keptLbp,
            keptTxnId,
          );
        }

        // LIRA-310 Waive: the KEPT_CHANGE mirror — a standalone profit-only
        // WAIVED_SHORTFALL row (amount 0, profit −waived), session-linked so
        // voidSessionBasket/refundSessionBasket sweep it with the basket
        // (rule 20; SESSION_BASKET_BYPASSABLE_NON_REVERSIBLE_TYPES). The
        // items and every counterparty's share are untouched — the shop
        // alone absorbs the gap. Books the VERIFIED amount, never the claim.
        if (waivedUsd > 0 || waivedLbp > 0) {
          const waivedTxnId = getTransactionRepository().createTransaction({
            type: "WAIVED_SHORTFALL",
            source_table: "customer_sessions",
            source_id: sessionId,
            user_id: userId,
            amount_usd: 0,
            amount_lbp: 0,
            profit_usd: -waivedUsd,
            profit_lbp: -waivedLbp,
            ...cashierRateStamp(exchangeRate),
            client_id: sessionClientId ?? null,
            // Same reason as KEPT_CHANGE above (LIRA-230): no formData to
            // inject the session's walk-in name into.
            client_name: sessionCustomerName ?? null,
            client_phone: siblingClientPhone,
            // LIRA-329 (T037): the session, the role and the method as sent.
            details: buildSessionSiblingDetails({
              sessionId,
              role: "WAIVED",
              paidByMethod,
            }),
            payment_snapshot: buildPaymentSnapshot({ sessionId }),
            summary: `Waived (session checkout): ${[
              waivedUsd > 0 ? `$${waivedUsd}` : null,
              waivedLbp > 0 ? `${waivedLbp.toLocaleString()} LBP` : null,
            ]
              .filter(Boolean)
              .join(" + ")}`,
            metadata_json: {
              session_id: sessionId,
              waived_usd: waivedUsd,
              waived_lbp: waivedLbp,
            },
          });
          repo.linkTransaction(
            sessionId,
            "waived_shortfall",
            waivedTxnId,
            0,
            0,
            -waivedUsd,
            -waivedLbp,
            waivedTxnId,
          );
        }

        repo.recordCheckoutClose(sessionId, {
          totalUsd: checkoutTotalUsd,
          totalLbp: checkoutTotalLbp,
          profitUsd: checkoutProfitUsd,
          profitLbp: checkoutProfitLbp,
          legacyTotal: checkoutTotalUsd + checkoutTotalLbp,
          legacyCurrency: cartItems[0]?.currency || "USD",
          closedBy: ctx.username || String(userId),
        });
      });

      return {
        success: true,
        results: itemResults,
        checkoutTotalUsd,
        checkoutTotalLbp,
        checkoutProfitUsd,
        checkoutProfitLbp,
        itemCount: cartItems.length,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Checkout failed",
      };
    }
  }
}

let instance: SessionCheckoutService | null = null;

export function getSessionCheckoutService(): SessionCheckoutService {
  if (!instance) instance = new SessionCheckoutService();
  return instance;
}

export function resetSessionCheckoutService(): void {
  instance = null;
}
