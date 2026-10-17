/**
 * LIRA-331: the ONLY place in converted UI code that may call `Intl.*` /
 * `toLocale*` (scripts/check-i18n.mjs G3). Pure leaf: no React, no Node.
 *
 * - Numbers never depend on the language (FR-016, research R4): every number
 *   is `en-US`, so a cashier reads `1,234,567.5` in both languages. (Arabic
 *   locales print `1.234.567,5` or Arabic-Indic digits — a different amount
 *   to the eye.)
 * - Dates: `en-US` in English, `ar-LB-u-nu-latn-ca-gregory` in Arabic —
 *   Lebanese month names (OD-5), Western digits, Gregorian calendar
 *   (research R5). No `timeZone` option is ever added, so the calendar day
 *   shown is the same in both languages (FR-020). Day bucketing never uses
 *   formatted strings (rule 27).
 */
import type { Language } from "@liratek/core";

const NUMBER_LOCALE = "en-US";

const DATE_LOCALES: Record<Language, string> = {
  en: "en-US",
  ar: "ar-LB-u-nu-latn-ca-gregory",
};

/** Shown for a missing or unreadable date. */
export const EMPTY_DATE = "—";

export type DateInput = Date | string | number | null | undefined;

const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = options ? JSON.stringify(options) : "";
  let fmt = numberFormats.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(NUMBER_LOCALE, options);
    numberFormats.set(key, fmt);
  }
  return fmt;
}

/** A number, `en-US` in both languages. */
export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  return numberFormat(options).format(value);
}

/**
 * An amount with its currency marker — the same text core writes into stored
 * summaries (`formatMoneyAmount`): `$1,234` for USD, `1,234 LBP` for LBP,
 * `1,234 EUR` otherwise. Identical in both languages.
 */
export function formatMoney(
  amount: number,
  currencyCode: string,
  options?: Intl.NumberFormatOptions,
): string {
  const n = formatNumber(amount, options);
  if (currencyCode === "USD") return `$${n}`;
  return `${n} ${currencyCode}`;
}

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dateFormat(
  lang: Language,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(DATE_LOCALES[lang] ?? DATE_LOCALES.en, options);
}

const DATE_DEFAULT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
};

const TIME_DEFAULT: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
};

/** A calendar date in the given language (default `Jan 15, 2026`). */
export function formatDate(
  value: DateInput,
  lang: Language,
  options: Intl.DateTimeFormatOptions = DATE_DEFAULT,
): string {
  const d = toDate(value);
  return d ? dateFormat(lang, options).format(d) : EMPTY_DATE;
}

/** A clock time in the given language (default `2:05 PM`). */
export function formatTime(
  value: DateInput,
  lang: Language,
  options: Intl.DateTimeFormatOptions = TIME_DEFAULT,
): string {
  const d = toDate(value);
  return d ? dateFormat(lang, options).format(d) : EMPTY_DATE;
}

/** Date and time in the given language. */
export function formatDateTime(
  value: DateInput,
  lang: Language,
  options: Intl.DateTimeFormatOptions = { ...DATE_DEFAULT, ...TIME_DEFAULT },
): string {
  const d = toDate(value);
  return d ? dateFormat(lang, options).format(d) : EMPTY_DATE;
}
