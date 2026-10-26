/**
 * LIRA-343 T025 (component part) — the selection summary under the calendar
 * (spec FR-009, FR-014). Failing-first: the first run failed with
 * "Cannot find module '../SettleSelectionBar'".
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { SettleSelectionBar } from "../SettleSelectionBar";

describe("SettleSelectionBar (LIRA-343)", () => {
  it("shows count, range, totals per currency, left out and Clear", () => {
    const onClear = jest.fn();
    render(
      <SettleSelectionBar
        count={5}
        firstDay="21 Oct"
        lastDay="25 Oct"
        totals={{ usd: 482, lbp: 1890000 }}
        leftOutCount={1}
        onClear={onClear}
        onPickAllOpen={jest.fn()}
      />,
    );
    const bar = screen.getByTestId("settle-selection-bar");
    expect(bar).toHaveTextContent("5");
    expect(bar).toHaveTextContent("21 Oct → 25 Oct");
    expect(bar).toHaveTextContent("$482.00 + 1,890,000 LBP");
    expect(bar).toHaveTextContent("1 left out");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("one day shows a single label and no left-out text when 0", () => {
    render(
      <SettleSelectionBar
        count={1}
        firstDay="23 Oct"
        lastDay="23 Oct"
        totals={{ usd: 120, lbp: 0 }}
        leftOutCount={0}
        onClear={jest.fn()}
        onPickAllOpen={jest.fn()}
      />,
    );
    const bar = screen.getByTestId("settle-selection-bar");
    expect(bar).toHaveTextContent("23 Oct");
    expect(bar).not.toHaveTextContent("→");
    expect(bar).toHaveTextContent("$120.00");
    expect(bar).not.toHaveTextContent("LBP");
    expect(bar).not.toHaveTextContent("left out");
  });

  it("empty: asks to tap days and offers Pick all open", () => {
    const onPickAllOpen = jest.fn();
    render(
      <SettleSelectionBar
        count={0}
        firstDay=""
        lastDay=""
        totals={{ usd: 0, lbp: 0 }}
        leftOutCount={0}
        onClear={jest.fn()}
        onPickAllOpen={onPickAllOpen}
      />,
    );
    expect(screen.getByTestId("settle-selection-bar")).toHaveTextContent(
      "Tap the days you are settling",
    );
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Pick all open" }));
    expect(onPickAllOpen).toHaveBeenCalledTimes(1);
  });
});
