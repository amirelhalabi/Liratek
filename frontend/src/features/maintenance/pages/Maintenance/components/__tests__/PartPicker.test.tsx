/**
 * PartPicker (LIRA-176 phase 8b, item 5) — the maintenance parts editor.
 *
 * Guards:
 *  - defaults the product search to the "Parts" category
 *  - the "Search all categories" toggle widens the query (asserted against
 *    the actual arguments passed to `getProducts`, not just visible results)
 *  - a newly added part pre-fills its price from the product's
 *    `retail_price` and that price stays editable afterward
 *  - a line loaded from an existing job (has `id`) keeps that `id` when
 *    edited; a freshly added line never carries one — this is the exact
 *    signal `MaintenanceRepository.syncParts` uses to tell "reconcile this
 *    existing row" from "insert a new one".
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PartPicker, { type PartLine } from "../PartPicker";
import type { Product } from "@liratek/ui";

const mockGetProducts = jest.fn();

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    getProducts: mockGetProducts,
  }),
}));

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 5,
    barcode: "PART-0005",
    name: "Screen Assembly",
    category: "Parts",
    cost_price: 25,
    retail_price: 40,
    stock_quantity: 3,
    min_stock_level: 1,
    tracks_imei_units: 0,
    warranty_months: null,
    created_at: "2026-09-01 10:00:00",
    updated_at: "2026-09-01 10:00:00",
    ...overrides,
  } as unknown as Product;
}

describe("PartPicker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetProducts.mockResolvedValue([]);
  });

  it("defaults the search to the Parts category", async () => {
    const onChange = jest.fn();
    render(<PartPicker parts={[]} onChange={onChange} />);

    fireEvent.change(screen.getByPlaceholderText("Search parts..."), {
      target: { value: "screen" },
    });

    await waitFor(() => {
      expect(mockGetProducts).toHaveBeenCalledWith("screen", {
        categories: ["Parts"],
      });
    });
  });

  it("toggling 'Search all categories' widens the query to no category filter", async () => {
    const onChange = jest.fn();
    render(<PartPicker parts={[]} onChange={onChange} />);

    fireEvent.click(screen.getByText("Search all categories"));
    fireEvent.change(screen.getByPlaceholderText("Search all products..."), {
      target: { value: "cable" },
    });

    await waitFor(() => {
      expect(mockGetProducts).toHaveBeenCalledWith("cable", undefined);
    });
  });

  it("adding a product pre-fills price from retail_price with no id, and the price stays editable", async () => {
    mockGetProducts.mockResolvedValue([product()]);
    const onChange = jest.fn();
    const { rerender } = render(<PartPicker parts={[]} onChange={onChange} />);

    fireEvent.change(screen.getByPlaceholderText("Search parts..."), {
      target: { value: "screen" },
    });

    const resultButton = await screen.findByText("Screen Assembly");
    fireEvent.click(resultButton);

    expect(onChange).toHaveBeenCalledTimes(1);
    const added: PartLine[] = onChange.mock.calls[0][0];
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      product_id: 5,
      product_name: "Screen Assembly",
      quantity: 1,
      unit_price_usd: 40,
    });
    // A brand-new line must never carry an `id` — that field means "existing
    // row" to MaintenanceRepository.syncParts.
    expect(added[0]).not.toHaveProperty("id");

    // Simulate the controlled parent re-rendering with the new line, then
    // edit its price — it must be a live, editable input.
    rerender(<PartPicker parts={added} onChange={onChange} />);
    const priceInput = screen.getByDisplayValue("40") as HTMLInputElement;
    fireEvent.change(priceInput, { target: { value: "55" } });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(2);
    });
    const edited: PartLine[] = onChange.mock.calls[1][0];
    expect(edited[0].unit_price_usd).toBe(55);
    expect(edited[0]).not.toHaveProperty("id");
  });

  it("a line loaded from an existing job keeps its id when edited", async () => {
    const onChange = jest.fn();
    const loadedLine: PartLine = {
      id: 42,
      product_id: 9,
      product_name: "Battery",
      quantity: 2,
      unit_price_usd: 15,
    };
    render(<PartPicker parts={[loadedLine]} onChange={onChange} />);

    // Bump the quantity via the "+" button. The layout per line is
    // [minus, plus, remove]; lucide icons carry no accessible name here, so
    // scope by the line's price-input sibling structure instead.
    const priceInput = screen.getByDisplayValue("15");
    const line = priceInput.closest("div")!.parentElement as HTMLElement;
    const buttons = Array.from(line.querySelectorAll("button"));
    const incBtn = buttons[1];
    fireEvent.click(incBtn);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });
    const updated: PartLine[] = onChange.mock.calls[0][0];
    expect(updated[0].id).toBe(42);
    expect(updated[0].quantity).toBe(3);
  });
});
