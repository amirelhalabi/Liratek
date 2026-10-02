/** @jest-environment jsdom */

// Pin a Beirut clock BEFORE any Date is created, so the 00:00-03:00 local
// window this test is about exists regardless of the machine's zone.
process.env.TZ = "Asia/Beirut";

/**
 * LIRA-185 expenses lead 3 — the History window's From/To filter must file
 * each expense under its BUSINESS (local) day, the day Profits and the
 * closing report count it on.
 *
 * A line-usage expense recorded at 01:30 Beirut on 2026-09-05 is stored as
 * the UTC instant 2026-09-04T22:30:00.000Z. The old filter cut the raw
 * string (`slice(0, 10)` -> "2026-09-04"), so filtering From = 2026-09-05
 * hid it.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { HistoryModal } from "../HistoryModal";

function row(id: number, description: string, expense_date: string) {
  return {
    id,
    description,
    category: "Line_Usage",
    amount_usd: 8,
    amount_lbp: 0,
    expense_date,
    is_refunded: 0,
  };
}

function renderModal() {
  render(
    <HistoryModal
      expenses={[
        row(1, "line usage 01:30", "2026-09-04T22:30:00.000Z"),
        row(2, "manual entry", new Date("2026-09-05").toISOString()),
        row(3, "previous evening", "2026-09-04T18:00:00.000Z"),
      ]}
      loading={false}
      onClose={jest.fn()}
      onRefresh={jest.fn()}
      onVoid={jest.fn()}
    />,
  );
}

describe("Expenses HistoryModal — date filter uses the business day", () => {
  it("From = To = 2026-09-05 keeps the 01:30 Beirut line-usage row", () => {
    renderModal();
    fireEvent.change(screen.getByTestId("date-range-from"), {
      target: { value: "2026-09-05" },
    });
    fireEvent.change(screen.getByTestId("date-range-to"), {
      target: { value: "2026-09-05" },
    });
    expect(screen.getByText("line usage 01:30")).toBeInTheDocument();
    expect(screen.getByText("manual entry")).toBeInTheDocument();
    expect(screen.queryByText("previous evening")).not.toBeInTheDocument();
  });

  it("To = 2026-09-04 does not show the 01:30 row under the previous day", () => {
    renderModal();
    fireEvent.change(screen.getByTestId("date-range-to"), {
      target: { value: "2026-09-04" },
    });
    expect(screen.queryByText("line usage 01:30")).not.toBeInTheDocument();
    expect(screen.getByText("previous evening")).toBeInTheDocument();
  });
});
