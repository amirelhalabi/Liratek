/** @jest-environment jsdom */
/**
 * LIRA-335 US4 — the hint under Transaction time.
 *
 * When a custom time is set, the widget asks which checkpoint differences
 * money saved at that time could resolve, and prints one line per
 * difference. It has no new props, so every form that renders it gets the
 * line. Anything unexpected (no adapter method, a rejection, a refused
 * read, an empty list, no ApiProvider at all) shows no line and never
 * crashes the form.
 *
 * Rule 17: written before the component change. The useApi mock returns
 * ONE module-level object (rule 25).
 */

import { render, screen, waitFor } from "@testing-library/react";
import type { CheckpointDifferenceView } from "@liratek/core";
import { TransactionTimeOverride } from "../TransactionTimeOverride";

const mockGetOpenDifferencesAfter = jest.fn();
const mockApi: { getOpenDifferencesAfter?: jest.Mock } = {
  getOpenDifferencesAfter: mockGetOpenDifferencesAfter,
};
const mockUseApi = jest.fn(() => mockApi);

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockUseApi(),
}));

function openDifference(
  over: Partial<CheckpointDifferenceView>,
): CheckpointDifferenceView {
  return {
    id: 1,
    closing_id: 1,
    // 15:00 UTC = Mon 18:00 Beirut.
    closing_created_at: "2026-10-12 15:00:00",
    drawer_name: "General",
    currency_code: "USD",
    amount: 50,
    direction: "OVER",
    resolved: 0,
    open: 50,
    status: "OPEN",
    closed_at: null,
    closed_by_name: null,
    shortage_expense_id: null,
    resolutions: [],
    ...over,
  };
}

// Mon Oct 12 2026, 14:10 Beirut.
const AT = new Date("2026-10-12T11:10:00.000Z").toISOString();
const LATER = new Date("2026-10-12T12:10:00.000Z").toISOString();

beforeEach(() => {
  mockGetOpenDifferencesAfter.mockReset();
  mockApi.getOpenDifferencesAfter = mockGetOpenDifferencesAfter;
  mockUseApi.mockImplementation(() => mockApi);
});

describe("TransactionTimeOverride — open-difference hint (LIRA-335)", () => {
  it("asks once per value with { at } and prints one line per difference", async () => {
    mockGetOpenDifferencesAfter.mockResolvedValue({
      success: true,
      data: [
        openDifference({}),
        openDifference({
          id: 2,
          drawer_name: "OMT_System",
          amount: -20,
          direction: "SHORT",
          resolved: 12,
          open: 8,
          status: "PARTLY_RESOLVED",
        }),
      ],
    });
    const { rerender } = render(
      <TransactionTimeOverride value={AT} onChange={jest.fn()} />,
    );

    const lines = await screen.findAllByTestId("txn-time-hint");
    expect(lines).toHaveLength(2);
    expect(lines[0].textContent).toBe(
      "This time is before General's checkpoint of Mon 06:00 PM (Over $50.00 open). Money into General saved at this time will resolve it instead of raising the balance.",
    );
    // A Short is resolved by money OUT of the drawer (FR-004), never in.
    expect(lines[1].textContent).toBe(
      "This time is before OMT Cash Drawer's checkpoint of Mon 06:00 PM (Short $8.00 open). Money out of OMT Cash Drawer saved at this time will resolve it instead of lowering the balance.",
    );
    expect(lines[1].textContent).not.toContain("Money into");
    expect(mockGetOpenDifferencesAfter).toHaveBeenCalledTimes(1);
    expect(mockGetOpenDifferencesAfter).toHaveBeenCalledWith({ at: AT });

    // Same value again: no second read. A new value: one more.
    rerender(<TransactionTimeOverride value={AT} onChange={jest.fn()} />);
    expect(mockGetOpenDifferencesAfter).toHaveBeenCalledTimes(1);
    rerender(<TransactionTimeOverride value={LATER} onChange={jest.fn()} />);
    await waitFor(() =>
      expect(mockGetOpenDifferencesAfter).toHaveBeenCalledTimes(2),
    );
    expect(mockGetOpenDifferencesAfter).toHaveBeenLastCalledWith({
      at: LATER,
    });
  });

  it("no value: no read and no line", () => {
    render(<TransactionTimeOverride onChange={jest.fn()} />);
    expect(mockGetOpenDifferencesAfter).not.toHaveBeenCalled();
    expect(screen.queryByTestId("txn-time-hint")).toBeNull();
  });

  it("an empty list shows no line", async () => {
    mockGetOpenDifferencesAfter.mockResolvedValue({ success: true, data: [] });
    render(<TransactionTimeOverride value={AT} onChange={jest.fn()} />);
    await waitFor(() =>
      expect(mockGetOpenDifferencesAfter).toHaveBeenCalledTimes(1),
    );
    expect(screen.queryByTestId("txn-time-hint")).toBeNull();
  });

  it("a refused read ({ success: false }) shows no line", async () => {
    mockGetOpenDifferencesAfter.mockResolvedValue({
      success: false,
      error: "Forbidden",
    });
    render(<TransactionTimeOverride value={AT} onChange={jest.fn()} />);
    await waitFor(() =>
      expect(mockGetOpenDifferencesAfter).toHaveBeenCalledTimes(1),
    );
    expect(screen.queryByTestId("txn-time-hint")).toBeNull();
  });

  it("a rejected read shows no line and does not crash", async () => {
    mockGetOpenDifferencesAfter.mockRejectedValue(new Error("offline"));
    render(<TransactionTimeOverride value={AT} onChange={jest.fn()} />);
    await waitFor(() =>
      expect(mockGetOpenDifferencesAfter).toHaveBeenCalledTimes(1),
    );
    expect(screen.queryByTestId("txn-time-hint")).toBeNull();
    expect(screen.getByTestId("txn-time-input")).toBeInTheDocument();
  });

  it("an adapter without the method shows no line and does not crash", () => {
    delete mockApi.getOpenDifferencesAfter;
    render(<TransactionTimeOverride value={AT} onChange={jest.fn()} />);
    expect(screen.queryByTestId("txn-time-hint")).toBeNull();
    expect(screen.getByTestId("txn-time-input")).toBeInTheDocument();
  });

  it("no ApiProvider at all (useApi throws) still renders the widget", () => {
    mockUseApi.mockImplementation(() => {
      throw new Error("ApiProvider is missing in the component tree");
    });
    render(<TransactionTimeOverride value={AT} onChange={jest.fn()} />);
    expect(screen.getByTestId("txn-time-input")).toBeInTheDocument();
    expect(screen.queryByTestId("txn-time-hint")).toBeNull();
  });
});
