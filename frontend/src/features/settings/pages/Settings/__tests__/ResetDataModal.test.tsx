/** @jest-environment jsdom */
/**
 * ResetDataModal (LIRA-165) — the typed-confirmation guard on the
 * destructive Reset Data action. Real `DATABASE_RESET_CONFIRMATION_PHRASE`
 * comes from @liratek/core (frontend jest resolves it to browser.ts, same
 * as every other pure core constant — no mock needed for it), so these
 * assertions exercise the real string, not a stand-in.
 *
 * These tests deliberately never let a real reset "succeed" all the way to
 * the reload branch — `window.location.reload()` isn't implemented in
 * jsdom, and the guard itself (never running a real reset) is what the plan
 * asks e2e to prove too (DATABASE_RESET_PLAN.md Phase 5).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ResetDataModal from "../ResetDataModal";
import { DATABASE_RESET_CONFIRMATION_PHRASE } from "@liratek/core";

const mockResetDatabase = jest.fn();
// A STABLE object reference — see CarrierLinesManager.test.tsx's own note:
// a fresh object literal per useApi() call would re-trigger any effect that
// depends on [api].
const mockApi = {
  resetDatabase: mockResetDatabase,
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

function openModal(totalRows = 1234) {
  return render(<ResetDataModal totalRows={totalRows} onClose={jest.fn()} />);
}

describe("ResetDataModal", () => {
  beforeEach(() => {
    mockResetDatabase.mockReset();
  });

  it("keeps the confirm button disabled until the exact phrase is typed", () => {
    openModal();

    const confirmBtn = screen.getByTestId(
      "reset-data-confirm-btn",
    ) as HTMLButtonElement;
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(screen.getByTestId("reset-data-phrase-input"), {
      target: { value: DATABASE_RESET_CONFIRMATION_PHRASE },
    });

    expect(confirmBtn).not.toBeDisabled();
  });

  it("keeps the confirm button disabled on a near-miss phrase (wrong case / trailing space)", () => {
    openModal();
    const confirmBtn = screen.getByTestId(
      "reset-data-confirm-btn",
    ) as HTMLButtonElement;
    const input = screen.getByTestId("reset-data-phrase-input");

    fireEvent.change(input, {
      target: { value: DATABASE_RESET_CONFIRMATION_PHRASE.toLowerCase() },
    });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(input, {
      target: { value: `${DATABASE_RESET_CONFIRMATION_PHRASE} ` },
    });
    expect(confirmBtn).toBeDisabled();

    expect(mockResetDatabase).not.toHaveBeenCalled();
  });

  it("calls resetDatabase exactly once with the typed phrase on confirm", async () => {
    mockResetDatabase.mockResolvedValue({
      success: true,
      data: { deletedRows: {}, totalDeleted: 42 },
    });

    openModal();
    fireEvent.change(screen.getByTestId("reset-data-phrase-input"), {
      target: { value: DATABASE_RESET_CONFIRMATION_PHRASE },
    });
    fireEvent.click(screen.getByTestId("reset-data-confirm-btn"));

    await waitFor(() =>
      expect(mockResetDatabase).toHaveBeenCalledTimes(1),
    );
    expect(mockResetDatabase).toHaveBeenCalledWith({
      confirmation: DATABASE_RESET_CONFIRMATION_PHRASE,
    });
  });

  it("shows the error and does not reload on a {success:false} response", async () => {
    mockResetDatabase.mockResolvedValue({
      success: false,
      error: "Backup failed, reset aborted",
    });
    const reloadSpy = jest.fn();
    const originalLocation = window.location;
    // jsdom's window.location.reload throws "Not implemented" — replace it
    // so a bug that DID reload would fail loudly instead of crashing jsdom.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, reload: reloadSpy },
    });

    try {
      openModal();
      fireEvent.change(screen.getByTestId("reset-data-phrase-input"), {
        target: { value: DATABASE_RESET_CONFIRMATION_PHRASE },
      });
      fireEvent.click(screen.getByTestId("reset-data-confirm-btn"));

      expect(
        await screen.findByText("Backup failed, reset aborted"),
      ).toBeInTheDocument();
      expect(reloadSpy).not.toHaveBeenCalled();
      // The modal stays open on the confirmation screen, not the "success"
      // one — the phrase input (hidden once status becomes "success") is
      // still present.
      expect(
        screen.getByTestId("reset-data-phrase-input"),
      ).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: originalLocation,
      });
    }
  });
});
