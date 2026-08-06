/**
 * `computeCarrierLineAlerts` (carrier-lines-validity plan Phase 4, D11 + D4)
 * — the Dashboard's carrier-line expiry / missing-line banner.
 *
 * The highest-stakes piece of this phase: D11's boundary is "<= 7 days or
 * already expired" — get the comparison operator wrong by one and the
 * banner either fires a day early/late or never clears. Exercised directly
 * against the boundary values the plan's own test matrix names (7 / 8 /
 * expired), plus D4's "carrier enabled with zero active lines" nudge.
 */

import { computeCarrierLineAlerts } from "../carrierLineAlerts";
import type { CarrierLineEntity } from "@liratek/ui";

function makeLine(overrides: Partial<CarrierLineEntity>): CarrierLineEntity {
  return {
    id: 1,
    carrier: "mtc",
    phone_number: "03111111",
    label: "Shop Line 1",
    credits: 10,
    validity_expires_at: null,
    notes: null,
    is_active: 1,
    is_primary: 1,
    created_at: "2026-08-01 00:00:00",
    updated_at: "2026-08-01 00:00:00",
    ...overrides,
  };
}

/** `YYYY-MM-DD` for "today plus N days", matching the module's own local
 *  calendar-day arithmetic (see `shared/utils/daysRemaining.ts`). */
function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

describe("computeCarrierLineAlerts", () => {
  it("returns nothing when the recharge module is disabled, regardless of the lines", () => {
    const lines = [makeLine({ carrier: "mtc" })]; // zero Alfa lines too
    expect(computeCarrierLineAlerts(lines, false)).toEqual([]);
  });

  it("D4: an enabled carrier with zero active lines gets a 'missing' alert", () => {
    const lines = [makeLine({ carrier: "mtc", validity_expires_at: null })];
    const alerts = computeCarrierLineAlerts(lines, true);
    expect(alerts).toContainEqual({ kind: "missing", carrier: "alfa" });
    expect(alerts).not.toContainEqual(
      expect.objectContaining({ kind: "missing", carrier: "mtc" }),
    );
  });

  it("D11 boundary: exactly 7 days remaining fires, 8 does not", () => {
    const sevenDays = [
      makeLine({
        id: 1,
        carrier: "mtc",
        validity_expires_at: todayPlus(7),
      }),
    ];
    const eightDays = [
      makeLine({
        id: 2,
        carrier: "mtc",
        validity_expires_at: todayPlus(8),
      }),
    ];

    const sevenAlerts = computeCarrierLineAlerts(sevenDays, true).filter(
      (a) => a.kind === "expiring",
    );
    const eightAlerts = computeCarrierLineAlerts(eightDays, true).filter(
      (a) => a.kind === "expiring",
    );

    expect(sevenAlerts).toHaveLength(1);
    expect(sevenAlerts[0]).toMatchObject({ carrier: "mtc", daysLeft: 7 });
    expect(eightAlerts).toHaveLength(0);
  });

  it("D11: an already-expired line always fires, regardless of how long ago", () => {
    const lines = [
      makeLine({ carrier: "alfa", validity_expires_at: todayPlus(-30) }),
    ];
    const alerts = computeCarrierLineAlerts(lines, true).filter(
      (a) => a.kind === "expiring",
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ carrier: "alfa", daysLeft: -30 });
  });

  it("a line with no validity_expires_at set is never flagged as expiring", () => {
    const lines = [makeLine({ carrier: "mtc", validity_expires_at: null })];
    const alerts = computeCarrierLineAlerts(lines, true);
    expect(alerts).not.toContainEqual(
      expect.objectContaining({ kind: "expiring" }),
    );
  });

  it("reports both an expiring MTC line and a missing Alfa line together", () => {
    const lines = [
      makeLine({ id: 1, carrier: "mtc", validity_expires_at: todayPlus(2) }),
    ];
    const alerts = computeCarrierLineAlerts(lines, true);
    expect(alerts).toHaveLength(2);
    expect(alerts).toContainEqual(
      expect.objectContaining({
        kind: "expiring",
        carrier: "mtc",
        daysLeft: 2,
      }),
    );
    expect(alerts).toContainEqual({ kind: "missing", carrier: "alfa" });
  });
});
