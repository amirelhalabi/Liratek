/** @jest-environment jsdom */
/**
 * LIRA-335 US3 — the Close difference window and the Reopen button.
 *
 * The payload's field name is taken from the core schema (rule 24): the
 * expected payload is parsed through `closeCheckpointDifferenceSchema` /
 * `reopenCheckpointDifferenceSchema`, so a renamed key fails here.
 *
 * Rule 17: written before the component exists. The useApi mock is a stable
 * module-level object (rule 25).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  closeCheckpointDifferenceSchema,
  reopenCheckpointDifferenceSchema,
  type CheckpointDifferenceView,
} from "@liratek/core";
import {
  CloseDifferenceDialog,
  ReopenDifferenceButton,
} from "../CloseDifferenceDialog";

const mockClose = jest.fn();
const mockReopen = jest.fn();
const mockApi = {
  closeCheckpointDifference: mockClose,
  reopenCheckpointDifference: mockReopen,
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

function difference(
  over: Partial<CheckpointDifferenceView>,
): CheckpointDifferenceView {
  return {
    id: 103,
    closing_id: 13,
    // 15:00 UTC = 18:00 Beirut, Oct 12.
    closing_created_at: "2026-10-12 15:00:00",
    drawer_name: "OMT_System",
    currency_code: "USD",
    amount: -20,
    direction: "SHORT",
    resolved: 12,
    open: 8,
    status: "PARTLY_RESOLVED",
    closed_at: null,
    closed_by_name: null,
    shortage_expense_id: null,
    resolutions: [],
    ...over,
  };
}

beforeEach(() => {
  mockClose.mockReset();
  mockReopen.mockReset();
});

function renderDialog(d: CheckpointDifferenceView) {
  const onCancel = jest.fn();
  const onDone = jest.fn();
  render(
    <CloseDifferenceDialog
      difference={d}
      checkpointLabel="OMT Cash Drawer · Oct 12, 06:00 PM"
      onCancel={onCancel}
      onDone={onDone}
    />,
  );
  return { onCancel, onDone };
}

describe("CloseDifferenceDialog", () => {
  it("a Short names the open amount and the checkpoint day, and confirms with Close as short", () => {
    renderDialog(difference({}));

    expect(screen.getByText("Close difference")).toBeTruthy();
    expect(screen.getByText("OMT Cash Drawer · Oct 12, 06:00 PM")).toBeTruthy();
    expect(screen.getByText("Short $8.00")).toBeTruthy();
    const body = screen.getByTestId("close-difference-body");
    expect(body.textContent).toContain("Drawer shortage");
    expect(body.textContent).toContain("$8.00");
    expect(body.textContent).toContain("Oct 12");
    expect(screen.getByRole("button", { name: "Close as short" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close as over" })).toBeNull();
    expect(
      screen.getByText(
        "You can reopen it later if the missing entry turns up.",
      ),
    ).toBeTruthy();
  });

  it("an Over records nothing and confirms with Close as over", () => {
    renderDialog(
      difference({
        amount: 15,
        direction: "OVER",
        resolved: 0,
        open: 15,
        status: "OPEN",
      }),
    );

    expect(screen.getByText("Over $15.00")).toBeTruthy();
    expect(screen.getByTestId("close-difference-body").textContent).toContain(
      "Nothing is recorded",
    );
    expect(screen.getByRole("button", { name: "Close as over" })).toBeTruthy();
  });

  it("a Short in EUR says no expense is recorded for that currency", () => {
    renderDialog(difference({ currency_code: "EUR" }));

    const body = screen.getByTestId("close-difference-body");
    expect(body.textContent).toContain("EUR");
    expect(body.textContent).toContain("no Drawer shortage expense");
    expect(screen.getByRole("button", { name: "Close as short" })).toBeTruthy();
  });

  it("confirm sends the schema's difference_id and reports success", async () => {
    const updated = difference({ status: "CLOSED", closed_by_name: "Amir" });
    mockClose.mockResolvedValue({ success: true, data: updated });
    const { onDone } = renderDialog(difference({}));

    fireEvent.click(screen.getByRole("button", { name: "Close as short" }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(updated));
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(mockClose).toHaveBeenCalledWith(
      closeCheckpointDifferenceSchema.parse({ difference_id: 103 }),
    );
  });

  it("shows the server's error on {success:false} and stays open", async () => {
    mockClose.mockResolvedValue({
      success: false,
      error: "Nothing left open to close",
    });
    const { onDone } = renderDialog(difference({}));

    fireEvent.click(screen.getByRole("button", { name: "Close as short" }));

    expect(await screen.findByText("Nothing left open to close")).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("Cancel closes without calling the server", () => {
    const { onCancel } = renderDialog(difference({}));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
  });
});

describe("ReopenDifferenceButton", () => {
  it("calls reopenCheckpointDifference with the schema's difference_id", async () => {
    const updated = difference({ status: "PARTLY_RESOLVED" });
    mockReopen.mockResolvedValue({ success: true, data: updated });
    const onDone = jest.fn();
    render(<ReopenDifferenceButton differenceId={104} onDone={onDone} />);

    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(updated));
    expect(mockReopen).toHaveBeenCalledWith(
      reopenCheckpointDifferenceSchema.parse({ difference_id: 104 }),
    );
  });

  it("shows the server's error when reopen is refused", async () => {
    mockReopen.mockResolvedValue({ success: false, error: "Not closed" });
    const onDone = jest.fn();
    render(<ReopenDifferenceButton differenceId={104} onDone={onDone} />);

    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));

    expect(await screen.findByText("Not closed")).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });
});
