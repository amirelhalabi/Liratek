/**
 * LIRA-331 (FR-009): names that are never translated. They appear verbatim,
 * in Latin letters, in both languages, and scripts/check-i18n.mjs does not
 * count them as hard-coded English. Pure leaf.
 *
 * The guard reads this list by matching the quoted strings below, so keep
 * one name per line.
 */
export const BRAND_NAMES = [
  "LiraTek",
  "OMT",
  "Whish",
  "MTC",
  "Alfa",
  "Binance",
  "iPick",
  "Katsh",
  "IMEI",
  "USD",
  "LBP",
  "EUR",
  "USDT",
  "WhatsApp",
  "Google",
] as const;

export type BrandName = (typeof BRAND_NAMES)[number];
