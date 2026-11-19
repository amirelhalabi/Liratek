/**
 * LIRA-402 — the ONE builder of a session checkout's `payments[]` (rule 22:
 * one payload shape per operation; the mode is a parameter, never a second
 * object literal). Used by `SessionCheckoutModal` (desktop and web share it)
 * and by the core tests that run its output through the real schema and
 * `SessionCheckoutService`. Pure leaf — no Node built-in, reachable from
 * `browser.ts` (rule 29).
 *
 * Two modes:
 *  - "collect" (the customer pays; also the nothing-to-collect case): the
 *    pay-in box's lines go IN, its change lines OUT/CHANGE, and every
 *    payout leaves as its own PAYOUT leg exactly as before LIRA-402 —
 *    SYSTEM payouts gross (`payoutOrigin: "SYSTEM"`), an exchange's payout
 *    gross, and the General payout as the caller computed it (the excess
 *    after netting when routed to cash, else gross).
 *  - "payout" (the shop pays the customer the net): the payout box's lines
 *    go OUT/PAYOUT/GENERAL — they carry the General payout left after
 *    netting AND any exchange payout. OMT/Whish SYSTEM payouts keep their
 *    own gross SYSTEM leg (a different cash box, never netted, owner
 *    decision #11-A).
 */
import type { SessionCheckoutPaymentInput } from "../validators/session.js";
import { MIXED_PAYOUT_METHOD, payoutMethodOf } from "./paymentLegs.js";

/** One line of a payment box (the shape `MultiPaymentInput` reports). */
export interface SessionCheckoutLine {
  method: string;
  currencyCode: string;
  amount: number;
  voucherCode?: string | undefined;
}

export interface CurrencyPair {
  usd: number;
  lbp: number;
}

export interface BuildSessionCheckoutLegsInput {
  mode: "collect" | "payout";
  /** Pay-in box lines (collect mode). */
  collectLines: ReadonlyArray<SessionCheckoutLine>;
  /** Pay-in box change lines (collect mode). */
  returnLines: ReadonlyArray<SessionCheckoutLine>;
  /** Payout box lines (payout mode). */
  payoutLines: ReadonlyArray<SessionCheckoutLine>;
  /** The per-currency method chosen for payouts that leave as their own leg. */
  payoutMethod: { USD: string; LBP: string };
  /** OMT/Whish SYSTEM payout, gross, per currency. */
  systemPayout: CurrencyPair;
  /** Collect mode only — an exchange's payout, gross, per currency. */
  exchangePayout: CurrencyPair;
  /** Collect mode only — the General payout leg per currency (excess after
   *  netting when routed to cash, else gross). */
  generalPayoutLeg: CurrencyPair;
}

const lineLeg =
  (direction: "IN" | "OUT", kind?: "PAYOUT" | "CHANGE") =>
  (l: SessionCheckoutLine): SessionCheckoutPaymentInput => ({
    method: l.method,
    currency_code: l.currencyCode,
    amount: l.amount,
    direction,
    ...(kind ? { kind } : {}),
    ...(kind === "PAYOUT" ? { payoutOrigin: "GENERAL" as const } : {}),
    ...(l.method === "GIFT_CARD" && l.voucherCode
      ? { voucher_code: l.voucherCode }
      : {}),
  });

function payoutLeg(
  method: string,
  currency: "USD" | "LBP",
  amount: number,
  origin: "SYSTEM" | "GENERAL",
): SessionCheckoutPaymentInput {
  return {
    method,
    currency_code: currency,
    amount,
    direction: "OUT",
    kind: "PAYOUT",
    payoutOrigin: origin,
  };
}

export function buildSessionCheckoutLegs(
  input: BuildSessionCheckoutLegsInput,
): SessionCheckoutPaymentInput[] {
  const legs: SessionCheckoutPaymentInput[] = [];
  const pairLegs = (pair: CurrencyPair, origin: "SYSTEM" | "GENERAL") => {
    if (pair.usd > 0) {
      legs.push(payoutLeg(input.payoutMethod.USD, "USD", pair.usd, origin));
    }
    if (pair.lbp > 0) {
      legs.push(payoutLeg(input.payoutMethod.LBP, "LBP", pair.lbp, origin));
    }
  };

  if (input.mode === "payout") {
    legs.push(
      ...input.payoutLines
        .filter((l) => l.amount > 0)
        .map(lineLeg("OUT", "PAYOUT")),
    );
    pairLegs(input.systemPayout, "SYSTEM");
    return legs;
  }

  legs.push(...input.collectLines.map(lineLeg("IN")));
  legs.push(...input.returnLines.map(lineLeg("OUT", "CHANGE")));
  pairLegs(input.systemPayout, "SYSTEM");
  // LIRA-380: an exchange's payout — the agreed amount, gross, never netted.
  pairLegs(input.exchangePayout, "GENERAL");
  pairLegs(input.generalPayoutLeg, "GENERAL");
  return legs;
}

/**
 * The `cashoutMethod` a cash-out item of `currency` carries when the payout
 * box paid it: the method every box line in that currency shares, else
 * CASH (a mixed split reads as a cash payout — the same reading as
 * `payoutMethodOf`, LIRA-391). Informational for a deferred session item:
 * the basket's legs move the money.
 */
export function payoutBoxMethodFor(
  lines: ReadonlyArray<SessionCheckoutLine>,
  currency: string,
): string {
  const inCurrency = lines.filter((l) => l.currencyCode === currency);
  const shared = payoutMethodOf(
    undefined,
    inCurrency.length > 0 ? inCurrency : lines,
  );
  return !shared || shared === MIXED_PAYOUT_METHOD ? "CASH" : shared;
}
