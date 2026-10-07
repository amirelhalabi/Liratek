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
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import PartPicker, { type PartLine } from "../PartPicker";
import type { Product } from "@liratek/ui";

const mockGetProducts = jest.fn();

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    getProducts: mockGetProducts,
  }),
}));

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
