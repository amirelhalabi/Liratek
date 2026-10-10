import type { TransactionPaymentLeg } from "@liratek/core/repositories/TransactionRepository";
import {
  formatLegAmount,
  formatPaymentLegs,
  getRowCashFlowDirection,
  type CashFlowDirection,
} from "@liratek/core/utils/cashFlow";
import { formatMoneyAmount } from "@liratek/core/utils/formatMoney";
import { formatCashMoney } from "@liratek/core/utils/transactionText";
import {
  billsOnlyCommissionAmount,
  cashLegsFor,
  cashMovementLine,
  checkpointPhysicalTotals,
  displayAmountFields,
  fallbackMethodLabel,
  formatCheckpointAmounts,
  isProviderBalanceInflow,
  methodLegsFor,
  sessionPooledCashLegsFor,
  sessionReversalLine,
} from "@liratek/core/utils/transactionRowDisplay";

import type { RecentTransaction } from "@/api/reads";
import { compactLbp } from "@/utils/format";

/**
 * How an Activity row describes its money. Every rule comes from core's
 * shared helpers, so the phone reads a row exactly like the web
 * Transactions page; only the formatting is phone-sized (LBP shortened).
 */

/** A voided or refunded row: still listed, but muted with its amount struck through. */
export function isInactiveTxn(x: { status?: string }): boolean {
  return !!x.status && x.status !== "ACTIVE";
}

/** List-row money: "$115", "200k LBP". */
export function shortMoney(amount: number, currency: string): string {
  return currency === "LBP"
    ? compactLbp(amount)
    : formatMoneyAmount(amount, currency);
}

const shortLeg = (leg: TransactionPaymentLeg) =>
  shortMoney(leg.amount, leg.currency_code);

/**
 * The cash arrow (same rule as the web badge): in / out / both, "credit" when
 * the money landed in a provider balance rather than a till (amber + on the
 * web), or null when no cash moved.
 */
export function txnDirection(
  x: RecentTransaction,
): CashFlowDirection | "credit" | null {
  if (isProviderBalanceInflow(x)) return "credit";
  return getRowCashFlowDirection({
    type: x.type,
    metadata_json: x.metadata_json,
    amount_usd: x.amount_usd,
    amount_lbp: x.amount_lbp,
    reverses_id: x.reverses_id ?? null,
    payments: x.payments,
  });
}

/**
 * The amount the web shows: a sale's value (not the cash handed over), a
 * bills-only settlement's commission, a checkpoint's counted totals.
 * Magnitude only — the arrow carries the direction.
 */
export function txnDisplayAmount(x: RecentTransaction): {
  usd: number;
  lbp: number;
} {
  const v =
    x.type === "CHECKPOINT"
      ? (checkpointPhysicalTotals(x.metadata_json) ?? {
          usd: x.amount_usd,
          lbp: x.amount_lbp,
        })
      : (billsOnlyCommissionAmount(x) ?? displayAmountFields(x));
  return { usd: Math.abs(v.usd), lbp: Math.abs(v.lbp) };
}

export function formatAmounts(
  a: { usd: number; lbp: number },
  short: boolean,
): string {
  const fmt = short ? shortMoney : formatMoneyAmount;
  const parts: string[] = [];
  if (a.usd) parts.push(fmt(a.usd, "USD"));
  if (a.lbp) parts.push(fmt(a.lbp, "LBP"));
  return parts.join(" · ") || "—";
}

/** The rate the customer paid at ("@ 89,000"), unless the row moves nothing. */
export function txnRate(x: RecentTransaction): string | null {
  const rate = x.display_exchange_rate ?? x.exchange_rate;
  const legs = cashLegsFor(x);
  if (!rate || (legs.length === 0 && !x.amount_usd && !x.amount_lbp))
    return null;
  return `@ ${Math.round(rate).toLocaleString()}`;
}

/**
 * The cash line, as the web words it: "paid $20 · change $6" for a sale, its
 * void or a refund; "in: … · out: …" for everything else. Own legs only.
 */
export function txnCashLine(x: RecentTransaction, short = true): string | null {
  if (x.type === "CHECKPOINT") return null;
  const money = short ? shortMoney : formatCashMoney;
  return (
    cashMovementLine(x, money) ??
    formatPaymentLegs(cashLegsFor(x), short ? shortLeg : formatLegAmount)
  );
}

/** List row line 2: cash line · rate · "on account" when the customer's account was charged or credited. */
export function txnRowDetail(x: RecentTransaction): string {
  const parts = [txnCashLine(x), txnRate(x)];
  if ((x.account_payments?.length ?? 0) > 0) parts.push("on account");
  return parts.filter(Boolean).join(" · ");
}

/** The basket's pooled line for its header row: "Session: in: $134", plus a whole-basket reversal. */
export function sessionLines(x: RecentTransaction, short = true): string[] {
  const pooled = sessionPooledCashLegsFor(x);
  const lines: string[] = [];
  const legs = formatPaymentLegs(
    pooled.filter((l) => !l.reversal),
    short ? shortLeg : formatLegAmount,
  );
  if (legs) lines.push(`Session: ${legs}`);
  const reversal = sessionReversalLine(
    pooled,
    short ? shortMoney : formatCashMoney,
  );
  if (reversal) lines.push(reversal);
  return lines;
}

// Short names for the system payment methods (seeded in every shop); any
// other code falls back to core's title-casing ("GIFT_CARD" → "Gift Card").
const METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  OMT: "OMT Wallet",
  WHISH: "Whish Wallet",
  BINANCE: "Binance",
  CUSTOMER_ACCOUNT: "Customer Account",
  GIFT_CARD: "Gift Card",
};

export function methodLabel(code: string): string {
  return METHOD_LABELS[code] ?? fallbackMethodLabel(code);
}

/**
 * The sheet's per-leg payment detail (the web's "▸ payment detail"):
 * "Cash · General  $115" — method, drawer, exact amount, grouped by side.
 */
export function paymentDetail(
  x: RecentTransaction,
): { side: "in" | "out"; text: string }[] {
  return methodLegsFor(x).map((l) => ({
    side: l.direction,
    text: `${methodLabel(l.method)}${l.drawer_name ? ` · ${l.drawer_name.replace(/_/g, " ")}` : ""}  ${formatLegAmount(l)}`,
  }));
}

export { formatCheckpointAmounts };
