/**
 * LIRA-331 — the Arabic words for a transaction's title ("OMT App Send",
 * "Loto Prize", "SALE"…) and for the Type filter's option labels.
 *
 * The English title is still worked out ONCE, by core's `transactionTitle`
 * (shared with the phone app), and the filter labels stay the English keys
 * the filter matches on. This module only translates that finished English
 * text at render time — it never re-derives a title from the row's metadata
 * (rule 14). Anything it does not recognise is shown in English, unchanged.
 *
 * English is returned untouched (byte-identical), so the table, the export,
 * the sort and every existing English assertion are unaffected.
 */
import type { TFunction } from "i18next";
import type { EN_RESOURCES } from "@liratek/ui/i18n/resources";

type TitlesCatalog = (typeof EN_RESOURCES)["audit"]["titles"];
export type ExactTitleKey = keyof TitlesCatalog["exact"];
type ProviderKey = keyof TitlesCatalog["provider"];
type WhatKey = keyof TitlesCatalog["what"];

type AuditT = TFunction<"audit">;

const norm = (s: string) => s.trim().replace(/[_\s]+/g, " ").toLowerCase();

/** English titles/labels (case- and underscore-insensitive) → catalog key. */
const EXACT: ReadonlyMap<string, ExactTitleKey> = new Map(
  (
    [
      ["Cash only (till)", "cashOnly"],
      ["Line recharge", "lineRecharge"],
      ["Credits recovered", "creditsRecovered"],
      ["Line Adjustment", "lineAdjustment"],
      ["OMT App Cash-Out", "omtAppCashOut"],
      ["MTC Top-up", "mtcTopUp"],
      ["Alfa Top-up", "alfaTopUp"],
      ["Loto", "loto"],
      ["Loto Prize", "lotoPrize"],
      ["Loto Settlement", "lotoSettlement"],
      ["Loto Monthly Fee", "lotoMonthlyFee"],
      ["Expense · Stock", "expenseStock"],
      ["Expense · Katsh", "expenseKatsh"],
      ["Expense · iPick", "expenseIpick"],
      ["Expense · Whish App", "expenseWhishApp"],
      ["General Top-up", "generalTopUp"],
      ["General Cash-Out", "generalCashOut"],
      ["Money Held", "moneyHeld"],
      ["Hold Returned", "holdReturned"],
      ["Hold Pickup Voided", "holdPickupVoided"],
      ["Account Credit", "accountCredit"],
      ["Cash Advance", "cashAdvance"],
      ["Waived", "waived"],
      ["Extra charge", "extraCharge"],
      ["Warranty Cost", "warrantyCost"],
      ["Supplier Settlement", "supplierSettlement"],
      ["Partner Settlement", "partnerSettlement"],
      ["Partner Payment", "partnerPayment"],
      ["Partner Adjustment", "partnerAdjustment"],
      ["Account Adjustment", "accountAdjustment"],
      ["Supplier Adjustment", "supplierAdjustment"],
      ["Stock Received", "stockReceived"],
      ["Supplier Debt Recorded", "supplierDebtRecorded"],
      ["Discount", "discount"],
      ["Checkpoint", "checkpoint"],
      ["Undo Refund", "undoRefund"],
      ["Initial Setup", "initialSetup"],
      ["Supplier Credit", "supplierCredit"],
      ["Supplier Payment", "supplierPayment"],
      ["Whish App Bills", "whishAppBills"],
      ["MTC Buy-back", "mtcBuyBack"],
      ["Alfa Buy-back", "alfaBuyBack"],
      // Types with no fixed title fall back to the humanised code
      // ("DEBT_REPAYMENT" → "DEBT REPAYMENT"); the filter uses "Sale" etc.
      ["Sale", "sale"],
      ["Exchange", "exchange"],
      ["Wallet Exchange", "walletExchange"],
      ["Telecom Self Charge", "telecomSelfCharge"],
      ["Telecom Credit Buyback", "telecomCreditBuyback"],
      ["Drawer Transfer", "drawerTransfer"],
      ["Custom Service", "customService"],
      ["Maintenance", "maintenance"],
      ["Expense", "expense"],
      ["Debt Repayment", "debtRepayment"],
      ["Credit Cash Out", "creditCashOut"],
      ["Kept Change", "keptChange"],
      ["Refund", "refund"],
      ["Client Created", "clientCreated"],
      ["Client Updated", "clientUpdated"],
      ["Client Deleted", "clientDeleted"],
      ["Financial Service", "financialService"],
      ["Recharge", "recharge"],
      ["Recharge Topup", "rechargeTopup"],
    ] as const
  ).map(([en, key]): [string, ExactTitleKey] => [norm(en), key]),
);

/** Provider names core builds titles from. Brand-only names (iPick, MTC…)
 *  are kept as they are. */
const PROVIDERS: ReadonlyMap<string, ProviderKey | null> = new Map(
  (
    [
      ["OMT System", "omtSystem"],
      ["Whish System", "whishSystem"],
      ["OMT App", "omtApp"],
      ["Whish App", "whishApp"],
      ["OMT Cash Drawer", "omtCashDrawer"],
      ["Whish Cash Drawer", "whishCashDrawer"],
      ["Financial Service", "financialService"],
      ["Recharge", "recharge"],
      ["Wallet", "wallet"],
      ["iPick", null],
      ["Katsh", null],
      ["Binance", null],
      ["MTC", null],
      ["Alfa", null],
      ["OMT", null],
      ["Whish", null],
    ] as const
  ).map(([en, key]): [string, ProviderKey | null] => [norm(en), key]),
);

/** The word core appends after the provider. Longest first, so
 *  "Credit Buy-back" wins over a shorter ending. */
const WHATS: readonly (readonly [string, WhatKey])[] = (
  [
    ["Credit Buy-back", "creditBuyBack"],
    ["Shop Line Use", "shopLineUse"],
    ["Exchange", "exchange"],
    ["Credits", "credits"],
    ["Voucher", "voucher"],
    ["Top-up", "topUp"],
    ["Send", "send"],
    ["Recv", "recv"],
    ["Bill", "bill"],
    ["Days", "days"],
    ["Gift", "gift"],
  ] as const
).map(([en, key]) => [norm(en), key] as const);

/** The catalog key for an English title, or null (then shown in English). */
export function titleKeyFor(
  title: string,
):
  | { kind: "exact"; key: ExactTitleKey }
  | { kind: "composed"; provider: string; providerKey: ProviderKey | null; what: WhatKey }
  | { kind: "provider"; providerKey: ProviderKey }
  | null {
  const n = norm(title);
  const exact = EXACT.get(n);
  if (exact) return { kind: "exact", key: exact };
  const provider = PROVIDERS.get(n);
  if (provider) return { kind: "provider", providerKey: provider };
  for (const [what, whatKey] of WHATS) {
    if (!n.endsWith(` ${what}`)) continue;
    const head = n.slice(0, n.length - what.length - 1);
    if (!PROVIDERS.has(head)) continue;
    // Keep the provider's original spelling (brand names stay as written).
    const original = title.trim().slice(0, head.length);
    return {
      kind: "composed",
      provider: original,
      providerKey: PROVIDERS.get(head) ?? null,
      what: whatKey,
    };
  }
  return null;
}

/**
 * The title in the displayed language. English (or anything not
 * recognised) comes back exactly as given.
 */
export function translateTitle(
  title: string,
  t: AuditT,
  language: string,
): string {
  if (language !== "ar") return title;
  const found = titleKeyFor(title);
  if (!found) return title;
  if (found.kind === "exact") return t(`titles.exact.${found.key}`);
  if (found.kind === "provider") return t(`titles.provider.${found.providerKey}`);
  return t("titles.pattern", {
    provider: found.providerKey
      ? t(`titles.provider.${found.providerKey}`)
      : found.provider,
    what: t(`titles.what.${found.what}`),
  });
}
