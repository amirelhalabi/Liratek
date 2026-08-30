/**
 * insuranceFulfillment.ts — LIRA-155 pure transition-predicate tests.
 *
 * D4.2 (owner decision, 2026-08-29): the fulfilment sequence is STRICT,
 * forward-only, single-step. This file enumerates the FULL 4x4 grid of
 * (from, to) pairs over FULFILLMENT_STATUSES — every legal pair (exactly the
 * 3 single forward steps) and every illegal pair (every skip, every backward
 * move, every same-status "transition", and DELIVERED's terminal rejection
 * of everything) — plus the `from: null` case (a row that isn't
 * fulfilment-tracked can never be "advanced" through this predicate; tracking
 * only ever starts at creation).
 *
 * Purely value-level: no DB, no mocks, no clock.
 */

import {
  FULFILLMENT_STATUSES,
  TERMINAL_FULFILLMENT_STATUS,
  isValidFulfillmentTransition,
  type FulfillmentStatus,
} from "../insuranceFulfillment";

describe("FULFILLMENT_STATUSES / TERMINAL_FULFILLMENT_STATUS", () => {
  it("is the exact ordered 4-status list from D4.2, no 'CANCELLED'", () => {
    expect(FULFILLMENT_STATUSES).toEqual([
      "ORDERED",
      "ISSUED",
      "RECEIVED",
      "DELIVERED",
    ]);
    expect(FULFILLMENT_STATUSES).not.toContain("CANCELLED");
  });

  it("TERMINAL_FULFILLMENT_STATUS is DELIVERED, the last entry", () => {
    expect(TERMINAL_FULFILLMENT_STATUS).toBe("DELIVERED");
    expect(TERMINAL_FULFILLMENT_STATUS).toBe(
      FULFILLMENT_STATUSES[FULFILLMENT_STATUSES.length - 1],
    );
  });
});

describe("isValidFulfillmentTransition", () => {
  describe("from: null (not fulfilment-tracked) — every target is rejected", () => {
    it.each(FULFILLMENT_STATUSES)("null -> %s is illegal", (to) => {
      expect(isValidFulfillmentTransition(null, to)).toBe(false);
    });
  });

  // Full 4x4 grid — every (from, to) pair over the 4 known statuses.
  // Legal iff `to` is EXACTLY the next entry after `from` in
  // FULFILLMENT_STATUSES (single forward step, no skip, no backward, no
  // same-status, and DELIVERED — the last index — has no "next" so every
  // pair with from === DELIVERED is illegal).
  const grid: Array<{
    from: FulfillmentStatus;
    to: FulfillmentStatus;
    expected: boolean;
  }> = FULFILLMENT_STATUSES.flatMap((from) =>
    FULFILLMENT_STATUSES.map((to) => ({
      from,
      to,
      expected:
        FULFILLMENT_STATUSES.indexOf(to) ===
        FULFILLMENT_STATUSES.indexOf(from) + 1,
    })),
  );

  it("the grid contains exactly 3 legal pairs (the 3 single forward steps) out of 16", () => {
    expect(grid).toHaveLength(16);
    expect(grid.filter((c) => c.expected)).toHaveLength(3);
  });

  it.each(grid)("$from -> $to is $expected", ({ from, to, expected }) => {
    expect(isValidFulfillmentTransition(from, to)).toBe(expected);
  });

  describe("named legal single-step transitions", () => {
    it("ORDERED -> ISSUED", () => {
      expect(isValidFulfillmentTransition("ORDERED", "ISSUED")).toBe(true);
    });
    it("ISSUED -> RECEIVED", () => {
      expect(isValidFulfillmentTransition("ISSUED", "RECEIVED")).toBe(true);
    });
    it("RECEIVED -> DELIVERED", () => {
      expect(isValidFulfillmentTransition("RECEIVED", "DELIVERED")).toBe(true);
    });
  });

  describe("named illegal transitions", () => {
    it("rejects a skip forward (ORDERED -> RECEIVED)", () => {
      expect(isValidFulfillmentTransition("ORDERED", "RECEIVED")).toBe(false);
    });
    it("rejects a skip all the way to terminal (ORDERED -> DELIVERED)", () => {
      expect(isValidFulfillmentTransition("ORDERED", "DELIVERED")).toBe(false);
    });
    it("rejects stepping backward (RECEIVED -> ISSUED)", () => {
      expect(isValidFulfillmentTransition("RECEIVED", "ISSUED")).toBe(false);
    });
    it("rejects stepping backward all the way (DELIVERED -> ORDERED)", () => {
      expect(isValidFulfillmentTransition("DELIVERED", "ORDERED")).toBe(false);
    });
    it("rejects a same-status no-op (ISSUED -> ISSUED)", () => {
      expect(isValidFulfillmentTransition("ISSUED", "ISSUED")).toBe(false);
    });
    it("DELIVERED accepts no further transition at all (terminal)", () => {
      for (const to of FULFILLMENT_STATUSES) {
        expect(isValidFulfillmentTransition("DELIVERED", to)).toBe(false);
      }
    });
  });
});
