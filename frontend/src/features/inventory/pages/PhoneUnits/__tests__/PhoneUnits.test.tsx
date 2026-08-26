/** @jest-environment jsdom */
/**
 * LIRA-143 — the standalone Phone Units page. Covers the four things the page
 * itself owns (the pure maths behind two of them is also covered directly in
 * phoneUnitsLogic.test.ts — these prove the page actually FEEDS its state
 * into them):
 *   1. filter state → the `productUnits.list` query args (status, defective
 *      toggle, debounced search, page → offset, and the page reset on a
 *      filter change),
 *   2. status / defective / warranty badge rendering,
 *   3. Delete offered for IN_STOCK units ONLY,
 *   4. the pagination controls' enabled/disabled state and range label.
 */
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PhoneUnits from "..";
import type {
  UnitListResult,
  UnitListRowWithWarranty,
  WarrantyStatus,
} from "../../../hooks/useProductUnits";
import {
  PHONE_UNITS_PAGE_SIZE,
  PHONE_UNITS_SEARCH_DEBOUNCE_MS,
} from "../phoneUnitsLogic";

const mockList = jest.fn();
const mockDelete = jest.fn();
const mockGetStory = jest.fn();
const mockNavigate = jest.fn();

jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useNavigate: () => mockNavigate,
}));

// `Select` is stubbed to a native <select> so the status filter's options are
// directly assertable and selectable — the same stubbing the house tests use
// for @headlessui-backed selects (see DrawerTopUpModal.currencyList.test.tsx).
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    productUnits: {
      list: mockList,
      delete: mockDelete,
      getStory: mockGetStory,
    },
  }),
  Select: ({
    value,
    onChange,
    options,
  }: {
    value: string;
    onChange: (v: string) => void;
    options: Array<{ value: string; label: string }>;
  }) => (
    <select
      data-testid="phone-units-status-filter"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

/* ─────────────────────────────── fixtures ────────────────────────────── */

const COVERED: WarrantyStatus = {
  source: "SALE",
  until: "2027-01-31",
  state: "COVERED",
};
const NONE: WarrantyStatus = { source: null, until: null, state: "NONE" };

function row(
  overrides: Partial<UnitListRowWithWarranty> = {},
): UnitListRowWithWarranty {
  return {
    id: 1,
    product_id: 7,
    imei: "356938035643809",
    status: "IN_STOCK",
    is_defective: 0,
    warranty_override_until: null,
    created_at: "2026-08-01 10:00:00",
    product_name: "iPhone 15 Pro",
    sale_item_id: null,
    sold_at: null,
    sold_price_usd: null,
    client_name: null,
    warranty_until: null,
    sale_refunded: null,
    warranty: NONE,
    ...overrides,
  };
}

function result(
  rows: UnitListRowWithWarranty[],
  total = rows.length,
): UnitListResult {
  return { rows, total };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PhoneUnits />
    </QueryClientProvider>,
  );
}

/** The filter object of the most recent `productUnits.list` call. */
function lastFilters(): Record<string, unknown> {
  const calls = mockList.mock.calls;
  return calls[calls.length - 1]?.[0] as Record<string, unknown>;
}

/**
 * Next is driven by the SERVER's `total`, so it stays disabled until the
 * current page's response has landed — clicking before then is a no-op and
 * would make a pagination assertion fail for the wrong reason.
 */
async function waitForNextEnabled(): Promise<void> {
  await waitFor(() =>
    expect(screen.getByTestId("phone-units-next")).not.toBeDisabled(),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetStory.mockResolvedValue([]);
  mockList.mockResolvedValue(result([]));
});

/* ───────────────────────── filters → query args ──────────────────────── */

describe("PhoneUnits — filter state → list query args", () => {
  it("requests the first page with no filters on mount", async () => {
    renderPage();
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    expect(lastFilters()).toEqual({
      limit: PHONE_UNITS_PAGE_SIZE,
      offset: 0,
    });
  });

  it("adds status when the status filter changes", async () => {
    renderPage();
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    fireEvent.change(screen.getByTestId("phone-units-status-filter"), {
      target: { value: "SOLD" },
    });

    await waitFor(() =>
      expect(lastFilters()).toEqual({
        limit: PHONE_UNITS_PAGE_SIZE,
        offset: 0,
        status: "SOLD",
      }),
    );
  });

  it("offers exactly All / In stock / Sold as status options", async () => {
    renderPage();
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    const select = screen.getByTestId(
      "phone-units-status-filter",
    ) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual([
      "",
      "IN_STOCK",
      "SOLD",
    ]);
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "All statuses",
      "In stock",
      "Sold",
    ]);
  });

  it("adds defectiveOnly when the toggle is switched on, and drops it again", async () => {
    renderPage();
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    const toggle = screen.getByTestId("phone-units-defective-toggle");

    fireEvent.click(toggle);
    await waitFor(() => expect(lastFilters().defectiveOnly).toBe(true));

    fireEvent.click(toggle);
    await waitFor(() =>
      expect(lastFilters()).toEqual({
        limit: PHONE_UNITS_PAGE_SIZE,
        offset: 0,
      }),
    );
  });

  it("debounces the search box — coalescing rapid edits into ONE request", async () => {
    renderPage();
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    const input = screen.getByTestId("phone-units-search");

    fireEvent.change(input, { target: { value: "3569" } });
    fireEvent.change(input, { target: { value: "356938" } });

    await waitFor(
      () => expect(lastFilters().search).toBe("356938"),
      { timeout: 2000 },
    );
    // The intermediate value never reached the backend.
    const searched = mockList.mock.calls.map(
      (c) => (c[0] as { search?: string }).search,
    );
    expect(searched).not.toContain("3569");
  });

  it("caps the search input at 64 characters (the Zod ceiling)", async () => {
    renderPage();
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    expect(screen.getByTestId("phone-units-search")).toHaveAttribute(
      "maxlength",
      "64",
    );
  });

  /** Paginate to page 2 (offset = one page) and return. */
  async function goToSecondPage(): Promise<void> {
    mockList.mockResolvedValue(
      result(
        Array.from({ length: PHONE_UNITS_PAGE_SIZE }, (_, i) =>
          row({ id: i + 1, imei: `10000000000000${i}` }),
        ),
        90,
      ),
    );
    renderPage();
    // Next only becomes clickable once the first page's `total` has landed.
    await waitForNextEnabled();
    fireEvent.click(screen.getByTestId("phone-units-next"));
    await waitFor(() =>
      expect(lastFilters().offset).toBe(PHONE_UNITS_PAGE_SIZE),
    );
  }

  it("resets to the first page when the defective toggle changes mid-pagination", async () => {
    await goToSecondPage();

    fireEvent.click(screen.getByTestId("phone-units-defective-toggle"));
    await waitFor(() =>
      expect(lastFilters()).toEqual({
        limit: PHONE_UNITS_PAGE_SIZE,
        offset: 0,
        defectiveOnly: true,
      }),
    );
  });

  it("resets to the first page when the status filter changes mid-pagination", async () => {
    await goToSecondPage();

    fireEvent.change(screen.getByTestId("phone-units-status-filter"), {
      target: { value: "IN_STOCK" },
    });
    await waitFor(() =>
      expect(lastFilters()).toEqual({
        limit: PHONE_UNITS_PAGE_SIZE,
        offset: 0,
        status: "IN_STOCK",
      }),
    );
  });

  it("resets to the first page when the search term changes mid-pagination", async () => {
    await goToSecondPage();

    fireEvent.change(screen.getByTestId("phone-units-search"), {
      target: { value: "iPhone" },
    });
    await waitFor(
      () =>
        expect(lastFilters()).toEqual({
          limit: PHONE_UNITS_PAGE_SIZE,
          offset: 0,
          search: "iPhone",
        }),
      { timeout: 2000 },
    );
  });
});

/* ──────────────────────────── row rendering ──────────────────────────── */

describe("PhoneUnits — row rendering", () => {
  it("renders IMEI, product, and the IN_STOCK / SOLD status badges", async () => {
    mockList.mockResolvedValue(
      result([
        row({ id: 1, imei: "111111111111111", status: "IN_STOCK" }),
        row({
          id: 2,
          imei: "222222222222222",
          status: "SOLD",
          product_name: "Galaxy S24",
        }),
      ]),
    );
    renderPage();

    expect(await screen.findByText("111111111111111")).toBeInTheDocument();
    expect(screen.getByText("Galaxy S24")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("phone-unit-row-1")).getByText("IN_STOCK"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("phone-unit-row-2")).getByText("SOLD"),
    ).toBeInTheDocument();
  });

  it("shows a Defective badge only for units with is_defective truthy", async () => {
    mockList.mockResolvedValue(
      result([
        row({ id: 1, imei: "111111111111111", is_defective: 1 }),
        row({ id: 2, imei: "222222222222222", is_defective: 0 }),
      ]),
    );
    renderPage();

    await screen.findByText("111111111111111");
    expect(
      within(screen.getByTestId("phone-unit-row-1")).getByText("Defective"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("phone-unit-row-2")).queryByText("Defective"),
    ).not.toBeInTheDocument();
  });

  it("renders each warranty state with its own badge label", async () => {
    mockList.mockResolvedValue(
      result([
        row({ id: 1, imei: "111111111111111", warranty: COVERED }),
        row({
          id: 2,
          imei: "222222222222222",
          warranty: { source: "SALE", until: "2025-02-01", state: "EXPIRED" },
        }),
        row({
          id: 3,
          imei: "333333333333333",
          warranty: { source: "REFUND", until: null, state: "VOID" },
        }),
        row({ id: 4, imei: "444444444444444", warranty: NONE }),
      ]),
    );
    renderPage();

    await screen.findByText("111111111111111");
    expect(screen.getByTestId("phone-unit-warranty-1")).toHaveTextContent(
      "Covered (until 2027-01-31)",
    );
    expect(screen.getByTestId("phone-unit-warranty-2")).toHaveTextContent(
      "Expired (2025-02-01)",
    );
    expect(screen.getByTestId("phone-unit-warranty-3")).toHaveTextContent(
      "Void (refunded)",
    );
    expect(screen.getByTestId("phone-unit-warranty-4")).toHaveTextContent(
      "No warranty",
    );
  });

  it("renders an em dash for a never-sold unit's sold date and client", async () => {
    mockList.mockResolvedValue(
      result([
        row({ id: 1, sold_at: null, client_name: null }),
        row({
          id: 2,
          imei: "222222222222222",
          status: "SOLD",
          sold_at: "2026-07-04 09:30:00",
          client_name: "Rita Haddad",
        }),
      ]),
    );
    renderPage();

    await screen.findByText("356938035643809");
    // Sold date + Client cells of the unsold row are both em dashes.
    const unsold = screen.getByTestId("phone-unit-row-1");
    expect(within(unsold).getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(
      within(screen.getByTestId("phone-unit-row-2")).getByText("Rita Haddad"),
    ).toBeInTheDocument();
  });

  it("shows the empty state when no unit matches the filters", async () => {
    mockList.mockResolvedValue(result([]));
    renderPage();
    expect(
      await screen.findByText("No units match these filters."),
    ).toBeInTheDocument();
  });
});

/* ─────────────────────────── delete affordance ───────────────────────── */

describe("PhoneUnits — delete is IN_STOCK-only", () => {
  it("renders the remove button for IN_STOCK units and NOT for SOLD ones", async () => {
    mockList.mockResolvedValue(
      result([
        row({ id: 1, imei: "111111111111111", status: "IN_STOCK" }),
        row({ id: 2, imei: "222222222222222", status: "SOLD" }),
      ]),
    );
    renderPage();

    await screen.findByText("111111111111111");
    expect(
      within(screen.getByTestId("phone-unit-row-1")).getByRole("button", {
        name: /Remove unit 111111111111111/,
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("phone-unit-row-2")).queryByRole("button"),
    ).not.toBeInTheDocument();
  });

  it("deletes on confirm and does not open the story panel (click is swallowed)", async () => {
    window.confirm = jest.fn().mockReturnValue(true);
    mockList.mockResolvedValue(
      result([row({ id: 9, imei: "999999999999999", status: "IN_STOCK" })]),
    );
    mockDelete.mockResolvedValue({ success: true });
    renderPage();

    await screen.findByText("999999999999999");
    fireEvent.click(
      screen.getByRole("button", { name: /Remove unit 999999999999999/ }),
    );

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith(9));
    expect(mockGetStory).not.toHaveBeenCalled();
  });

  it("does NOT delete when the confirm is dismissed", async () => {
    window.confirm = jest.fn().mockReturnValue(false);
    mockList.mockResolvedValue(
      result([row({ id: 9, imei: "999999999999999", status: "IN_STOCK" })]),
    );
    renderPage();

    await screen.findByText("999999999999999");
    fireEvent.click(
      screen.getByRole("button", { name: /Remove unit 999999999999999/ }),
    );

    expect(window.confirm).toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

/* ────────────────────────── story panel toggle ───────────────────────── */

describe("PhoneUnits — row click toggles the story panel", () => {
  it("loads and shows the ImeiStoryCard for the clicked row, then hides it", async () => {
    mockList.mockResolvedValue(
      result([row({ id: 5, imei: "555555555555555" })]),
    );
    mockGetStory.mockResolvedValue([
      {
        id: 5,
        product_id: 7,
        imei: "555555555555555",
        status: "IN_STOCK",
        sale_item_id: null,
        is_defective: 0,
        warranty_override_until: null,
        created_at: "2026-08-01 10:00:00",
        updated_at: "2026-08-01 10:00:00",
        product_name: "iPhone 15 Pro",
        warranty_until: null,
        is_refunded: null,
        refunded_quantity: null,
        quantity: null,
        sold_price_usd: null,
        sale_id: null,
        sold_at: null,
        client_id: null,
        client_name: null,
        warranty: NONE,
      },
    ]);
    renderPage();

    await screen.findByText("555555555555555");
    fireEvent.click(screen.getByTestId("phone-unit-row-5"));

    await waitFor(() =>
      expect(mockGetStory).toHaveBeenCalledWith("555555555555555"),
    );
    expect(await screen.findByTestId("imei-story-card")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("phone-unit-row-5"));
    await waitFor(() =>
      expect(screen.queryByTestId("imei-story-card")).not.toBeInTheDocument(),
    );
  });
});

/* ───────────────────────────── pagination ────────────────────────────── */

describe("PhoneUnits — server-side pagination", () => {
  const fullPage = (offset: number) =>
    Array.from({ length: PHONE_UNITS_PAGE_SIZE }, (_, i) =>
      row({ id: offset + i + 1, imei: `1000000000000${offset + i}` }),
    );

  it("labels the range against the SERVER total, not the row count", async () => {
    mockList.mockResolvedValue(result(fullPage(0), 137));
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("phone-units-range")).toHaveTextContent(
        "1–25 of 137 units",
      ),
    );
  });

  it("disables Prev on the first page and enables Next when more remain", async () => {
    mockList.mockResolvedValue(result(fullPage(0), 137));
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("phone-units-range")).toHaveTextContent("137"),
    );
    expect(screen.getByTestId("phone-units-prev")).toBeDisabled();
    expect(screen.getByTestId("phone-units-next")).not.toBeDisabled();
  });

  it("advances the offset by one page on Next and back on Prev", async () => {
    mockList.mockResolvedValue(result(fullPage(0), 137));
    renderPage();
    await waitForNextEnabled();

    fireEvent.click(screen.getByTestId("phone-units-next"));
    await waitFor(() =>
      expect(lastFilters().offset).toBe(PHONE_UNITS_PAGE_SIZE),
    );
    await waitFor(() =>
      expect(screen.getByTestId("phone-units-range")).toHaveTextContent(
        "26–50 of 137",
      ),
    );

    fireEvent.click(screen.getByTestId("phone-units-prev"));
    await waitFor(() => expect(lastFilters().offset).toBe(0));
  });

  /**
   * Regression — the search debounce must never undo a pagination click.
   *
   * The first implementation armed the debounce from a `useEffect` on
   * `searchInput`, which runs on MOUNT too: ~300ms into the session its
   * callback fired `setSearch("") ; setPage(0)`, so any Next click made
   * inside that window was silently reverted (the pager visibly bounced back
   * to page 1 and a second request went out with offset 0). That also made
   * the "advances the offset by one page" test above fail ~50% of runs under
   * full-suite load. Nothing is typed here, so NO debounce may fire at all.
   */
  it("keeps a pagination click after the debounce window elapses (nothing typed)", async () => {
    mockList.mockResolvedValue(result(fullPage(0), 137));
    renderPage();
    await waitForNextEnabled();

    fireEvent.click(screen.getByTestId("phone-units-next"));
    await waitFor(() =>
      expect(lastFilters().offset).toBe(PHONE_UNITS_PAGE_SIZE),
    );

    // Past the debounce window — a mount-armed timer would land right here.
    await act(async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, PHONE_UNITS_SEARCH_DEBOUNCE_MS * 2 + 100),
      );
    });

    expect(lastFilters().offset).toBe(PHONE_UNITS_PAGE_SIZE);
    expect(screen.getByTestId("phone-units-range")).toHaveTextContent(
      "26–50 of 137",
    );
  });

  /**
   * Regression — a search edit that resolves to the SAME effective term is
   * not a filter change, so it must not reset the page either. (The payload
   * trims, so "iPhone " and "iPhone" are one and the same query.) A genuine
   * term change still resets — see "resets to the first page when the search
   * term changes mid-pagination".
   */
  it("does not reset the page when a search edit resolves to the applied term", async () => {
    mockList.mockResolvedValue(result(fullPage(0), 137));
    renderPage();
    const input = screen.getByTestId("phone-units-search");

    // Apply a real term first, then paginate inside that filtered result.
    fireEvent.change(input, { target: { value: "iPhone" } });
    await waitFor(() => expect(lastFilters().search).toBe("iPhone"), {
      timeout: 2000,
    });
    await waitForNextEnabled();
    fireEvent.click(screen.getByTestId("phone-units-next"));
    await waitFor(() =>
      expect(lastFilters().offset).toBe(PHONE_UNITS_PAGE_SIZE),
    );

    // A no-op edit (trailing whitespace) — the effective term is unchanged.
    fireEvent.change(input, { target: { value: "iPhone " } });
    await act(async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, PHONE_UNITS_SEARCH_DEBOUNCE_MS * 2 + 100),
      );
    });

    expect(lastFilters()).toEqual({
      limit: PHONE_UNITS_PAGE_SIZE,
      offset: PHONE_UNITS_PAGE_SIZE,
      search: "iPhone",
    });
  });

  it("disables both buttons when a single short page holds everything", async () => {
    mockList.mockResolvedValue(result([row({ id: 1 })], 1));
    renderPage();

    await screen.findByText("356938035643809");
    expect(screen.getByTestId("phone-units-range")).toHaveTextContent(
      "1–1 of 1 units",
    );
    expect(screen.getByTestId("phone-units-prev")).toBeDisabled();
    expect(screen.getByTestId("phone-units-next")).toBeDisabled();
  });

  it("disables Next on the last page", async () => {
    // 30 total → page 2 holds 5 rows.
    mockList.mockResolvedValueOnce(result(fullPage(0), 30));
    renderPage();
    await waitForNextEnabled();

    mockList.mockResolvedValue(
      result(
        Array.from({ length: 5 }, (_, i) =>
          row({ id: 100 + i, imei: `2000000000000${i}` }),
        ),
        30,
      ),
    );
    fireEvent.click(screen.getByTestId("phone-units-next"));

    await waitFor(() =>
      expect(screen.getByTestId("phone-units-range")).toHaveTextContent(
        "26–30 of 30",
      ),
    );
    expect(screen.getByTestId("phone-units-next")).toBeDisabled();
    expect(screen.getByTestId("phone-units-prev")).not.toBeDisabled();
  });
});

/* ────────────────────────────── navigation ───────────────────────────── */

describe("PhoneUnits — header", () => {
  it("navigates back to the Inventory page", async () => {
    renderPage();
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    expect(screen.getByText("Phone Units")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("phone-units-back"));
    expect(mockNavigate).toHaveBeenCalledWith("/products");
  });
});
