/**
 * PartPicker — 2 per-ticket test files merged into one suite
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

import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PartPicker, { type PartLine } from "../PartPicker";
import { type Product } from "@liratek/ui";

const mockGetProducts = jest.fn();

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    getProducts: mockGetProducts,
  }),
}));

function resetBetweenFiles() {
  jest.clearAllMocks();
  (mockGetProducts as unknown as jest.Mock).mockReset();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("PartPicker.priceChangeWarning (LIRA-260)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * PartPicker — LIRA-260 price-change warning on maintenance parts (LIRA-263).
   *
   * A part added from the catalog pre-fills its price from the product's
   * `retail_price`; when the cashier edits that price away from it, the shared
   * amber `PriceChangeWarning` shows both prices. Warning only — the edited
   * price is still what gets saved.
   *
   * The `useApi` mock deliberately returns a fresh object literal per call
   * (CLAUDE.md rule 25) so an unstable-identity effect would loop here.
   *
   * Rule 17: written before the PartPicker change and run against it — the
   * "edited price" case failed (no `price-change-warning` element).
   */

  const screenAssembly = {
    id: 5,
    barcode: "PART-0005",
    name: "Screen Assembly",
    category: "Parts",
    cost_price: 25,
    retail_price: 40,
    stock_quantity: 3,
    min_stock_level: 1,
  } as unknown as Product;

  function Harness({ initial = [] }: { initial?: PartLine[] }) {
    const [parts, setParts] = useState<PartLine[]>(initial);
    return <PartPicker parts={parts} onChange={setParts} />;
  }

  async function addScreenAssembly() {
    fireEvent.change(screen.getByPlaceholderText("Search parts..."), {
      target: { value: "screen" },
    });
    fireEvent.click(await screen.findByText("Screen Assembly"));
  }

  describe("PartPicker — price change warning (LIRA-260)", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockGetProducts.mockResolvedValue([screenAssembly]);
    });

    it("shows no warning while the part is at its catalog price", async () => {
      render(<Harness />);
      await addScreenAssembly();

      expect(screen.getByDisplayValue("40")).toBeInTheDocument();
      expect(screen.queryByTestId("price-change-warning")).toBeNull();
    });

    it("editing the part price shows the warning with both prices", async () => {
      render(<Harness />);
      await addScreenAssembly();

      fireEvent.change(screen.getByDisplayValue("40"), {
        target: { value: "55" },
      });

      const warning = await screen.findByTestId("price-change-warning");
      expect(warning).toHaveTextContent("$40.00");
      expect(warning).toHaveTextContent("$55.00");
    });

    it("a line with no catalog price (product gone) shows no warning", () => {
      render(
        <Harness
          initial={[
            {
              id: 42,
              product_id: 9,
              product_name: "Battery",
              quantity: 1,
              unit_price_usd: 15,
            },
          ]}
        />,
      );
      expect(screen.queryByTestId("price-change-warning")).toBeNull();
    });
  });
});

describe("PartPicker (LIRA-176)", () => {
  beforeAll(resetBetweenFiles);

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
      const { rerender } = render(
        <PartPicker parts={[]} onChange={onChange} />,
      );

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
});
