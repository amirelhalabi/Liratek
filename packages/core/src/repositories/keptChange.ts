/**
 * Kept change — the ONE server-side check-and-split (owner decisions
 * 2026-10-07). Every money repository that accepts a client-claimed
 * `kept_change_*` calls `resolveKeptChange` instead of trusting the claim or
 * re-deriving its own math (rule 14). The UI half is `MultiPaymentInput`'s
 * `payer` prop (`@liratek/ui`); see docs/FEATURE_GUIDE.md "Kept change".
 *
 * Kept change = the cash handed back (or handed out) is LESS than due, and
 * the difference stays with someone. Who pays decides what it means:
 *
 *   payer      lines                          kept change becomes
 *   ─────────  ─────────────────────────────  ─────────────────────────────
 *   customer   customer → shop (POS, recharge  shop PROFIT (uncapped):
 *              sale, OMT SEND, debts, …);      IN − OUT − kept = due
 *              OUT = change back to customer
 *   payout     shop → customer (OMT/Whish      shop PROFIT, capped below
 *              RECEIVE, Binance cash-out,      PAYOUT_KEEP_CHANGE_MAX ($1 /
 *              buyback, credit cash-out);      100,000 LBP), payout currency
 *              NO OUT legs ever                only: paid = owed − kept
 *   shop       shop → outsider (Expenses);     added to the COST, never
 *              OUT ("returned") = change the   profit: cost = handed −
 *              outsider hands back INTO the    returned
 *              drawer
 *
 * Kept profit belongs INSIDE the transaction's own profit stamp
 * (`profit_usd`/`profit_lbp`, per currency, unconverted) — never a separate
 * field — so the generic void/refund negates it for free (rule 20). Exchange
 * keeps its own `kept_profit_usd` model (USD-only profit column) and does
 * not call this.
 *
 * FOR-partner transactions refuse kept change in every payer mode (exact
 * amount required), as Exchange already does.
 *
 * Tamper protection is two-layer: the S2 `reconcileLegs` equation (epsilon
 * $0.05 USD-equivalent) AND a tight check that the claimed kept never
 * exceeds the REAL excess/shortfall beyond cents/LBP rounding — without it a
 * phantom kept under $0.05 on an exact payment would pass reconcile and book
 * profit (or cost) out of nothing.
 *
 * Funding rule (owner decisions 2026-10-07): kept change must be REAL
 * drawer money the shop is holding back — cash OR wallet (OMT, WHISH,
 * Binance, …) — never a slice of the customer's own account debt, store
 * credit or gift card. "Drawer method" = `isDrawerAffectingMethod` (the one
 * definition in utils/payments.ts); CUSTOMER_ACCOUNT, GIFT_CARD and any
 * other non-drawer method are not. Applies only when something is kept (an
 * ordinary account / gift-card payment with nothing kept is untouched):
 *
 *   customer  kept ≤ drawerExcess, where (all USD-equivalent at the tender
 *             rate):
 *               drawerExcess = (drawer IN − drawer OUT)
 *                    − max(0, expected − (non-drawer IN − non-drawer OUT))
 *             i.e. non-drawer legs are applied to the total FIRST; only
 *             drawer money beyond what the total still needs can be kept. A
 *             non-drawer OUT (change credited back to the account) counts
 *             against the non-drawer side, so "cash $20 for $10, $5 to the
 *             account, $5 kept" and "WHISH $25 for $20, $3 cash back, $2
 *             kept" are allowed, while "account $15 for $10, $5 kept" and
 *             "account $15 + cash $5 for $10, $5 cash back, $5 kept" (which
 *             reconciles on paper) are refused.
 *   shop      the same formula on handed/returned/bill, AND every returned
 *             leg must be a drawer method (change comes back into a drawer,
 *             never onto an account).
 *   payout    every payout leg must be a drawer method; a payout charged to
 *             an account or gift card cannot keep anything.
 *
 * Cashier-facing wording: every refusal opens with ONE plain sentence (it
 * reaches the cashier as a toast), followed by the technical detail in
 * parentheses — `"<plain>. (<context>: <detail>)"`.
 *
 * Why here and not in `utils/`: it reuses `reconcileLegs`/`usdEquivalent`/
 * `sumLegsByCurrency` from `moneyPosting.ts` (rule 14 — one equation),
 * which is Node-only (it reaches the database via utils/payments.js). Only
 * repositories call this; the UI computes its own live preview and shares
 * just the cap constant (`validators/exchange.ts`). It is deliberately NOT
 * exported from `browser.ts` (rule 29). A separate file (not inside
 * moneyPosting.ts) also keeps parallel module migrations out of each other's
 * diff range.
 *
 * Never reads the clock: the caller passes the server rate-of-record AND
 * the client's tender rate (rule 27). The only DB read is the funding
 * check's payment-method lookup (`isDrawerAffectingMethod`, which falls back
 * to the hardcoded map when no DB is available).
 */

import {
  reconcileLegs,
  resolveStampedExchangeRate,
  sumLegsByCurrency,
  usdEquivalent,
  type ExpectedTotals,
  type KeptChange,
  type ReconciliationLeg,
} from "./moneyPosting.js";
import { PAYOUT_KEEP_CHANGE_MAX } from "../validators/exchange.js";
import { formatMoneyAmount } from "../utils/formatMoney.js";
import { isDrawerAffectingMethod } from "../utils/payments.js";

export type KeptChangePayer = "customer" | "payout" | "shop";

interface ResolveKeptChangeCommon {
  /** Server rate-of-record (normally `data.exchangeRate ?? getUsdLbpSellRate(db)`). */
  exchangeRate: number;
  /** The rate the till actually converted at (client-supplied, rule 27).
   *  Preferred over `exchangeRate` whenever it is a valid positive number. */
  tenderExchangeRate?: number;
  /** The client's claim (`kept_change_usd`/`kept_change_lbp`). Absent = 0. */
  claimedKept?: KeptChange | null;
  /** FOR-partner transaction — kept change refused. */
  isForPartner?: boolean;
  /** Label for thrown errors (e.g. "POS sale", "OMT RECEIVE"). */
  context: string;
}

/** Customer pays the shop. */
export interface CustomerKeptChangeInput extends ResolveKeptChangeCommon {
  payer: "customer";
  /** What the customer owes (the flow's own total — see reconcileLegs). */
  expected: ExpectedTotals;
  /** Customer tender (pre-partitioned IN legs, rule 16). */
  inLegs: ReconciliationLeg[] | undefined | null;
  /** Change handed back to the customer (OUT legs). */
  outLegs?: ReconciliationLeg[] | undefined | null;
}

/** Shop hands money to a customer. */
export interface PayoutKeptChangeInput extends ResolveKeptChangeCommon {
  payer: "payout";
  /** What the shop owes the customer, in ONE currency. */
  owed: number;
  owedCurrency: string;
  /** The cash/method lines the shop hands out. Must carry no OUT leg. */
  payoutLegs: ReconciliationLeg[] | undefined | null;
  /** Always refused when non-empty — a payout has no "change". Accepted as
   *  a parameter only so a caller passing its partitioned OUT set gets a
   *  clear refusal instead of a silent ignore. */
  outLegs?: ReconciliationLeg[] | undefined | null;
}

/** Shop pays an outsider (Expenses). */
export interface ShopKeptChangeInput extends ResolveKeptChangeCommon {
  payer: "shop";
  /** The outsider's bill (nominal cost). */
  bill: ExpectedTotals;
  /** Cash the shop hands to the outsider (drawer debit). */
  handedLegs: ReconciliationLeg[] | undefined | null;
  /** Change the outsider hands BACK into the drawer (drawer credit). */
  returnedLegs?: ReconciliationLeg[] | undefined | null;
}

export type ResolveKeptChangeInput =
  | CustomerKeptChangeInput
  | PayoutKeptChangeInput
  | ShopKeptChangeInput;

export interface KeptChangeResult {
  /** Profit to ADD to the transaction's own profit stamp, per currency
   *  (customer / payout). Always 0 in shop mode. */
  keptUsd: number;
  keptLbp: number;
  /** Shop mode: change the outsider did not return (already included in
   *  `costUsd`/`costLbp`). 0 otherwise. */
  notReturnedUsd: number;
  notReturnedLbp: number;
  /** Shop mode: the real cost per currency = handed − returned. One
   *  currency may be negative when the change came back in the other
   *  currency (e.g. $10 handed, 180,000 LBP returned → cost $10 / −180,000
   *  LBP). 0 in customer / payout mode. */
  costUsd: number;
  costLbp: number;
}

const ZERO: KeptChangeResult = {
  keptUsd: 0,
  keptLbp: 0,
  notReturnedUsd: 0,
  notReturnedLbp: 0,
  costUsd: 0,
  costLbp: 0,
};

/** Cents / whole-LBP rounding the UI applies to a kept figure. */
const ROUNDING_TOLERANCE = { USD: 0.005, LBP: 0.5 } as const;
const FLOAT_DUST = 1e-9;

/** A refusal the cashier reads: plain sentence first, detail after. */
function refusal(plain: string, context: string, detail: string): Error {
  return new Error(`${plain} (${context}: ${detail})`);
}

const NOT_ADD_UP = "The payment doesn't add up to the total.";

/** `reconcileLegs` with the cashier-facing sentence in front of its
 *  technical "do not reconcile" text (moneyPosting.ts is shared by flows
 *  that don't use this helper, so its own wording is left alone). */
function reconcile(args: Parameters<typeof reconcileLegs>[0]): void {
  try {
    reconcileLegs(args);
  } catch (e) {
    if (e instanceof Error && /do not reconcile/.test(e.message)) {
      throw new Error(`${NOT_ADD_UP} (${e.message})`);
    }
    throw e;
  }
}

const isDrawer = (l: ReconciliationLeg) => isDrawerAffectingMethod(l.method);

function legsUsd(legs: ReconciliationLeg[], rate: number, context: string) {
  if (legs.length === 0) return 0;
  const s = sumLegsByCurrency(legs, context);
  return usdEquivalent(s.usd, s.lbp, rate);
}

function keptTolerance(kept: { usd: number; lbp: number }, rate: number) {
  return (
    (kept.usd > 0 ? ROUNDING_TOLERANCE.USD : 0) +
    (kept.lbp > 0 ? ROUNDING_TOLERANCE.LBP / rate : 0) +
    FLOAT_DUST
  );
}

/**
 * Funding rule (see the header): kept ≤ drawer IN − drawer OUT − the part
 * of the expected total the non-drawer legs do not cover. Throws `error`
 * when the claim needs money that is not in a drawer.
 */
function assertDrawerFunded(args: {
  inLegs: ReconciliationLeg[];
  outLegs: ReconciliationLeg[];
  expected: ExpectedTotals;
  kept: { usd: number; lbp: number };
  rate: number;
  context: string;
  error: () => Error;
}): void {
  const { inLegs, outLegs, expected, kept, rate, context } = args;
  const drawerIn = legsUsd(inLegs.filter(isDrawer), rate, context);
  const drawerOut = legsUsd(outLegs.filter(isDrawer), rate, context);
  const nonDrawerNet =
    legsUsd(
      inLegs.filter((l) => !isDrawer(l)),
      rate,
      context,
    ) -
    legsUsd(
      outLegs.filter((l) => !isDrawer(l)),
      rate,
      context,
    );
  const expectedUsd = usdEquivalent(expected.usd, expected.lbp, rate);
  const drawerExcess =
    drawerIn - drawerOut - Math.max(0, expectedUsd - nonDrawerNet);
  const keptUsd = usdEquivalent(kept.usd, kept.lbp, rate);
  if (keptUsd > drawerExcess + keptTolerance(kept, rate)) {
    throw args.error();
  }
}

function nonEmpty(legs: ReconciliationLeg[] | undefined | null) {
  return (legs ?? []).filter((l) => Math.abs(l.amount) > 0);
}

function readClaim(claim: KeptChange | null | undefined, context: string) {
  const usd = claim?.usd ?? 0;
  const lbp = claim?.lbp ?? 0;
  if (!Number.isFinite(usd) || !Number.isFinite(lbp) || usd < 0 || lbp < 0) {
    throw refusal(
      "The kept change amount isn't valid.",
      context,
      "Kept change must be a non-negative amount",
    );
  }
  return { usd, lbp, any: usd > 0 || lbp > 0 };
}

/** Kept/not-returned may never exceed the real excess beyond rounding. */
function assertWithinExcess(args: {
  inLegs: ReconciliationLeg[];
  outLegs: ReconciliationLeg[];
  expected: ExpectedTotals;
  kept: { usd: number; lbp: number };
  rate: number;
  context: string;
  error: () => Error;
}): void {
  const { inLegs, outLegs, expected, kept, rate, context } = args;
  const inS = sumLegsByCurrency(inLegs, context);
  const outS = sumLegsByCurrency(outLegs, context);
  const excessUsd =
    usdEquivalent(inS.usd, inS.lbp, rate) -
    usdEquivalent(outS.usd, outS.lbp, rate) -
    usdEquivalent(expected.usd, expected.lbp, rate);
  const keptUsd = usdEquivalent(kept.usd, kept.lbp, rate);
  if (keptUsd > excessUsd + keptTolerance(kept, rate)) {
    throw args.error();
  }
}

/**
 * Verify a client-claimed kept change against the legs and split it into
 * profit (customer/payout) or cost (shop). Throws a descriptive Error on any
 * mismatch or refusal; call it inside the flow's `db.transaction(...)`
 * BEFORE writing any row, so a throw rolls everything back. It REPLACES the
 * flow's own `reconcileLegs` call (it runs the same equation).
 *
 * No legs and nothing claimed → returns zeros without reconciling (legacy /
 * scripted callers, same as reconcileLegs).
 */
export function resolveKeptChange(
  input: ResolveKeptChangeInput,
): KeptChangeResult {
  const { context, exchangeRate, tenderExchangeRate } = input;
  const kept = readClaim(input.claimedKept, context);
  const rate = resolveStampedExchangeRate(exchangeRate, tenderExchangeRate);

  if (kept.any && input.isForPartner) {
    throw refusal(
      "Keeping change isn't allowed on a partner transaction.",
      context,
      "a partner transaction cannot keep change — the exact amount is required",
    );
  }

  switch (input.payer) {
    case "customer": {
      const inLegs = nonEmpty(input.inLegs);
      const outLegs = nonEmpty(input.outLegs);
      if (kept.any && inLegs.length === 0) {
        throw refusal(
          "There is no payment to keep change from.",
          context,
          "keeping change needs the payment lines — there is nothing to keep it from",
        );
      }
      reconcile({
        inLegs,
        outLegs,
        keptChange: { usd: kept.usd, lbp: kept.lbp },
        expectedTotals: input.expected,
        exchangeRate,
        ...(tenderExchangeRate !== undefined ? { tenderExchangeRate } : {}),
        context,
      });
      if (kept.any) {
        assertWithinExcess({
          inLegs,
          outLegs,
          expected: input.expected,
          kept,
          rate,
          context,
          error: () =>
            refusal(
              "The change kept is more than the change due.",
              context,
              "kept change is more than the change actually due — refusing to book it as profit",
            ),
        });
        assertDrawerFunded({
          inLegs,
          outLegs,
          expected: input.expected,
          kept,
          rate,
          context,
          error: () =>
            refusal(
              "Change can only be kept from cash or wallet money.",
              context,
              "kept change exceeds the drawer (cash/wallet) excess — an account or gift card overpay cannot be kept as profit",
            ),
        });
      }
      return { ...ZERO, keptUsd: kept.usd, keptLbp: kept.lbp };
    }

    case "shop": {
      const handed = nonEmpty(input.handedLegs);
      const returned = nonEmpty(input.returnedLegs);
      if (kept.any && handed.length === 0) {
        throw refusal(
          "There is no payment to keep change from.",
          context,
          "change not returned needs the payment lines — there is nothing to keep it from",
        );
      }
      // Same equation as a customer payment, read from the shop's side:
      // handed − returned − notReturned = bill.
      reconcile({
        inLegs: handed,
        outLegs: returned,
        keptChange: { usd: kept.usd, lbp: kept.lbp },
        expectedTotals: input.bill,
        exchangeRate,
        ...(tenderExchangeRate !== undefined ? { tenderExchangeRate } : {}),
        context,
      });
      if (kept.any) {
        assertWithinExcess({
          inLegs: handed,
          outLegs: returned,
          expected: input.bill,
          kept,
          rate,
          context,
          error: () =>
            refusal(
              "The change not returned is more than the change due.",
              context,
              "change not returned is more than the change actually due — refusing to add it to the cost",
            ),
        });
        const drawerOnly = () =>
          refusal(
            "Change not returned only applies to cash or wallet money.",
            context,
            "change not returned must come out of drawer (cash/wallet) money handed and any change must come back into a drawer",
          );
        if (returned.some((l) => !isDrawer(l))) throw drawerOnly();
        assertDrawerFunded({
          inLegs: handed,
          outLegs: returned,
          expected: input.bill,
          kept,
          rate,
          context,
          error: drawerOnly,
        });
      }
      if (handed.length === 0) return { ...ZERO };
      const h = sumLegsByCurrency(handed, context);
      const r = sumLegsByCurrency(returned, context);
      return {
        ...ZERO,
        notReturnedUsd: kept.usd,
        notReturnedLbp: kept.lbp,
        costUsd: h.usd - r.usd,
        costLbp: h.lbp - r.lbp,
      };
    }

    case "payout": {
      const all = nonEmpty(input.payoutLegs);
      const outLegs = [
        ...nonEmpty(input.outLegs),
        ...all.filter((l) => l.direction === "OUT"),
      ];
      if (outLegs.length > 0) {
        throw refusal(
          "A payout can't include change given back.",
          context,
          "a payout cannot carry change (OUT) legs — the shop hands out money, it never receives change",
        );
      }
      const legs = all;
      const to = input.owedCurrency;
      const owed = Math.abs(input.owed);

      if (!kept.any) {
        reconcile({
          inLegs: legs,
          expectedTotals:
            to === "LBP" ? { usd: 0, lbp: owed } : { usd: owed, lbp: 0 },
          exchangeRate,
          ...(tenderExchangeRate !== undefined ? { tenderExchangeRate } : {}),
          context,
        });
        return { ...ZERO };
      }

      if (legs.length === 0) {
        throw refusal(
          "There is no payout line to keep change from.",
          context,
          "keeping change needs the payment lines — without them the full payout is paid out",
        );
      }
      if (legs.some((l) => !isDrawer(l))) {
        throw refusal(
          "Change can only be kept on a cash or wallet payout.",
          context,
          "a payout through an account or gift card cannot keep change — every payout line must move a drawer",
        );
      }
      if (to !== "USD" && to !== "LBP") {
        throw refusal(
          "Change can only be kept on a USD or LBP payout.",
          context,
          "keeping change requires a USD or LBP payout currency",
        );
      }
      const keptInPayout = to === "USD" ? kept.usd : kept.lbp;
      const keptOther = to === "USD" ? kept.lbp : kept.usd;
      if (keptOther > 0) {
        throw refusal(
          `Change must be kept in the payout's currency (${to}).`,
          context,
          `Kept change must be in the payout currency (${to})`,
        );
      }
      const cap = PAYOUT_KEEP_CHANGE_MAX[to];
      if (keptInPayout >= cap) {
        throw refusal(
          `You can only keep less than ${formatMoneyAmount(cap, to)} of change on a payout.`,
          context,
          `Kept change must be a small leftover — under ${formatMoneyAmount(cap, to)}`,
        );
      }

      const paidS = sumLegsByCurrency(legs, context);
      const paidUsd = usdEquivalent(paidS.usd, paidS.lbp, rate);
      const paid = to === "USD" ? paidUsd : paidUsd * rate;
      const tol = ROUNDING_TOLERANCE[to];
      const shortfall = owed - paid;
      if (shortfall <= tol) {
        throw refusal(
          "There is no change to keep — the payout is already paid in full.",
          context,
          "keep change applies only when the payout is short of the amount owed — the payout lines already cover it",
        );
      }
      // paid = owed − kept, via the S2 equation with the reduced target
      // (reconcileLegs' own keptChange arg has the overpay sign — wrong here).
      const remaining = owed - keptInPayout;
      reconcile({
        inLegs: legs,
        expectedTotals:
          to === "LBP"
            ? { usd: 0, lbp: remaining }
            : { usd: remaining, lbp: 0 },
        exchangeRate,
        ...(tenderExchangeRate !== undefined ? { tenderExchangeRate } : {}),
        context,
      });
      if (keptInPayout > shortfall + tol + FLOAT_DUST) {
        throw refusal(
          "The change kept is more than the amount left unpaid.",
          context,
          "kept change is more than the amount left unpaid — refusing to book it as profit",
        );
      }
      return to === "USD"
        ? { ...ZERO, keptUsd: keptInPayout }
        : { ...ZERO, keptLbp: keptInPayout };
    }
  }
}
