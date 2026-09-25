/**
 * NOT RUN — proven at the end-of-batch gate (the #28 describe block only;
 * everything above it was already green before this batch).
 *
 * `computeCarrierLineAlerts` (carrier-lines-validity plan Phase 4, D11 + D4)
 * — the Dashboard's carrier-line expiry / missing-line banner.
 *
 * The highest-stakes piece of this phase: D11's boundary is "<= 7 days or
 * already expired" — get the comparison operator wrong by one and the
 * banner either fires a day early/late or never clears. Exercised directly
 * against the boundary values the plan's own test matrix names (7 / 8 /
 * expired), plus D4's "carrier enabled with zero active lines" nudge.
 */

import {
  computeCarrierLineAlerts,
  carrierLineAlertText,
} from "../carrierLineAlerts";
import type { CarrierLineEntity } from "@liratek/ui";

function makeLine(overrides: Partial<CarrierLineEntity>): CarrierLineEntity {
  return {
    id: 1,
    carrier: "mtc",
    phone_number: "03111111",
    label: "Shop Line 1",
    credits: 10,
    validity_expires_at: null,
    days_owed: 0,
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

describe("computeCarrierLineAlerts — sold-ahead days (#28, LIRA-218)", () => {
  it("a line carrying days_owed gets a red 'sold-ahead' alert", () => {
    const lines = [
      makeLine({
        carrier: "mtc",
        validity_expires_at: todayPlus(0),
        days_owed: 210,
      }),
    ];
    const alerts = computeCarrierLineAlerts(lines, true);
    expect(alerts).toContainEqual(
      expect.objectContaining({
        kind: "sold-ahead",
        carrier: "mtc",
        daysOwed: 210,
      }),
    );
  });

  it("a line with no sold-ahead balance never gets the alert", () => {
    const lines = [
      makeLine({ carrier: "mtc", validity_expires_at: todayPlus(30) }),
    ];
    const alerts = computeCarrierLineAlerts(lines, true);
    expect(alerts).not.toContainEqual(
      expect.objectContaining({ kind: "sold-ahead" }),
    );
  });

  it("a sold-ahead line pinned at today ALSO fires the ordinary 'expiring' alert for the same 0-day reading — both are reported, as distinct kinds (m7 fix)", () => {
    const lines = [
      makeLine({
        carrier: "mtc",
        validity_expires_at: todayPlus(0),
        days_owed: 210,
      }),
    ];
    const alerts = computeCarrierLineAlerts(lines, true);
    const soldAhead = alerts.filter((a) => a.kind === "sold-ahead");
    const expiring = alerts.filter((a) => a.kind === "expiring");
    expect(soldAhead).toHaveLength(1);
    // A pinned-at-today line IS within the 7-day window too — both alerts
    // are legitimate and both must be present, never collapsed into one.
    expect(expiring).toHaveLength(1);
  });

  it("carrierLineAlertText names the sold-ahead count and says to recharge", () => {
    const text = carrierLineAlertText({
      kind: "sold-ahead",
      carrier: "mtc",
      lineLabel: "Shop Line 1",
      daysOwed: 210,
      deadlineDays: 3,
    });
    expect(text).toContain("210");
    expect(text).toMatch(/recharge/i);
  });

  // M6 fix (2026-09-24 adversarial review): the owner's example is "recharge
  // within 5 days" — a concrete deadline, not just "recharge to deliver
  // them". Per CLAUDE.md rule 17, `deadlineDays` did not exist pre-fix, so
  // these fail against the pre-fix type/text.

  it("M6: carrierLineAlertText names a concrete day-count deadline when one remains", () => {
    const text = carrierLineAlertText({
      kind: "sold-ahead",
      carrier: "mtc",
      lineLabel: "Shop Line 1",
      daysOwed: 210,
      deadlineDays: 5,
    });
    expect(text).toMatch(/within 5d/i);
  });

  it("M6: carrierLineAlertText says to recharge NOW once the deadline has already passed (deadlineDays 0)", () => {
    const text = carrierLineAlertText({
      kind: "sold-ahead",
      carrier: "mtc",
      lineLabel: "Shop Line 1",
      daysOwed: 210,
      deadlineDays: 0,
    });
    expect(text).toMatch(/now/i);
  });

  it("M6: a freshly pinned sold-ahead line (0 lapse) gets the full grace window as its deadline", () => {
    const lines = [
      makeLine({
        carrier: "mtc",
        validity_expires_at: todayPlus(0),
        days_owed: 210,
      }),
    ];
    const alerts = computeCarrierLineAlerts(lines, true);
    const soldAhead = alerts.find((a) => a.kind === "sold-ahead");
    expect(soldAhead).toBeDefined();
    if (soldAhead?.kind === "sold-ahead") {
      expect(soldAhead.deadlineDays).toBe(5); // LINE_REVIVAL_GRACE_DAYS
    }
  });

  it("M6: a sold-ahead line 3 days into its grace window has 2 days left on the deadline", () => {
    const lines = [
      makeLine({
        carrier: "mtc",
        validity_expires_at: todayPlus(-3),
        days_owed: 210,
      }),
    ];
    const alerts = computeCarrierLineAlerts(lines, true);
    const soldAhead = alerts.find((a) => a.kind === "sold-ahead");
    expect(soldAhead).toBeDefined();
    if (soldAhead?.kind === "sold-ahead") {
      expect(soldAhead.deadlineDays).toBe(2);
    }
  });
});
