/**
 * LIRA-334 — payout round-up (owner decision 2026-10-18).
 *
 * The cashier hands the customer a little MORE than owed because the drawer
 * has no coins or small notes (owed 102.90, handed 103.00). The client
 * claims the difference (`rounding_given_usd` / `rounding_given_lbp`, in the
 * payout's own currency); this verifies the claim against the payout legs
 * and returns the amount to book. The caller books it with
 * `bookPayoutRoundingExpense` (changeRoundingExpense.ts) — a books-only
 * "Change rounding" expense linked to the payout, voided with it.
 *
 * The mirror of payout kept change (`resolveKeptChange`, payer "payout"):
 * the same cap (`isWithinShortfallMax`, $5 / 450,000 LBP, compared in the
 * payout's own currency), the same tolerance, the same drawer-only rule —
 * with the opposite sign (legs cover `owed + rounding`, not `owed − kept`).
 *
 * The claim is in the OWED currency; the legs may mix USD and LBP (a USD
 * payout topped up with an LBP note claims USD rounding — `reconcileLegs`
 * converts at the tender rate).
 *
 * No claim → it reconciles the legs against `owed` exactly as the flow did
 * before (so callers can replace their plain `reconcileLegs` with it), and
 * returns zero. Node-only (reaches `utils/payments.js` via moneyPosting) —
 * NOT exported from browser.ts (rule 29).
 */
import {
  reconcileLegs,
  resolveStampedExchangeRate,
  sumLegsByCurrency,
  usdEquivalent,
  type ReconciliationLeg,
} from "./moneyPosting.js";
import {
  KEPT_CHANGE_ROUNDING_TOLERANCE,
  isWithinShortfallMax,
} from "../validators/exchange.js";
import {
  ROUNDING_GIVEN_CURRENCY_MESSAGE,
  ROUNDING_GIVEN_NOT_ALLOWED_MESSAGE,
  ROUNDING_GIVEN_OVER_CAP_MESSAGE,
  ROUNDING_GIVEN_WITH_KEPT_MESSAGE,
} from "../validators/common.js";
import { isDrawerAffectingMethod } from "../utils/payments.js";

export interface ResolveRoundingGivenInput {
  /** What the shop owes the customer, in ONE currency (magnitude). */
  owed: number;
  owedCurrency: string;
  /** The lines the shop hands out (pre-partitioned; must carry no OUT leg). */
  payoutLegs: ReconciliationLeg[] | undefined | null;
  /** The client's claim. Absent / zero = no round-up. */
  claimed?: { usd?: number | undefined; lbp?: number | undefined } | null;
  /** The client's payout kept-change claim — refused together with a round-up. */
  claimedKept?: { usd?: number | undefined; lbp?: number | undefined } | null;
  /** The flow cannot round up here (for-partner, session basket, account or
   *  wallet payout, two-currency pickup). Refuses a claim; no claim is fine. */
  notAllowed?: boolean;
  /** Server rate-of-record. */
  exchangeRate: number;
  /** The rate the till converted at (client-supplied, rule 27). */
  tenderExchangeRate?: number;
  /** Label for thrown errors (e.g. "OMT RECEIVE cashout"). */
  context: string;
}

export interface RoundingGiven {
  usd: number;
  lbp: number;
}

const ZERO: RoundingGiven = { usd: 0, lbp: 0 };
const FLOAT_DUST = 1e-9;

function refusal(plain: string, context: string, detail: string): Error {
  return new Error(`${plain} (${context}: ${detail})`);
}

function amount(v: number | undefined): number {
  return v ?? 0;
}

export function resolveRoundingGiven(
  input: ResolveRoundingGivenInput,
): RoundingGiven {
  const { context, exchangeRate, tenderExchangeRate } = input;
  const to = input.owedCurrency;
  const owed = Math.abs(input.owed);
  const usd = amount(input.claimed?.usd);
  const lbp = amount(input.claimed?.lbp);
  if (!Number.isFinite(usd) || !Number.isFinite(lbp) || usd < 0 || lbp < 0) {
    throw refusal(
      ROUNDING_GIVEN_NOT_ALLOWED_MESSAGE,
      context,
      "the round-up must be a non-negative amount",
    );
  }
  const legs = (input.payoutLegs ?? []).filter((l) => Math.abs(l.amount) > 0);

  if (usd <= 0 && lbp <= 0) {
    reconcileLegs({
      inLegs: legs,
      expectedTotals:
        to === "LBP" ? { usd: 0, lbp: owed } : { usd: owed, lbp: 0 },
      exchangeRate,
      ...(tenderExchangeRate !== undefined ? { tenderExchangeRate } : {}),
      context,
    });
    return { ...ZERO };
  }

  if (input.notAllowed) {
    throw refusal(
      ROUNDING_GIVEN_NOT_ALLOWED_MESSAGE,
      context,
      "this payout cannot be rounded up — pay out the exact amount",
    );
  }
  if (
    amount(input.claimedKept?.usd) > 0 ||
    amount(input.claimedKept?.lbp) > 0
  ) {
    throw refusal(
      ROUNDING_GIVEN_WITH_KEPT_MESSAGE,
      context,
      "kept change (paid out less) and a round-up (paid out more) cannot both apply",
    );
  }
  if (to !== "USD" && to !== "LBP") {
    throw refusal(
      ROUNDING_GIVEN_NOT_ALLOWED_MESSAGE,
      context,
      "a round-up requires a USD or LBP payout currency",
    );
  }
  const claim = to === "USD" ? usd : lbp;
  const other = to === "USD" ? lbp : usd;
  if (other > 0 || claim <= 0) {
    throw refusal(
      ROUNDING_GIVEN_CURRENCY_MESSAGE,
      context,
      `the round-up must be in the payout currency (${to})`,
    );
  }
  if (!isWithinShortfallMax(claim, to)) {
    throw refusal(
      ROUNDING_GIVEN_OVER_CAP_MESSAGE,
      context,
      "a round-up is a small leftover — pay out the exact amount",
    );
  }
  if (
    legs.length === 0 ||
    legs.some(
      (l) => l.direction === "OUT" || !isDrawerAffectingMethod(l.method),
    )
  ) {
    throw refusal(
      ROUNDING_GIVEN_NOT_ALLOWED_MESSAGE,
      context,
      "a round-up needs cash or wallet payout lines and no change (OUT) lines",
    );
  }

  const rate = resolveStampedExchangeRate(exchangeRate, tenderExchangeRate);
  const paidS = sumLegsByCurrency(legs, context);
  const paidUsd = usdEquivalent(paidS.usd, paidS.lbp, rate);
  const paid = to === "USD" ? paidUsd : paidUsd * rate;
  const tol = KEPT_CHANGE_ROUNDING_TOLERANCE[to];
  const excess = paid - owed;
  if (excess <= tol) {
    throw refusal(
      ROUNDING_GIVEN_NOT_ALLOWED_MESSAGE,
      context,
      "nothing to round up — the payout lines do not exceed the amount owed",
    );
  }
  // handed = owed + rounding (the S2 equation with the raised target).
  const target = owed + claim;
  reconcileLegs({
    inLegs: legs,
    expectedTotals:
      to === "LBP" ? { usd: 0, lbp: target } : { usd: target, lbp: 0 },
    exchangeRate,
    ...(tenderExchangeRate !== undefined ? { tenderExchangeRate } : {}),
    context,
  });
  if (claim > excess + tol + FLOAT_DUST) {
    throw refusal(
      ROUNDING_GIVEN_NOT_ALLOWED_MESSAGE,
      context,
      "the round-up is more than was handed out above the amount owed",
    );
  }
  return to === "USD"
    ? { usd: Number(claim.toFixed(2)), lbp: 0 }
    : { usd: 0, lbp: Math.round(claim) };
}
