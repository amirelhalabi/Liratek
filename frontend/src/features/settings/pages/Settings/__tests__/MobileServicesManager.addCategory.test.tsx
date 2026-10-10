/** @jest-environment jsdom */
/**
 * MobileServicesManager — "Add category" on a provider row.
 *
 * A category is not a stored entity: it exists only as the `category` text on
 * an item. The old flow accepted the name, then tried to open a subcategory
 * input inside the new category's row — a row that cannot render until an
 * item uses the category. Result: the click did nothing and nothing was saved
 * (owner-reported 2026-10-07, web app, WHISH_APP).
 *
 * The fix opens the new-item form straight away with the category filled in
 * and an editable Subcategory field, so the category is saved with its first
 * item. A typed name that matches an existing category ignoring case reuses
 * the existing spelling ("ALFA" → "alfa"), because `alfa`/`mtc` drive carrier
 * logic and one check (`KatshForm.isTelecomVoucher`) compares exactly.
 * After a successful create, the shared sale-screen catalog is refreshed so
 * the new item shows on the Recharge page without a reload.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import MobileServicesManager from "../MobileServicesManager";
import type { MobileServiceItem } from "@/types/electron";

const mockGetAdminMobileServiceItems = jest.fn();
const mockCountMobileServiceItems = jest.fn();
const mockCreateMobileServiceItem = jest.fn();
const mockRefreshCatalog = jest.fn();
// A STABLE object reference — load() is a useCallback depending on [api].
const mockApi = {
  getAdminMobileServiceItems: mockGetAdminMobileServiceItems,
  countMobileServiceItems: mockCountMobileServiceItems,
  seedMobileServiceItems: jest.fn(),
  getAllSettings: jest.fn().mockResolvedValue([]),
  createMobileServiceItem: mockCreateMobileServiceItem,
  updateMobileServiceItem: jest.fn(),
  deleteMobileServiceItem: jest.fn(),
  toggleActiveMobileServiceItem: jest.fn(),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@liratek/core", () => jest.requireActual("@liratek/core"));

const mockCatalogContext = { refresh: mockRefreshCatalog };
jest.mock("@/contexts/MobileServiceItemsContext", () => ({
  useOptionalMobileServiceItemsContext: () => mockCatalogContext,
}));

function item(over: Partial<MobileServiceItem>): MobileServiceItem {
  return {
    id: 1,
    provider: "WHISH_APP",
    category: "alfa",
    subcategory: "Prepaid",
    label: "7.58",
    cost_lbp: 700000,
    sell_lbp: 750000,
    sort_order: 0,
    is_active: 1,
    validity_days: null,
    credits: null,
    days_cost_lbp: null,
    sell_days_lbp: null,
    sell_credit_lbp: null,
    max_returned_credits_usd: null,
    created_at: "2026-07-01 00:00:00",
    updated_at: "2026-07-01 00:00:00",
    ...over,
  };
}

/** Labels are siblings of their inputs (no htmlFor), same as guardB. */
function inputNextTo(labelText: string): HTMLInputElement {
  const label = screen.getByText(labelText);
  return label.parentElement!.querySelector("input") as HTMLInputElement;
}

async function startNewCategory(name: string) {
  render(<MobileServicesManager />);
  await screen.findByText("WHISH_APP");
  // Only one provider in the fixture → one "Add category" button.
  fireEvent.click(screen.getByTitle("Add category"));
  const input = screen.getByPlaceholderText("New category name...");
  fireEvent.change(input, { target: { value: name } });
  fireEvent.keyDown(input, { key: "Enter" });
}

function fillAndSubmit(subcategory: string) {
  fireEvent.change(inputNextTo("Subcategory"), {
    target: { value: subcategory },
  });
  fireEvent.change(screen.getByPlaceholderText("e.g. 60UC, 3.6"), {
    target: { value: "Card 1" },
  });
  fireEvent.change(inputNextTo("Cost (LBP)"), { target: { value: "100000" } });
  fireEvent.change(inputNextTo("Sell (LBP)"), { target: { value: "120000" } });
  fireEvent.click(screen.getByText("Add"));
}

describe("MobileServicesManager — add category", () => {
  beforeEach(() => {
    mockGetAdminMobileServiceItems
      .mockReset()
      .mockResolvedValue([item({ id: 1 })]);
    mockCountMobileServiceItems
      .mockReset()
      .mockResolvedValue({ success: true, data: 1 });
    mockCreateMobileServiceItem
      .mockReset()
      .mockResolvedValue({ success: true, data: item({ id: 2 }) });
    mockRefreshCatalog.mockReset().mockResolvedValue(undefined);
  });

  it("confirming a new category opens the item form and saves the category with its first item", async () => {
    await startNewCategory("test");

    fillAndSubmit("games");

    await waitFor(() =>
      expect(mockCreateMobileServiceItem).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "WHISH_APP",
          category: "test",
          subcategory: "games",
          label: "Card 1",
        }),
      ),
    );
  });

  it("reuses the existing spelling when the typed name matches ignoring case", async () => {
    await startNewCategory("  ALFA ");

    fillAndSubmit("prepaid");

    await waitFor(() =>
      expect(mockCreateMobileServiceItem).toHaveBeenCalledWith(
        expect.objectContaining({ category: "alfa", subcategory: "Prepaid" }),
      ),
    );
  });

  it("refreshes the shared sale-screen catalog after a successful create", async () => {
    await startNewCategory("test");

    fillAndSubmit("games");

    await waitFor(() => expect(mockRefreshCatalog).toHaveBeenCalled());
  });
});
