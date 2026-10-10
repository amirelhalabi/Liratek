/** @jest-environment jsdom */
/**
 * LIRA-296 P3 (T047, FR-015) — the cart line's unit picker says what the
 * category calls its serial: "Select Serial…" for a laptop category,
 * "Select IMEI…" for phones. The label comes from the category list
 * (`getCategoriesFull`), with the tracking flag as the fallback.
 * The `useApi` mock returns ONE stable object (rule 25).
 */
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CartLineRow } from "../CartLineRow";
import type { CartItem } from "@liratek/ui";

const mockApi = {
  productUnits: { getForProduct: jest.fn() },
  getCategoriesFull: jest.fn(),
};
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

function renderRow(item: CartItem) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CartLineRow
        item={item}
        allItems={[item]}
        onUpdateQuantity={jest.fn()}
        onRemoveItem={jest.fn()}
        onSelectUnit={jest.fn()}
      />
    </QueryClientProvider>,
  );
}

const item = (category: string): CartItem => ({
  id: 1,
  name: "Unit item",
  category,
  barcode: "111",
  quantity: 1,
  retail_price: 100,
  cost_price: 50,
  tracks_imei_units: 1,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.productUnits.getForProduct.mockResolvedValue([
    { id: 101, product_id: 1, imei: "SN-1", status: "IN_STOCK", is_defective: 0 },
  ]);
  mockApi.getCategoriesFull.mockResolvedValue([
    { name: "Laptops", tracks_imei_units: 1, serial_label: "Serial" },
    { name: "Phones", tracks_imei_units: 1, serial_label: "IMEI" },
  ]);
});

it("a Serial category's picker says 'Select Serial…'", async () => {
  renderRow(item("Laptops"));
  const select = await screen.findByRole("combobox");
  expect(
    await within(select).findByRole("option", { name: "Select Serial…" }),
  ).toBeInTheDocument();
});

it("a phone category's picker says 'Select IMEI…'", async () => {
  renderRow(item("Phones"));
  const select = await screen.findByRole("combobox");
  expect(
    await within(select).findByRole("option", { name: "Select IMEI…" }),
  ).toBeInTheDocument();
});
