/**
 * LIRA-309 — the status a phone line shows (Phone Lines page, Dashboard and
 * bell alerts), for both kinds of line. Pins the owner's rule (2026-10-11):
 * a for-sale line warns 3 days before expiry, a shop line keeps its 7-day
 * warning, both turn red inside the 5-day revival grace and are lost after.
 */
import {
  classifyLineStatus,
  RESALE_LINE_EXPIRY_WARNING_DAYS,
  SHOP_LINE_EXPIRY_WARNING_DAYS,
} from "../lineStatus.js";

const TODAY = "2026-10-11";

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe("classifyLineStatus — for-sale line (3-day window)", () => {
  const w = RESALE_LINE_EXPIRY_WARNING_DAYS;

  it("uses a 3-day window", () => {
    expect(w).toBe(3);
  });

  it.each([
    [4, "OK"],
    [3, "EXPIRING"],
    [0, "EXPIRING"],
    [-1, "IN_GRACE"],
    [-5, "IN_GRACE"],
    [-6, "LOST"],
  ])("expiry in %i days → %s", (d, status) => {
    expect(classifyLineStatus(addDays(TODAY, d), TODAY, w).status).toBe(
      status,
    );
  });

  it("reports days left while valid", () => {
    expect(classifyLineStatus(addDays(TODAY, 2), TODAY, w).daysLeft).toBe(2);
  });

  it("reports days left to save the line during grace", () => {
    expect(
      classifyLineStatus(addDays(TODAY, -1), TODAY, w).daysToSave,
    ).toBe(4);
    expect(
      classifyLineStatus(addDays(TODAY, -2), TODAY, w).daysToSave,
    ).toBe(3);
    expect(
      classifyLineStatus(addDays(TODAY, -5), TODAY, w).daysToSave,
    ).toBe(0);
  });

  it("no expiry recorded → NO_EXPIRY", () => {
    expect(classifyLineStatus(null, TODAY, w).status).toBe("NO_EXPIRY");
    expect(classifyLineStatus(undefined, TODAY, w).status).toBe("NO_EXPIRY");
    expect(classifyLineStatus("", TODAY, w).status).toBe("NO_EXPIRY");
  });
});

describe("classifyLineStatus — shop line (7-day window, unchanged)", () => {
  const w = SHOP_LINE_EXPIRY_WARNING_DAYS;

  it("uses a 7-day window", () => {
    expect(w).toBe(7);
  });

  it.each([
    [8, "OK"],
    [7, "EXPIRING"],
    [-3, "IN_GRACE"],
    [-6, "LOST"],
  ])("expiry in %i days → %s", (d, status) => {
    expect(classifyLineStatus(addDays(TODAY, d), TODAY, w).status).toBe(
      status,
    );
  });
});
