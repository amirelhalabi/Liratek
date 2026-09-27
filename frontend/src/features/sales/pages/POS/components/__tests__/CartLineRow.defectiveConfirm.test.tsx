/** @jest-environment jsdom */

/**
 * Owner decision 2026-09-26: a refunded-as-defective phone unit comes back
 * IN_STOCK with `is_defective = 1` and today shows in the POS "Current
 * Sale" IMEI picker exactly like any other unit — no mark, no confirm — so
 * a defective phone can be sold by accident.
 *
 * Fix under test (CartLineRow.tsx): the dropdown option text gets a
 * "— Defective" suffix for a defective unit, and picking one opens a
 * confirm dialog ("This phone is marked defective — sell anyway?") before
 * `onSelectUnit` is ever called. Cancel must leave the selection exactly as
 * it was (onSelectUnit never called); Confirm applies it. A non-defective
 * unit is unaffected — no dialog, immediate `onSelectUnit`.
 */

import { render, screen, within, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CartLineRow } from "../CartLineRow";
import type { CartItem } from "@liratek/ui";

const mockGetForProduct = jest.fn();

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    productUnits: {
      getForProduct: mockGetForProduct,
    },
  }),
}));

function makeItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: 1,
    name: "Test Phone",
    category: "Mobiles",
    barcode: "111",
    quantity: 1,
    retail_price: 100,
    cost_price: 50,
    tracks_imei_units: 1,
    ...overrides,
  };
}

function renderRow(item: CartItem, allItems: CartItem[] = [item]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onSelectUnit = jest.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <CartLineRow
        item={item}
        allItems={allItems}
        onUpdateQuantity={jest.fn()}
        onRemoveItem={jest.fn()}
        onSelectUnit={onSelectUnit}
      />
    </QueryClientProvider>,
  );
  return { onSelectUnit };
}

describe("CartLineRow — defective-unit mark + confirm gate", () => {
  beforeEach(() => {
    mockGetForProduct.mockReset();
  });

  it("marks a defective unit's option text with 'Defective', leaves a clean unit unmarked", async () => {
    mockGetForProduct.mockResolvedValue([
      { id: 101, product_id: 1, imei: "IMEI-CLEAN", status: "IN_STOCK", is_defective: 0 },
      { id: 102, product_id: 1, imei: "IMEI-BAD", status: "IN_STOCK", is_defective: 1 },
    ]);
    renderRow(makeItem());

    const select = await screen.findByRole("combobox");
    expect(
      within(select).getByRole("option", { name: "IMEI-CLEAN" }),
    ).toBeInTheDocument();
    expect(
      within(select).getByRole("option", { name: /IMEI-BAD.*Defective/ }),
    ).toBeInTheDocument();
  });

  it("picking a defective unit opens a confirm dialog and does NOT call onSelectUnit yet", async () => {
    mockGetForProduct.mockResolvedValue([
      { id: 102, product_id: 1, imei: "IMEI-BAD", status: "IN_STOCK", is_defective: 1 },
    ]);
    const { onSelectUnit } = renderRow(makeItem());

    const select = await screen.findByRole("combobox");
    fireEvent.change(select, { target: { value: "102" } });

    expect(
      await screen.findByText(
        "This phone is marked defective — sell anyway?",
      ),
    ).toBeInTheDocument();
    expect(onSelectUnit).not.toHaveBeenCalled();
  });

  it("canceling the confirm dialog reverts the selection — onSelectUnit is never called", async () => {
    mockGetForProduct.mockResolvedValue([
      { id: 102, product_id: 1, imei: "IMEI-BAD", status: "IN_STOCK", is_defective: 1 },
    ]);
    const { onSelectUnit } = renderRow(makeItem());

    const select = await screen.findByRole("combobox");
    fireEvent.change(select, { target: { value: "102" } });
    await screen.findByText("This phone is marked defective — sell anyway?");

    fireEvent.click(screen.getByTestId("confirm-modal-cancel-btn"));

    expect(onSelectUnit).not.toHaveBeenCalled();
    expect(
      screen.queryByText("This phone is marked defective — sell anyway?"),
    ).not.toBeInTheDocument();
  });

  it("confirming the dialog calls onSelectUnit with the defective unit", async () => {
    mockGetForProduct.mockResolvedValue([
      { id: 102, product_id: 1, imei: "IMEI-BAD", status: "IN_STOCK", is_defective: 1 },
    ]);
    const { onSelectUnit } = renderRow(makeItem());

    const select = await screen.findByRole("combobox");
    fireEvent.change(select, { target: { value: "102" } });
    await screen.findByText("This phone is marked defective — sell anyway?");

    fireEvent.click(screen.getByTestId("confirm-modal-confirm-btn"));

    expect(onSelectUnit).toHaveBeenCalledWith("1", {
      id: 102,
      imei: "IMEI-BAD",
    });
  });

  it("a non-defective unit needs no confirm — onSelectUnit fires immediately", async () => {
    mockGetForProduct.mockResolvedValue([
      { id: 101, product_id: 1, imei: "IMEI-CLEAN", status: "IN_STOCK", is_defective: 0 },
    ]);
    const { onSelectUnit } = renderRow(makeItem());

    const select = await screen.findByRole("combobox");
    fireEvent.change(select, { target: { value: "101" } });

    expect(onSelectUnit).toHaveBeenCalledWith("1", {
      id: 101,
      imei: "IMEI-CLEAN",
    });
    expect(
      screen.queryByText("This phone is marked defective — sell anyway?"),
    ).not.toBeInTheDocument();
  });
});
