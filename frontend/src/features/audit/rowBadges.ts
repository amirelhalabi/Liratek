/**
 * Small tags shown in a Transactions row's Summary cell (owner decision
 * 2026-10-16). The Status, Reverses and Ret. Credits columns were removed
 * from the table and its exports; the rare cases they showed now appear as
 * tags, and a normal active row gets none. The Details panel lists all three
 * using the same `rowStatus` / `returnedCreditsText`, so the two never
 * disagree (rule 14).
 *
 * Pure data, no JSX: `SummaryCell` renders them.
 */
import { formatNumber } from "@liratek/ui/i18n/format";
import type { TransactionRow } from "./hooks/useTransactionRows";

export type RowStatus = "VOIDED" | "REFUNDED" | "PARTLY_REFUNDED" | "ACTIVE";

export interface RowBadge {
  key: "status" | "reverses" | "credits";
  /** English text. The screen shows it in the displayed language from the
   *  row itself (`rowStatus`, `signedCreditsText`) — LIRA-331. */
  label: string;
  className: string;
}

/**
 * The removed Status cell's states, plus PARTLY_REFUNDED (owner decision
 * Q2, shop-day test 2026-10-16). A refunded ORIGINAL keeps
 * `status = "ACTIVE"` — only `reversed_by_id` marks a WHOLE refund (note
 * 21d), so checking `status` alone would miss every refunded row. A sale
 * refunded ITEM BY ITEM keeps `reversed_by_id` null too: core's `getRecent`
 * flags it `item_refunded`, with `item_refund_remaining` false once every
 * line is back (then it reads REFUNDED, not PARTLY_REFUNDED).
 */
export function rowStatus(
  row: Pick<TransactionRow, "status" | "reversed_by_id"> &
    Partial<Pick<TransactionRow, "item_refunded" | "item_refund_remaining">>,
): RowStatus {
  if (row.status === "VOIDED") return "VOIDED";
  if (row.reversed_by_id) return "REFUNDED";
  if (row.item_refunded) {
    return row.item_refund_remaining === false ? "REFUNDED" : "PARTLY_REFUNDED";
  }
  return "ACTIVE";
}

const STATUS_TEXT: Record<RowStatus, string> = {
  VOIDED: "Voided",
  REFUNDED: "Refunded",
  PARTLY_REFUNDED: "Partly refunded",
  ACTIVE: "Active",
};

/** `rowStatus` in words, for the Details panel and the export. */
export function rowStatusText(row: Parameters<typeof rowStatus>[0]): string {
  return STATUS_TEXT[rowStatus(row)];
}

/**
 * Net telecom credit returned on an Only-Days MTC/Alfa card sale (LIRA-205),
 * formatted as the removed Ret. Credits cell did: signed — a void/refund
 * carries the negated mirror — with a real minus sign before the `$`
 * (`formatAmount` would print `$-73`).
 */
export function returnedCreditsText(v: number): string {
  return `${v < 0 ? "−" : ""}$${formatNumber(Math.abs(v))}`;
}

/** The credits tag's amount, signed both ways: "+$3" / "−$2.5". */
export function signedCreditsText(v: number): string {
  return `${v > 0 ? "+" : ""}${returnedCreditsText(v)}`;
}

/** True when the row returned (or reversed) a non-zero credit amount. */
export function hasReturnedCredits(
  row: Pick<TransactionRow, "returned_credits_usd">,
): row is { returned_credits_usd: number } {
  return row.returned_credits_usd != null && row.returned_credits_usd !== 0;
}

const TAG = "text-[10px] px-1.5 py-0.5 rounded font-medium";
const STATUS_CLASS: Record<Exclude<RowStatus, "ACTIVE">, string> = {
  VOIDED: `bg-red-900/50 text-red-300 ${TAG}`,
  REFUNDED: `bg-rose-900/50 text-rose-300 ${TAG}`,
  // Lighter than REFUNDED: most of the sale still stands.
  PARTLY_REFUNDED: `bg-rose-900/30 text-rose-300/90 ${TAG}`,
};
const STATUS_TAG: Record<Exclude<RowStatus, "ACTIVE">, string> = {
  VOIDED: "VOIDED",
  REFUNDED: "REFUNDED",
  PARTLY_REFUNDED: "PARTLY REFUNDED",
};
const CHIP_CLASS = `bg-slate-700 text-slate-200 ${TAG}`;

/**
 * The transaction a void / refund reverses — ONE definition for the table's
 * "↩ #N" tag, the Details panel's Reverses fact and the export's. A whole
 * void/refund carries `reverses_id`; a sale-ITEM refund leaves it null and
 * core's `getRecent` resolves its sale as `item_refund_of_id` (shop-day test
 * 2026-10-16).
 */
export function reversedTransactionId(
  row: Pick<TransactionRow, "reverses_id"> &
    Partial<Pick<TransactionRow, "item_refund_of_id">>,
): number | null {
  return row.reverses_id ?? row.item_refund_of_id ?? null;
}

/** The row's tags, in order: status, reversal, credits. Empty for a normal
 *  active row. */
export function rowBadges(
  row: Parameters<typeof rowStatus>[0] &
    Parameters<typeof reversedTransactionId>[0] &
    Pick<TransactionRow, "returned_credits_usd">,
): RowBadge[] {
  const badges: RowBadge[] = [];
  const status = rowStatus(row);
  if (status !== "ACTIVE") {
    badges.push({
      key: "status",
      label: STATUS_TAG[status],
      className: STATUS_CLASS[status],
    });
  }
  const reverses = reversedTransactionId(row);
  if (reverses) {
    badges.push({
      key: "reverses",
      label: `↩ #${reverses}`,
      className: CHIP_CLASS,
    });
  }
  if (hasReturnedCredits(row)) {
    badges.push({
      key: "credits",
      // i18n-exempt: English text; SummaryCell shows audit:badges.creditsBack
      label: `${signedCreditsText(row.returned_credits_usd)} credits back`,
      className: CHIP_CLASS,
    });
  }
  return badges;
}
