/**
 * LIRA-343: default money formatters for the settle calendar. Built on the
 * shared en-US number formatter (i18n guard G3: no Intl / toLocale here), so
 * amounts read the same in English and Arabic.
 */
import { formatNumber } from "@liratek/ui/i18n/format";
import type { SettleFormatters } from "./types";

const MINUS = "−";

function sign(amount: number): string {
  return amount < 0 ? MINUS : "";
}

export function defaultFormatUsd(amount: number): string {
  const n = formatNumber(Math.abs(amount), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign(amount)}$${n}`;
}

export function defaultFormatLbp(amount: number): string {
  return `${sign(amount)}${formatNumber(Math.round(Math.abs(amount)))} LBP`; // i18n-exempt: currency code
}

/**
 * Owner pick 2026-10-27 ("short numbers in colour"): the amount under a day
 * is short and UNSIGNED — the calendar colours it (red owed, green credit).
 * Each step is [unit size, suffix, decimals]; a value that rounds up to 1,000
 * of its unit moves to the next one ("999.96k" is "1m", not "1,000k").
 */
type ShortStep = readonly [size: number, suffix: string, decimals: number];

function compact(amount: number, steps: readonly ShortStep[]): string {
  const abs = Math.abs(amount);
  for (let i = 0; i < steps.length; i++) {
    const [size, suffix, decimals] = steps[i]!;
    const next = steps[i + 1];
    const factor = 10 ** decimals;
    const value = Math.round((abs / size) * factor) / factor;
    if (next && value * size >= next[0]) continue;
    return `${formatNumber(value, { maximumFractionDigits: decimals })}${suffix}`;
  }
  return "";
}

const USD_SHORT: readonly ShortStep[] = [
  [1, "", 0],
  [1_000, "k", 1],
  [1_000_000, "m", 1],
  [1_000_000_000, "B", 2],
];

const LBP_SHORT: readonly ShortStep[] = [
  [1, "", 0],
  [1_000, "k", 0],
  [1_000_000, "m", 1],
  [1_000_000_000, "B", 2],
];

/** Under a circle, unsigned: `$391`, `$6.5k`. */
export function defaultFormatUsdShort(amount: number): string {
  return `$${compact(amount, USD_SHORT)}`;
}

/** Under a circle, unsigned, number part only: `990k`, `153.2m`, `1.17B`. */
export function defaultFormatLbpShort(amount: number): string {
  return compact(amount, LBP_SHORT);
}

export const DEFAULT_SETTLE_FORMATTERS: SettleFormatters = {
  formatUsd: defaultFormatUsd,
  formatLbp: defaultFormatLbp,
  formatUsdShort: defaultFormatUsdShort,
  formatLbpShort: defaultFormatLbpShort,
};

/** "$482.00 + 1,890,000 LBP"; only the non-zero currencies; "" when both are 0. */
export function joinCurrencyAmounts(
  usd: number,
  lbp: number,
  f: Pick<SettleFormatters, "formatUsd" | "formatLbp">,
): string {
  const parts: string[] = [];
  if (Math.abs(usd) >= 0.005) parts.push(f.formatUsd(usd));
  if (Math.abs(lbp) >= 0.5) parts.push(f.formatLbp(lbp));
  return parts.join(" + ");
}
