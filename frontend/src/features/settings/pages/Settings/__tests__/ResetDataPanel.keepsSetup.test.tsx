/** @jest-environment jsdom */
/**
 * Settings › Reset Data panel must describe exactly what a reset keeps and
 * what it deletes (owner decision 2026-10-07: keep the shop's setup, wipe
 * only operational data). The old text said "Products, stock" and "the
 * mobile-services catalog" are deleted and never mentioned categories,
 * presets, partners or suppliers at all — so a shop owner could not tell
 * their setup survives.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
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
    keeps.getByText(/products.*stock.*set to 0/i);
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
