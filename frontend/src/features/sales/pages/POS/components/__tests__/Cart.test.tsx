/** @jest-environment jsdom */

/**
 * Cart.tsx — LIRA-143 phase 6a's "headline trap" fix. The IMEI UI used to
 * gate on `(item.category?.toLowerCase() || "").includes("phone")`, which
 * both false-positived (e.g. "Headphones") and missed every real phone
 * category not literally named "phone". This drives the REAL Cart
 * component (not a hand-built decision table) through
 * `resolveCartLineMode`'s two branches ("unit-picker" / "none" — the
 * free-text typed-IMEI mode was removed by owner decision 2026-08-26; the
 * unit system now owns IMEIs) plus the same-product unit-filtering rule
 * (item 1) and the qty-lock rule (item 2).
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Cart from "../Cart";
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
    name: "Test Product",
    // Deliberately the old heuristic's false-positive category — proves
    // resolveCartLineMode never looks at it.
    category: "Headphones",
    barcode: "111",
    quantity: 1,
    retail_price: 10,
    cost_price: 5,
    tracks_imei_units: 0,
    ...overrides,
  };
}

function renderCart(items: CartItem[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const props = {
    items,
    onUpdateQuantity: jest.fn(),
    onRemoveItem: jest.fn(),
    onSelectUnit: jest.fn(),
    onClearCart: jest.fn(),
    onCheckout: jest.fn(),
    onOpenDrafts: jest.fn(),
    draftCount: 0,
  };
  render(
    <QueryClientProvider client={queryClient}>
      <Cart {...props} />
    </QueryClientProvider>,
  );
  return props;
}

describe("Cart — IMEI line gate (resolveCartLineMode)", () => {
  beforeEach(() => {
    mockGetForProduct.mockReset();
  });

  it("flag OFF renders no IMEI UI, even for a category that used to false-positive", () => {
    renderCart([makeItem({ tracks_imei_units: 0, category: "Headphones" })]);
    expect(
      screen.queryByPlaceholderText(/Enter IMEI/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    // The gate never even calls out to check registered units when the
    // flag is off.
    expect(mockGetForProduct).not.toHaveBeenCalled();
  });

  it("flag ON with zero registered units renders no IMEI UI at all (drift case; owner decision 2026-08-26)", async () => {
    mockGetForProduct.mockResolvedValue([]);
    renderCart([makeItem({ tracks_imei_units: 1, category: "Mobiles" })]);

    // Wait for the units query to resolve before asserting absence, so this
    // isn't just catching the pre-load state.
    await waitFor(() => expect(mockGetForProduct).toHaveBeenCalled());
    expect(
      screen.queryByPlaceholderText(/Enter IMEI/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("flag ON with registered units renders a unit picker and no free-text input", async () => {
    mockGetForProduct.mockResolvedValue([
      { id: 101, product_id: 1, imei: "IMEI-A", status: "IN_STOCK" },
      { id: 102, product_id: 1, imei: "IMEI-B", status: "IN_STOCK" },
    ]);
    renderCart([makeItem({ tracks_imei_units: 1 })]);

    const select = await screen.findByRole("combobox");
    expect(select).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText(/Enter IMEI/i),
    ).not.toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "IMEI-A" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "IMEI-B" })).toBeInTheDocument();
  });

  it("locks the qty +/- buttons at 1 for a unit-picker line", async () => {
    mockGetForProduct.mockResolvedValue([
      { id: 101, product_id: 1, imei: "IMEI-A", status: "IN_STOCK" },
    ]);
    renderCart([makeItem({ tracks_imei_units: 1, quantity: 1 })]);

    await screen.findByRole("combobox");
    expect(
      screen.getByRole("button", { name: "Decrease quantity" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Increase quantity" }),
    ).toBeDisabled();
  });

  it("does not lock qty for a zero-registered-units (drift, mode 'none') line", async () => {
    mockGetForProduct.mockResolvedValue([]);
    renderCart([makeItem({ tracks_imei_units: 1, quantity: 2 })]);

    await waitFor(() => expect(mockGetForProduct).toHaveBeenCalled());
    // Decrease is enabled because quantity (2) > 1; the point under test is
    // that isLockedQty is false, not the quantity>=1 disable rule.
    expect(
      screen.getByRole("button", { name: "Decrease quantity" }),
    ).not.toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Increase quantity" }),
    ).not.toBeDisabled();
  });

  it("filters units already picked by another line of the SAME product out of the other line's options", async () => {
    mockGetForProduct.mockResolvedValue([
      { id: 101, product_id: 1, imei: "IMEI-A", status: "IN_STOCK" },
      { id: 102, product_id: 1, imei: "IMEI-B", status: "IN_STOCK" },
    ]);
    renderCart([
      makeItem({
        tracks_imei_units: 1,
        cartLineId: "line-a",
        product_unit_id: 101,
      }),
      makeItem({ tracks_imei_units: 1, cartLineId: "line-b" }),
    ]);

    const selects = await screen.findAllByRole("combobox");
    expect(selects).toHaveLength(2);

    // line-a keeps offering its OWN already-chosen unit (IMEI-A).
    expect(
      within(selects[0]).getByRole("option", { name: "IMEI-A" }),
    ).toBeInTheDocument();

    // line-b must NOT offer IMEI-A (claimed by line-a) — only IMEI-B.
    expect(
      within(selects[1]).queryByRole("option", { name: "IMEI-A" }),
    ).not.toBeInTheDocument();
    expect(
      within(selects[1]).getByRole("option", { name: "IMEI-B" }),
    ).toBeInTheDocument();
  });
});
