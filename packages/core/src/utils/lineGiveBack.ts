/**
 * LIRA-337 — the figures of a give-back: part of a for-sale line's credit sent
 * to one of the shop's own lines before the line is sold.
 *
 * ONE derivation (rule 14): the Phone Lines panel previews with it and
 * `ResaleLineService.giveBack` saves with it, so the screen and the record
 * cannot disagree. Pure and browser-safe (rule 29).
 *
 * Owner rules (2026-10-18, specs/337-give-credit-back/research.md R2–R4):
 * - The sender pays the SMS fee ($0.16 per message, at most $3 per message)
 *   out of the credit leaving the line, so the buyer keeps exactly what they
 *   asked for — or, when no exact split exists, the nearest amount above it.
 * - The price drops by the credit that left the line × the credit selling
 *   price (LBP per $1), at the exchange rate.
 * - The cost drops by the credit the shop line received × the shop's credit
 *   cost rate, so the fee stays inside the line's cost.
 */
import {
  MAX_CREDIT_PER_SMS_USD,
  SMS_TRANSFER_FEE_USD,
} from "./telecomCredit.js";

export interface LineGiveBackInput {
  creditsBefore: number;
  creditsKept: number;
  /** LBP the shop sells $1 of credit for (typed on screen). */
  creditSellPriceLbp: number;
  /** LBP $1 of credit costs the shop (Shop Config). */
  creditCostRateLbp: number;
  /** LBP per USD. */
  exchangeRate: number;
}

export type LineGiveBackPlan =
  | {
      ok: true;
      /** Credit the shop line receives. */
      creditsSent: number;
      smsFeeUsd: number;
      creditsAfter: number;
      priceDropUsd: number;
      costDropUsd: number;
    }
  | { ok: false; error: string };

export const GIVE_BACK_KEEP_TOO_MUCH_ERROR =
  "The buyer must keep less credit than the line has.";

export function planLineGiveBack(input: LineGiveBackInput): LineGiveBackPlan {
  const beforeC = toCents(input.creditsBefore);
  const keptC = toCents(input.creditsKept);
  if (!(beforeC > 0)) {
    return { ok: false, error: "This line has no credit to give back." };
  }
  if (!(keptC >= 0) || keptC >= beforeC) {
    return { ok: false, error: GIVE_BACK_KEEP_TOO_MUCH_ERROR };
  }
  if (!(input.exchangeRate > 0) || !(input.creditSellPriceLbp > 0) || !(input.creditCostRateLbp > 0)) {
    return { ok: false, error: "Enter the credit price and the exchange rate." };
  }

  // Largest X (cents) with X + ⌈X / per⌉ × fee ≤ G; try each message count.
  const giveC = beforeC - keptC;
  const perC = toCents(MAX_CREDIT_PER_SMS_USD);
  const feeC = toCents(SMS_TRANSFER_FEE_USD);
  let sentC = 0;
  for (let n = 1; n <= Math.ceil(giveC / perC) + 1; n++) {
    const x = Math.min(perC * n, giveC - feeC * n);
    if (x > perC * (n - 1) && x > sentC) sentC = x;
  }
  if (sentC <= 0) {
    return { ok: false, error: "Too little credit to cover the SMS fee." };
  }
  const smsFeeC = Math.ceil(sentC / perC) * feeC;
  const leftC = sentC + smsFeeC;

  return {
    ok: true,
    creditsSent: sentC / 100,
    smsFeeUsd: smsFeeC / 100,
    creditsAfter: (beforeC - leftC) / 100,
    priceDropUsd: round2(((leftC / 100) * input.creditSellPriceLbp) / input.exchangeRate),
    costDropUsd: round2(((sentC / 100) * input.creditCostRateLbp) / input.exchangeRate),
  };
}

function toCents(n: number): number {
  return Math.round(n * 100);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
