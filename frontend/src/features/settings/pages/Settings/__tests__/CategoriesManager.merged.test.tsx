/**
 * CategoriesManager — 2 per-ticket test files merged into one suite
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

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CategoriesManager from "../CategoriesManager";

const mockApi = {
  getCategoriesFull: jest.fn(),
  createCategory: jest.fn(),
  updateCategory: jest.fn(),
  deleteCategory: jest.fn(),
  getProductSuppliersFull: jest.fn(),
  createProductSupplier: jest.fn(),
  updateProductSupplier: jest.fn(),
  deleteProductSupplier: jest.fn(),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

function resetBetweenFiles() {
  jest.clearAllMocks();
  (mockApi.getCategoriesFull as unknown as jest.Mock).mockReset();
  (mockApi.createCategory as unknown as jest.Mock).mockReset();
  (mockApi.updateCategory as unknown as jest.Mock).mockReset();
  (mockApi.deleteCategory as unknown as jest.Mock).mockReset();
  (mockApi.getProductSuppliersFull as unknown as jest.Mock).mockReset();
  (mockApi.createProductSupplier as unknown as jest.Mock).mockReset();
  (mockApi.updateProductSupplier as unknown as jest.Mock).mockReset();
  (mockApi.deleteProductSupplier as unknown as jest.Mock).mockReset();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("CategoriesManager.serial (LIRA-296)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-296 P3 (T047, T048) — a serial-tracked category chooses what its
   * serial is called (IMEI or Serial) and what happens when an item is sold
   * without picking its unit (block the sale, or allow it with a warning).
   * Both save through `useApi().updateCategory` (rule 19); the choices only
   * show for a category that tracks serials.
   */

  const LAPTOPS = {
    id: 5,
    name: "Laptops",
    sort_order: 0,
    is_active: 1,
    tracks_imei_units: 1,
    warranty_months: null,
    serial_label: "Serial",
    serial_required: "BLOCK",
  };
  const ACCESSORIES = {
    id: 2,
    name: "Accessories",
    sort_order: 1,
    is_active: 1,
    tracks_imei_units: 0,
    warranty_months: null,
    serial_label: "Serial",
    serial_required: "BLOCK",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.getCategoriesFull.mockResolvedValue([LAPTOPS, ACCESSORIES]);
    mockApi.getProductSuppliersFull.mockResolvedValue([]);
    mockApi.updateCategory.mockResolvedValue({ success: true });
  });

  it("shows the label and the rule only for a category that tracks serials", async () => {
    render(<CategoriesManager />);
    const label = await screen.findByLabelText("Serial name for Laptops");
    expect(label).toHaveValue("Serial");
    expect(
      screen.getByLabelText("Sold without a serial — Laptops"),
    ).toHaveValue("BLOCK");
    expect(screen.queryByLabelText("Serial name for Accessories")).toBeNull();
  });

  it("saves the serial name", async () => {
    render(<CategoriesManager />);
    fireEvent.change(await screen.findByLabelText("Serial name for Laptops"), {
      target: { value: "IMEI" },
    });
    await waitFor(() =>
      expect(mockApi.updateCategory).toHaveBeenCalledWith(5, {
        serial_label: "IMEI",
      }),
    );
  });

  it("saves the rule for a sale without the serial", async () => {
    render(<CategoriesManager />);
    fireEvent.change(
      await screen.findByLabelText("Sold without a serial — Laptops"),
      { target: { value: "WARN" } },
    );
    await waitFor(() =>
      expect(mockApi.updateCategory).toHaveBeenCalledWith(5, {
        serial_required: "WARN",
      }),
    );
  });
});

describe("CategoriesManager.warrantyDefault (LIRA-296)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-296 (T018) — a "Default warranty (months)" per category in Settings.
   * Empty means "No warranty". Saving sends `warranty_months` (a number, or
   * null when cleared) through `useApi().updateCategory` (rule 19). A value
   * outside 0–60 is refused on the page, before any call.
   * The `useApi` mock returns ONE stable object (rule 25).
   */

  const PHONES = {
    id: 1,
    name: "Phones",
    sort_order: 0,
    is_active: 1,
    tracks_imei_units: 1,
    warranty_months: 12,
  };
  const ACCESSORIES = {
    id: 2,
    name: "Accessories",
    sort_order: 1,
    is_active: 1,
    tracks_imei_units: 0,
    warranty_months: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.getCategoriesFull.mockResolvedValue([PHONES, ACCESSORIES]);
    mockApi.getProductSuppliersFull.mockResolvedValue([]);
    mockApi.updateCategory.mockResolvedValue({ success: true });
  });

  const input = (name: string) =>
    screen.findByLabelText(`Default warranty (months) for ${name}`);

  beforeEach(() => {
    render(<CategoriesManager />);
  });

  describe("CategoriesManager — default warranty per category (LIRA-296)", () => {
    it("shows each category's default, and 'No warranty' when there is none", async () => {
      expect(await input("Phones")).toHaveValue("12");
      const acc = await input("Accessories");
      expect(acc).toHaveValue("");
      expect(acc).toHaveAttribute("placeholder", "No warranty");
    });

    it("saves a new default as warranty_months", async () => {
      const acc = await input("Accessories");
      fireEvent.change(acc, { target: { value: "1" } });
      fireEvent.blur(acc);
      await waitFor(() =>
        expect(mockApi.updateCategory).toHaveBeenCalledWith(2, {
          warranty_months: 1,
        }),
      );
    });

    it("clearing the box saves null (no warranty)", async () => {
      const phones = await input("Phones");
      fireEvent.change(phones, { target: { value: "" } });
      fireEvent.blur(phones);
      await waitFor(() =>
        expect(mockApi.updateCategory).toHaveBeenCalledWith(1, {
          warranty_months: null,
        }),
      );
    });

    it("does not save when nothing changed", async () => {
      const phones = await input("Phones");
      fireEvent.blur(phones);
      await new Promise((r) => setTimeout(r, 20));
      expect(mockApi.updateCategory).not.toHaveBeenCalled();
    });

    it("refuses more than 60 months without calling the server", async () => {
      const acc = await input("Accessories");
      fireEvent.change(acc, { target: { value: "61" } });
      fireEvent.blur(acc);
      expect(
        await screen.findByText("Warranty must be 0 to 60 whole months."),
      ).toBeInTheDocument();
      expect(mockApi.updateCategory).not.toHaveBeenCalled();
    });
  });
});
