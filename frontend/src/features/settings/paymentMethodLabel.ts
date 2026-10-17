import { i18n } from "@/i18n/setup";

/**
 * LIRA-331 (OD-3): the label shown for a payment method. The stored `label`
 * is what every payload, option `value` and comparison uses; only the text on
 * screen is translated. A seeded method whose label still equals its seed
 * (the English `common:payment.<CODE>` text, which is exactly what
 * create_db.sql seeds) shows that catalog entry in the display language.
 * A renamed seed, or a method the shop added, is shown as stored.
 */
const SEEDED_PAYMENT_CODES = [
  "CASH",
  "OMT",
  "WHISH",
  "BINANCE",
  "CUSTOMER_ACCOUNT",
  "GIFT_CARD",
] as const;

type SeededCode = (typeof SEEDED_PAYMENT_CODES)[number];

function isSeeded(code: string): code is SeededCode {
  return (SEEDED_PAYMENT_CODES as readonly string[]).includes(code);
}

export function paymentMethodLabel(
  code: string,
  label: string,
  /** The language shown — `i18n.language` from the caller's useTranslation. */
  language: string,
): string {
  if (!isSeeded(code)) return label;
  const seed = i18n.getFixedT("en", "common")(`payment.${code}`);
  if (label !== seed) return label;
  return i18n.getFixedT(language, "common")(`payment.${code}`);
}
