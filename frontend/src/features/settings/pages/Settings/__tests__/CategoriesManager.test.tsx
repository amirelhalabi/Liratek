/** @jest-environment jsdom */
/**
 * LIRA-143 Phase 6b — CategoriesManager migrated its category CRUD off raw
 * `window.api.inventory.*` calls onto `useApi()` (rule 19a), and gained the
 * "Tracks IMEI units" toggle (decision #9). The supplier section still uses
 * `window.api` directly (no `useApi()` equivalent exists for it) — left
 * untouched here, and simply renders empty since `window.api` is undefined
 * in this jsdom environment (optional-chained, so no crash).
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import CategoriesManager from "../CategoriesManager";

const mockGetCategoriesFull = jest.fn();
const mockCreateCategory = jest.fn();
const mockUpdateCategory = jest.fn();
const mockDeleteCategory = jest.fn();
// Stable reference — CategoriesManager's category load effect closes over
// `api` per render; a fresh object per useApi() call is harmless here (the
// load effect has an empty dep array) but kept stable anyway for parity
// with the house convention (ServiceProvidersManager.test.tsx).
const mockApi = {
  getCategoriesFull: mockGetCategoriesFull,
  createCategory: mockCreateCategory,
  updateCategory: mockUpdateCategory,
  deleteCategory: mockDeleteCategory,
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

const TRACKING_CATEGORY = {
  id: 1,
  name: "Phones",
  sort_order: 0,
  is_active: 1,
  tracks_imei_units: 1,
};
const NON_TRACKING_CATEGORY = {
  id: 2,
  name: "Accessories",
  sort_order: 1,
  is_active: 1,
  tracks_imei_units: 0,
};

describe("CategoriesManager — category CRUD via useApi()", () => {
  beforeEach(() => {
    mockGetCategoriesFull
      .mockReset()
      .mockResolvedValue([TRACKING_CATEGORY, NON_TRACKING_CATEGORY]);
    mockCreateCategory.mockReset().mockResolvedValue({ success: true, id: 3 });
    mockUpdateCategory.mockReset().mockResolvedValue({ success: true });
    mockDeleteCategory.mockReset().mockResolvedValue({ success: true });
  });

  it("loads categories via api.getCategoriesFull() (not window.api)", async () => {
    render(<CategoriesManager />);
    expect(await screen.findByText("Phones")).toBeInTheDocument();
    expect(screen.getByText("Accessories")).toBeInTheDocument();
    expect(mockGetCategoriesFull).toHaveBeenCalledTimes(1);
  });

  it("creates a category via api.createCategory(name)", async () => {
    render(<CategoriesManager />);
    await screen.findByText("Phones");

    const nameInput = screen.getByPlaceholderText("New category name...");
    fireEvent.change(nameInput, { target: { value: "Chargers" } });
    // Two "Add" buttons exist on the page (categories + suppliers sections)
    // — scope to the one next to the category-name input.
    fireEvent.click(within(nameInput.closest("div")!).getByRole("button"));

    await waitFor(() =>
      expect(mockCreateCategory).toHaveBeenCalledWith("Chargers"),
    );
  });

  it("renames a category via api.updateCategory(id, { name })", async () => {
    render(<CategoriesManager />);
    await screen.findByText("Accessories");

    const row = screen.getByText("Accessories").closest("tr")!;
    const [editButton] = within(row).getAllByRole("button");
    fireEvent.click(editButton);

    const input = screen.getByDisplayValue("Accessories");
    fireEvent.change(input, { target: { value: "Parts & Accessories" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(mockUpdateCategory).toHaveBeenCalledWith(2, {
        name: "Parts & Accessories",
      }),
    );
  });

  it("deletes a category via api.deleteCategory(id)", async () => {
    window.confirm = jest.fn().mockReturnValue(true);
    render(<CategoriesManager />);
    await screen.findByText("Accessories");

    const row = screen.getByText("Accessories").closest("tr")!;
    const [, deleteButton] = within(row).getAllByRole("button");
    fireEvent.click(deleteButton);

    await waitFor(() => expect(mockDeleteCategory).toHaveBeenCalledWith(2));
  });
});

describe("CategoriesManager — Tracks IMEI units toggle (decision #9)", () => {
  beforeEach(() => {
    mockGetCategoriesFull
      .mockReset()
      .mockResolvedValue([TRACKING_CATEGORY, NON_TRACKING_CATEGORY]);
    mockUpdateCategory.mockReset().mockResolvedValue({ success: true });
  });

  it("renders the toggle ON for a tracking category and OFF for a non-tracking one", async () => {
    render(<CategoriesManager />);
    await screen.findByText("Phones");

    // DataTable defaultSortKey="name" sorts rows alphabetically — scope by
    // row (via the name text), never assume array/index order.
    const phonesRow = screen.getByText("Phones").closest("tr")!;
    const accessoriesRow = screen.getByText("Accessories").closest("tr")!;
    expect(within(phonesRow).getByRole("switch")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(within(accessoriesRow).getByRole("switch")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("clicking the toggle on a tracking category turns it OFF", async () => {
    render(<CategoriesManager />);
    await screen.findByText("Phones");

    const phonesRow = screen.getByText("Phones").closest("tr")!;
    fireEvent.click(within(phonesRow).getByRole("switch"));

    await waitFor(() =>
      expect(mockUpdateCategory).toHaveBeenCalledWith(1, {
        tracks_imei_units: false,
      }),
    );
  });

  it("clicking the toggle on a non-tracking category turns it ON", async () => {
    render(<CategoriesManager />);
    await screen.findByText("Accessories");

    const accessoriesRow = screen.getByText("Accessories").closest("tr")!;
    fireEvent.click(within(accessoriesRow).getByRole("switch"));

    await waitFor(() =>
      expect(mockUpdateCategory).toHaveBeenCalledWith(2, {
        tracks_imei_units: true,
      }),
    );
  });
});
