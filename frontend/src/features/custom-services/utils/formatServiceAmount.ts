/**
 * LIRA-185 — the ONE dual-currency formatter for the Services page (form
 * preview, Today's cards, history table). It replaces three identical local
 * copies whose `usd > 0` / `lbp > 0` guards dropped every negative part, so
 * a service sold at a loss read "$0.00" while the Profits page showed the
 * loss. Every NON-ZERO part is shown, with its sign; an all-zero amount
 * reads "$0.00", unchanged.
 */
export function formatServiceAmount(usd: number, lbp: number): string {
  const parts: string[] = [];
  if (usd !== 0) {
    parts.push(`${usd < 0 ? "-" : ""}$${Math.abs(usd).toFixed(2)}`);
  }
  if (lbp !== 0) parts.push(`${lbp.toLocaleString()} LBP`);
  return parts.join(" + ") || "$0.00";
}
