/**
 * `daysRemaining` — shared date-only day-count helper (rule 14). Lifted out
 * of `CarrierLinesPanel.tsx` (carrier-lines-validity plan Phase 4) so the
 * Recharge-tab chip's day count and the Dashboard banner's D11 boundary
 * always agree on the same arithmetic.
 */

import { daysRemaining } from "../daysRemaining";

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

describe("daysRemaining", () => {
  it("returns 0 for today's own date", () => {
    expect(daysRemaining(todayPlus(0))).toBe(0);
  });

  it("returns a positive count for a future date", () => {
    expect(daysRemaining(todayPlus(7))).toBe(7);
    expect(daysRemaining(todayPlus(30))).toBe(30);
  });

  it("returns a negative count for a past (expired) date", () => {
    expect(daysRemaining(todayPlus(-1))).toBe(-1);
    expect(daysRemaining(todayPlus(-30))).toBe(-30);
  });
});
