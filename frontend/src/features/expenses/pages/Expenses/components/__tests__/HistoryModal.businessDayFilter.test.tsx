/** @jest-environment jsdom */

/**
 * LIRA-185 expenses lead 3 — the History window's From/To filter must file
 * each expense under its BUSINESS (local) day, the day Profits and the
 * closing report count it on.
 *
 * A line-usage expense recorded at 01:30 LOCAL on 2026-09-05 can serialize to
 * a UTC instant that still reads as 2026-09-04 (e.g. 22:30Z in a UTC+3 zone).
 * The old filter cut the raw string (`slice(0, 10)`), which is always the
 * UTC day, so filtering From = 2026-09-05 could hide it.
 *
 * `process.env.TZ`, set after the jsdom environment and its Date/Intl
 * machinery are already initialized, is NOT honored by Node — so this file
 * must not hardcode Beirut clock strings and rely on a TZ assignment to make
 * them land correctly. Instead every fixture instant is built with the local
 * `Date(year, month, day, hour, minute)` constructor, which Node always
 * interprets in whatever timezone the test process actually started in
 * (CI's UTC, this machine's Beirut, or anything `TZ=<zone>` is run under).
 * `.toISOString()` then gives the correct corresponding UTC instant for
 * that zone, so the local-day boundary this test is about exists no matter
 * where it runs.
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

// Local-time instants (interpreted in the process's own timezone), each at
// least an hour clear of local midnight so the assertions never depend on
// which side of a DST/offset boundary the runner happens to sit.
const LINE_USAGE_0130_LOCAL = new Date(2026, 8, 5, 1, 30, 0).toISOString();
const MANUAL_ENTRY_NOON_LOCAL = new Date(2026, 8, 5, 12, 0, 0).toISOString();
const PREVIOUS_EVENING_2300_LOCAL = new Date(
  2026,
  8,
  4,
  23,
  0,
  0,
).toISOString();

function renderModal() {
  render(
    <HistoryModal
      expenses={[
        row(1, "line usage 01:30", LINE_USAGE_0130_LOCAL),
        row(2, "manual entry", MANUAL_ENTRY_NOON_LOCAL),
        row(3, "previous evening", PREVIOUS_EVENING_2300_LOCAL),
      ]}
      loading={false}
      onClose={jest.fn()}
      onRefresh={jest.fn()}
      onVoid={jest.fn()}
    />,
  );
}

describe("Expenses HistoryModal — date filter uses the business day", () => {
  it("From = To = 2026-09-05 keeps the 01:30 local line-usage row", () => {
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
