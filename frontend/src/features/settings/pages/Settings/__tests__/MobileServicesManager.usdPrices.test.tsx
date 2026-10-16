/** @jest-environment jsdom */
/**
 * MobileServicesManager — USD price pair (LIRA-324, Whish App USD mode).
 *
 * `mobile_service_items.cost_usd` / `sell_usd` (both nullable) let an item be
 * sold in USD. The Settings catalog manager must let the owner edit them on
 * an existing item and on a new one, send them as numbers with cents (never
 * parseInt — 9.5 must not become 9), send `null` when cleared, and show the
 * pair in the row summary only when the item has one.
 *
 * Rule 24: the sent payloads are parsed through the core schemas, so the
 * asserted field names are the schema's own, not hand-typed copies.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  mobileServiceItemCreateSchema,
  mobileServiceItemUpdateSchema,
} from "@liratek/core";
import MobileServicesManager from "../MobileServicesManager";
import type { MobileServiceItem } from "@/types/electron";

const mockGetAdminMobileServiceItems = jest.fn();
const mockCountMobileServiceItems = jest.fn();
const mockCreateMobileServiceItem = jest.fn();
const mockUpdateMobileServiceItem = jest.fn();
const mockRefreshCatalog = jest.fn();
// A STABLE object reference (rule 25) — load() is a useCallback depending on
// [api]; a fresh literal per useApi() call would re-fire the load effect.
const mockApi = {
  getAdminMobileServiceItems: mockGetAdminMobileServiceItems,
  countMobileServiceItems: mockCountMobileServiceItems,
  seedMobileServiceItems: jest.fn(),
  getAllSettings: jest.fn().mockResolvedValue([]),
  createMobileServiceItem: mockCreateMobileServiceItem,
  updateMobileServiceItem: mockUpdateMobileServiceItem,
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
    category: "gaming",
    subcategory: "pubg",
    label: "60UC",
    cost_lbp: 850000,
    sell_lbp: 900000,
    sort_order: 0,
    is_active: 1,
    validity_days: null,
    credits: null,
    days_cost_lbp: null,
    sell_days_lbp: null,
    sell_credit_lbp: null,
    max_returned_credits_usd: null,
    cost_usd: null,
    sell_usd: null,
    created_at: "2026-07-01 00:00:00",
    updated_at: "2026-07-01 00:00:00",
    ...over,
  };
}

const USD_ITEM = item({ id: 1, cost_usd: 10, sell_usd: 10 });
const PLAIN_ITEM = item({ id: 2, label: "325UC" });

/** A "$x.xx / $y.yy" pair anywhere in the text. */
const USD_PAIR = /\$\d+\.\d{2} \/ \$\d+\.\d{2}/;

/** Labels are siblings of their inputs (no htmlFor), same as addCategory. */
function inputNextTo(labelText: string): HTMLInputElement {
  const label = screen.getByText(labelText);
  return label.parentElement!.querySelector("input") as HTMLInputElement;
}

async function renderWith(items: MobileServiceItem[]) {
  mockGetAdminMobileServiceItems.mockResolvedValue(items);
  render(<MobileServicesManager />);
  await screen.findByText(items[0].label);
}

function lastUpdatePayload() {
  const calls = mockUpdateMobileServiceItem.mock.calls;
  const [id, data] = calls[calls.length - 1];
  return mobileServiceItemUpdateSchema.parse({ id, ...data });
}

function lastCreatePayload() {
  const calls = mockCreateMobileServiceItem.mock.calls;
  return mobileServiceItemCreateSchema.parse(calls[calls.length - 1][0]);
}

describe("MobileServicesManager — USD prices (LIRA-324)", () => {
  beforeEach(() => {
    mockGetAdminMobileServiceItems.mockReset();
    mockCountMobileServiceItems
      .mockReset()
      .mockResolvedValue({ success: true, data: 1 });
    mockUpdateMobileServiceItem
      .mockReset()
      .mockResolvedValue({ success: true, data: USD_ITEM });
    mockCreateMobileServiceItem
      .mockReset()
      .mockResolvedValue({ success: true, data: PLAIN_ITEM });
    mockRefreshCatalog.mockReset().mockResolvedValue(undefined);
  });

  it("edit row shows Cost (USD) / Sell (USD) inputs prefilled from the item", async () => {
    await renderWith([USD_ITEM]);
    fireEvent.click(screen.getByTitle("Edit"));

    expect(screen.getByLabelText("Cost (USD)")).toHaveValue(10);
    expect(screen.getByLabelText("Sell (USD)")).toHaveValue(10);
  });

  it("edit row prefills empty when the item has no USD prices", async () => {
    await renderWith([PLAIN_ITEM]);
    fireEvent.click(screen.getByTitle("Edit"));

    expect(screen.getByLabelText("Cost (USD)")).toHaveValue(null);
    expect(screen.getByLabelText("Sell (USD)")).toHaveValue(null);
  });

  it("saving sends cost_usd / sell_usd as numbers with cents", async () => {
    await renderWith([USD_ITEM]);
    fireEvent.click(screen.getByTitle("Edit"));

    fireEvent.change(screen.getByLabelText("Cost (USD)"), {
      target: { value: "9.5" },
    });
    fireEvent.change(screen.getByLabelText("Sell (USD)"), {
      target: { value: "10.25" },
    });
    fireEvent.click(screen.getByLabelText("Save item"));

    await waitFor(() => expect(mockUpdateMobileServiceItem).toHaveBeenCalled());
    const sent = lastUpdatePayload();
    expect(sent.id).toBe(1);
    expect(sent.cost_usd).toBe(9.5);
    expect(sent.sell_usd).toBe(10.25);
  });

  it("saving sends null when the USD inputs are cleared", async () => {
    await renderWith([USD_ITEM]);
    fireEvent.click(screen.getByTitle("Edit"));

    fireEvent.change(screen.getByLabelText("Cost (USD)"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Sell (USD)"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByLabelText("Save item"));

    await waitFor(() => expect(mockUpdateMobileServiceItem).toHaveBeenCalled());
    const sent = lastUpdatePayload();
    expect(sent.cost_usd).toBeNull();
    expect(sent.sell_usd).toBeNull();
  });

  it("add-item form has the USD inputs and the create call carries them", async () => {
    await renderWith([PLAIN_ITEM]);
    fireEvent.click(screen.getByTitle("Add item"));

    fireEvent.change(screen.getByPlaceholderText("e.g. 60UC, 3.6"), {
      target: { value: "660UC" },
    });
    fireEvent.change(inputNextTo("Cost (LBP)"), {
      target: { value: "100000" },
    });
    fireEvent.change(inputNextTo("Sell (LBP)"), {
      target: { value: "120000" },
    });
    fireEvent.change(screen.getByLabelText("Cost (USD)"), {
      target: { value: "9.5" },
    });
    fireEvent.change(screen.getByLabelText("Sell (USD)"), {
      target: { value: "10.25" },
    });
    fireEvent.click(screen.getByText("Add"));

    await waitFor(() => expect(mockCreateMobileServiceItem).toHaveBeenCalled());
    const sent = lastCreatePayload();
    expect(sent.label).toBe("660UC");
    expect(sent.cost_usd).toBe(9.5);
    expect(sent.sell_usd).toBe(10.25);
  });

  it("add-item create call carries null USD prices when left empty", async () => {
    await renderWith([PLAIN_ITEM]);
    fireEvent.click(screen.getByTitle("Add item"));

    // The USD inputs exist even when left empty.
    expect(screen.getByLabelText("Cost (USD)")).toHaveValue(null);
    expect(screen.getByLabelText("Sell (USD)")).toHaveValue(null);

    fireEvent.change(screen.getByPlaceholderText("e.g. 60UC, 3.6"), {
      target: { value: "660UC" },
    });
    fireEvent.change(inputNextTo("Cost (LBP)"), {
      target: { value: "100000" },
    });
    fireEvent.change(inputNextTo("Sell (LBP)"), {
      target: { value: "120000" },
    });
    fireEvent.click(screen.getByText("Add"));

    await waitFor(() => expect(mockCreateMobileServiceItem).toHaveBeenCalled());
    const sent = lastCreatePayload();
    // toBeNull, not toBeUndefined: the schema keeps an absent optional key
    // absent, so this only passes on an explicit null on the wire.
    expect(sent.cost_usd).toBeNull();
    expect(sent.sell_usd).toBeNull();
  });

  it("row summary shows the USD pair when the item has USD prices", async () => {
    await renderWith([USD_ITEM]);
    expect(screen.getByText("$10.00 / $10.00")).toBeInTheDocument();
  });

  it("row summary shows nothing USD-related when both are null", async () => {
    await renderWith([PLAIN_ITEM]);
    expect(screen.queryByText(USD_PAIR)).not.toBeInTheDocument();
  });
});
