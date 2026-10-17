/** @jest-environment jsdom */
/**
 * LIRA-331 — the category payloads must not depend on the display language.
 * Drives the real CategoriesManager through every category save (add, rename,
 * IMEI-tracking toggle, serial name, sale-without-serial rule, default
 * warranty months) once in English and once in Arabic, and asserts the
 * captured api calls are deep-equal.
 *
 * Selectors are anchored on stored data (category names, which are shown as
 * stored in both languages) and on structure (the row's cells and buttons),
 * so the same steps work in both languages.
 *
 * Written before CategoriesManager was converted to i18n: it passed against
 * the unconverted component (not failing-first — a guard against future
 * drift, e.g. a translated option label leaking into `serial_label`).
 */
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { i18n, loadLanguage } from "@/i18n/setup";
import CategoriesManager from "../CategoriesManager";

const mockGetCategoriesFull = jest.fn();
const mockCreateCategory = jest.fn();
const mockUpdateCategory = jest.fn();

// Module-level: one stable identity (rule 25).
const mockApi = {
  getCategoriesFull: mockGetCategoriesFull,
  createCategory: mockCreateCategory,
  updateCategory: mockUpdateCategory,
  deleteCategory: jest.fn(),
  getProductSuppliersFull: jest.fn(),
  createProductSupplier: jest.fn(),
  updateProductSupplier: jest.fn(),
  deleteProductSupplier: jest.fn(),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

const LAPTOPS = {
  id: 1,
  name: "Laptops",
  sort_order: 0,
  is_active: 1,
  tracks_imei_units: 1,
  warranty_months: 12,
  serial_label: "IMEI",
  serial_required: "BLOCK",
};
const CABLES = {
  id: 2,
  name: "Cables",
  sort_order: 1,
  is_active: 1,
  tracks_imei_units: 0,
  warranty_months: null,
};

/** The row's cells: [checkbox, name, tracks-serials, warranty, actions]. */
function cells(name: string): HTMLElement[] {
  const row = screen.getByText(name).closest("tr")!;
  return Array.from(row.querySelectorAll("td")) as HTMLElement[];
}

async function runFlow(): Promise<unknown[][]> {
  jest.clearAllMocks();
  mockGetCategoriesFull.mockResolvedValue([LAPTOPS, CABLES]);
  mockApi.getProductSuppliersFull.mockResolvedValue([]);
  mockCreateCategory.mockResolvedValue({ success: true, id: 3 });
  mockUpdateCategory.mockResolvedValue({ success: true });

  const { unmount, container } = render(<CategoriesManager />);
  await screen.findByText("Laptops");

  // 1. Add a category: the first text box and the button beside it.
  const addInput = container.querySelector(
    'input[type="text"]',
  ) as HTMLInputElement;
  fireEvent.change(addInput, { target: { value: "  Tablets  " } });
  fireEvent.click(within(addInput.parentElement!).getByRole("button"));
  await waitFor(() => expect(mockCreateCategory).toHaveBeenCalledTimes(1));
  await screen.findByText("Laptops");

  // 2. Rename: actions cell → [edit, delete], then [save, cancel].
  fireEvent.click(within(cells("Cables")[4]).getAllByRole("button")[0]);
  const editInput = cells("Cables")[1].querySelector("input")!;
  fireEvent.change(editInput, { target: { value: "USB Cables" } });
  // While editing, the name cell holds an input (not the text), so find the
  // row through the input itself.
  const editRow = editInput.closest("tr")!;
  const actions = editRow.querySelectorAll("td")[4];
  fireEvent.click(within(actions as HTMLElement).getAllByRole("button")[0]);
  await waitFor(() => expect(mockUpdateCategory).toHaveBeenCalledTimes(1));
  await screen.findByText("Cables");

  // 3. Toggle serial tracking on Cables.
  fireEvent.click(within(cells("Cables")[2]).getByRole("switch"));
  await waitFor(() => expect(mockUpdateCategory).toHaveBeenCalledTimes(2));
  await screen.findByText("Laptops");

  // 4. Serial name and 5. sale-without-serial rule on Laptops.
  const [labelSelect, requiredSelect] = within(
    cells("Laptops")[2],
  ).getAllByRole("combobox");
  fireEvent.change(labelSelect, { target: { value: "Serial" } });
  await waitFor(() => expect(mockUpdateCategory).toHaveBeenCalledTimes(3));
  await screen.findByText("Laptops");
  fireEvent.change(
    within(cells("Laptops")[2]).getAllByRole("combobox")[1] ?? requiredSelect,
    { target: { value: "WARN" } },
  );
  await waitFor(() => expect(mockUpdateCategory).toHaveBeenCalledTimes(4));
  await screen.findByText("Laptops");

  // 6. Default warranty: set Cables to 6, clear Laptops (→ null).
  const cablesWarranty = cells("Cables")[3].querySelector("input")!;
  fireEvent.change(cablesWarranty, { target: { value: "6" } });
  fireEvent.blur(cablesWarranty);
  await waitFor(() => expect(mockUpdateCategory).toHaveBeenCalledTimes(5));
  await screen.findByText("Laptops");
  const laptopsWarranty = cells("Laptops")[3].querySelector("input")!;
  fireEvent.change(laptopsWarranty, { target: { value: "" } });
  fireEvent.blur(laptopsWarranty);
  await waitFor(() => expect(mockUpdateCategory).toHaveBeenCalledTimes(6));

  const calls = [
    ...mockCreateCategory.mock.calls.map((c) => ["create", ...c]),
    ...mockUpdateCategory.mock.calls.map((c) => ["update", ...c]),
  ];
  unmount();
  return calls;
}

async function inLanguage(lang: "en" | "ar") {
  await loadLanguage(lang);
  await i18n.changeLanguage(lang);
  return runFlow();
}

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("CategoriesManager — category payloads are identical in English and Arabic", () => {
  it("add, rename, tracking, serial name/rule and default warranty", async () => {
    const en = await inLanguage("en");
    const ar = await inLanguage("ar");
    expect(ar).toEqual(en);
    // Sanity: the stored codes and the operator's own text, never a label.
    expect(en).toEqual([
      ["create", "Tablets"],
      ["update", 2, { name: "USB Cables" }],
      ["update", 2, { tracks_imei_units: true }],
      ["update", 1, { serial_label: "Serial" }],
      ["update", 1, { serial_required: "WARN" }],
      ["update", 2, { warranty_months: 6 }],
      ["update", 1, { warranty_months: null }],
    ]);
  });
});
