/**
 * Session Payment Service — basket-payment recorder (LIRA basket payment).
 *
 * A customer session is ONE basket the customer pays for once. Each cart item is
 * created in `deferPayment` mode (the item's own customer-cash legs are skipped),
 * then this recorder posts the single customer-facing payment for the whole
 * basket:
 *
 *  - Inserts each customer-cash IN/OUT leg into `payments` with `session_id` set
 *    and `transaction_id` NULL (a payment row belongs to EITHER a transaction OR
 *    a session basket, never both). Drawer-name resolution reuses the same
 *    helpers the per-transaction repositories use, so reconciliation matches.
 *  - Posts each leg to `drawer_balances` ONCE (IN = +, OUT/change = −).
 *  - Creates ONE debt-ledger entry for the total CUSTOMER_ACCOUNT IN portion
 *    (split by leg currency), tied to the session's client.
 *  - Redeems GIFT_CARD legs via the existing voucher path (deposits the voucher's
 *    full value to the owner's account; the CUSTOMER_ACCOUNT debt then consumes
 *    it). GIFT_CARD IN legs are treated as non-drawer (debt-like), exactly as the
 *    per-transaction paths treat them.
 *  - Back-fills each session SALE's paid_usd/paid_lbp/exchange_rate_snapshot from
 *    the basket settlement so a covered sale realizes profit and an on-account
 *    sale stays pending (the single basket debt entry carries it).
 *
 * MUST be called INSIDE the checkout's db.transaction so it's atomic with the
 * item creation. It does NOT open its own transaction.
 */

import {
  getCustomerSessionRepository,
  type CustomerSessionRepository,
} from "../repositories/CustomerSessionRepository.js";
import { getClientRepository } from "../repositories/ClientRepository.js";
import { getSalesRepository } from "../repositories/SalesRepository.js";
import { getVoucherRepository } from "../repositories/VoucherRepository.js";
import {
  getSessionPaymentRepository,
  type SessionPaymentRepository,
} from "../repositories/SessionPaymentRepository.js";
import { getDebtService } from "./DebtService.js";
import {
  isDrawerAffectingMethod,
  paymentMethodToDrawerName,
} from "../utils/payments.js";
import { closingLogger } from "../utils/logger.js";

// =============================================================================
// Types
// =============================================================================

/**
 * A single customer-facing payment leg for the whole basket.
 * `direction` is from the shop's perspective:
 *  - "IN"  — customer paid the shop (credits a drawer / uses account credit)
 *  - "OUT" — shop returned change to the customer (debits a drawer / store credit)
 */
export interface BasketPaymentLeg {
  method: string;
  currencyCode: string;
  amount: number;
  direction?: "IN" | "OUT";
  /** Set when method === 'GIFT_CARD' — the voucher code being redeemed. */
  voucherCode?: string;
}

export interface RecordBasketPaymentInput {
  legs: BasketPaymentLeg[];
  /** Operator-edited USD→LBP rate of record for the basket. */
  exchangeRate: number;
  userId: number;
  /**
   * Override client for the debt entry / store credit. When omitted, the
   * session's resolved client is used.
   */
  clientId?: number | null;
}

export interface RecordBasketPaymentResult {
  /** USD posted to drawers (sum of drawer-affecting IN legs in USD). */
  drawerInUsd: number;
  drawerInLbp: number;
  drawerOutUsd: number;
  drawerOutLbp: number;
  /** CUSTOMER_ACCOUNT (incl. GIFT_CARD) debt created, by currency. */
  debtUsd: number;
  debtLbp: number;
  /**
   * GIFT_CARD IN portion (a subset of debt*). Tracked separately because a gift
   * card is PREPAID value that was actually collected — unlike a CUSTOMER_ACCOUNT
   * charge it must NOT keep a sale pending. Used by the sale back-fill.
   */
  giftCardUsd: number;
  giftCardLbp: number;
}

// =============================================================================
// Service
// =============================================================================

export class SessionPaymentService {
  private repo: CustomerSessionRepository;
  private paymentRepo: SessionPaymentRepository;

  constructor(
    repo?: CustomerSessionRepository,
    paymentRepo?: SessionPaymentRepository,
  ) {
    this.repo = repo ?? getCustomerSessionRepository();
    this.paymentRepo = paymentRepo ?? getSessionPaymentRepository();
  }

  /**
   * Record the single customer-facing payment for a whole session basket.
   * MUST run inside the caller's db.transaction (it does not open its own).
   */
  recordBasketPayment(
    sessionId: number,
    input: RecordBasketPaymentInput,
  ): RecordBasketPaymentResult {
    const { legs, exchangeRate, userId } = input;
    const rate = exchangeRate > 0 ? exchangeRate : 1;

    // Resolve the session's client for the debt / store-credit entry.
    const sessionClientId = input.clientId ?? this.resolveSessionClientId(sessionId);

    const result: RecordBasketPaymentResult = {
      drawerInUsd: 0,
      drawerInLbp: 0,
      drawerOutUsd: 0,
      drawerOutLbp: 0,
      debtUsd: 0,
      debtLbp: 0,
      giftCardUsd: 0,
      giftCardLbp: 0,
    };

    let debtUsd = 0;
    let debtLbp = 0;
    let giftCardUsd = 0;
    let giftCardLbp = 0;

    for (const leg of legs) {
      const amt = Math.abs(leg.amount);
      if (amt <= 0) continue;
      const isOut = leg.direction === "OUT";

      // GIFT_CARD: redeem the voucher (deposits its full value as account credit)
      // then treat the leg as a non-drawer (debt-like) charge against that credit.
      if (leg.method === "GIFT_CARD") {
        if (!leg.voucherCode?.trim()) {
          throw new Error("Gift card payment requires a voucher code");
        }
        getVoucherRepository().redeemByCode({
          code: leg.voucherCode.trim().toUpperCase(),
          context: "session",
          transactionId: null,
          userId,
        });
        // An IN gift-card leg consumes the deposited credit as basket debt.
        // It is ALSO tracked as gift-card (collected/prepaid) so the sale
        // back-fill realizes a gift-card-paid sale instead of leaving it pending.
        if (!isOut) {
          if (leg.currencyCode === "USD") {
            debtUsd += amt;
            giftCardUsd += amt;
          } else if (leg.currencyCode === "LBP") {
            debtLbp += amt;
            giftCardLbp += amt;
          }
        }
        continue;
      }

      // CUSTOMER_ACCOUNT and other non-drawer methods.
      if (!isDrawerAffectingMethod(leg.method)) {
        if (isOut) {
          // OUT on account = store credit deposit (change kept on account).
          if (!sessionClientId) {
            throw new Error(
              "Client is required to return change as store credit",
            );
          }
          getDebtService().addCredit({
            clientId: sessionClientId,
            amountUsd: leg.currencyCode === "USD" ? amt : 0,
            amountLbp: leg.currencyCode === "LBP" ? amt : 0,
            note: "Basket change returned",
            userId,
          });
        } else {
          // IN on account = customer charges the basket to their account (debt).
          if (leg.currencyCode === "USD") debtUsd += amt;
          else if (leg.currencyCode === "LBP") debtLbp += amt;
        }
        continue;
      }

      // Drawer-affecting cash/wallet leg: one payments row + one drawer delta.
      const drawerName = paymentMethodToDrawerName(leg.method);
      const signed = isOut ? -amt : amt;
      this.paymentRepo.insertSessionLeg({
        sessionId,
        method: leg.method,
        drawerName,
        currencyCode: leg.currencyCode,
        amount: signed,
        note: isOut ? "Basket change returned" : "Basket payment",
        userId,
      });
      this.paymentRepo.postDrawerDelta(drawerName, leg.currencyCode, signed);

      if (isOut) {
        if (leg.currencyCode === "USD") result.drawerOutUsd += amt;
        else if (leg.currencyCode === "LBP") result.drawerOutLbp += amt;
      } else {
        if (leg.currencyCode === "USD") result.drawerInUsd += amt;
        else if (leg.currencyCode === "LBP") result.drawerInLbp += amt;
      }
    }

    // ONE debt-ledger entry for the whole CUSTOMER_ACCOUNT (+ GIFT_CARD) portion.
    if (debtUsd > 0 || debtLbp > 0) {
      if (!sessionClientId) {
        throw new Error("Cannot create basket debt without a client");
      }
      this.paymentRepo.insertBasketDebt({
        sessionId,
        clientId: sessionClientId,
        amountUsd: debtUsd,
        amountLbp: debtLbp,
        userId,
      });
    }
    result.debtUsd = debtUsd;
    result.debtLbp = debtLbp;
    result.giftCardUsd = giftCardUsd;
    result.giftCardLbp = giftCardLbp;

    // Back-fill the paid state of the session's SALE rows so the Profits page
    // classifies them correctly (covered → realized; on-account → pending).
    this.backfillSaleSettlement(sessionId, result, rate);

    closingLogger.info(
      { sessionId, ...result, exchangeRate: rate },
      "Recorded session basket payment",
    );

    return result;
  }

  /**
   * Resolve the client_id for a session (used for the basket debt entry).
   * Prefers an explicit phone match, then a name match.
   */
  private resolveSessionClientId(sessionId: number): number | null {
    const session = this.repo.getSessionById(sessionId);
    if (!session) return null;
    const clientRepo = getClientRepository();
    if (session.customer_phone) {
      const byPhone = clientRepo.findByPhone(session.customer_phone);
      if (byPhone) return byPhone.id;
    }
    if (session.customer_name) {
      const byName = clientRepo.findByName(session.customer_name);
      if (byName) return byName.id;
    }
    return null;
  }

  /**
   * Back-fill each session SALE's paid_usd/paid_lbp/exchange_rate_snapshot so the
   * Profits page classifies it correctly (covered → realized; on-account → pending).
   *
   * Allocation rule — "account debt to sales first" (conservative):
   *
   * A session basket is paid with ONE pooled payment, so we cannot know which
   * specific item a given cash leg or account charge was "for". The only basket
   * items that can stay PENDING are SALES (recharges/financial/etc. realize on
   * creation regardless). We therefore attribute the CUSTOMER_ACCOUNT debt to
   * sales first, and let sales realize from whatever value is left.
   *
   * Concretely: a sale is paid only for the portion of the sales total that the
   * on-account debt does NOT cover. This is the conservative choice — when the
   * pooled payment is ambiguous we err toward leaving profit PENDING rather than
   * realizing money that wasn't collected. It fixes two bugs the previous
   * "cash-in first" rule had:
   *   - cash that actually paid for a NON-sale item no longer realizes a sale
   *     (cross-item cash bleed), and
   *   - a GIFT_CARD-paid sale realizes instead of being stuck pending, because
   *     gift-card value is prepaid/collected and is excluded from the debt here.
   */
  private backfillSaleSettlement(
    sessionId: number,
    drawer: RecordBasketPaymentResult,
    rate: number,
  ): void {
    // Resolve this session's SALE rows (unified txn → source sale id + amount).
    const saleRows = this.paymentRepo.getSessionSaleRows(sessionId);

    if (saleRows.length === 0) return;

    // Total goods value of the session's sales (USD-equivalent).
    const salesTotalUsdEquiv = saleRows.reduce(
      (sum, s) => sum + (s.final_usd ?? 0),
      0,
    );

    // On-ACCOUNT (CUSTOMER_ACCOUNT) debt only, in USD-equivalent. Gift-card is a
    // subset of debt* but is PREPAID/collected value, so it must NOT keep a sale
    // pending — exclude it here.
    const accountDebtUsdEquiv = Math.max(
      0,
      drawer.debtUsd -
        drawer.giftCardUsd +
        (drawer.debtLbp - drawer.giftCardLbp) / rate,
    );

    // Value available to realize sales = sales total minus the account debt
    // attributed to them. Allocated across sales in creation order.
    let salesPaidPool = salesTotalUsdEquiv - accountDebtUsdEquiv;
    if (salesPaidPool < 0) salesPaidPool = 0;

    const salesRepo = getSalesRepository();
    for (const sale of saleRows) {
      const due = sale.final_usd ?? 0;
      const coveredUsd = Math.min(due, salesPaidPool);
      salesPaidPool -= coveredUsd;
      // Record the covered portion as USD paid (basket rate snapshot).
      salesRepo.markSalePaid(sale.sale_id, coveredUsd, 0, rate);
    }
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: SessionPaymentService | null = null;

export function getSessionPaymentService(): SessionPaymentService {
  if (!instance) {
    instance = new SessionPaymentService();
  }
  return instance;
}

export function resetSessionPaymentService(): void {
  instance = null;
}
