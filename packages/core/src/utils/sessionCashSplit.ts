/**
 * LIRA-304 (owner decision 2026-10-10, "OMT first") — how a session
 * basket's cash is split between the shop's primary-system cash drawer
 * (OMT_System / Whish_System) and General at checkout.
 *
 * The cash the customer hands over pays the basket's primary-system
 * transfers FIRST: each cash leg sends to the primary cash drawer whatever
 * the transfers still need (same currency first, then the other currency at
 * the basket rate), and the rest goes to General. Change handed back always
 * comes out of General — the transfer drawer only ever receives exactly what
 * the transfers cost. Replaces the old by-share split (each leg split in
 * proportion to the transfers' share of the basket).
 *
 * Shared by the session checkout screen's "Goes to" preview (FR-010a) and
 * `SessionPaymentService.recordBasketPayment` (the real posting), so the two
 * can never disagree. Pure and Node-free (rule 29).
 */

export interface BasketCashLegInput {
  currencyCode: string;
  /** Positive amount handed over in this leg. */
  amount: number;
  /** Only cash-family legs can go to the primary cash drawer (the rest —
   *  wallets, Customer Account, gift card — keep their own drawer). */
  eligible: boolean;
}

export interface BasketCashLegSplit {
  pcdAmount: number;
  generalAmount: number;
}

const toMinor = (currency: string, n: number): number =>
  Math.round(n * (currency === "USD" ? 100 : 1));
const fromMinor = (currency: string, n: number): number =>
  n / (currency === "USD" ? 100 : 1);

/**
 * Split each IN leg. `primaryChargeUsd`/`primaryChargeLbp` are the
 * basket's primary-system transfer charges per currency (SEND amount + fee;
 * 0 when the basket has none). Every split re-adds exactly to its leg
 * (integer minor units: cents for USD, whole LBP).
 */
export function splitBasketCashOmtFirst(input: {
  primaryChargeUsd: number;
  primaryChargeLbp: number;
  legs: BasketCashLegInput[];
  rate: number;
}): BasketCashLegSplit[] {
  const rate = input.rate > 0 ? input.rate : 1;
  // What the transfers still need, per currency (minor units).
  const need: Record<string, number> = {
    USD: toMinor("USD", Math.max(0, input.primaryChargeUsd)),
    LBP: toMinor("LBP", Math.max(0, input.primaryChargeLbp)),
  };
  const pcd = input.legs.map(() => 0);

  // Pass 1 — same currency.
  input.legs.forEach((leg, i) => {
    if (!leg.eligible || leg.amount <= 0) return;
    const units = toMinor(leg.currencyCode, leg.amount);
    const want = need[leg.currencyCode] ?? 0;
    const take = Math.min(units, want);
    if (take > 0) {
      pcd[i] += take;
      need[leg.currencyCode] = want - take;
    }
  });

  // Pass 2 — the other currency, at the basket rate (e.g. LBP cash paying
  // a USD transfer).
  input.legs.forEach((leg, i) => {
    if (!leg.eligible || leg.amount <= 0) return;
    const units = toMinor(leg.currencyCode, leg.amount) - pcd[i];
    if (units <= 0) return;
    const other = leg.currencyCode === "USD" ? "LBP" : "USD";
    const wantOther = need[other] ?? 0;
    if (wantOther <= 0) return;
    // Convert the other currency's need into this leg's minor units.
    const wantHere =
      leg.currencyCode === "USD"
        ? Math.round((fromMinor("LBP", wantOther) / rate) * 100)
        : Math.round(fromMinor("USD", wantOther) * rate);
    const take = Math.min(units, wantHere);
    if (take <= 0) return;
    pcd[i] += take;
    const covered =
      leg.currencyCode === "USD"
        ? Math.round(fromMinor("USD", take) * rate)
        : Math.round((fromMinor("LBP", take) / rate) * 100);
    need[other] = Math.max(0, wantOther - covered);
  });

  return input.legs.map((leg, i) => {
    if (!leg.eligible || leg.amount <= 0) {
      return { pcdAmount: 0, generalAmount: Math.max(0, leg.amount) };
    }
    // Nothing to the transfer drawer → the leg stays exactly as handed
    // over (a sub-cent amount is never rounded, so a later reversal nets
    // the drawer back to the exact cent).
    if (pcd[i] === 0) return { pcdAmount: 0, generalAmount: leg.amount };
    const pcdAmount = fromMinor(leg.currencyCode, pcd[i]);
    return {
      pcdAmount,
      generalAmount: Math.round((leg.amount - pcdAmount) * 1e9) / 1e9,
    };
  });
}
