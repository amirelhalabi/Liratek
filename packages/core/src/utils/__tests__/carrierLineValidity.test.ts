/**
 * LIRA-157 — the carrier-line validity rule, unit-tested as pure logic.
 *
 * These tests pin the OWNER-STATED rule (interview 2026-08-29), not the
 * implementation: a charge stacks on a live line, starts from today inside the
 * 5-day grace window, is refused past it, and is clipped at 365 days.
 *
 * Every case injects `today` explicitly rather than leaning on the clock, so
 * the suite cannot go green-then-red as the calendar moves, and month/year
 * rollovers are asserted on real boundaries instead of whatever today happens
 * to be. `addDays` below is deliberately re-implemented rather than imported —
 * importing the production helper would only assert that it agrees with itself.
 */

import {
  LINE_REVIVAL_GRACE_DAYS,
  MAX_LINE_VALIDITY_DAYS,
  burnedLineMessage,
  classifyLineValidity,
  projectValidityExpiry,
} from "../carrierLineValidity.js";

const TODAY = "2026-08-29";

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const mm = (dt.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = dt.getUTCDate().toString().padStart(2, "0");
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

describe("constants match what the owner stated", () => {
  it("a line holds at most one year of validity", () => {
    expect(MAX_LINE_VALIDITY_DAYS).toBe(365);
  });

  it("a lapsed line stays revivable for five days", () => {
    expect(LINE_REVIVAL_GRACE_DAYS).toBe(5);
  });
});

describe("classifyLineValidity", () => {
  it("a line with no expiry recorded is NO_EXPIRY", () => {
    expect(classifyLineValidity(null, TODAY)).toEqual({
      state: "NO_EXPIRY",
      lapseDays: 0,
      daysRemaining: 0,
    });
    expect(classifyLineValidity(undefined, TODAY).state).toBe("NO_EXPIRY");
  });

  it("an expiry in the future is VALID, with the days left", () => {
    expect(classifyLineValidity(addDays(TODAY, 30), TODAY)).toEqual({
      state: "VALID",
      lapseDays: 0,
      daysRemaining: 30,
    });
  });

  it("an expiry of TODAY is still VALID (the line dies at end of day)", () => {
    expect(classifyLineValidity(TODAY, TODAY)).toEqual({
      state: "VALID",
      lapseDays: 0,
      daysRemaining: 0,
    });
  });

  // The grace boundary: 5 is in, 6 is out. Asserted on both sides so an
  // off-by-one in the comparison cannot pass.
  it("lapsed by 1..5 days is GRACE", () => {
    for (const lapse of [1, 2, 3, 4, 5]) {
      const c = classifyLineValidity(addDays(TODAY, -lapse), TODAY);
      expect([lapse, c.state]).toEqual([lapse, "GRACE"]);
      expect(c.lapseDays).toBe(lapse);
      expect(c.daysRemaining).toBe(-lapse);
    }
  });

  it("lapsed by 6 days is already BURNED", () => {
    const c = classifyLineValidity(addDays(TODAY, -6), TODAY);
    expect(c.state).toBe("BURNED");
    expect(c.lapseDays).toBe(6);
  });

  it("the owner's 22-day lapse is BURNED", () => {
    expect(classifyLineValidity(addDays(TODAY, -22), TODAY).state).toBe(
      "BURNED",
    );
  });
});

describe("projectValidityExpiry — charging (positive delta)", () => {
  // ── The owner's own two reported cases ────────────────────────────────────

  it("OWNER CASE: a line with 30 days left, charged with a 365-day card, caps at 365 — not 395", () => {
    const p = projectValidityExpiry(addDays(TODAY, 30), 365, TODAY);
    expect(p.expiry).toBe(addDays(TODAY, 365));
    expect(p.capped).toBe(true);
    expect(p.daysLostToCap).toBe(30);
    expect(p.burned).toBe(false);
  });

  it("OWNER CASE: a line lapsed 22 days is burned — the charge is refused, not rebased", () => {
    const p = projectValidityExpiry(addDays(TODAY, -22), 30, TODAY);
    expect(p.burned).toBe(true);
    expect(p.expiry).toBeNull();
    expect(p.state).toBe("BURNED");
    expect(p.lapseDays).toBe(22);
  });

  // ── Stacking (D6.3) ──────────────────────────────────────────────────────

  it("a live line STACKS: 30 days left + a 30-day card = 60 days", () => {
    const p = projectValidityExpiry(addDays(TODAY, 30), 30, TODAY);
    expect(p.expiry).toBe(addDays(TODAY, 60));
    expect(p.capped).toBe(false);
  });

  it("stacking anchors on the line's own expiry, not today", () => {
    // If this rebased onto today the answer would be TODAY+10, not +70.
    const p = projectValidityExpiry(addDays(TODAY, 60), 10, TODAY);
    expect(p.expiry).toBe(addDays(TODAY, 70));
  });

  // ── Grace (D6.2) ─────────────────────────────────────────────────────────

  it("inside the grace window the days start from TODAY, the lapse is forgiven", () => {
    // Lapsed 3 days, +30 → 30 days from today (NOT 27 — the lapse is not
    // deducted; NOT 33 — it does not stack onto a past date either).
    const p = projectValidityExpiry(addDays(TODAY, -3), 30, TODAY);
    expect(p.expiry).toBe(addDays(TODAY, 30));
    expect(p.state).toBe("GRACE");
    expect(p.burned).toBe(false);
  });

  it("the grace window is inclusive at exactly 5 days", () => {
    const p = projectValidityExpiry(addDays(TODAY, -5), 30, TODAY);
    expect(p.burned).toBe(false);
    expect(p.expiry).toBe(addDays(TODAY, 30));
  });

  it("one day past the window, the same charge is refused", () => {
    expect(projectValidityExpiry(addDays(TODAY, -6), 30, TODAY).burned).toBe(
      true,
    );
  });

  // ── No expiry ────────────────────────────────────────────────────────────

  it("a line with no expiry at all charges from today", () => {
    expect(projectValidityExpiry(null, 30, TODAY).expiry).toBe(
      addDays(TODAY, 30),
    );
  });

  // ── The ceiling ──────────────────────────────────────────────────────────

  it("exactly 365 days from today is NOT capped (the boundary is inclusive)", () => {
    const p = projectValidityExpiry(null, 365, TODAY);
    expect(p.expiry).toBe(addDays(TODAY, 365));
    expect(p.capped).toBe(false);
    expect(p.daysLostToCap).toBe(0);
  });

  it("366 days from today IS capped, by exactly one day", () => {
    const p = projectValidityExpiry(null, 366, TODAY);
    expect(p.expiry).toBe(addDays(TODAY, 365));
    expect(p.capped).toBe(true);
    expect(p.daysLostToCap).toBe(1);
  });

  it("a line already AT the ceiling gains nothing from another card", () => {
    const p = projectValidityExpiry(addDays(TODAY, 365), 30, TODAY);
    expect(p.expiry).toBe(addDays(TODAY, 365));
    expect(p.capped).toBe(true);
    expect(p.daysLostToCap).toBe(30);
  });

  it("a line stored BEYOND the ceiling is pulled back to it by any charge", () => {
    // Legacy/hand-entered data can hold an impossible date. A charge is the
    // moment the rule applies, so it clips rather than extending further.
    const p = projectValidityExpiry("2099-01-01", 30, TODAY);
    expect(p.expiry).toBe(addDays(TODAY, 365));
    expect(p.capped).toBe(true);
  });
});

describe("projectValidityExpiry — selling days (negative delta)", () => {
  it("subtracts from the line's OWN expiry", () => {
    const p = projectValidityExpiry(addDays(TODAY, 30), -10, TODAY);
    expect(p.expiry).toBe(addDays(TODAY, 20));
    expect(p.burned).toBe(false);
  });

  it("a burned line is NOT refused — consumption is a record, not a revival", () => {
    // Selling days off a lapsed line pushes it further into the past. That is
    // truthful; before LIRA-157 it rebased onto today and reported the line as
    // LESS expired than it really was.
    const p = projectValidityExpiry(addDays(TODAY, -22), -10, TODAY);
    expect(p.burned).toBe(false);
    expect(p.expiry).toBe(addDays(TODAY, -32));
  });

  it("a line with no expiry anchors on today", () => {
    expect(projectValidityExpiry(null, -10, TODAY).expiry).toBe(
      addDays(TODAY, -10),
    );
  });
});

describe("projectValidityExpiry — zero delta", () => {
  it("is a no-op that still reports the line's state", () => {
    const p = projectValidityExpiry(addDays(TODAY, -22), 0, TODAY);
    expect(p.expiry).toBe(addDays(TODAY, -22));
    expect(p.capped).toBe(false);
    expect(p.burned).toBe(false);
    expect(p.state).toBe("BURNED");
    expect(p.lapseDays).toBe(22);
  });
});

describe("calendar correctness", () => {
  it("crosses a month boundary", () => {
    expect(projectValidityExpiry("2026-01-30", 5, "2026-01-20").expiry).toBe(
      "2026-02-04",
    );
  });

  it("crosses a year boundary", () => {
    expect(projectValidityExpiry("2026-12-28", 10, "2026-12-01").expiry).toBe(
      "2027-01-07",
    );
  });

  it("handles a leap day", () => {
    // 2028 is a leap year: 2028-02-28 + 2 days = 2028-03-01.
    expect(projectValidityExpiry("2028-02-28", 2, "2028-02-01").expiry).toBe(
      "2028-03-01",
    );
  });
});

describe("burnedLineMessage", () => {
  it("names the lapse and the grace window so the operator knows why", () => {
    const msg = burnedLineMessage(22);
    expect(msg).toContain("22 days ago");
    expect(msg).toContain(String(LINE_REVIVAL_GRACE_DAYS));
    expect(msg).toMatch(/register a new line/i);
  });
});
