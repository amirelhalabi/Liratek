/** @jest-environment jsdom */
/**
 * LIRA-331 — the mobile-service catalog payloads must not depend on the
 * display language. Drives the real MobileServicesManager through
 *   1. add a new category (provider header → name → item form → save),
 *   2. add an item to an existing subcategory (LBP + USD prices, order,
 *      validity, credits, Only-Days split),
 *   3. edit an existing item (every field of the edit row),
 * once in English and once in Arabic, and asserts the captured api payloads
 * are deep-equal.
 *
 * Selectors are anchored on stored data (provider code, category,
 * subcategory and item label are shown as stored in both languages) and on
 * structure (input order inside a form/row), so the same steps work in both
 * languages.
 *
 * Written before MobileServicesManager was converted to i18n: it passed
 * against the unconverted component (not failing-first — a guard against
 * future drift, e.g. a translated label leaking into `provider`).
 */
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import {
  mobileServiceItemCreateSchema,
  mobileServiceItemUpdateSchema,
} from "@liratek/core";
import { i18n, loadLanguage } from "@/i18n/setup";
import MobileServicesManager from "../MobileServicesManager";
import type { MobileServiceItem } from "@/types/electron";

const mockGetAdminMobileServiceItems = jest.fn();
const mockCreateMobileServiceItem = jest.fn();
const mockUpdateMobileServiceItem = jest.fn();

// Module-level: one stable identity (rule 25).
const mockApi = {
  getAdminMobileServiceItems: mockGetAdminMobileServiceItems,
  countMobileServiceItems: jest.fn(),
  seedMobileServiceItems: jest.fn(),
  getAllSettings: jest.fn(),
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

const mockCatalogContext = { refresh: jest.fn() };
jest.mock("@/contexts/MobileServiceItemsContext", () => ({
  useOptionalMobileServiceItemsContext: () => mockCatalogContext,
}));

const ITEM: MobileServiceItem = {
  id: 7,
  provider: "WHISH_APP",
  category: "gaming",
  subcategory: "pubg",
  label: "60UC",
  cost_lbp: 850000,
  sell_lbp: 900000,
  sort_order: 2,
  is_active: 1,
  validity_days: 30,
  credits: 4,
  days_cost_lbp: 500000,
  sell_days_lbp: 600000,
  sell_credit_lbp: 95000,
  max_returned_credits_usd: null,
  cost_usd: 9.5,
  sell_usd: 10,
  created_at: "2026-07-01 00:00:00",
  updated_at: "2026-07-01 00:00:00",
};

function set(input: Element, value: string) {
  fireEvent.change(input, { target: { value } });
}

/** The floating new-item form, found through its subcategory input. */
function newItemForm(subcategoryValue: string): HTMLElement {
  return screen
    .getByDisplayValue(subcategoryValue)
    .closest(".space-y-3") as HTMLElement;
}

/**
 * Inputs of the new-item form, in order: subcategory, label, cost LBP,
 * sell LBP, cost USD, sell USD, order, validity, credits, days cost,
 * sell days, sell credit. Its first button is the save button.
 */
async function fillNewItemForm(form: HTMLElement, label: string) {
  const inputs = form.querySelectorAll("input");
  set(inputs[1], label);
  set(inputs[2], "100000");
  set(inputs[3], "120000");
  set(inputs[4], "9.25");
  set(inputs[5], "10.5");
  set(inputs[6], "3");
  set(inputs[7], "28");
  set(inputs[8], "1.5");
  set(inputs[9], "70000");
  set(inputs[10], "80000");
  set(inputs[11], "90000");
  fireEvent.click(within(form).getAllByRole("button")[0]);
}

async function runFlow() {
  jest.clearAllMocks();
  mockGetAdminMobileServiceItems.mockResolvedValue([ITEM]);
  mockApi.countMobileServiceItems.mockResolvedValue({ success: true, data: 1 });
  mockApi.getAllSettings.mockResolvedValue([]);
  mockCreateMobileServiceItem.mockResolvedValue({ success: true, data: ITEM });
  mockUpdateMobileServiceItem.mockResolvedValue({ success: true, data: ITEM });
  mockCatalogContext.refresh.mockResolvedValue(undefined);

  const { unmount } = render(<MobileServicesManager />);
  await screen.findByText("60UC");

  // 1. New category from the provider header: its only button opens the
  //    name box; Enter opens the item form for that category.
  const providerHeader = screen
    .getByText("WHISH_APP")
    .closest(".cursor-pointer") as HTMLElement;
  fireEvent.click(within(providerHeader).getByRole("button"));
  const nameBox = within(providerHeader).getByRole("textbox");
  set(nameBox, "streaming");
  fireEvent.keyDown(nameBox, { key: "Enter" });
  const catForm = (await screen.findAllByRole("textbox"))
    .map((el) => el.closest(".space-y-3"))
    .find(Boolean) as HTMLElement;
  set(catForm.querySelectorAll("input")[0], "netflix");
  await fillNewItemForm(newItemForm("netflix"), "1 month");
  await waitFor(() =>
    expect(mockCreateMobileServiceItem).toHaveBeenCalledTimes(1),
  );
  await screen.findByText("60UC");

  // 2. Add an item to the existing "pubg" subcategory: the first button on
  //    its header is "add item".
  const subHeader = screen
    .getByText("pubg")
    .closest(".cursor-pointer") as HTMLElement;
  fireEvent.click(within(subHeader).getAllByRole("button")[0]);
  await fillNewItemForm(newItemForm("pubg"), "325UC");
  await waitFor(() =>
    expect(mockCreateMobileServiceItem).toHaveBeenCalledTimes(2),
  );
  await screen.findByText("60UC");

  // 3. Edit the item: row buttons are [on/off, edit, delete].
  const row = screen.getByText("60UC").closest(".group") as HTMLElement;
  fireEvent.click(within(row).getAllByRole("button")[1]);
  const labelInput = screen.getByDisplayValue("60UC");
  const editRow = labelInput.closest(".flex-col") as HTMLElement;
  // Edit-row inputs, in order: label, cost, sell, cost USD, sell USD, order,
  // validity, credits, days cost, sell days, sell credit, max returned.
  const e = editRow.querySelectorAll("input");
  set(e[0], " 60 UC ");
  set(e[1], "860000");
  set(e[2], "910000");
  set(e[3], "9.75");
  set(e[4], "");
  set(e[5], "5");
  set(e[6], "");
  set(e[7], "4.5");
  set(e[8], "510000");
  set(e[9], "610000");
  set(e[10], "96000");
  set(e[11], "3.5");
  // Row 1's first button is save.
  fireEvent.click(within(labelInput.parentElement!).getAllByRole("button")[0]);
  await waitFor(() =>
    expect(mockUpdateMobileServiceItem).toHaveBeenCalledTimes(1),
  );

  const result = {
    creates: mockCreateMobileServiceItem.mock.calls.map((c) => c[0]),
    updates: mockUpdateMobileServiceItem.mock.calls.map((c) => [c[0], c[1]]),
  };
  unmount();
  return result;
}

async function inLanguage(lang: "en" | "ar") {
  await loadLanguage(lang);
  await i18n.changeLanguage(lang);
  return runFlow();
}

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("MobileServicesManager — catalog payloads are identical in English and Arabic", () => {
  it("new category, new item and edited item", async () => {
    const en = await inLanguage("en");
    const ar = await inLanguage("ar");
    expect(ar).toEqual(en);

    // Sanity: every payload is valid for the core schemas (rule 24) and
    // carries stored codes / typed text only.
    const [newCat, newItem] = en.creates.map((p) =>
      mobileServiceItemCreateSchema.parse(p),
    );
    expect(newCat).toMatchObject({
      provider: "WHISH_APP",
      category: "streaming",
      subcategory: "netflix",
      label: "1 month",
    });
    expect(newItem).toMatchObject({
      provider: "WHISH_APP",
      category: "gaming",
      subcategory: "pubg",
      label: "325UC",
      cost_lbp: 100000,
      sell_lbp: 120000,
      cost_usd: 9.25,
      sell_usd: 10.5,
      sort_order: 3,
      validity_days: 28,
      credits: 1.5,
      days_cost_lbp: 70000,
      sell_days_lbp: 80000,
      sell_credit_lbp: 90000,
    });
    const [id, data] = en.updates[0] as [number, Record<string, unknown>];
    expect(mobileServiceItemUpdateSchema.parse({ id, ...data })).toMatchObject({
      id: 7,
      label: "60 UC",
      cost_lbp: 860000,
      sell_lbp: 910000,
      cost_usd: 9.75,
      sell_usd: null,
      sort_order: 5,
      validity_days: null,
      credits: 4.5,
      days_cost_lbp: 510000,
      sell_days_lbp: 610000,
      sell_credit_lbp: 96000,
      max_returned_credits_usd: 3.5,
    });
  });
});
