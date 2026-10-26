/**
 * LIRA-343 T033 / T033b — the generic day details panel under the settle
 * calendar (spec US4, FR-016, FR-016a, FR-016c).
 *
 * Failing-first: written before SettleDayDetails existed; the first run must
 * fail with "Cannot find module '../SettleDayDetails'".
 *
 * Plain props, no useApi, so there is nothing to mock for rule 25.
 */
import type { ComponentProps } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { SettleDayDetails, type SettleDayDetailsRow } from "../SettleDayDetails";

function row(partial: Partial<SettleDayDetailsRow> & { key: string; id: number }): SettleDayDetailsRow {
  return {
    label: "Cash out",
    memberTag: null,
    amount_usd: 0,
    amount_lbp: 0,
    covered_usd: 0,
    covered_lbp: 0,
    remaining_usd: 0,
    remaining_lbp: 0,
    settlements: [],
    addedAfterSettlement: false,
    waitingForStatement: false,
    ...partial,
  };
}

// 21 Oct: $97 OMT App cash-out, $50 paid by settlement #10057 (US4 scenario 1).
const PART_PAID = row({
  key: "fs:501",
  id: 501,
  label: "Cash out",
  memberTag: "OMT App",
  amount_usd: 97,
  covered_usd: 50,
  remaining_usd: 47,
  settlements: [
    { transaction_id: 10057, settled_at: "2026-10-22 10:00:00", currency: "USD", amount: 50 },
  ],
});

// Closed by two settlements (US4 scenario 2).
const TWO_SETTLEMENTS = row({
  key: "fs:502",
  id: 502,
  label: "Bill payment",
  amount_usd: 120,
  covered_usd: 120,
  remaining_usd: 0,
  settlements: [
    { transaction_id: 10057, settled_at: "2026-10-22 10:00:00", currency: "USD", amount: 70 },
    { transaction_id: 10061, settled_at: "2026-10-23 10:00:00", currency: "USD", amount: 50 },
  ],
});

const LBP_OPEN = row({
  key: "fs:503",
  id: 503,
  label: "Transfer",
  memberTag: "iPick",
  amount_lbp: 990000,
  remaining_lbp: 990000,
  addedAfterSettlement: true,
  waitingForStatement: true,
});

function renderDetails(overrides: Partial<ComponentProps<typeof SettleDayDetails>> = {}) {
  const props: ComponentProps<typeof SettleDayDetails> = {
    day: "2026-10-21",
    dayLabel: "21 Oct",
    rows: [PART_PAID, TWO_SETTLEMENTS, LBP_OPEN],
    picked: false,
    unticked: new Set<string>(),
    onClose: jest.fn(),
    ...overrides,
  };
  render(<SettleDayDetails {...props} />);
  return props;
}

describe("SettleDayDetails (LIRA-343)", () => {
  it("is a labelled region named after the day, and Close calls onClose", () => {
    const props = renderDetails();
    const region = screen.getByRole("region", { name: "21 Oct" });
    fireEvent.click(within(region).getByRole("button", { name: "Close" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("shows #id, label, member tag, amount and '$50.00 paid by #10057 · $47.00 left'", () => {
    renderDetails();
    const r = screen.getByTestId("settle-day-row-fs:501");
    expect(r).toHaveTextContent("#501");
    expect(r).toHaveTextContent("Cash out");
    expect(within(r).getByText("OMT App")).toBeInTheDocument();
    expect(r).toHaveTextContent("$97.00");
    expect(r).toHaveTextContent("$50.00 paid by #10057 · $47.00 left");
    const bar = within(r).getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "52");
  });

  it("lists both settlements of a day closed by two, without a 'left' part", () => {
    renderDetails();
    const r = screen.getByTestId("settle-day-row-fs:502");
    expect(r).toHaveTextContent("$70.00 paid by #10057");
    expect(r).toHaveTextContent("$50.00 paid by #10061");
    expect(r).not.toHaveTextContent("left");
    expect(within(r).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("shows an unpaid LBP row's amount left and its two tags", () => {
    renderDetails();
    const r = screen.getByTestId("settle-day-row-fs:503");
    expect(r).toHaveTextContent("990,000 LBP");
    expect(r).toHaveTextContent("990,000 LBP left");
    expect(within(r).getByText("iPick")).toBeInTheDocument();
    expect(within(r).getByText("Added after settlement")).toBeInTheDocument();
    expect(within(r).getByText("Waiting for its statement type")).toBeInTheDocument();
  });

  it("has no checkboxes when the day is not picked", () => {
    renderDetails({ onToggleRow: jest.fn() });
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("a picked day offers a checkbox on open rows only; clicking toggles by key", () => {
    const onToggleRow = jest.fn();
    renderDetails({ picked: true, onToggleRow });
    const boxes = screen.getAllByRole("checkbox");
    // fs:502 is fully paid → no checkbox.
    expect(boxes).toHaveLength(2);
    expect(within(screen.getByTestId("settle-day-row-fs:502")).queryByRole("checkbox")).toBeNull();
    const box = within(screen.getByTestId("settle-day-row-fs:501")).getByRole("checkbox", {
      name: "Include #501 in this settlement",
    });
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(onToggleRow).toHaveBeenCalledWith("fs:501");
  });

  it("an unticked row shows unchecked, and the day says 'Partly picked'", () => {
    renderDetails({ picked: true, onToggleRow: jest.fn(), unticked: new Set(["fs:503"]) });
    expect(
      within(screen.getByTestId("settle-day-row-fs:503")).getByRole("checkbox"),
    ).not.toBeChecked();
    expect(
      within(screen.getByTestId("settle-day-row-fs:501")).getByRole("checkbox"),
    ).toBeChecked();
    expect(screen.getByText("Partly picked")).toBeInTheDocument();
  });

  it("no 'Partly picked' note while every open row is ticked", () => {
    renderDetails({ picked: true, onToggleRow: jest.fn() });
    expect(screen.queryByText("Partly picked")).toBeNull();
  });

  it("'See in Transactions ›' shows only with a handler, and calls it", () => {
    const { unmount } = render(
      <SettleDayDetails
        day="2026-10-21"
        dayLabel="21 Oct"
        rows={[PART_PAID]}
        picked={false}
        unticked={new Set()}
        onClose={jest.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /See in Transactions/ })).toBeNull();
    unmount();

    const onSee = jest.fn();
    renderDetails({ onSeeInTransactions: onSee });
    fireEvent.click(screen.getByRole("button", { name: "See in Transactions ›" }));
    expect(onSee).toHaveBeenCalledTimes(1);
  });

  it("an empty day says so", () => {
    renderDetails({ rows: [] });
    expect(screen.getByText("No transactions on this day")).toBeInTheDocument();
  });

  it("uses caller formatters when given", () => {
    renderDetails({ formatters: { formatUsd: (n: number) => `USD ${n}` } });
    expect(screen.getByTestId("settle-day-row-fs:501")).toHaveTextContent(
      "USD 50 paid by #10057 · USD 47 left",
    );
  });
});
