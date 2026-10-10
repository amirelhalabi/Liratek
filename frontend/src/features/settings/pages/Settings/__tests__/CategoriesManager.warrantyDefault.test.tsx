/** @jest-environment jsdom */
/**
 * LIRA-296 (T018) — a "Default warranty (months)" per category in Settings.
 * Empty means "No warranty". Saving sends `warranty_months` (a number, or
 * null when cleared) through `useApi().updateCategory` (rule 19). A value
 * outside 0–60 is refused on the page, before any call.
 * The `useApi` mock returns ONE stable object (rule 25).
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
    expect(await input("Phones")).toHaveValue(12);
    const acc = await input("Accessories");
    expect(acc).toHaveValue(null);
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
