/**
 * LIRA-345 (owner decisions S1/S3, 2026-10-26) — the ONE "this supplier is
 * settled on the day calendar" predicate (rule 14), shared by the Suppliers
 * page (tabs, Settle Account button), the server gate on the amount-first
 * settle, and the Transactions labels.
 */
import {
  billsStayOnTickList,
  calendarTakesCommission,
  isSettleStaleMessage,
  settleStaleMessage,
  settlesByDay,
} from "../settlesByDay";

const base = {
  provider: null as string | null,
  is_system: 0,
  is_active: 1,
  is_account_member: false,
};

describe("settlesByDay (LIRA-345)", () => {
  it("OMT account parent and members settle by day", () => {
    expect(
      settlesByDay({ ...base, provider: "OMT", is_system: 1, is_account_member: true }),
    ).toBe(true);
    expect(
      settlesByDay({ ...base, provider: "iPick", is_system: 1, is_account_member: true }),
    ).toBe(true);
  });

  it("Katsh settles by day", () => {
    expect(settlesByDay({ ...base, provider: "Katsh", is_system: 1 })).toBe(true);
  });

  it("Whish settles by day only when active", () => {
    expect(settlesByDay({ ...base, provider: "WHISH" })).toBe(true);
    expect(settlesByDay({ ...base, provider: "WHISH", is_active: 0 })).toBe(false);
  });

  it("product suppliers (is_system 0, no provider) settle by day", () => {
    expect(settlesByDay(base)).toBe(true);
  });

  // LIRA-351 (owner decisions 2026-10-29): Loto settles on the calendar
  // like every other supplier. It has no bills (no tick list) and its
  // commission is earned at the sale (no settlement commission).
  it("Loto settles by day, with no tick list and no settlement commission", () => {
    const loto = { ...base, provider: "LOTO", is_system: 1 };
    expect(settlesByDay(loto)).toBe(true);
    expect(billsStayOnTickList(loto)).toBe(false);
    expect(calendarTakesCommission(loto)).toBe(false);
  });

  it("other company suppliers outside the OMT account do not (yet)", () => {
    for (const provider of ["iPick", "OMT_APP", "WHISH_APP", "OMT"]) {
      expect(settlesByDay({ ...base, provider, is_system: 1 })).toBe(false);
    }
  });

  it("bills stay on the tick list for calendar suppliers outside the OMT account", () => {
    expect(billsStayOnTickList({ ...base, provider: "Katsh", is_system: 1 })).toBe(true);
    expect(billsStayOnTickList({ ...base, provider: "WHISH" })).toBe(true);
    expect(
      billsStayOnTickList({ ...base, provider: "OMT", is_system: 1, is_account_member: true }),
    ).toBe(false);
    expect(billsStayOnTickList(base)).toBe(false);
  });

  it("the commission field is offered for the OMT account and Whish only (S4)", () => {
    expect(
      calendarTakesCommission({ ...base, provider: "OMT", is_system: 1, is_account_member: true }),
    ).toBe(true);
    expect(calendarTakesCommission({ ...base, provider: "WHISH" })).toBe(true);
    expect(calendarTakesCommission({ ...base, provider: "Katsh", is_system: 1 })).toBe(false);
    expect(calendarTakesCommission(base)).toBe(false);
  });

  it("the stale refusal names the supplier and is recognised whatever the name", () => {
    expect(settleStaleMessage("Katsh")).toBe(
      "Katsh's balance changed since you opened this sheet.",
    );
    // The OMT wording is unchanged (the OMT tests and the e2e match on it).
    expect(settleStaleMessage("OMT")).toBe(
      "OMT's balance changed since you opened this sheet.",
    );
    expect(isSettleStaleMessage(`${settleStaleMessage("Acme")} Check the new amounts.`)).toBe(true);
    expect(isSettleStaleMessage("There is nothing to settle")).toBe(false);
  });
});
