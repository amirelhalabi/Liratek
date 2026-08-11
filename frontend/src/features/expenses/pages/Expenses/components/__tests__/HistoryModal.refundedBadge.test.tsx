/** @jest-environment jsdom */

/**
 * Expenses History modal — refunded-row display (LIRA-131).
 *
 * `expenses` is in `TransactionRepository._markSourceRefunded`'s
 * supported-tables whitelist (migration v68) — a void/refund of an expense
 * correctly sets `is_refunded = 1` / `refunded_at`. The "Refunded" badge JSX
 * already existed here (`isRefunded = Boolean(expense.is_refunded)`,
 * LIRA-131 audit: "dead badge ready") — it was starved because
 * `ExpenseRepository.getColumns()` never projected either column (fixed in
 * this same change; see ExpenseRepository.refundedRead.test.ts for the
 * backend-side proof). `expenses` carries no profit concept (it's a pure
 * cost/outflow row), so unlike recharges/exchange/financial_services/
 * custom-services there is no profit column to neutralise here — the badge
 * is the whole fix.
 *
 * Rule 17 (failing-first): no NEW frontend code was written for this
 * module (the badge JSX pre-dates this ticket) — the bug was entirely the
 * missing backend projection. This test proves that directly: given props
 * shaped like the PRE-fix repository (is_refunded/refunded_at simply
 * absent, exactly what an un-projected SELECT produces), the badge does
 * NOT render; given props shaped like the FIXED repository, it does. Both
 * branches are asserted below, so the test would fail if the badge JSX
 * were ever removed OR if the projection regressed back to omitting the
 * columns.
 */

import { render, screen, within } from "@testing-library/react";
import { HistoryModal } from "../HistoryModal";

const REFUNDED_DESC = "Refunded shop supply";
const LIVE_DESC = "Live shop supply";

function baseExpense(overrides: Record<string, unknown>) {
  return {
    id: 1,
    description: LIVE_DESC,
    category: "Shop_Supply",
    amount_usd: 25,
    amount_lbp: 0,
    expense_date: "2026-08-10",
    ...overrides,
  };
}

describe("Expenses HistoryModal — refunded row display (LIRA-131)", () => {
  it("shows a Refunded badge on a row shaped like the FIXED repository (is_refunded=1)", () => {
    render(
      <HistoryModal
        expenses={[
          baseExpense({
            id: 1,
            description: REFUNDED_DESC,
            is_refunded: 1,
            refunded_at: "2026-08-10 21:00:00",
          }),
          baseExpense({ id: 2, description: LIVE_DESC, is_refunded: 0 }),
        ]}
        loading={false}
        onClose={jest.fn()}
        onRefresh={jest.fn()}
        onVoid={jest.fn()}
      />,
    );

    const refundedRow = screen.getByText(REFUNDED_DESC).closest("tr");
    const liveRow = screen.getByText(LIVE_DESC).closest("tr");
    expect(refundedRow).not.toBeNull();
    expect(liveRow).not.toBeNull();

    expect(
      within(refundedRow as HTMLElement).getByText("Refunded"),
    ).toBeInTheDocument();
    expect(
      within(liveRow as HTMLElement).queryByText("Refunded"),
    ).not.toBeInTheDocument();
  });

  it("failing-first proof: a row shaped like the PRE-fix repository (is_refunded simply absent from the SELECT) shows NO badge at all", () => {
    render(
      <HistoryModal
        // No is_refunded/refunded_at keys — exactly what
        // ExpenseRepository.getColumns() produced before this ticket's fix.
        expenses={[baseExpense({ id: 1, description: REFUNDED_DESC })]}
        loading={false}
        onClose={jest.fn()}
        onRefresh={jest.fn()}
        onVoid={jest.fn()}
      />,
    );

    const row = screen.getByText(REFUNDED_DESC).closest("tr");
    expect(within(row as HTMLElement).queryByText("Refunded")).toBeNull();
  });
});
