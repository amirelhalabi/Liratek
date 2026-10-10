import { formatMoneyAmount } from "@liratek/core/utils/formatMoney";
import { MAIN_DRAWER_CURRENCIES, visibleDrawerCurrencies } from "@liratek/core/utils/visibleDrawerCurrencies";

/** Display helpers shared by Home and Activity (one copy each, rule 14). */

export function drawerLabel(name: string): string {
  return name.replace(/_/g, " ");
}

/** Which currencies to show: core's shared rule, same as the web Dashboard. */
export function drawerAmounts(byCurrency: Record<string, number>): string {
  const visible = visibleDrawerCurrencies(byCurrency);
  const order = (c: string) => {
    const i = MAIN_DRAWER_CURRENCIES.indexOf(c);
    return i === -1 ? MAIN_DRAWER_CURRENCIES.length : i;
  };
  return (
    Object.keys(visible)
      .sort((a, b) => order(a) - order(b) || a.localeCompare(b))
      .map((c) => formatMoneyAmount(visible[c] ?? 0, c))
      .join("  ·  ") || "—"
  );
}

export function txnAmount(t: { amount_usd: number; amount_lbp: number }): string {
  const parts: string[] = [];
  if (t.amount_usd) parts.push(formatMoneyAmount(t.amount_usd, "USD"));
  if (t.amount_lbp) parts.push(formatMoneyAmount(t.amount_lbp, "LBP"));
  return parts.join(" · ") || "—";
}

export function txnTime(iso: string): string {
  // Stored as UTC in either `YYYY-MM-DD HH:MM:SS` or ISO `…Z` form (LIRA-289 research R2).
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
