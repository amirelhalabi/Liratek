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
 *
 * Primary Cash Drawer plan §3 Phase D (docs/plans/todo_plans/PRIMARY_CASH_DRAWER_PLAN.md,
 * decision #7): this is the ONE seam where the money layer (this service) does
 * not itself know which provider a basket's cash paid for — the basket is a
 * single pooled payment across possibly-unrelated items. The owner's rule is
 * split-by-item-share: the primary-system (shop_base_system) financial-service
 * item's pro-rata portion of each cash-family leg routes to the primary cash
 * drawer (PCD, `OMT_System`/`Whish_System`); the remainder routes to General,
 * exactly as today. `SessionPaymentRepository.getSessionCashSplitContext`
 * derives the split ratio SERVER-SIDE from the session's own linked items
 * (never from client input) — see `splitCashLegByItemShare` below.
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
  type SessionCashSplitContext,
  type SessionSaleRow,
} from "../repositories/SessionPaymentRepository.js";
import { getDebtService } from "./DebtService.js";
import {
  isDrawerAffectingMethod,
  paymentMethodToDrawerName,
  resolveServiceCashDrawer,
} from "../utils/payments.js";
import { primaryCashDrawerName } from "../constants/systemFloatDrawers.js";
import { closingLogger } from "../utils/logger.js";
import { resolveKeptChange } from "../repositories/keptChange.js";
import type { KeptChange } from "../repositories/moneyPosting.js";
import { basketHasNothingToCollect } from "../utils/sessionNothingToCollect.js";

// LIRA-270 — the ONE nothing-to-collect rule now lives in a pure shared
// module (the checkout modal reads it too); re-exported for existing callers.
export { basketHasNothingToCollect };

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
  /**
   * BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase F wire contract (frozen):
   * meaningful ONLY on a `direction: "OUT"` leg — IN legs never carry it.
   *  - "PAYOUT" — the shop pays the customer for a basket item (a session
   *    RECEIVE / Loto-prize cashout), operator-chosen method. Debits the PCD
   *    in proportion to the basket's PAYOUT-side primary-system share
   *    (mirrors the IN/charge-side ratio — see `ratioForCurrency` below) and
   *    is noted "Basket payout to customer".
   *  - "CHANGE" or absent — legacy behavior: overpayment change returned to
   *    the customer, noted "Basket change returned", split by the
   *    CHARGE-side ratio (byte-identical to pre-Phase-F).
   */
  kind?: "PAYOUT" | "CHANGE";
  /**
   * Owner decision #11-A (2026-09-24, netted session checkout). Meaningful
   * ONLY on a `kind: "PAYOUT"` leg — forces `ratioForCurrency` to 1 ("SYSTEM"
   * — an OMT/Whish SYSTEM money-transfer-box payout, always the primary cash
   * drawer, never netted) or 0 ("GENERAL" — a General-drawer payout: loto
   * prize / wallet / Binance cash-out; the frontend already netted the
   * CASH-routed portion against the charge, so only the excess reaches this
   * leg). Absent = legacy blended session-share ratio (byte-identical to
   * pre-#11-A payloads) — needed because that ratio is a SESSION-level
   * constant and would otherwise mis-split a leg whose amount no longer
   * equals the full gross payout total once part of it has been netted away.
   */
  payoutOrigin?: "SYSTEM" | "GENERAL";
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
  /**
   * Bug 7 fix (BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase F): the
   * `financial_services.id`s of every fee-on-top RECEIVE item in this
   * basket — SessionCheckoutService is the only layer that ever sees
   * `includingFees`/`serviceType` (parsed from each cart item's formData,
   * never persisted), so it resolves this gate and hands the ids down.
   * `getSessionCashSplitContext` reads the fee VALUE itself from the
   * persisted `financial_services.omt_fee`/`whish_fee` columns (rule 14 —
   * one source of truth) and folds it into the basket's CHARGE-side split
   * totals. Omitted/empty = no fee-on-top RECEIVE items (legacy baskets).
   */
  feeOnTopReceiveFsIds?: number[];
  /**
   * G42 — the client's kept-change claim (change the customer left with the
   * shop). Checked here, against the basket's server-derived net charge,
   * BEFORE any leg is written (`resolveBasketKeptChange`); the verified
   * amount comes back as `keptUsd`/`keptLbp` on the result. Omitted = none.
   */
  keptChange?: KeptChange | null;
  // (No FOR-partner flag: owner decision 2026-10-07 — a basket holding a
  // FOR-partner item may keep change; the item's own partner posting is
  // unaffected and kept change stays drawer-funded via resolveKeptChange.)
}

/** LIRA-258 / G17 — `allocateBasketAccountDebt`'s sales-first split. */
interface BasketAccountDebtAllocation {
  /** USD-equivalent value available to mark the basket's sales paid. */
  salesPaidPoolUsd: number;
  /** Initial covered_usd/covered_lbp of the basket's 'Session Debt' row
   *  (gift-card share + sales-attributed share). */
  preCoveredUsd: number;
  preCoveredLbp: number;
}

export interface RecordBasketPaymentResult {
  /** USD posted to drawers (sum of drawer-affecting IN legs in USD). */
  drawerInUsd: number;
  drawerInLbp: number;
  /**
   * Total drawer-affecting OUT amount (change + payout combined) — kept for
   * backward compatibility. Since `kind` was introduced (Phase F) this is a
   * MIX of change and payout; use `drawerChangeUsd`/`drawerPayoutUsd` (and
   * their LBP twins) below for the per-kind breakdown so a consumer never
   * mistakes a payout for change.
   */
  drawerOutUsd: number;
  drawerOutLbp: number;
  /** Subset of drawerOut* from `kind: "PAYOUT"` OUT legs (shop pays the customer). */
  drawerPayoutUsd: number;
  drawerPayoutLbp: number;
  /** Subset of drawerOut* from `kind: "CHANGE"`/kind-less OUT legs (overpayment change). */
  drawerChangeUsd: number;
  drawerChangeLbp: number;
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
  /** G42 — the kept change verified by `resolveBasketKeptChange` (0 when
   *  none was claimed). The caller books THESE, never the raw claim. */
  keptUsd: number;
  keptLbp: number;
}

// =============================================================================
// Kept change (G42, FEATURE_GUIDE §4.1)
// =============================================================================

const SESSION_KEPT_CONTEXT = "Session checkout";

/**
 * G42 — verify a session basket's kept-change claim with the ONE helper
 * (`resolveKeptChange`, payer "customer") and return what to book.
 *
 * The customer's tender pays the basket's NET charge:
 *
 *   IN − CHANGE − kept = netCharge
 *   netCharge = gross charge − gross payout + Σ(kind:"PAYOUT" OUT legs)
 *
 * per currency. Gross charge/payout come from the session's OWN linked items
 * (`getSessionCashSplitContext` — the same totals the PCD split uses, incl.
 * a fee-on-top RECEIVE's fee; rule 14), never from client totals. A PAYOUT
 * leg is the shop paying the customer for a cash-out item, so it is NEVER
 * passed as change: adding it back into the net charge makes a cash payout
 * netted against the charge (no leg, or only the excess) and a gross
 * wallet/account/SYSTEM payout (a full leg) reconcile identically.
 *
 * Leg split mirrors `recordBasketPayment`: no `direction` = IN; an OUT leg
 * without `kind` is change.
 *
 * Only called when kept change is claimed (G42 scope — a basket without kept
 * change is not reconciled here). Throws on refusal; callers run it inside
 * the checkout transaction before any write.
 */
export function resolveBasketKeptChange(input: {
  legs: BasketPaymentLeg[];
  ctx: Pick<
    SessionCashSplitContext,
    "chargeTotalUsd" | "chargeTotalLbp" | "payoutTotalUsd" | "payoutTotalLbp"
  >;
  claimedKept: KeptChange | null | undefined;
  exchangeRate: number;
}): { keptUsd: number; keptLbp: number } {
  const { usd, lbp, inLegs, changeLegs } = basketNetCharge(
    input.legs,
    input.ctx,
  );
  const { keptUsd, keptLbp } = resolveKeptChange({
    payer: "customer",
    context: SESSION_KEPT_CONTEXT,
    exchangeRate: input.exchangeRate,
    claimedKept: input.claimedKept,
    // Owner decision 2026-10-07: a customer basket may keep change even
    // when it holds a FOR-partner item (the basket's customer is a real
    // walk-in; the partner item's own ledger posting is untouched).
    isForPartner: false,
    expected: { usd, lbp },
    inLegs,
    outLegs: changeLegs,
  });
  return { keptUsd, keptLbp };
}

/**
 * The ONE net-charge computation for a session basket (rule 14) — used by
 * the kept-change check (G42) and, via `basketCollectNet`, the
 * nothing-to-collect check (LIRA-270):
 *
 *   net = gross charge − gross payout + Σ(kind:"PAYOUT" OUT legs)
 *
 * per currency. Also returns the leg split both callers need: no
 * `direction` = IN; an OUT leg without `kind` (or `kind: "CHANGE"`) is
 * change; a `kind: "PAYOUT"` leg is folded into the net instead.
 */
export function basketNetCharge(
  legs: BasketPaymentLeg[],
  ctx: Pick<
    SessionCashSplitContext,
    "chargeTotalUsd" | "chargeTotalLbp" | "payoutTotalUsd" | "payoutTotalLbp"
  >,
): {
  usd: number;
  lbp: number;
  inLegs: BasketPaymentLeg[];
  changeLegs: BasketPaymentLeg[];
} {
  const inLegs: BasketPaymentLeg[] = [];
  const changeLegs: BasketPaymentLeg[] = [];
  let payoutLegUsd = 0;
  let payoutLegLbp = 0;
  for (const leg of legs) {
    if (leg.direction !== "OUT") inLegs.push(leg);
    else if (leg.kind === "PAYOUT") {
      const amt = Math.abs(leg.amount);
      if (leg.currencyCode === "LBP") payoutLegLbp += amt;
      else payoutLegUsd += amt;
    } else changeLegs.push(leg);
  }
  return {
    usd: ctx.chargeTotalUsd - ctx.payoutTotalUsd + payoutLegUsd,
    lbp: ctx.chargeTotalLbp - ctx.payoutTotalLbp + payoutLegLbp,
    inLegs,
    changeLegs,
  };
}

/**
 * LIRA-270 — the net charge the nothing-to-collect guard reads: the charge
 * minus ONLY the payout that was absorbed into it (netted against the
 * charge, so no leg — or only the excess — was sent for it).
 *
 * Differs from `basketNetCharge` in one place: an OUT leg with NO `kind`
 * (the legacy shape — the checkout modal always tags its OUT legs CHANGE or
 * PAYOUT) is treated as a payout that left as its own leg, not as change.
 * Reading it as change made a gross $40 payout look absorbed, so a basket
 * whose 500,000 LBP charge was still owed was refused (2026-10-10). For a
 * refusal gate the ambiguous leg must lean towards accepting. An explicit
 * `kind: "CHANGE"` leg stays change, so a stale tender + stale change from
 * the modal on a payout-covered basket is still refused.
 *
 * Kept change (`resolveBasketKeptChange`) deliberately keeps reading
 * `basketNetCharge` unchanged — it only runs when change is claimed.
 */
export function basketCollectNet(
  legs: BasketPaymentLeg[],
  ctx: Pick<
    SessionCashSplitContext,
    "chargeTotalUsd" | "chargeTotalLbp" | "payoutTotalUsd" | "payoutTotalLbp"
  >,
): ReturnType<typeof basketNetCharge> {
  return basketNetCharge(
    legs.map((l) =>
      l.direction === "OUT" && !l.kind
        ? { ...l, kind: "PAYOUT" as const }
        : l,
    ),
    ctx,
  );
}

/** True when the client claimed any kept change. */
export function hasKeptChangeClaim(k: KeptChange | null | undefined): boolean {
  return (k?.usd ?? 0) > 0 || (k?.lbp ?? 0) > 0;
}

// =============================================================================
// Pro-rata cash split (Primary Cash Drawer plan §3 Phase D, decision #7)
// =============================================================================

/** A cash-family leg's amount split between the primary cash drawer (PCD)
 *  and General. Both fields are always ≥ 0 and always re-add to `amount`. */
export interface CashLegSplit {
  pcdAmount: number;
  generalAmount: number;
}

/**
 * Split a basket cash-family leg's (positive) amount between the PCD and
 * General, pro-rata to `ratio` (the primary-system FS item share of the
 * basket, per currency — see `SessionCashSplitContext`).
 *
 * Deterministic, lossless rounding: works in integer minor units (cents for
 * USD, whole units for LBP — LBP carries no sub-unit in this codebase) so
 * `pcdAmount + generalAmount === amount` EXACTLY, never off by a rounding
 * cent. `Math.round` picks the PCD's integer share; whatever the rounding
 * step drops or adds is the remainder and it always lands in `generalAmount`
 * (plan Phase D: "rounding remainder to General") — never silently lost.
 * A split that doesn't re-add exactly would corrupt one of the two drawers,
 * so the reconciliation is asserted, not just assumed.
 */
export function splitCashLegByItemShare(
  amount: number,
  ratio: number,
  currencyCode: string,
): CashLegSplit {
  if (amount <= 0 || ratio <= 0) {
    return { pcdAmount: 0, generalAmount: Math.max(0, amount) };
  }
  const clampedRatio = Math.min(1, ratio);
  const scale = currencyCode === "USD" ? 100 : 1;
  const totalUnits = Math.round(amount * scale);
  const pcdUnits = Math.round(totalUnits * clampedRatio);
  const generalUnits = totalUnits - pcdUnits;
  const pcdAmount = pcdUnits / scale;
  const generalAmount = generalUnits / scale;

  // Hard invariant (Phase D): the split must never lose or invent money.
  if (Math.abs(pcdAmount + generalAmount - amount) > 1e-9) {
    throw new Error(
      `Basket cash-leg split failed to reconcile: pcd=${pcdAmount} + general=${generalAmount} !== amount=${amount}`,
    );
  }
  return { pcdAmount, generalAmount };
}

/**
 * Per-currency PCD ratio derived from a session's cash-split context.
 *
 * Two independent buckets (bug 7 fix, BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4
 * Phase F — `getSessionCashSplitContext` now sums gross per-DIRECTION totals
 * instead of a signed net that a negative payout item could shrink or
 * invert):
 *  - "charge" — the customer-paid side (every IN leg, and every kind-less/
 *    CHANGE OUT leg, since change is a byproduct of the charge-side
 *    overpayment, not of a payout item).
 *  - "payout" — the shop-pays-customer side (a `kind: "PAYOUT"` OUT leg,
 *    e.g. a session RECEIVE/Loto-prize cashout) — mirrors the charge-side
 *    ratio using the basket's PAYOUT-side primary-system share instead.
 */
function ratioForCurrency(
  ctx: SessionCashSplitContext,
  currencyCode: string,
  bucket: "charge" | "payout",
  originHint?: "SYSTEM" | "GENERAL",
): number {
  // Fix-round finding #2 (2026-09-24): a "SYSTEM" leg is the FRONTEND'S
  // combined omt_system + whish_system payout total for this currency
  // (binanceCart.ts's `SYSTEM_PAYOUT_MODULES` bucket has no per-provider
  // identity — see that file's comment). It must NOT be forced 100% to the
  // shop's own PCD (`primaryCashDrawerName(ctx.baseSystem)`): only the
  // BASE-system's own share of the combined SYSTEM total belongs there — a
  // non-base-system item (e.g. a Whish payout while OMT is primary) has no
  // PCD of its own and must fall through to General, exactly as a solo
  // non-base-system transaction already does via `resolveServiceCashDrawer`.
  // `systemPayoutTotalUsd/Lbp` is scoped to financial_services-backed payout
  // items ONLY (both providers, never a General-drawer loto/wallet payout —
  // see its doc comment), so a General payout riding along in the same
  // basket can never dilute this ratio.
  if (bucket === "payout" && originHint === "SYSTEM") {
    const total =
      currencyCode === "USD"
        ? ctx.systemPayoutTotalUsd
        : currencyCode === "LBP"
          ? ctx.systemPayoutTotalLbp
          : 0;
    const primary =
      currencyCode === "USD"
        ? ctx.primarySystemPayoutUsd
        : currencyCode === "LBP"
          ? ctx.primarySystemPayoutLbp
          : 0;
    return total > 0 ? primary / total : 0;
  }
  if (bucket === "payout" && originHint === "GENERAL") return 0;
  if (bucket === "payout") {
    if (currencyCode === "USD") {
      return ctx.payoutTotalUsd > 0
        ? ctx.primarySystemPayoutUsd / ctx.payoutTotalUsd
        : 0;
    }
    if (currencyCode === "LBP") {
      return ctx.payoutTotalLbp > 0
        ? ctx.primarySystemPayoutLbp / ctx.payoutTotalLbp
        : 0;
    }
    return 0;
  }
  if (currencyCode === "USD") {
    return ctx.chargeTotalUsd > 0
      ? ctx.primarySystemChargeUsd / ctx.chargeTotalUsd
      : 0;
  }
  if (currencyCode === "LBP") {
    return ctx.chargeTotalLbp > 0
      ? ctx.primarySystemChargeLbp / ctx.chargeTotalLbp
      : 0;
  }
  return 0;
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
    const sessionClientId =
      input.clientId ?? this.resolveSessionClientId(sessionId);

    const result: RecordBasketPaymentResult = {
      drawerInUsd: 0,
      drawerInLbp: 0,
      drawerOutUsd: 0,
      drawerOutLbp: 0,
      drawerPayoutUsd: 0,
      drawerPayoutLbp: 0,
      drawerChangeUsd: 0,
      drawerChangeLbp: 0,
      debtUsd: 0,
      debtLbp: 0,
      giftCardUsd: 0,
      giftCardLbp: 0,
      keptUsd: 0,
      keptLbp: 0,
    };

    let debtUsd = 0;
    let debtLbp = 0;
    let giftCardUsd = 0;
    let giftCardLbp = 0;

    // Primary Cash Drawer plan §3 Phase D: resolve the split context ONCE,
    // server-side, from the session's own linked items (never from the
    // client-supplied legs) — every eligible cash-family leg below is split
    // against these same ratios.
    const cashSplitCtx = this.paymentRepo.getSessionCashSplitContext(
      sessionId,
      input.feeOnTopReceiveFsIds ?? [],
    );
    const pcdDrawerName = primaryCashDrawerName(cashSplitCtx.baseSystem);

    // G42: check the kept-change claim against the server-derived net charge
    // BEFORE the first leg/drawer/voucher write (a throw rolls back the
    // whole checkout).
    if (hasKeptChangeClaim(input.keptChange)) {
      const kept = resolveBasketKeptChange({
        legs,
        ctx: cashSplitCtx,
        claimedKept: input.keptChange,
        exchangeRate: rate,
      });
      result.keptUsd = kept.keptUsd;
      result.keptLbp = kept.keptLbp;
    }

    // LIRA-270: when the basket has nothing left to collect (a cash payout
    // cancels the whole charge), the customer pays nothing — so a
    // customer-paid (IN) leg can only be a stale line the checkout screen
    // failed to clear. Refuse it before any write instead of posting a
    // phantom payment into a drawer (or a phantom debt on the account).
    // Skipped when the item lookup failed: "unknown" must never read as
    // "nothing due".
    if (!cashSplitCtx.lookupFailed) {
      const net = basketCollectNet(legs, cashSplitCtx);
      const strayIn = net.inLegs.filter((l) => Math.abs(l.amount) > 0);
      if (strayIn.length > 0 && basketHasNothingToCollect(net, rate)) {
        throw new Error(
          "There is nothing left to collect from the customer on this basket — remove the payment and try again. " +
            `(Session checkout: net charge USD ${net.usd.toFixed(2)} / LBP ${Math.round(net.lbp)}, ` +
            `but ${strayIn.length} customer payment leg(s) were sent.)`,
        );
      }
    }

    for (const leg of legs) {
      const amt = Math.abs(leg.amount);
      if (amt <= 0) continue;
      const isOut = leg.direction === "OUT";
      // Note discriminator (byte-identical legacy when kind is absent/CHANGE).
      const isPayout = isOut && leg.kind === "PAYOUT";
      const outNote = isPayout
        ? "Basket payout to customer"
        : "Basket change returned";

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
          // OUT on account = store-credit deposit. Two cases both land here:
          //  - overpayment change the customer keeps on account, and
          //  - a cash-out (Binance/OMT/Whish RECEIVE) the customer settles to
          //    their account instead of taking cash — booked as a real credit
          //    that reduces their balance and shows on the Debts Payments side.
          // session_id links it to the basket so the Debts page can open the
          // basket breakdown (the payments-side eye button).
          if (!sessionClientId) {
            throw new Error(
              "Client is required to settle a payout to store credit",
            );
          }
          // Throwing variant: a failed credit write must roll the whole
          // checkout back, never commit it without the customer's credit
          // (LIRA-258 / G13).
          getDebtService().addCreditOrThrow({
            clientId: sessionClientId,
            amountUsd: leg.currencyCode === "USD" ? amt : 0,
            amountLbp: leg.currencyCode === "LBP" ? amt : 0,
            note: `Session #${sessionId} basket`,
            userId,
            sessionId,
          });
        } else {
          // IN on account = customer charges the basket to their account (debt).
          if (leg.currencyCode === "USD") debtUsd += amt;
          else if (leg.currencyCode === "LBP") debtLbp += amt;
        }
        continue;
      }

      // Drawer-affecting cash/wallet leg. A wallet-bound method (OMT/WHISH
      // app, Binance, …) keeps its own drawer unchanged. A cash-family method
      // (today bound to General) is PCD-eligible when this session ran on
      // the primary system's provider — reuse the ONE routing resolver
      // (`resolveServiceCashDrawer`, rule 14) with `provider === baseSystem`
      // forced true, so it answers exactly "would a primary-system item's
      // cash leg land in the PCD?" without re-deriving that predicate here.
      const naturalDrawer = paymentMethodToDrawerName(leg.method);
      const isPcdEligible =
        resolveServiceCashDrawer(leg.method, {
          provider: cashSplitCtx.baseSystem,
          baseSystem: cashSplitCtx.baseSystem,
        }) === pcdDrawerName;

      if (!isPcdEligible) {
        const signed = isOut ? -amt : amt;
        this.paymentRepo.insertSessionLeg({
          sessionId,
          method: leg.method,
          drawerName: naturalDrawer,
          currencyCode: leg.currencyCode,
          amount: signed,
          note: isOut ? outNote : "Basket payment",
          userId,
        });
        this.paymentRepo.postDrawerDelta(
          naturalDrawer,
          leg.currencyCode,
          signed,
        );
      } else {
        // Split by item share (decision #7): the primary-system FS subtotal's
        // share of this currency's basket total routes to the PCD, the rest
        // to General. Two independent postings, EACH still going through
        // insertPaymentRow + applyDrawerDelta (rule 20 — the generic void
        // path reverses both for free, no hand-rolled UPDATE).
        //
        // Bug 7 fix (Phase F): an IN leg or a kind-less/CHANGE OUT leg splits
        // by the CHARGE-side ratio (unchanged for every legacy basket); a
        // kind-PAYOUT OUT leg splits by the mirrored PAYOUT-side ratio — a
        // primary-system RECEIVE/Loto-prize cashout debits the PCD in
        // proportion to ITS share of the basket's payout total, never the
        // charge-side ratio (which a negative payout item used to corrupt by
        // shrinking/inverting the old signed basket total).
        const ratio = ratioForCurrency(
          cashSplitCtx,
          leg.currencyCode,
          isPayout ? "payout" : "charge",
          isPayout ? leg.payoutOrigin : undefined,
        );
        const { pcdAmount, generalAmount } = splitCashLegByItemShare(
          amt,
          ratio,
          leg.currencyCode,
        );

        if (pcdAmount > 0) {
          const signed = isOut ? -pcdAmount : pcdAmount;
          this.paymentRepo.insertSessionLeg({
            sessionId,
            method: leg.method,
            drawerName: pcdDrawerName,
            currencyCode: leg.currencyCode,
            amount: signed,
            note: isOut
              ? `${outNote} (primary-system item share)`
              : "Basket payment (primary-system item share)",
            userId,
          });
          this.paymentRepo.postDrawerDelta(
            pcdDrawerName,
            leg.currencyCode,
            signed,
          );
        }

        if (generalAmount > 0) {
          const signed = isOut ? -generalAmount : generalAmount;
          this.paymentRepo.insertSessionLeg({
            sessionId,
            method: leg.method,
            drawerName: "General",
            currencyCode: leg.currencyCode,
            amount: signed,
            note: isOut ? outNote : "Basket payment",
            userId,
          });
          this.paymentRepo.postDrawerDelta("General", leg.currencyCode, signed);
        }
      }

      if (isOut) {
        if (leg.currencyCode === "USD") {
          result.drawerOutUsd += amt;
          if (isPayout) result.drawerPayoutUsd += amt;
          else result.drawerChangeUsd += amt;
        } else if (leg.currencyCode === "LBP") {
          result.drawerOutLbp += amt;
          if (isPayout) result.drawerPayoutLbp += amt;
          else result.drawerChangeLbp += amt;
        }
      } else {
        if (leg.currencyCode === "USD") result.drawerInUsd += amt;
        else if (leg.currencyCode === "LBP") result.drawerInLbp += amt;
      }
    }

    result.debtUsd = debtUsd;
    result.debtLbp = debtLbp;
    result.giftCardUsd = giftCardUsd;
    result.giftCardLbp = giftCardLbp;

    // ONE allocation of the account debt across the basket (sales first —
    // see `allocateBasketAccountDebt`), shared by the debt row's
    // pre-coverage and the sale back-fill below (rule 14).
    const saleRows = this.paymentRepo.getSessionSaleRows(sessionId);
    const allocation = this.allocateBasketAccountDebt(saleRows, result, rate);

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
        coveredUsd: allocation.preCoveredUsd,
        coveredLbp: allocation.preCoveredLbp,
        userId,
      });
    }

    // Back-fill the paid state of the session's SALE rows so the Profits page
    // classifies them correctly (covered → realized; on-account → pending).
    this.backfillSaleSettlement(saleRows, allocation, rate);

    // F3 (round-3 review) — stamp the rate this basket was ACTUALLY checked
    // out at onto every member, so a later session-item refund defaults to
    // it instead of the cart-time rate (see the repository method's doc).
    this.paymentRepo.stampMemberExchangeRate(sessionId, rate);

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
   * LIRA-258 / G17 — the ONE allocation of a basket's on-account debt across
   * its items. Rule — "account debt to sales first" (conservative, the
   * existing lira-session-allocation convention):
   *
   * A session basket is paid with ONE pooled payment, so we cannot know which
   * specific item a given cash leg or account charge was "for". We attribute
   * the CUSTOMER_ACCOUNT debt to the basket's SALES first (their share stays
   * pending through `sales.paid_usd`, released by repayments via
   * `DebtRepository._markSalesPaidFIFO`); whatever account debt the sales
   * do not absorb is the NON-SALE share, which holds every non-sale charge
   * item's profit until the customer repays it (`ProfitRepository
   * .notDebtPending`'s session arm, fed by the 'Session Debt' row's
   * `covered_*`). GIFT_CARD value is prepaid/collected: it is part of the
   * debt row (it consumes the voucher's deposited credit) but never waits for
   * a repayment, so it is excluded from the account debt here.
   *
   * Returns, besides the sales' paid pool, the debt row's PRE-COVERAGE: the
   * gift-card share (per currency) plus the sales-attributed share (USD
   * column first, the rest converted into the LBP column at the basket
   * rate) — so the row's uncovered remainder is exactly the non-sale share,
   * and a repayment that pays the sales (via `sales.paid_usd`) is never
   * counted a second time on the row.
   */
  private allocateBasketAccountDebt(
    saleRows: SessionSaleRow[],
    drawer: RecordBasketPaymentResult,
    rate: number,
  ): BasketAccountDebtAllocation {
    const safeRate = rate > 0 ? rate : 1;
    const accountUsd = Math.max(0, drawer.debtUsd - drawer.giftCardUsd);
    const accountLbp = Math.max(0, drawer.debtLbp - drawer.giftCardLbp);
    const accountDebtUsdEquiv = accountUsd + accountLbp / safeRate;

    // Total goods value of the session's sales (USD-equivalent).
    const salesTotalUsdEquiv = saleRows.reduce(
      (sum, s) => sum + (s.final_usd ?? 0),
      0,
    );
    const salesAttributedUsdEquiv = Math.min(
      salesTotalUsdEquiv,
      accountDebtUsdEquiv,
    );

    const salesOnUsd = Math.min(accountUsd, salesAttributedUsdEquiv);
    const salesOnLbp = Math.min(
      accountLbp,
      (salesAttributedUsdEquiv - salesOnUsd) * safeRate,
    );

    return {
      salesPaidPoolUsd: Math.max(
        0,
        salesTotalUsdEquiv - salesAttributedUsdEquiv,
      ),
      preCoveredUsd: drawer.giftCardUsd + salesOnUsd,
      preCoveredLbp: drawer.giftCardLbp + salesOnLbp,
    };
  }

  /**
   * Back-fill each session SALE's paid_usd/paid_lbp/exchange_rate_snapshot so the
   * Profits page classifies it correctly (covered → realized; on-account → pending).
   *
   * Uses `allocateBasketAccountDebt`'s sales-first split: a sale is paid
   * only for the portion of the sales total that the on-account debt does
   * NOT cover. This is the conservative choice — when the pooled payment is
   * ambiguous we err toward leaving profit PENDING rather than realizing
   * money that wasn't collected. It fixes two bugs the previous
   * "cash-in first" rule had:
   *   - cash that actually paid for a NON-sale item no longer realizes a sale
   *     (cross-item cash bleed), and
   *   - a GIFT_CARD-paid sale realizes instead of being stuck pending, because
   *     gift-card value is prepaid/collected and is excluded from the debt here.
   */
  private backfillSaleSettlement(
    saleRows: SessionSaleRow[],
    allocation: BasketAccountDebtAllocation,
    rate: number,
  ): void {
    if (saleRows.length === 0) return;

    // Value available to realize sales, allocated across sales in creation order.
    let salesPaidPool = allocation.salesPaidPoolUsd;

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
