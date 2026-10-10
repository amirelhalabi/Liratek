import { RECHARGE_SUBTYPE_LABELS } from "@liratek/core";

/** Recharge subtype → human label — core's shared list (LIRA-301), re-exported for this app. */
export { RECHARGE_SUBTYPE_LABELS };

/**
 * "what was actually recharged" detail, distinct from the price charged:
 * DAYS is denominated in days, TOP_UP has no separate face value, every
 * other subtype in the recharge's own dollar face value (e.g. "$6" MTC
 * credits).
 */
function describeRechargeAmount(type: string, amount: number): string {
  if (type === "DAYS") return `${amount} days`;
  if (type === "TOP_UP") return "";
  return `$${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

/** "<subtype label> <face value>", e.g. "Credits $6" — used on receipts. */
export function rechargeDetailLabel(type: string, amount: number): string {
  const label = RECHARGE_SUBTYPE_LABELS[type] ?? type;
  const amountDetail = describeRechargeAmount(type, amount);
  return amountDetail ? `${label} ${amountDetail}` : label;
}

/**
 * Owner note #21 (LIRA-088, migration v182): the `recharge_type` actually
 * submitted to `recharge:process`/`POST /api/recharge/process` for the
 * Credit tab, given the shop-line checkbox's state. ONE pure function (rule
 * 14) so the money direction the checkbox implies can never drift between
 * its callers:
 *   - `Recharge/index.tsx`'s `handleTelecomSubmit` (direct submit + the
 *     session-cart `formData.type`), and
 *   - `TelecomForm.tsx`'s `isCreditBuyback` (drives every UI branch — the
 *     submit-button label, the profit-preview visibility, the PaymentSheet
 *     title — that has to agree with what actually gets submitted).
 *
 * NOT used by `TelecomForm.tsx`'s `handleForPartnerSubmit` — "For Partner"
 * is hidden and force-reset off the moment `isShopLineMatch` is true (see
 * that file's own comment), so that path can never see a shop-line number
 * at all and stays on its pre-existing, unrelated `type: rechargeType`
 * payload (fix-round-1 finding `partner-path-sends-credit-transfer`: routing
 * a `CREDIT_BUYBACK` through it would hit `processCreditBuyback`, which has
 * no partner-ledger handling at all).
 *
 * Non-Credit tabs (DAYS, ALFA_GIFT, …) and a Credit-tab number that isn't a
 * shop line at all pass `rechargeType` straight through unchanged — the
 * checkbox is only ever rendered, and only ever meaningful, when
 * `isShopLineMatch` is true.
 */
export function deriveSubmittedRechargeType(
  rechargeType: string,
  isShopLineMatch: boolean,
  shopLineBuyback: boolean,
): string {
  if (rechargeType !== "CREDIT_TRANSFER" || !isShopLineMatch) {
    return rechargeType;
  }
  return shopLineBuyback ? "CREDIT_BUYBACK" : "SHOP_LINE_USE";
}
