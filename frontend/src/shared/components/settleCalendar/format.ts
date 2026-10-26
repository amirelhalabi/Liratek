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

export function defaultFormatUsdShort(amount: number): string {
  const abs = Math.abs(amount);
  const whole = Math.abs(abs - Math.round(abs)) < 0.005;
  const n = whole
    ? formatNumber(Math.round(abs))
    : formatNumber(abs, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign(amount)}$${n}`;
}

export function defaultFormatLbpShort(amount: number): string {
  const abs = Math.round(Math.abs(amount));
  let body: string;
  if (abs < 1000) body = formatNumber(abs);
  else if (abs < 1_000_000) body = `${formatNumber(Math.round(abs / 1000))}k`;
  else body = `${formatNumber(abs / 1_000_000, { maximumFractionDigits: 2 })}m`;
  return `${sign(amount)}${body}`;
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
