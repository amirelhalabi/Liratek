import { allocatePayments, type Money, type RateTable } from "@liratek/ui";
import {
  sessionBasketCustomerAmount,
  sessionPooledReceiveFee,
} from "@liratek/core";
import type { CartItem, CartModule } from "../types/cart";

/**
 * Modules whose payout comes from the OMT/Whish SYSTEM money-transfer box —
 * its own physical drawer, always kept separate from General (owner decision
 * #11-A, OWNER_NOTES_REMAINING_BUILD.md, 2026-09-24: "OMT/Whish SYSTEM
 * payouts ... keep the two boxes SEPARATE" — unlike a loto prize or a
 * wallet/Binance cash-out, which ARE paid from General and can net against
 * the charge below via `netCashPayoutAgainstCharge`).
 */
const SYSTEM_PAYOUT_MODULES = new Set<CartModule>([
  "omt_system",
  "whish_system",
]);

/**
 * Customer-perspective reading of a Binance basket item.
 *
 * The session basket shows ONE perspective — the customer's: what they pay
 * (+) or get paid (−), in the currency that changes hands with THEM. For
 * Binance that is always CASH (USD): the stored `amount` is that cash side
 * (SEND: +amount+fee the customer pays; RECEIVE: −(amount−fee) the shop pays
 * out). The USDT quantity is the SERVICE being performed and lives in the
 * item label; the wallet gaining/losing USDT is shop bookkeeping that
 * belongs to the transactions view — never to the basket (no cart line
 * shows the Katsh drawer draw-down either).
 *
 * The item's "USDT" currency is a MECHANICAL flag only: `splitBasketCashSides`
 * below folds it into the USD cash-side bucket (charge or payout) instead of
 * giving it its own currency bucket, which is what actually keeps a Binance
 * item out of a phantom "USDT total" in the pooled basket payment / debt.
 * There is no more separate self-posted replay path for this — the gross
 * charge/payout split (BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §1.5, Phase F) is
 * now the one model every session-basket item goes through, cashout or not.
 * Do not render the raw "USDT" tag — rendering `amount` as "USDT" once read
 * as "the wallet loses 50 USDT" on a cash out. Returns null for non-Binance
 * items.
 */
export function binanceCashSide(
  item: Pick<CartItem, "module" | "amount">,
): { cashUsd: number } | null {
  if (item.module !== "binance_receive" && item.module !== "binance_send") {
    return null;
  }
  return { cashUsd: item.amount };
}

/**
 * GROSS split of a basket into charges (customer pays, +) and cash-out payouts
 * (shop pays, −), per currency, WITHOUT netting them against each other.
 *
 * A $10 charge and a $20 cash-out must surface on the Debts page as a $10 debt
 * AND a $20 credit (net −$10) — never collapsed into one −$10 line. So charges
 * and payouts are accumulated into SEPARATE buckets: the charges seed the
 * pooled payment / basket debt, the payouts become the cash payout or the
 * on-account store credit. Netting here (returning `usd = charge − payout`)
 * is the bug this guards — the canceled amounts would vanish from the ledger.
 *
 * `binanceCashSide` folds a Binance item's USDT tag into its USD cash side;
 * every other item contributes its own `amount`/`currency`.
 *
 * BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §1.5 Phase F: a WHISH system RECEIVE
 * (negative cart amount = a payout item) that carries a customer-paid
 * fee-on-top (`formData.includingFees` falsy, `whishFee` > 0) ALSO
 * contributes that fee into the CHARGE bucket, in its own currency — the
 * ONE shared rule `sessionPooledReceiveFee` decides this, the same one the
 * server uses (LIRA-271; an OMT RECEIVE never takes a fee, D1) — "the fee simply joins the gross charge bucket
 * ... collected by the pooled payment lines" (§1.5). Fee-included
 * (`includingFees` true) contributes nothing extra here: the fee is already
 * netted out of the (smaller) payout amount the item itself carries, so there
 * is nothing separate left to collect. `formData` is optional so callers that
 * never carry a fee (every non-financial module, and existing tests built
 * before this field existed) don't need to supply it.
 */
export function splitBasketCashSides(
  items: Array<
    Pick<CartItem, "module" | "amount" | "currency"> &
      Partial<Pick<CartItem, "formData">>
  >,
): {
  chargeUsd: number;
  chargeLbp: number;
  payoutUsd: number;
  payoutLbp: number;
  /**
   * Subset of payoutUsd/payoutLbp coming from OMT/Whish SYSTEM items
   * (`SYSTEM_PAYOUT_MODULES`) — the money-transfer box. Owner decision
   * #11-A: this portion is NEVER netted against the charge, even when routed
   * through CASH — it always keeps its own separate leg/drawer.
   * `payoutUsd - systemPayoutUsd` (etc.) is the General-drawer-eligible
   * portion (loto prize, wallet/Binance cash-out) that CAN net — see
   * `netCashPayoutAgainstCharge` below.
   */
  systemPayoutUsd: number;
  systemPayoutLbp: number;
  /**
   * Subset of chargeUsd/chargeLbp coming from an OMT/Whish SYSTEM item (a
   * positive-amount `omt_system`/`whish_system` SEND, or a SYSTEM RECEIVE's
   * fee-on-top) — the money-transfer box's OWN charge. Fix-round finding #3
   * (2026-09-24): a General-drawer payout (loto prize, wallet/Binance
   * cash-out) must NEVER net against this portion — OMT_System/Whish_System
   * and General are physically DIFFERENT cash boxes, so "count it out and
   * take it straight back" never applies across them (the owner's #11-A
   * netting rationale is General-drawer-only; the SYSTEM-payout half of that
   * same decision — "keep the two boxes SEPARATE" — extends here for
   * exactly the same physical reason). `chargeUsd - systemChargeUsd` (etc.)
   * is the General-bound netting base the caller must use instead of the
   * raw gross `chargeUsd`/`chargeLbp`.
   */
  systemChargeUsd: number;
  systemChargeLbp: number;
} {
  let chargeUsd = 0,
    chargeLbp = 0,
    payoutUsd = 0,
    payoutLbp = 0,
    systemPayoutUsd = 0,
    systemPayoutLbp = 0,
    systemChargeUsd = 0,
    systemChargeLbp = 0;
  for (const item of items) {
    const binance = binanceCashSide(item);
    // A For-Partner item is the partner's obligation, booked by the item
    // itself — it adds nothing to what the walk-in pays or is paid (one
    // shared rule with SessionCheckoutService, @liratek/core).
    const amt = sessionBasketCustomerAmount({
      amount: binance ? binance.cashUsd : item.amount,
      formData: item.formData,
    });
    const ccy = binance ? "USD" : item.currency;
    const isSystemItem = SYSTEM_PAYOUT_MODULES.has(item.module);
    if (amt >= 0) {
      if (ccy === "USD") {
        chargeUsd += amt;
        if (isSystemItem) systemChargeUsd += amt;
      } else if (ccy === "LBP") {
        chargeLbp += amt;
        if (isSystemItem) systemChargeLbp += amt;
      }
    } else {
      if (ccy === "USD") {
        payoutUsd += -amt;
        if (isSystemItem) systemPayoutUsd += -amt;
      } else if (ccy === "LBP") {
        payoutLbp += -amt;
        if (isSystemItem) systemPayoutLbp += -amt;
      }
    }

    // A WHISH system RECEIVE's fee-on-top rides along as a SEPARATE charge,
    // on top of (never instead of) the payout bucketing above — and it is
    // itself a SYSTEM-box charge (collected as part of that same SYSTEM
    // RECEIVE), so it counts toward systemChargeUsd/Lbp too.
    //
    // LIRA-271: which fee counts is decided by the ONE shared rule
    // (`sessionPooledReceiveFee`, @liratek/core) the server also uses — read
    // from each financial payload, top level or batch sub-item, in that
    // payload's own currency. An OMT RECEIVE's `omtFee` is informational
    // only (D1) and an app-wallet RECEIVE's fee arrives in the wallet, so
    // neither is ever collected here.
    const fd = item.formData ?? {};
    const payloads: Array<Record<string, unknown>> =
      fd._batch === true && Array.isArray(fd.items)
        ? (fd.items as Array<Record<string, unknown>>)
        : [fd];
    for (const payload of payloads) {
      const fee = sessionPooledReceiveFee(payload);
      if (fee <= 0) continue;
      const feeCcy =
        typeof payload.currency === "string" && payload.currency
          ? payload.currency
          : item.currency;
      if (feeCcy === "USD") {
        chargeUsd += fee;
        systemChargeUsd += fee;
      } else if (feeCcy === "LBP") {
        chargeLbp += fee;
        systemChargeLbp += fee;
      }
    }
  }
  return {
    chargeUsd,
    chargeLbp,
    payoutUsd,
    payoutLbp,
    systemPayoutUsd,
    systemPayoutLbp,
    systemChargeUsd,
    systemChargeLbp,
  };
}

/**
 * Net a GENERAL-drawer CASH payout against the basket's charge (owner
 * decision #11-A, OWNER_NOTES_REMAINING_BUILD.md, 2026-09-24): a loto prize
 * or a wallet/Binance cash-out paid in CASH is money the shop would
 * otherwise have to physically count out and then take straight back in as
 * the customer's payment — so instead of two separate cash movements, the
 * customer's tender is netted against the combined charge+payout and only
 * the PHYSICAL difference changes hands ("only the physical legs are
 * recorded"). OMT/Whish SYSTEM payouts and any non-cash payout (store
 * credit, a wallet) are excluded by the CALLER — pass only the netting-
 * ELIGIBLE amount in `cashPayoutUsd`/`cashPayoutLbp` (i.e.
 * `payoutUsd - systemPayoutUsd`, gated on that currency's payout method
 * actually being CASH).
 *
 * Reuses the money engine's `allocatePayments` — the SAME native +
 * cross-currency spillover MultiPaymentInput already runs internally — by
 * treating the payout as a payment already "tendered" toward the charge:
 * `remaining` is the net amount STILL owed (feed this into
 * MultiPaymentInput's `totals`), `change` is the payout's excess over the
 * charge — the only part that still needs a real PAYOUT leg (money
 * physically leaving a drawer). When the payout doesn't fully cover the
 * charge, `change` is empty and NO payout leg is needed at all: that money
 * never physically left the drawer, it was only a reduction of what the
 * customer owed.
 *
 * Owner's worked example (2026-09-24): a 1,280,000 LBP ticket charge netted
 * against a 400,000 LBP prize (rate 89,000) leaves 880,000 LBP still owed;
 * paid with $50 cash, that's exactly 40$ + 10,000 LBP change — the
 * 390,000 LBP drawer gap a GROSS payout leg used to create (today's payout
 * leg debited the full 400,000 LBP that never physically left the drawer).
 */
export function netCashPayoutAgainstCharge(params: {
  chargeUsd: number;
  chargeLbp: number;
  /** Netting-eligible portion only — see the caller-gating note above. */
  cashPayoutUsd: number;
  cashPayoutLbp: number;
  /** USD→LBP rate of record (session checkout uses the BUY side). */
  rate: number;
}): {
  /** Feed these into MultiPaymentInput's `totals` in place of the raw charge. */
  netChargeUsd: number;
  netChargeLbp: number;
  /** The payout's excess over the charge — still needs a real PAYOUT leg. */
  excessPayoutUsd: number;
  excessPayoutLbp: number;
} {
  const { chargeUsd, chargeLbp, cashPayoutUsd, cashPayoutLbp, rate } = params;

  if (cashPayoutUsd <= 0 && cashPayoutLbp <= 0) {
    return {
      netChargeUsd: chargeUsd,
      netChargeLbp: chargeLbp,
      excessPayoutUsd: 0,
      excessPayoutLbp: 0,
    };
  }

  const totals: Money[] = [];
  if (chargeUsd > 0) totals.push({ amount: chargeUsd, currency: "USD" });
  if (chargeLbp > 0) totals.push({ amount: chargeLbp, currency: "LBP" });

  const payments: Money[] = [];
  if (cashPayoutUsd > 0)
    payments.push({ amount: cashPayoutUsd, currency: "USD" });
  if (cashPayoutLbp > 0)
    payments.push({ amount: cashPayoutLbp, currency: "LBP" });

  const safeRate = rate > 0 ? rate : 1;
  const rates: RateTable = {
    base: "USD",
    rates: { LBP: { buy: safeRate, sell: safeRate } },
  };

  const { remaining, change } = allocatePayments(
    { totals, payments, rates, side: "buy" },
    { round: true },
  );

  const at = (list: Money[], currency: string): number =>
    list.find((m) => m.currency === currency)?.amount ?? 0;

  return {
    netChargeUsd: at(remaining, "USD"),
    netChargeLbp: at(remaining, "LBP"),
    excessPayoutUsd: at(change, "USD"),
    excessPayoutLbp: at(change, "LBP"),
  };
}
