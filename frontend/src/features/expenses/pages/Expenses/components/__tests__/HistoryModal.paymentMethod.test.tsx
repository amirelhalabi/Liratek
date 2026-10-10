/** @jest-environment jsdom */

/**
 * Expenses History modal — the payment column shows each expense's own
 * payment method (LIRA-185 leftover, expenses lead 5).
 *
 * The cell was a hard-coded "Cash" for every row, so an expense paid from
 * Whish, OMT or Binance still read "Cash". It now shows the shop's label for
 * `paid_by_method` (passed in by the page from its payment methods), falling
 * back to a title-cased code, and "Cash" only when the row has no method.
 */

import { render, screen, within } from "@testing-library/react";
import { HistoryModal } from "../HistoryModal";

function expense(id: number, description: string, paid_by_method?: string) {
  return {
    id,
    description,
    category: "Shop_Supply",
    amount_usd: 10,
    amount_lbp: 0,
    expense_date: "2026-10-10",
    ...(paid_by_method !== undefined ? { paid_by_method } : {}),
  };
}

function rowOf(description: string): HTMLElement {
  const row = screen.getByText(description).closest("tr");
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

describe("Expenses HistoryModal — payment method column", () => {
  it("shows the shop's label for each row's own payment method", () => {
    render(
      <HistoryModal
        expenses={[
          expense(1, "Paid in cash", "CASH"),
          expense(2, "Paid from Whish", "WHISH"),
          expense(3, "Paid from Binance", "BINANCE"),
        ]}
        methodLabels={{ CASH: "Cash", WHISH: "Whish Money", BINANCE: "Binance" }}
        loading={false}
        onClose={jest.fn()}
        onRefresh={jest.fn()}
        onVoid={jest.fn()}
      />,
    );

    expect(within(rowOf("Paid in cash")).getByText("Cash")).toBeInTheDocument();
    expect(
      within(rowOf("Paid from Whish")).getByText("Whish Money"),
    ).toBeInTheDocument();
    expect(
      within(rowOf("Paid from Whish")).queryByText("Cash"),
    ).not.toBeInTheDocument();
    expect(
      within(rowOf("Paid from Binance")).getByText("Binance"),
    ).toBeInTheDocument();
  });

  it("falls back to a readable code when no label is known, and to Cash when the row has no method", () => {
    render(
      <HistoryModal
        expenses={[
          expense(1, "Line usage", "LINE_CREDIT"),
          expense(2, "Old row without method"),
        ]}
        loading={false}
        onClose={jest.fn()}
        onRefresh={jest.fn()}
        onVoid={jest.fn()}
      />,
    );

    expect(
      within(rowOf("Line usage")).getByText("Line Credit"),
    ).toBeInTheDocument();
    expect(
      within(rowOf("Old row without method")).getByText("Cash"),
    ).toBeInTheDocument();
  });
});
