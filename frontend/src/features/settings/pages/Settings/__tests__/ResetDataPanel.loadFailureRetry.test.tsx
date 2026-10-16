/** @jest-environment jsdom */
/**
 * Seed-run finding (2026-10-16): Settings › Reset Data's "Reset All Data"
 * button stayed disabled for 30 s when the preview request stalled or
 * failed. A failure showed only a generic line (the web transport throws a
 * plain `{ status, message }` object, not an `Error`, so its real message
 * was dropped) and there was no way to try again; a stall showed
 * "Loading preview..." forever. The panel must show the real reason with a
 * Retry button, and offer Retry when the preview takes too long.
 */

import { render, screen, fireEvent, act } from "@testing-library/react";
import ResetDataPanel from "../ResetDataPanel";

const mockGetPreview = jest.fn();
// A STABLE object reference (rule 25).
const mockApi = {
  getDatabaseResetPreview: mockGetPreview,
  resetDatabase: jest.fn(),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

const PREVIEW = { counts: { transactions: 3 }, totalRows: 3 };

function resetButton() {
  return screen.getByTestId("reset-data-open-modal-btn");
}

describe("ResetDataPanel — preview failure and stall", () => {
  beforeEach(() => {
    mockGetPreview.mockReset();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("shows the server's message and a Retry that loads the preview", async () => {
    mockGetPreview
      .mockRejectedValueOnce({ status: 503, message: "Server restarting" })
      .mockResolvedValueOnce(PREVIEW);

    render(<ResetDataPanel />);

    expect(await screen.findByText(/Server restarting/)).toBeInTheDocument();
    expect(resetButton()).toBeDisabled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    });
    expect(await screen.findByTestId("reset-data-preview")).toBeInTheDocument();
    expect(resetButton()).not.toBeDisabled();
    expect(mockGetPreview).toHaveBeenCalledTimes(2);
  });

  it("offers Retry when the preview stalls, and a late answer for the stalled request is ignored", async () => {
    jest.useFakeTimers();
    let resolveStalled: (v: typeof PREVIEW) => void = () => {};
    mockGetPreview
      .mockReturnValueOnce(
        new Promise((r) => {
          resolveStalled = r;
        }),
      )
      .mockResolvedValueOnce({ counts: { clients: 1 }, totalRows: 1 });

    render(<ResetDataPanel />);
    expect(screen.getByText(/Loading preview/)).toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(15_000);
    });
    expect(screen.getByTestId("reset-data-slow")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    });
    expect(await screen.findByTestId("reset-data-preview")).toHaveTextContent(
      "Clients",
    );
    expect(resetButton()).not.toBeDisabled();

    // The first (stalled) request finally answers — it must not replace
    // the newer preview.
    await act(async () => {
      resolveStalled(PREVIEW);
    });
    expect(screen.getByTestId("reset-data-preview")).not.toHaveTextContent(
      "Transactions",
    );
  });
});
