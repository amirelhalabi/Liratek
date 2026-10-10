/** @jest-environment jsdom */
/**
 * LIRA-296 (T021) — "Warranty: N months (edit)" on each cart line.
 *   - The default shown is the product's own length, else its category's
 *     default (Settings), else "No warranty".
 *   - Editing it reports the new length for this line only (0–60), and
 *     "Use default" clears the edit.
 * The `useApi` mock returns ONE stable object (rule 25).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CartItem } from "@liratek/ui";
import { CartLineRow } from "../CartLineRow";

const mockApi = {
  productUnits: { getForProduct: jest.fn().mockResolvedValue([]) },
  getCategoriesFull: jest.fn(),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

const item = (over: Partial<CartItem> = {}): CartItem => ({
  id: 1,
  name: "Charger",
  barcode: "C-1",
  category: "Accessories",
  quantity: 1,
  retail_price: 10,
  cost_price: 5,
  ...over,
});

function renderRow(i: CartItem) {
  const onSetWarranty = jest.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <CartLineRow
        item={i}
        allItems={[i]}
        onUpdateQuantity={jest.fn()}
        onRemoveItem={jest.fn()}
        onSelectUnit={jest.fn()}
        onSetWarranty={onSetWarranty}
      />
    </QueryClientProvider>,
  );
  return { onSetWarranty };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.getCategoriesFull.mockResolvedValue([
    { id: 2, name: "Accessories", sort_order: 0, is_active: 1, tracks_imei_units: 0, warranty_months: 1 },
    { id: 3, name: "Cables", sort_order: 1, is_active: 1, tracks_imei_units: 0, warranty_months: null },
  ]);
});

describe("CartLineRow — per-line warranty (LIRA-296)", () => {
  it("shows the product's own length", async () => {
    renderRow(item({ warranty_months: 3 }));
    expect(await screen.findByText("Warranty: 3 months")).toBeInTheDocument();
  });

  it("falls back to the category default", async () => {
    renderRow(item({ warranty_months: null }));
    expect(await screen.findByText("Warranty: 1 month")).toBeInTheDocument();
  });

  it("shows 'No warranty' when neither has one", async () => {
    renderRow(item({ warranty_months: null, category: "Cables" }));
    await waitFor(() => expect(mockApi.getCategoriesFull).toHaveBeenCalled());
    expect(await screen.findByText("No warranty")).toBeInTheDocument();
  });

  it("shows the till edit instead of the default", async () => {
    renderRow(item({ warranty_months: 3, warranty_months_edit: 6 }));
    expect(await screen.findByText("Warranty: 6 months (edited)")).toBeInTheDocument();
  });

  it("editing reports the new length for this line", async () => {
    const { onSetWarranty } = renderRow(item({ warranty_months: 3 }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit warranty" }));
    const box = screen.getByLabelText("Warranty months for Charger");
    expect(box).toHaveValue(3);
    fireEvent.change(box, { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Save warranty" }));
    expect(onSetWarranty).toHaveBeenCalledWith("1", 6);
  });

  it("refuses more than 60 months", async () => {
    const { onSetWarranty } = renderRow(item({ warranty_months: 3 }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit warranty" }));
    fireEvent.change(screen.getByLabelText("Warranty months for Charger"), {
      target: { value: "61" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save warranty" }));
    expect(onSetWarranty).not.toHaveBeenCalled();
    expect(screen.getByText("0 to 60 months")).toBeInTheDocument();
  });

  it("'Use default' clears the edit", async () => {
    const { onSetWarranty } = renderRow(
      item({ warranty_months: 3, warranty_months_edit: 6 }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Edit warranty" }));
    fireEvent.click(screen.getByRole("button", { name: "Use default" }));
    expect(onSetWarranty).toHaveBeenCalledWith("1", null);
  });
});
