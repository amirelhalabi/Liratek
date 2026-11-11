/**
 * LIRA-388 — the opposite entry a bookkeeping row's "Refund" will write,
 * in words, for its one-line confirm ("Write the opposite entry: −$500 …?").
 * Derived from the row's OWN stored figures (never retyped): the amounts
 * negated, in the row's own currencies, plus the row's summary.
 */
import { formatMoney } from "@liratek/ui/i18n/format";

export interface OppositeEntryRow {
  amount_usd: number;
  amount_lbp: number;
  summary?: string | null;
}

const signed = (n: number, currency: "USD" | "LBP"): string =>
  `${n > 0 ? "+" : "−"}${formatMoney(Math.abs(n), currency, {
    maximumFractionDigits: currency === "USD" ? 2 : 0,
  })}`;

export function oppositeEntryText(row: OppositeEntryRow): string {
  const parts: string[] = [];
  if (row.amount_usd) parts.push(signed(-row.amount_usd, "USD"));
  if (row.amount_lbp) parts.push(signed(-row.amount_lbp, "LBP"));
  const what = row.summary?.trim() ?? "";
  if (parts.length === 0) return what;
  return what ? `${parts.join(" / ")} — ${what}` : parts.join(" / ");
}
