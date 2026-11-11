/**
 * ResetDataPanel — 2 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 2).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import {
  render,
  screen,
  waitFor,
  within,
  fireEvent,
  act,
} from "@testing-library/react";
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

function resetBetweenFiles() {
  jest.clearAllMocks();
  (mockGetPreview as unknown as jest.Mock).mockReset();
  (mockApi.resetDatabase as unknown as jest.Mock).mockReset();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("ResetDataPanel.keepsSetup", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Settings › Reset Data panel must describe exactly what a reset keeps and
   * what it deletes (owner decision 2026-10-07: keep the shop's setup, wipe
   * only operational data). The old text said "Products, stock" and "the
   * mobile-services catalog" are deleted and never mentioned categories,
   * presets, partners or suppliers at all — so a shop owner could not tell
   * their setup survives.
   */

  describe("ResetDataPanel keeps/deletes text", () => {
    beforeEach(() => {
      mockGetPreview.mockReset();
      mockGetPreview.mockResolvedValue({
        counts: { transactions: 3, product_stock_batches: 2, clients: 1 },
        totalRows: 6,
      });
    });

    it("lists the shop's setup under KEEPS", async () => {
      render(<ResetDataPanel />);
      await waitFor(() =>
        expect(screen.getByTestId("reset-data-preview")).toBeInTheDocument(),
      );

      const keeps = within(screen.getByTestId("reset-data-keeps"));
      keeps.getByText(/product categories/i);
      keeps.getByText(/products.*stock and minimum stock set to 0/i);
      keeps.getByText(/mobile services items/i);
      keeps.getByText(/service presets/i);
      keeps.getByText(/partners and suppliers.*balances.*0/i);
    });

    it("lists only operational data under DELETES — never the catalog or suppliers themselves", async () => {
      render(<ResetDataPanel />);
      await waitFor(() =>
        expect(screen.getByTestId("reset-data-preview")).toBeInTheDocument(),
      );

      const deletes = screen.getByTestId("reset-data-deletes");
      const text = deletes.textContent ?? "";
      expect(text).toMatch(/transactions/i);
      expect(text).toMatch(/clients/i);
      expect(text).toMatch(/stock history/i);
      expect(text).not.toMatch(/products,/i);
      expect(text).not.toMatch(/catalog/i);
      expect(text).not.toMatch(/re-seeds/i);
    });

    it("labels the stock rows in the preview as stock, not products", async () => {
      render(<ResetDataPanel />);
      const preview = await screen.findByTestId("reset-data-preview");
      expect(preview.textContent).not.toMatch(/Products & stock/);
      expect(preview.textContent).toMatch(/Stock & purchases/);
    });
  });
});

describe("ResetDataPanel.loadFailureRetry", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Seed-run finding (2026-10-16): Settings › Reset Data's "Reset All Data"
   * button stayed disabled for 30 s when the preview request stalled or
   * failed. A failure showed only a generic line (the web transport throws a
   * plain `{ status, message }` object, not an `Error`, so its real message
   * was dropped) and there was no way to try again; a stall showed
   * "Loading preview..." forever. The panel must show the real reason with a
   * Retry button, and offer Retry when the preview takes too long.
   */

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
      expect(
        await screen.findByTestId("reset-data-preview"),
      ).toBeInTheDocument();
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
});
