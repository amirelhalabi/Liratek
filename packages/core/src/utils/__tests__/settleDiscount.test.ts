/**
 * LIRA-372 — the one screen helper for the settle Discount line. `owed` is
 * what is owed in that currency BEFORE the payment (research R2): the room
 * must not shrink as the payment line follows the discount.
 */
import {
  settleDiscountRoom,
  clampSettleDiscount,
  settleDiscountOverpaid,
} from "../settleDiscount.js";

describe("settleDiscountRoom (LIRA-372)", () => {
  it.each([
    ["USD", 2.5, 2.5],
    ["USD", 100, 5],
    ["LBP", 300_000, 300_000],
    ["LBP", 900_000, 450_000],
    ["USD", -10, 0],
    ["LBP", -1, 0],
    ["USD", 2.345, 2.35],
    ["LBP", 1234.6, 1235],
  ] as const)("%s owed %p → %p", (currency, owed, room) => {
    expect(settleDiscountRoom(currency, owed)).toBe(room);
  });
});

describe("clampSettleDiscount (LIRA-372)", () => {
  it("caps a typed 6 at $5", () => {
    expect(clampSettleDiscount("USD", 6, 100)).toEqual({
      applied: 5,
      capped: true,
      room: 5,
    });
  });

  it("keeps an amount inside the room", () => {
    expect(clampSettleDiscount("USD", 2.5, 412.5)).toEqual({
      applied: 2.5,
      capped: false,
      room: 5,
    });
  });

  it("caps at what is owed when that is smaller", () => {
    expect(clampSettleDiscount("USD", 4, 3)).toEqual({
      applied: 3,
      capped: true,
      room: 3,
    });
  });

  it("rounds to cents and whole LBP", () => {
    expect(clampSettleDiscount("USD", 2.345, 100).applied).toBe(2.35);
    expect(clampSettleDiscount("LBP", 1000.4, 900_000).applied).toBe(1000);
  });

  it("treats a negative or blank typed amount as 0", () => {
    expect(clampSettleDiscount("USD", -3, 100)).toEqual({
      applied: 0,
      capped: false,
      room: 5,
    });
    expect(clampSettleDiscount("USD", Number.NaN, 100).applied).toBe(0);
  });
});

describe("settleDiscountOverpaid (LIRA-372)", () => {
  it.each([
    ["USD", 412.5, 410, 2.5, false],
    ["USD", 412.5, 412.5, 2.5, true],
    ["USD", 412.5, 410.004, 2.5, false],
    ["LBP", 900_000, 450_000, 450_000, false],
    ["LBP", 900_000, 450_001, 450_000, true],
  ] as const)(
    "%s owed %p, paid %p, discount %p → %p",
    (currency, owed, paid, discount, expected) => {
      expect(settleDiscountOverpaid(currency, owed, paid, discount)).toBe(
        expected,
      );
    },
  );
});
