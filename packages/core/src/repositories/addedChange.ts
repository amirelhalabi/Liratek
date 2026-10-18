/**
 * LIRA-336 — change the customer adds on a payout (owner request
 * 2026-10-18).
 *
 * The shop owes a customer $197 and has no small notes, so the cashier asks
 * the customer for $3 (or 268,500 LBP) and hands out $200. The customer's
 * money is an IN line of the payout; it raises what the shop pays out by the
 * same value. Nothing else changes: the payout's amount and profit stay
 * those of a plain $197 payout, there is no expense, and both drawers move
 * by what really moved.
 *
 * The client claims the amount (`added_change_usd` / `added_change_lbp`, in
 * the payout's own currency). This verifies the claim against the
 * customer's lines and returns it; the caller then reconciles its payout
 * lines against `owed + added` (minus kept change, plus a round-up — both
 * resolved against the raised target) and writes the measured lines as
 * positive `payments` rows with `writeCustomerLegs` once its transaction
 * row exists. Reversal (rule 20): those rows belong to the payout's own
 * transaction, so the generic `_reversePayments` (Hold Money: `voidPickup`)
 * mirrors them — no new reversal owner.
 *
 * The rules (research R3):
 *   - the claim is the opt-in (FR-008). No claim → zero, and the caller's
 *     legacy path runs untouched — EXCEPT customer lines on a payout where
 *     the customer owes nothing, which can only be added change and are
 *     refused without a claim (rule 23);
 *   - only money that really came in counts: no CUSTOMER_ACCOUNT line, no
 *     forgiven amount (FR-009);
 *   - converted into the payout currency at the payout's own reconcile rate
 *     (`resolveStampedExchangeRate(server, tender)`);
 *   - at most $5 / 450,000 LBP in the payout currency (FR-011, the shared
 *     `isWithinShortfallMax` cap of round-up and kept change);
 *   - the claim must equal the derived amount within cents / whole LBP, or
 *     the leg epsilon when the lines and the payout mix currencies.
 *
 * Node-only (reaches `utils/payments.js` via moneyPosting) — NOT exported
 * from browser.ts (rule 29).
 */
import {
  LEG_RECONCILIATION_EPSILON_USD,
  measureCustomerLegs,
  resolveStampedExchangeRate,
  type MeasuredCustomerLegs,
  type ReconciliationLeg,
} from "./moneyPosting.js";
import {
  KEPT_CHANGE_ROUNDING_TOLERANCE,
  isWithinShortfallMax,
} from "../validators/exchange.js";
import {
  ADDED_CHANGE_ACCOUNT_MESSAGE,
  ADDED_CHANGE_MISMATCH_MESSAGE,
  ADDED_CHANGE_NOT_ALLOWED_MESSAGE,
  ADDED_CHANGE_OVER_CAP_MESSAGE,
} from "../validators/common.js";

export interface ResolveAddedChangeInput {
  /** The customer's lines (customerPayments, or a Whish receive's fee lines). */
  legs: ReconciliationLeg[] | undefined | null;
  /** What the customer owes the shop on this payout (0 when nothing — the
   *  lines are then only added change). */
  expected: { amount: number; currency: string };
  /** The payout's currency — the claim's currency. */
  payoutCurrency: string;
  /** Server rate-of-record of the payout reconcile (LBP per USD). */
  exchangeRate: number;
  /** The rate the till converted at (client-supplied, rule 27). */
  tenderExchangeRate?: number | undefined;
  /** Rate for measuring the lines (`measureCustomerLegs`' `rate`). Defaults
   *  to the reconcile rate. */
  measureRate?: number;
  /** The client an account line would belong to (measure needs it). */
  clientId?: number | null;
  /** A forgiven amount sent with the lines — refused together with a claim. */
  waived?: number;
  /** The client's claim. Absent / zero = no added change. */
  claimed?: { usd?: number | undefined; lbp?: number | undefined } | null;
  /** The flow cannot take added change here (for-partner, session basket,
   *  account or wallet payout, two-currency pickup). Refuses a claim. */
  notAllowed?: boolean;
  /** Label for thrown errors (e.g. "OMT RECEIVE cashout"). */
  context: string;
}

export interface AddedChange {
  /** The verified amount, in the payout currency (exactly one side non-zero,
   *  or both zero). */
  usd: number;
  lbp: number;
  /** The measured customer lines to write later (`writeCustomerLegs`);
   *  null when nothing was claimed. */
  measured: MeasuredCustomerLegs | null;
}

function refusal(plain: string, context: string, detail: string): Error {
  return new Error(`${plain} (${context}: ${detail})`);
}

/** USDT counts as USD (the same rule as `measureCustomerLegs`). */
function asComparable(currency: string): string {
  return currency === "USDT" ? "USD" : currency;
}

export function resolveAddedChange(
  input: ResolveAddedChangeInput,
): AddedChange {
  const { context, expected } = input;
  const usd = input.claimed?.usd ?? 0;
  const lbp = input.claimed?.lbp ?? 0;
  if (!Number.isFinite(usd) || !Number.isFinite(lbp) || usd < 0 || lbp < 0) {
    throw refusal(
      ADDED_CHANGE_NOT_ALLOWED_MESSAGE,
      context,
      "the added change must be a non-negative amount",
    );
  }
  const legs = (input.legs ?? []).filter((l) => Math.abs(l.amount) > 0);

  // ── No claim: the legacy path (FR-008) ────────────────────────────────
  if (usd <= 0 && lbp <= 0) {
    if (legs.length > 0 && !(expected.amount > 0)) {
      throw refusal(
        ADDED_CHANGE_MISMATCH_MESSAGE,
        context,
        "the customer owes nothing here, so their lines can only be change they add — send the added change with them",
      );
    }
    return { usd: 0, lbp: 0, measured: null };
  }

  // ── A claim ───────────────────────────────────────────────────────────
  if (input.notAllowed) {
    throw refusal(
      ADDED_CHANGE_NOT_ALLOWED_MESSAGE,
      context,
      "pay out the amount owed",
    );
  }
  const to = input.payoutCurrency;
  if (to !== "USD" && to !== "LBP") {
    throw refusal(
      ADDED_CHANGE_NOT_ALLOWED_MESSAGE,
      context,
      "added change needs a USD or LBP payout",
    );
  }
  const from = asComparable(expected.currency);
  if (from !== "USD" && from !== "LBP") {
    throw refusal(
      ADDED_CHANGE_NOT_ALLOWED_MESSAGE,
      context,
      "added change needs the customer to pay in USD or LBP",
    );
  }
  const claim = to === "USD" ? usd : lbp;
  const other = to === "USD" ? lbp : usd;
  if (other > 0 || claim <= 0) {
    throw refusal(
      ADDED_CHANGE_MISMATCH_MESSAGE,
      context,
      `the added change must be in the payout currency (${to})`,
    );
  }
  if (!isWithinShortfallMax(claim, to)) {
    throw refusal(
      ADDED_CHANGE_OVER_CAP_MESSAGE,
      context,
      `${claim} ${to} claimed`,
    );
  }
  if (legs.length === 0) {
    throw refusal(
      ADDED_CHANGE_MISMATCH_MESSAGE,
      context,
      "no customer lines were sent",
    );
  }
  if (
    legs.some((l) => l.method === "CUSTOMER_ACCOUNT") ||
    (input.waived ?? 0) > 0
  ) {
    throw refusal(
      ADDED_CHANGE_ACCOUNT_MESSAGE,
      context,
      "only cash or wallet lines can add change",
    );
  }

  const rate = resolveStampedExchangeRate(
    input.exchangeRate,
    input.tenderExchangeRate,
  );
  const measured = measureCustomerLegs({
    legs,
    expected,
    rate: input.measureRate ?? rate,
    clientId: input.clientId ?? null,
    context,
    allowAddedChange: true,
  });

  // The extra (in the expected currency) → the payout currency.
  const extra = measured.addedChange;
  const derived =
    from === to ? extra : to === "USD" ? extra / rate : extra * rate;
  const mixed =
    from !== to || legs.some((l) => asComparable(l.currencyCode) !== to);
  const tol = mixed
    ? to === "USD"
      ? LEG_RECONCILIATION_EPSILON_USD
      : LEG_RECONCILIATION_EPSILON_USD * rate
    : KEPT_CHANGE_ROUNDING_TOLERANCE[to];
  if (Math.abs(claim - derived) > tol) {
    throw refusal(
      ADDED_CHANGE_MISMATCH_MESSAGE,
      context,
      `claimed ${claim} ${to}, the customer's lines add ${to === "USD" ? derived.toFixed(2) : Math.round(derived)} ${to}`,
    );
  }
  return to === "USD"
    ? { usd: Number(claim.toFixed(2)), lbp: 0, measured }
    : { usd: 0, lbp: Math.round(claim), measured };
}
