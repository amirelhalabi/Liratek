/**
 * LIRA-338 — the providers whose MTC/Alfa cards can be charged to one of the
 * shop's OWN lines: a shop line (self-charge) or a line held for sale (the
 * LIRA-309 CARD recharge). Each is paid from that provider's LBP balance.
 *
 * Defined once (rule 14): `FinancialServiceRepository.selfChargeTelecomItem`,
 * `ResaleLineService.recharge` and the grids' "Charge to shop line" button
 * (`isSelfChargeEligible`) all read it. Pure data, browser-safe (rule 29).
 */
export const LINE_CHARGE_PROVIDERS = ["iPick", "Katsh", "WHISH_APP"] as const;

export type LineChargeProvider = (typeof LINE_CHARGE_PROVIDERS)[number];

export function isLineChargeProvider(
  provider: string | null | undefined,
): provider is LineChargeProvider {
  return (LINE_CHARGE_PROVIDERS as readonly string[]).includes(provider ?? "");
}

/** The refusal for a card from any other provider. */
export const LINE_CHARGE_PROVIDER_ERROR =
  "Pick an MTC or Alfa card from iPick, Katsh or Whish App.";
