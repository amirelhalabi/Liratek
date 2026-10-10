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

/** Stored as UTC in either `YYYY-MM-DD HH:MM:SS` or ISO `…Z` form (LIRA-289 research R2). */
export function parseTxnDate(iso: string): Date {
  return new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
}

export function txnTime(iso: string): string {
  const d = parseTxnDate(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Clock time only ("14:32"), for a row that already sits under its day header. */
export function txnClock(iso: string): string {
  const d = parseTxnDate(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Full date and time for the details sheet ("Wed, 8 Oct 2026, 14:32"). */
export function txnFullDate(iso: string): string {
  const d = parseTxnDate(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString([], { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Day key on the PHONE's calendar (rule 27): the stored time is UTC, so a
 * 01:30 Beirut sale has yesterday's UTC date. Never slice the stored string.
 */
export function txnDayKey(iso: string): string {
  const d = parseTxnDate(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return localDayKey(d);
}

function localDayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Day header: "Today", "Yesterday", or "Wed 8 Oct" (year added when not this year). */
export function dayHeader(dayKey: string, now: Date = new Date()): string {
  if (dayKey === localDayKey(now)) return "Today";
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (dayKey === localDayKey(y)) return "Yesterday";
  const [yy, mm, dd] = dayKey.split("-").map(Number);
  if (!yy || !mm || !dd) return dayKey;
  const d = new Date(yy, mm - 1, dd);
  return d.toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(yy === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** One amount for the list row: USD when set, otherwise LBP. Both go in the details sheet. */
export function txnMainAmount(t: { amount_usd: number; amount_lbp: number }): string {
  if (t.amount_usd) return formatMoneyAmount(t.amount_usd, "USD");
  if (t.amount_lbp) return formatMoneyAmount(t.amount_lbp, "LBP");
  return "—";
}
