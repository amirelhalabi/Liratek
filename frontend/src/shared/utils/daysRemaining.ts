/**
 * Days remaining until a stored `YYYY-MM-DD` calendar date, computed
 * date-only — neither side carries a time-of-day component, so there is no
 * timezone drift between "today" and the stored expiry. Negative means the
 * date has already passed.
 *
 * Single definition (rule 14): originally lived only inside
 * `CarrierLinesPanel.tsx` (the Recharge-tab per-line chip's ≤3-day amber /
 * expired-red colouring). The Dashboard's carrier-line expiry banner
 * (carrier-lines-validity plan Phase 4, D11's ≤7-day-or-expired boundary)
 * needs the exact same date arithmetic, so it is lifted here rather than
 * re-implemented — both call sites must agree on what "N days left" means.
 */
export function daysRemaining(dateStr: string): number {
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const [ey, em, ed] = dateStr.split("-").map(Number);
  const expiry = Date.UTC(ey, em - 1, ed);
  return Math.round((expiry - today) / 86_400_000);
}
