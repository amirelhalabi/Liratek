/**
 * LIRA-332 (FR-007) — the "contact us to activate" WhatsApp link, built in
 * ONE place for the web banner and the phone strip (rule 14).
 *
 * Same number and `wa.me/<number>?text=` format as `landing/wa.html`.
 *
 * ⚠ Pure leaf: reachable from `browser.ts` and imported by the phone app.
 * No `db/`, logger or Node built-in (rule 29).
 */

export const LIRATEK_WHATSAPP_NUMBER = "96181077357";

export interface ActivationLinkInput {
  shopName?: string | null;
  /** The shop's web address, e.g. `abouali.liratek.shop`. */
  shopAddress?: string | null;
}

/** "Hi LiraTek, I'd like to activate my shop {name} ({address})." */
export function activationMessage(input: ActivationLinkInput): string {
  const name = input.shopName?.trim();
  const address = input.shopAddress?.trim();
  let text = "Hi LiraTek, I'd like to activate my shop";
  if (name) text += ` ${name}`;
  if (address) text += ` (${address})`;
  return `${text}.`;
}

export function buildActivationWhatsAppUrl(input: ActivationLinkInput): string {
  return `https://wa.me/${LIRATEK_WHATSAPP_NUMBER}?text=${encodeURIComponent(
    activationMessage(input),
  )}`;
}
