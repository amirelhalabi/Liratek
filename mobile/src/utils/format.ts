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

/**
 * Short LBP for the list row, where every amount ends in ",000": 200,000 →
 * "200k", 4,590,000 → "4.59M". Rounded for display only; the details sheet
 * shows the exact figure.
 */
export function compactLbp(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  const trim = (n: number, digits: number) => String(Number(n.toFixed(digits)));
  if (abs >= 1_000_000) return `${sign}${trim(abs / 1_000_000, 2)}M LBP`;
  if (abs >= 1_000) return `${sign}${trim(abs / 1_000, 1)}k LBP`;
  return `${sign}${abs.toLocaleString()} LBP`;
}
