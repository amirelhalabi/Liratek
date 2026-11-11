/**
 * LIRA-232 round-3 finding #2 follow-up (coordinator, 2026-09-27) —
 * `isSessionPayoutMember` is the ONE shared predicate for "is this
 * session-basket member a netted payout", used by BOTH
 * `TransactionRepository._assertNoNettedPayoutMembers` (core) and the
 * frontend's own session-group derivation. This file proves its exclusions
 * and inclusions directly, without any DB fixture.
 */
import {
  isSessionItemRefundableMember,
  isSessionPayoutMember,
  sessionItemRefundDirection,
} from "../sessionPayoutMember";

describe("isSessionPayoutMember", () => {
  it("excludes a REFUND row even though its amount is negative — the bug that hid 'Refund item' after the first item refund", () => {
    expect(
      isSessionPayoutMember({
        type: "REFUND",
        amount_usd: -30,
        amount_lbp: 0,
      }),
    ).toBe(false);
  });

  it("excludes any reversal row (reverses_id set), regardless of type or amount", () => {
    expect(
      isSessionPayoutMember({
        type: "CUSTOM_SERVICE",
        amount_usd: -10,
        amount_lbp: 0,
        reverses_id: 42,
      }),
    ).toBe(false);
  });

  it("excludes a VOIDED row, regardless of amount", () => {
    expect(
      isSessionPayoutMember({
        type: "LOTO_CASH_PRIZE",
        amount_usd: 0,
        amount_lbp: -450000,
        status: "VOIDED",
      }),
    ).toBe(false);
  });

  it("excludes KEPT_CHANGE (always amount 0/0 in production, but named explicitly)", () => {
    expect(
      isSessionPayoutMember({
        type: "KEPT_CHANGE",
        amount_usd: 0,
        amount_lbp: 0,
      }),
    ).toBe(false);
  });

  it("includes a LOTO_CASH_PRIZE (negative amount_lbp)", () => {
    expect(
      isSessionPayoutMember({
        type: "LOTO_CASH_PRIZE",
        amount_usd: 0,
        amount_lbp: -450000,
        status: "ACTIVE",
      }),
    ).toBe(true);
  });

  it("includes a FINANCIAL_SERVICE RECEIVE/wallet cash-out (negative amount_usd) — type alone can't tell a charge from a payout, sign can", () => {
    expect(
      isSessionPayoutMember({
        type: "FINANCIAL_SERVICE",
        amount_usd: -60,
        amount_lbp: 0,
        status: "ACTIVE",
      }),
    ).toBe(true);
  });

  it("includes a negative-amount CUSTOM_SERVICE payout", () => {
    expect(
      isSessionPayoutMember({
        type: "CUSTOM_SERVICE",
        amount_usd: -15,
        amount_lbp: 0,
        status: "ACTIVE",
      }),
    ).toBe(true);
  });

  it("excludes an ordinary positive-amount sold item (SALE)", () => {
    expect(
      isSessionPayoutMember({
        type: "SALE",
        amount_usd: 100,
        amount_lbp: 0,
        status: "ACTIVE",
      }),
    ).toBe(false);
  });
});

describe("LIRA-381 — isSessionItemRefundableMember / sessionItemRefundDirection", () => {
  const live = {
    amount_usd: 0,
    amount_lbp: 0,
    status: "ACTIVE",
    reverses_id: null,
  };
  it.each([
    "SALE",
    "CUSTOM_SERVICE",
    "RECHARGE",
    "LOTO",
    "LOTO_CASH_PRIZE",
    "FINANCIAL_SERVICE",
    "EXCHANGE",
    "MAINTENANCE",
  ])("%s is refundable on its own", (type) => {
    expect(isSessionItemRefundableMember({ ...live, type })).toBe(true);
  });
  it.each([
    "KEPT_CHANGE",
    "WAIVED_SHORTFALL",
    "EXTRA_CHARGE",
    "BASKET_DISCOUNT",
    "REFUND",
  ])("%s is not an item", (type) => {
    expect(isSessionItemRefundableMember({ ...live, type })).toBe(false);
  });
  it("a voided or reversal row is not a live member", () => {
    expect(
      isSessionItemRefundableMember({
        ...live,
        type: "LOTO",
        status: "VOIDED",
      }),
    ).toBe(false);
    expect(
      isSessionItemRefundableMember({ ...live, type: "LOTO", reverses_id: 9 }),
    ).toBe(false);
  });
  it("an exchange basket line (+given / −received) is never a payout; its refund is a hand-back mirror", () => {
    const exchange = {
      type: "EXCHANGE",
      amount_usd: 100,
      amount_lbp: -8_950_000,
      status: "ACTIVE",
      reverses_id: null,
    };
    expect(isSessionPayoutMember(exchange)).toBe(false);
    expect(sessionItemRefundDirection(exchange)).toBe("to_customer");
  });
  it("direction follows the customer-side sign", () => {
    expect(sessionItemRefundDirection({ amount_usd: 20, amount_lbp: 0 })).toBe(
      "to_customer",
    );
    expect(
      sessionItemRefundDirection({ amount_usd: 0, amount_lbp: -500000 }),
    ).toBe("from_customer");
  });
});
