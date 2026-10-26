import type { PaymentMethod } from "@liratek/ui";

/**
 * The payment methods a partner settlement leg may use. CLIENT_ACCOUNT
 * settles no money (partner_ledger.settlement_method CHECK constraint keeps
 * it legacy-field-only) and can never appear as a split-leg method (the
 * partner settle schemas reject it outright).
 *
 * Labels are resolved at render time; the codes are the wire values.
 * OMT / Whish / Binance are brand names. ONE list for every partner money
 * screen (rule 14).
 */
export function partnerLegMethods(cashLabel: string): PaymentMethod[] {
  return [
    { code: "CASH", label: cashLabel },
    { code: "OMT", label: "OMT" }, // i18n-exempt: brand name
    { code: "WHISH", label: "Whish" }, // i18n-exempt: brand name
    { code: "BINANCE", label: "Binance" }, // i18n-exempt: brand name
  ];
}
