/**
 * Custom Services' partner involvement, picked on one segmented control
 * (Customer / For Partner / Via Partner — owner decision 2026-10-16):
 *   "none" — no partner, the ordinary walk-in flow.
 *   "FOR"  — no counter payment; the full price books to the partner's tab.
 *   "VIA"  — the partner performs the service, the customer pays us now,
 *            and we owe the partner the cost.
 */
export type PartnerMode = "none" | "FOR" | "VIA";

/** What the page must reset when the mode changes. */
export interface PartnerModeTransition {
  /** Drop payment lines, return legs and kept change (FOR collects none). */
  clearPayments: boolean;
  /** Turn "Pay out" off — it is only valid under VIA. */
  clearPayout: boolean;
  /** Forget the picked partner (leaving partner mode entirely). */
  clearPartner: boolean;
}

/**
 * The side effects of moving from one partner mode to another, or `null`
 * when nothing changes. These are exactly the effects of the two checkboxes
 * the segmented control replaced: turning FOR on cleared payment state and
 * Pay out; turning VIA off cleared Pay out; turning either off cleared the
 * partner (ForPartnerToggle did that itself); switching between FOR and VIA
 * kept the partner. VIA never clears payment lines — the customer still
 * pays through the normal payment section.
 */
export function partnerModeTransition(
  from: PartnerMode,
  to: PartnerMode,
): PartnerModeTransition | null {
  if (from === to) return null;
  return {
    clearPayments: to === "FOR",
    clearPayout: to !== "VIA",
    clearPartner: to === "none",
  };
}
