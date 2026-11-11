/**
 * LIRA-232 round-3 adversarial review, finding #2 follow-up (coordinator,
 * 2026-09-27) — the ONE predicate (rule 14) for "is this session-basket
 * member a PAYOUT that was netted against the basket's other items at
 * checkout" (a loto cash prize, a wallet/Binance cash-out, a negative-
 * amount custom-service payout, a FINANCIAL_SERVICE RECEIVE cash-out, …),
 * shared by BOTH:
 *   - `TransactionRepository._assertNoNettedPayoutMembers` (core, server
 *     side — refuses `refundSessionBasketItem`/`getSessionItemRefundPreview`
 *     on any basket that contains one), and
 *   - the frontend's own session-group derivation
 *     (`frontend/src/features/audit/hooks/useTransactionRows.ts`), which
 *     must use THIS function instead of re-deriving the same rule and
 *     drifting from it.
 *
 * Zero imports of Node or repositories (rule 29) — this module is reachable
 * from `browser.ts` and must stay a leaf; it only imports the (also leaf)
 * `TRANSACTION_TYPES` map for the REFUND/KEPT_CHANGE type literals.
 *
 * The bug this closes: the frontend's own ad-hoc version of this check
 * tested `amount_usd < 0 || amount_lbp < 0` over EVERY session-group row —
 * including the REFUND row `refundSessionBasketItem` itself writes (always
 * posted with a NEGATIVE amount, since it reverses part of the basket). So
 * after the FIRST item refund, the whole basket looked like a "payout
 * basket" to that check, and the "Refund item" button silently vanished for
 * every remaining item. This predicate is deliberately given enough of the
 * row to tell a genuine payout apart from the refund/reversal machinery
 * that basket already carries:
 *   - a VOIDED row is never a live payout — excluded;
 *   - a REFUND row (or anything with `reverses_id` set — a reversal of any
 *     kind) is bookkeeping, not something "sold" or "paid out" at
 *     checkout — excluded;
 *   - KEPT_CHANGE is always posted with amount_usd = amount_lbp = 0 (a
 *     profit-only row — proven to net a basket to 0), so it never trips the
 *     negative-amount test in the first place, but is named explicitly
 *     below for the reader's sake (rule 14's "detected from data, not a
 *     hand list" still holds — this is documentation, not a second
 *     branch).
 *   - everything else with a negative amount_usd/amount_lbp — a loto cash
 *     prize, a wallet/Binance/FINANCIAL_SERVICE cash-out (RECEIVE), a
 *     custom-service payout — was genuinely netted against the basket's
 *     other items and IS a payout. `FINANCIAL_SERVICE`/`CUSTOM_SERVICE`/
 *     `RECHARGE` cannot be told apart by TYPE alone (the same row shape
 *     books both a charge and a payout depending on sign — see
 *     `transactionTypes.ts`'s own doc on why `MODULE_DEBT_TRANSACTION_TYPES`
 *     stays a whitelist), so sign is the one reliable, data-derived signal
 *     this function relies on for those.
 */
import { TRANSACTION_TYPES } from "./transactionTypes.js";

/** The fields this predicate reads — a subset of the unified `transactions`
 *  row (or a session-group row derived from it) any caller, core or
 *  frontend, already has in hand. */
export interface SessionPayoutMemberCandidate {
  type: string;
  amount_usd: number;
  amount_lbp: number;
  /** 'ACTIVE' | 'VOIDED' — a voided row is excluded regardless of amount. */
  status?: string | null;
  /** Set on a REFUND (or any other reversal) row — excluded regardless of
   *  type/amount, since a reversal is bookkeeping, not a payout. */
  reverses_id?: number | null;
}

export function isSessionPayoutMember(
  member: SessionPayoutMemberCandidate,
): boolean {
  if (member.status === "VOIDED") return false;
  if (member.reverses_id != null) return false;
  if (member.type === TRANSACTION_TYPES.REFUND) return false;
  if (member.type === TRANSACTION_TYPES.KEPT_CHANGE) return false;
  // LIRA-310: the Waive sibling is amount 0 like KEPT_CHANGE — never a payout.
  if (member.type === TRANSACTION_TYPES.WAIVED_SHORTFALL) return false;
  // LIRA-341: the basket discount sibling is amount 0 too — never a payout.
  if (member.type === TRANSACTION_TYPES.BASKET_DISCOUNT) return false;
  // LIRA-380/381: an exchange basket line always has a negative side (its
  // link row stores +given / −received) but is a two-sided swap, never a
  // payout netted against other items (it posts its own gross leg). Its
  // item refund is the exact mirror of both sides.
  if (member.type === TRANSACTION_TYPES.EXCHANGE) return false;
  return (member.amount_usd ?? 0) < 0 || (member.amount_lbp ?? 0) < 0;
}

/**
 * LIRA-381 — basket-level checkout lines: they belong to the WHOLE basket
 * (kept change, a waived amount, the basket extra, the basket discount), not
 * to one item, so "Refund item" is never offered on them and
 * `refundSessionBasketItem` refuses them; only the whole-basket reversal
 * undoes them.
 */
const SESSION_BASKET_LEVEL_TYPES: ReadonlySet<string> = new Set<string>([
  TRANSACTION_TYPES.KEPT_CHANGE,
  TRANSACTION_TYPES.WAIVED_SHORTFALL,
  TRANSACTION_TYPES.EXTRA_CHARGE,
  TRANSACTION_TYPES.BASKET_DISCOUNT,
]);

/** LIRA-381 — is this row a basket-level checkout line (see above)? */
export function isSessionBasketLevelMember(member: { type: string }): boolean {
  return SESSION_BASKET_LEVEL_TYPES.has(member.type);
}

/**
 * LIRA-381 — the ONE rule (rule 14) for "can this session-basket row be
 * refunded on its own": every LIVE member — a product, a service, a
 * recharge, a loto ticket or prize, a transfer or cash-out, an exchange, a
 * repair — except the basket-level checkout lines above. Shared by
 * `TransactionRepository._planSessionItemRefund` (server refusal) and the
 * Transactions page's "Refund item" button, so the two can never disagree.
 * A voided row or any reversal row (a REFUND, or anything with
 * `reverses_id`) is not a live member.
 */
export function isSessionItemRefundableMember(
  member: SessionPayoutMemberCandidate,
): boolean {
  if (member.status === "VOIDED") return false;
  if (member.reverses_id != null) return false;
  if (member.type === TRANSACTION_TYPES.REFUND) return false;
  return !isSessionBasketLevelMember(member);
}

/** LIRA-381 — which way the money moves when ONE member is refunded, from
 *  its customer-side signed amount (the session link row): a charge goes
 *  back TO the customer; a payout (any negative side) comes back FROM them. */
export type SessionItemRefundDirection = "to_customer" | "from_customer";

export function sessionItemRefundDirection(member: {
  type?: string;
  amount_usd: number;
  amount_lbp: number;
}): SessionItemRefundDirection {
  // An exchange is a swap, refunded by its exact mirror — reported as a
  // hand-back (`to_customer`), whatever the sign of its received side.
  if (member.type === TRANSACTION_TYPES.EXCHANGE) return "to_customer";
  return (member.amount_usd ?? 0) < 0 || (member.amount_lbp ?? 0) < 0
    ? "from_customer"
    : "to_customer";
}
