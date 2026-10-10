/** @jest-environment jsdom */
/**
 * LIRA-296 P3 (T047, T048) — a serial-tracked category chooses what its
 * serial is called (IMEI or Serial) and what happens when an item is sold
 * without picking its unit (block the sale, or allow it with a warning).
 * Both save through `useApi().updateCategory` (rule 19); the choices only
 * show for a category that tracks serials.
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
  expect(screen.getByLabelText("Sold without a serial — Laptops")).toHaveValue(
    "BLOCK",
  );
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
