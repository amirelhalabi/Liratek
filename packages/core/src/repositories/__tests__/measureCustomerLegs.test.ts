/**
 * LIRA-336 T004 — `measureCustomerLegs`: the pure check half of
 * `bookCustomerLegs` (moneyPosting.ts, research R2).
 *
 *  - Without `allowAddedChange` it refuses exactly what `bookCustomerLegs`
 *    refuses (overpay, uncovered shortfall, forgive over the cap) and writes
 *    nothing — it has no db handle at all.
 *  - With `allowAddedChange` the target may be 0, and money ABOVE it comes
 *    back as `addedChange` (in the expected currency) plus `addedChangeUsd`,
 *    instead of the overpay refusal. An account line or a forgiven amount
 *    together with money above the target is refused (FR-009).
 *
 * Rule 17 — run on 2026-10-18 BEFORE `measureCustomerLegs` existed: the
 * whole suite failed at import ("measureCustomerLegs is not a function" /
 * TS2305 no exported member), every case red.
 */
import {
  measureCustomerLegs,
  CUSTOMER_LEGS_OVERPAID_MESSAGE,
  CUSTOMER_LEGS_SHORT_MESSAGE,
  CUSTOMER_LEGS_FORGIVE_OVER_CAP_MESSAGE,
  type ReconciliationLeg,
} from "../moneyPosting";
import { ADDED_CHANGE_ACCOUNT_MESSAGE } from "../../validators/common";

const RATE = 89_500;

function leg(
  method: string,
  currencyCode: string,
  amount: number,
): ReconciliationLeg {
  return { method, currencyCode, amount };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\$]/g, "\\$&");

describe("measureCustomerLegs — existing behaviour (no allowAddedChange)", () => {
  it("an exact payment measures paid = total, nothing owed, nothing added", () => {
    const m = measureCustomerLegs({
      legs: [leg("CASH", "USD", 100)],
      expected: { amount: 100, currency: "USD" },
      rate: RATE,
    });
    expect(m.paid).toBeCloseTo(100, 6);
    expect(m.owed).toEqual({ usd: 0, lbp: 0 });
    expect(m.forgiven).toBe(0);
    expect(m.addedChange).toBe(0);
    expect(m.addedChangeUsd).toBe(0);
  });

  it("an overpay is refused with the overpay message", () => {
    expect(() =>
      measureCustomerLegs({
        legs: [leg("CASH", "USD", 103)],
        expected: { amount: 100, currency: "USD" },
        rate: RATE,
      }),
    ).toThrow(new RegExp(escape(CUSTOMER_LEGS_OVERPAID_MESSAGE)));
  });

  it("an uncovered shortfall is refused", () => {
    expect(() =>
      measureCustomerLegs({
        legs: [leg("CASH", "USD", 90)],
        expected: { amount: 100, currency: "USD" },
        rate: RATE,
      }),
    ).toThrow(new RegExp(escape(CUSTOMER_LEGS_SHORT_MESSAGE)));
  });

  it("a forgive over the cap is refused", () => {
    expect(() =>
      measureCustomerLegs({
        legs: [leg("CASH", "USD", 90)],
        expected: { amount: 100, currency: "USD" },
        rate: RATE,
        waived: 10,
      }),
    ).toThrow(new RegExp(escape(CUSTOMER_LEGS_FORGIVE_OVER_CAP_MESSAGE)));
  });

  it("a zero target is still refused without allowAddedChange", () => {
    expect(() =>
      measureCustomerLegs({
        legs: [leg("CASH", "USD", 3)],
        expected: { amount: 0, currency: "USD" },
        rate: RATE,
      }),
    ).toThrow(/total to collect is not valid/);
  });

  it("an account shortfall measures the debt per currency", () => {
    const m = measureCustomerLegs({
      legs: [leg("CASH", "USD", 90), leg("CUSTOMER_ACCOUNT", "USD", 10)],
      expected: { amount: 100, currency: "USD" },
      rate: RATE,
      clientId: 1,
    });
    expect(m.owed).toEqual({ usd: 10, lbp: 0 });
    expect(m.addedChange).toBe(0);
  });
});

describe("measureCustomerLegs — allowAddedChange", () => {
  it("expected 0 plus $3 cash → added 3", () => {
    const m = measureCustomerLegs({
      legs: [leg("CASH", "USD", 3)],
      expected: { amount: 0, currency: "USD" },
      rate: RATE,
      allowAddedChange: true,
    });
    expect(m.addedChange).toBeCloseTo(3, 6);
    expect(m.addedChangeUsd).toBeCloseTo(3, 6);
    expect(m.drawerLegs).toHaveLength(1);
  });

  it("expected 100 plus $103 → added 3", () => {
    const m = measureCustomerLegs({
      legs: [leg("CASH", "USD", 103)],
      expected: { amount: 100, currency: "USD" },
      rate: RATE,
      allowAddedChange: true,
    });
    expect(m.addedChange).toBeCloseTo(3, 6);
    expect(m.addedChangeUsd).toBeCloseTo(3, 6);
  });

  it("an exact payment adds nothing", () => {
    const m = measureCustomerLegs({
      legs: [leg("CASH", "USD", 100)],
      expected: { amount: 100, currency: "USD" },
      rate: RATE,
      allowAddedChange: true,
    });
    expect(m.addedChange).toBe(0);
    expect(m.addedChangeUsd).toBe(0);
  });

  it("an LBP line on a USD target → added in USD and as USD equivalent", () => {
    const m = measureCustomerLegs({
      legs: [leg("CASH", "LBP", 268_500)],
      expected: { amount: 0, currency: "USD" },
      rate: RATE,
      allowAddedChange: true,
    });
    expect(m.addedChange).toBeCloseTo(3, 6);
    expect(m.addedChangeUsd).toBeCloseTo(3, 6);
  });

  it("a USD line on an LBP target → added in LBP", () => {
    const m = measureCustomerLegs({
      legs: [leg("CASH", "USD", 3)],
      expected: { amount: 0, currency: "LBP" },
      rate: RATE,
      allowAddedChange: true,
    });
    expect(m.addedChange).toBeCloseTo(268_500, 3);
    expect(m.addedChangeUsd).toBeCloseTo(3, 6);
  });

  it("an LBP target paid in LBP above it → added in LBP", () => {
    const m = measureCustomerLegs({
      legs: [leg("CASH", "LBP", 9_000_000)],
      expected: { amount: 8_953_000, currency: "LBP" },
      rate: RATE,
      allowAddedChange: true,
    });
    expect(m.addedChange).toBeCloseTo(47_000, 3);
    expect(m.addedChangeUsd).toBeCloseTo(47_000 / RATE, 6);
  });

  it("an account line with money above the target is refused", () => {
    expect(() =>
      measureCustomerLegs({
        legs: [leg("CASH", "USD", 100), leg("CUSTOMER_ACCOUNT", "USD", 3)],
        expected: { amount: 100, currency: "USD" },
        rate: RATE,
        clientId: 1,
        allowAddedChange: true,
      }),
    ).toThrow(new RegExp(escape(ADDED_CHANGE_ACCOUNT_MESSAGE)));
  });

  it("a forgiven amount with money above the target is refused", () => {
    expect(() =>
      measureCustomerLegs({
        legs: [leg("CASH", "USD", 103)],
        expected: { amount: 100, currency: "USD" },
        rate: RATE,
        waived: 1,
        allowAddedChange: true,
      }),
    ).toThrow(new RegExp(escape(ADDED_CHANGE_ACCOUNT_MESSAGE)));
  });

  it("a shortfall is still refused (nothing added)", () => {
    expect(() =>
      measureCustomerLegs({
        legs: [leg("CASH", "USD", 90)],
        expected: { amount: 100, currency: "USD" },
        rate: RATE,
        allowAddedChange: true,
      }),
    ).toThrow(new RegExp(escape(CUSTOMER_LEGS_SHORT_MESSAGE)));
  });
});
