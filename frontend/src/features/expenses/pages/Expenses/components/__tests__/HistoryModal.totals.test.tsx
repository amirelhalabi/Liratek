/** @jest-environment jsdom */

/**
 * Expenses History modal — Total USD / Total LBP chips (LIRA-311).
 *
 * The window shows the totals of the rows it lists, USD and LBP kept
 * separate, and leaves a refunded row out (same rule as the page header,
 * shared through `expenseTotals`). Rows from past days count too — the
 * window is now fed every day, not only today.
 *
 * Not proven failing-first: written after the change (rule 17).
 */

import { render, screen } from "@testing-library/react";
import { HistoryModal } from "../HistoryModal";

function expense(overrides: Record<string, unknown>) {
  return {
    id: 1,
    description: "Row",
    category: "Shop_Supply",
    amount_usd: 0,
    amount_lbp: 0,
    expense_date: "2026-10-12",
    ...overrides,
  };
}

function chipValue(label: string): string {
  const chip = screen.getByText(label).parentElement as HTMLElement;
  return chip.textContent ?? "";
}

describe("Expenses HistoryModal — totals (LIRA-311)", () => {
  it("totals USD and LBP separately across days, leaving refunded rows out", () => {
    render(
      <HistoryModal
        expenses={[
          expense({ id: 1, amount_usd: 20 }),
          expense({ id: 2, amount_usd: 15.5, expense_date: "2026-09-01" }),
          expense({ id: 3, amount_lbp: 700000 }),
          expense({ id: 4, amount_lbp: 500000, expense_date: "2026-08-15" }),
          expense({ id: 5, amount_usd: 10, is_refunded: 1 }),
          expense({ id: 6, amount_lbp: 90000, is_refunded: 1 }),
        ]}
        loading={false}
        onClose={jest.fn()}
        onRefresh={jest.fn()}
        onVoid={jest.fn()}
      />,
    );

    expect(chipValue("Total USD")).toContain("$35.50");
    expect(chipValue("Total LBP")).toContain((1200000).toLocaleString());
  });

  it("shows zero totals when nothing is listed", () => {
    render(
      <HistoryModal
        expenses={[]}
        loading={false}
        onClose={jest.fn()}
        onRefresh={jest.fn()}
        onVoid={jest.fn()}
      />,
    );

    expect(chipValue("Total USD")).toContain("$0.00");
    expect(chipValue("Total LBP")).toContain("0");
  });
});
