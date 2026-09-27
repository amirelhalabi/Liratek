/** @jest-environment jsdom */

/**
 * Owner decision 2026-09-26: scanning/typing a defective unit's IMEI
 * straight into the POS search box auto-adds it to the cart today with no
 * mark and no confirmation (`ProductSearch.tsx`'s barcode-scan auto-add
 * path, fed by `api.resolveScanCode`). This mirrors the same gap fixed in
 * the cart's IMEI dropdown (CartLineRow.tsx): a defective phone must still
 * be sellable, but picking one — including via scan — must ask first.
 *
 * Fix under test: when `resolveScanCode` resolves a `matched_unit` with
 * `is_defective`, the auto-add pauses behind a confirm dialog ("This phone
 * is marked defective — sell anyway?") instead of calling `onAddToCart`
 * immediately. Cancel leaves the cart untouched; Confirm adds it exactly as
 * today's unconditional path does. A non-defective scan is unaffected.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ProductSearch from "../ProductSearch";
import type { Product } from "@liratek/ui";

const mockGetTodaysSales = jest.fn();
const mockGetProducts = jest.fn();
const mockResolveScanCode = jest.fn();

// Rule 25 (CLAUDE.md) — `useApi()` MUST return a STABLE reference; a fresh
// object literal per call would re-fire ProductSearch's `[..., api]`
// effects every render. Matches the pattern already established in
// ProductSearch.dstDateShift.test.tsx.
const mockApi = {
  getTodaysSales: mockGetTodaysSales,
  getProducts: mockGetProducts,
  resolveScanCode: mockResolveScanCode,
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
  appEvents: { emit: jest.fn(), on: jest.fn(() => () => {}) },
}));

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 1,
    name: "Galaxy S21",
    category: "Mobiles",
    barcode: "",
    retail_price: 500,
    cost_price: 300,
    stock_quantity: 3,
    min_stock_level: 1,
    is_active: 1,
    tracks_imei_units: 1,
    ...overrides,
  } as Product;
}

const SCAN_IMEI = "356938035643809";

describe("ProductSearch — scanning a defective IMEI asks to confirm first", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetTodaysSales.mockResolvedValue([]);
    mockGetProducts.mockResolvedValue([]);
  });

  it("opens a confirm dialog instead of auto-adding, for a defective matched unit", async () => {
    mockResolveScanCode.mockResolvedValue({
      success: true,
      data: {
        product: makeProduct(),
        matched_unit: { id: 202, imei: SCAN_IMEI, is_defective: 1 },
      },
    });
    const onAddToCart = jest.fn().mockResolvedValue(true);
    render(<ProductSearch onAddToCart={onAddToCart} />);
    await waitFor(() => expect(mockGetTodaysSales).toHaveBeenCalled());

    const input = screen.getByPlaceholderText(/Search products/i);
    fireEvent.change(input, { target: { value: SCAN_IMEI } });

    await waitFor(
      () => expect(mockResolveScanCode).toHaveBeenCalledWith(SCAN_IMEI),
      { timeout: 3000 },
    );
    await waitFor(() =>
      expect(
        screen.getByText("This phone is marked defective — sell anyway?"),
      ).toBeInTheDocument(),
    );
    expect(onAddToCart).not.toHaveBeenCalled();
  });

  it("Cancel leaves the cart untouched and closes the dialog", async () => {
    mockResolveScanCode.mockResolvedValue({
      success: true,
      data: {
        product: makeProduct(),
        matched_unit: { id: 202, imei: SCAN_IMEI, is_defective: 1 },
      },
    });
    const onAddToCart = jest.fn().mockResolvedValue(true);
    render(<ProductSearch onAddToCart={onAddToCart} />);
    await waitFor(() => expect(mockGetTodaysSales).toHaveBeenCalled());

    const input = screen.getByPlaceholderText(
      /Search products/i,
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: SCAN_IMEI } });

    await waitFor(
      () =>
        expect(
          screen.getByText("This phone is marked defective — sell anyway?"),
        ).toBeInTheDocument(),
      { timeout: 3000 },
    );

    fireEvent.click(screen.getByTestId("confirm-modal-cancel-btn"));

    expect(onAddToCart).not.toHaveBeenCalled();
    expect(
      screen.queryByText("This phone is marked defective — sell anyway?"),
    ).not.toBeInTheDocument();
  });

  it("Confirm adds the defective unit to the cart, exactly like today's non-defective path", async () => {
    const product = makeProduct();
    mockResolveScanCode.mockResolvedValue({
      success: true,
      data: {
        product,
        matched_unit: { id: 202, imei: SCAN_IMEI, is_defective: 1 },
      },
    });
    const onAddToCart = jest.fn().mockResolvedValue(true);
    render(<ProductSearch onAddToCart={onAddToCart} />);
    await waitFor(() => expect(mockGetTodaysSales).toHaveBeenCalled());

    const input = screen.getByPlaceholderText(
      /Search products/i,
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: SCAN_IMEI } });

    await waitFor(
      () =>
        expect(
          screen.getByText("This phone is marked defective — sell anyway?"),
        ).toBeInTheDocument(),
      { timeout: 3000 },
    );

    fireEvent.click(screen.getByTestId("confirm-modal-confirm-btn"));

    await waitFor(() =>
      expect(onAddToCart).toHaveBeenCalledWith(product, {
        id: 202,
        imei: SCAN_IMEI,
      }),
    );
  });

  it("a non-defective matched unit auto-adds immediately with no confirm dialog (unchanged behavior)", async () => {
    const product = makeProduct();
    mockResolveScanCode.mockResolvedValue({
      success: true,
      data: {
        product,
        matched_unit: { id: 101, imei: SCAN_IMEI, is_defective: 0 },
      },
    });
    const onAddToCart = jest.fn().mockResolvedValue(true);
    render(<ProductSearch onAddToCart={onAddToCart} />);
    await waitFor(() => expect(mockGetTodaysSales).toHaveBeenCalled());

    const input = screen.getByPlaceholderText(/Search products/i);
    fireEvent.change(input, { target: { value: SCAN_IMEI } });

    await waitFor(
      () =>
        expect(onAddToCart).toHaveBeenCalledWith(product, {
          id: 101,
          imei: SCAN_IMEI,
        }),
      { timeout: 3000 },
    );
    expect(
      screen.queryByText("This phone is marked defective — sell anyway?"),
    ).not.toBeInTheDocument();
  });
});
