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
  PHONE_UNITS_EXPORT_HEADERS,
  PHONE_UNITS_EXPORT_MAX_ROWS,
  PHONE_UNITS_EXPORT_PAGE_SIZE,
  PHONE_UNITS_PAGE_SIZE,
  PHONE_UNITS_SEARCH_DEBOUNCE_MS,
} from "../phoneUnitsLogic";

const mockList = jest.fn();
const mockDelete = jest.fn();
const mockGetStory = jest.fn();
const mockNavigate = jest.fn();
const mockExportExcel = jest.fn();
const mockExportPdf = jest.fn();

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
  // The page drives the house writers itself (server pagination makes
  // DataTable's own exporter wrong here — see index.tsx). Stubbed so the
  // assertions can read the TableData that would have been written, and so
  // jsdom never tries to save a file.
  exportToExcel: (...args: unknown[]) => mockExportExcel(...args),
  exportToPdf: (...args: unknown[]) => mockExportPdf(...args),
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
    // Default: the MODEL grants no warranty at all, so a NONE verdict really
    // does mean "No warranty" for these rows.
    product_warranty_months: null,
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

    await waitFor(() => expect(lastFilters().search).toBe("356938"), {
      timeout: 2000,
    });
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

  /**
   * Owner-reported 2026-08-26: fresh stock of a model that HAS a warranty
   * term used to read "No warranty" here, because the clock only starts at
   * the sale (decision #4) so the computed verdict is `NONE`. The page now
   * shows the term for exactly that case — and for nothing else.
   */
  it("shows the model's term for unsold stock, and never for a sold unit or a real verdict", async () => {
    mockList.mockResolvedValue(
      result([
        // Unsold, model grants 6 months -> the term.
        row({
          id: 1,
          imei: "111111111111111",
          status: "IN_STOCK",
          product_warranty_months: 6,
          warranty: NONE,
        }),
        // Unsold, model grants nothing -> unchanged.
        row({
          id: 2,
          imei: "222222222222222",
          status: "IN_STOCK",
          product_warranty_months: null,
          warranty: NONE,
        }),
        // SOLD before the model had a term (no stamp on its sale line) ->
        // stays "No warranty": the term is never applied retroactively.
        row({
          id: 3,
          imei: "333333333333333",
          status: "SOLD",
          sale_item_id: 9,
          sale_refunded: 0,
          product_warranty_months: 6,
          warranty: NONE,
        }),
        // A real verdict wins over the term, even in stock (refund override).
        row({
          id: 4,
          imei: "444444444444444",
          status: "IN_STOCK",
          product_warranty_months: 6,
          warranty: COVERED,
        }),
      ]),
    );
    renderPage();

    await screen.findByText("111111111111111");
    expect(screen.getByTestId("phone-unit-warranty-1")).toHaveTextContent(
      "6 mo — starts at sale",
    );
    expect(screen.getByTestId("phone-unit-warranty-2")).toHaveTextContent(
      "No warranty",
    );
    expect(screen.getByTestId("phone-unit-warranty-3")).toHaveTextContent(
      "No warranty",
    );
    expect(screen.getByTestId("phone-unit-warranty-4")).toHaveTextContent(
      "Covered (until 2027-01-31)",
    );
  });

  /**
   * Owner decision 2026-08-27 — a refund voids the sale's warranty AND puts
   * the unit back on the shelf. The TABLE is forward-looking, so a shelved
   * unit of a model that grants a term advertises what its NEXT sale will
   * carry. (`ImeiStoryCard` keeps "Void (refunded)" — its own test pins that.)
   */
  it("shows the term for a refunded unit back in stock, and keeps Void once sold", async () => {
    const VOID: WarrantyStatus = {
      source: "REFUND",
      until: null,
      state: "VOID",
    };
    mockList.mockResolvedValue(
      result([
        // Back in stock after a refund, model grants 6 months -> the term.
        row({
          id: 1,
          imei: "111111111111111",
          status: "IN_STOCK",
          product_warranty_months: 6,
          warranty: VOID,
        }),
        // Back in stock, but the model grants nothing -> the true verdict.
        row({
          id: 2,
          imei: "222222222222222",
          status: "IN_STOCK",
          product_warranty_months: null,
          warranty: VOID,
        }),
        // Still SOLD (refunded but not restocked) -> the true verdict, term
        // or no term. Nothing forward-looking to say about a finished sale.
        row({
          id: 3,
          imei: "333333333333333",
          status: "SOLD",
          sale_item_id: 9,
          sale_refunded: 1,
          product_warranty_months: 6,
          warranty: VOID,
        }),
      ]),
    );
    renderPage();

    await screen.findByText("111111111111111");
    expect(screen.getByTestId("phone-unit-warranty-1")).toHaveTextContent(
      "6 mo — starts at sale",
    );
    expect(screen.getByTestId("phone-unit-warranty-2")).toHaveTextContent(
      "Void (refunded)",
    );
    expect(screen.getByTestId("phone-unit-warranty-3")).toHaveTextContent(
      "Void (refunded)",
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

/* ──────────────────── export ALL filtered rows (item #6) ─────────────── */

/**
 * The page paginates SERVER-side, so `DataTable`'s built-in exporter would
 * have written the 25 rows it was handed. These tests pin the replacement:
 * the header buttons loop `productUnits.list` for EVERY row matching the
 * current filters, then hand the full set to the house writers.
 */
describe("PhoneUnits — export covers every filtered row, not the page", () => {
  /** A `list` stub serving `total` rows, honouring limit/offset. */
  function serveRows(total: number) {
    const all = Array.from({ length: total }, (_, i) =>
      row({ id: i + 1, imei: `35693803564${String(i + 1).padStart(4, "0")}` }),
    );
    mockList.mockImplementation(
      async (filters: { limit: number; offset: number }) =>
        result(
          all.slice(filters.offset, filters.offset + filters.limit),
          total,
        ),
    );
    return all;
  }

  /** Only the calls the EXPORT loop made (the on-screen query uses the
   *  25-row page size). */
  function exportCalls(): Array<{ limit: number; offset: number }> {
    return mockList.mock.calls
      .map((c) => c[0] as { limit: number; offset: number })
      .filter((f) => f.limit > PHONE_UNITS_PAGE_SIZE || f.offset > 0);
  }

  beforeEach(() => {
    window.confirm = jest.fn().mockReturnValue(true);
  });

  it("pages through the whole result set and exports all 450 rows to Excel", async () => {
    serveRows(450);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("phone-units-range")).toHaveTextContent("450"),
    );

    fireEvent.click(screen.getByTestId("phone-units-export-excel"));

    await waitFor(() => expect(mockExportExcel).toHaveBeenCalledTimes(1));

    // 450 rows at the contract's 200-row ceiling = 3 calls.
    const calls = exportCalls();
    expect(calls).toEqual([
      { limit: PHONE_UNITS_EXPORT_PAGE_SIZE, offset: 0 },
      { limit: PHONE_UNITS_EXPORT_PAGE_SIZE, offset: 200 },
      { limit: 50, offset: 400 },
    ]);

    const [tableData, filename] = mockExportExcel.mock.calls[0] as [
      { headers: string[]; rows: string[][] },
      string,
    ];
    expect(tableData.rows).toHaveLength(450);
    expect(tableData.rows[0]![0]).toBe("356938035640001");
    expect(tableData.rows[449]![0]).toBe("356938035640450");
    expect(filename).toMatch(/^phone-units-\d{2}-\d{2}-\d{4}$/);
    expect(mockExportPdf).not.toHaveBeenCalled();
  });

  it("routes the PDF button to the PDF writer with the same full row set", async () => {
    serveRows(300);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("phone-units-range")).toHaveTextContent("300"),
    );

    fireEvent.click(screen.getByTestId("phone-units-export-pdf"));

    await waitFor(() => expect(mockExportPdf).toHaveBeenCalledTimes(1));
    const [tableData] = mockExportPdf.mock.calls[0] as [{ rows: string[][] }];
    expect(tableData.rows).toHaveLength(300);
    expect(mockExportExcel).not.toHaveBeenCalled();
  });

  it("carries the CURRENT filters onto every export page", async () => {
    serveRows(450);
    renderPage();
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    fireEvent.change(screen.getByTestId("phone-units-status-filter"), {
      target: { value: "IN_STOCK" },
    });
    fireEvent.click(screen.getByTestId("phone-units-defective-toggle"));
    await waitFor(() => expect(lastFilters().defectiveOnly).toBe(true));

    fireEvent.click(screen.getByTestId("phone-units-export-excel"));
    await waitFor(() => expect(mockExportExcel).toHaveBeenCalledTimes(1));

    const calls = mockList.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((f) => f.limit === PHONE_UNITS_EXPORT_PAGE_SIZE);
    expect(calls.length).toBeGreaterThan(1);
    for (const call of calls) {
      expect(call.status).toBe("IN_STOCK");
      expect(call.defectiveOnly).toBe(true);
    }
  });

  it("exports the same columns the table shows, Actions excluded", async () => {
    serveRows(3);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("phone-units-range")).toHaveTextContent("3"),
    );

    // The visible header row, straight from the DOM.
    const rendered = [
      ...screen.getByTestId("data-table").querySelectorAll("thead th"),
    ].map((th) => th.textContent?.trim() ?? "");
    expect(rendered).toEqual([...PHONE_UNITS_EXPORT_HEADERS, "Actions"]);

    fireEvent.click(screen.getByTestId("phone-units-export-excel"));
    await waitFor(() => expect(mockExportExcel).toHaveBeenCalledTimes(1));
    const [tableData] = mockExportExcel.mock.calls[0] as [
      { headers: string[] },
    ];
    expect(tableData.headers).toEqual(rendered.slice(0, -1));
  });

  it("shows a busy state on the clicked button and disables both while fetching", async () => {
    serveRows(450);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("phone-units-range")).toHaveTextContent("450"),
    );

    // Hold the FIRST export page open so the busy state is observable.
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const all = Array.from({ length: 450 }, (_, i) => row({ id: i + 1 }));
    mockList.mockImplementation(
      async (filters: { limit: number; offset: number }) => {
        if (filters.limit === PHONE_UNITS_EXPORT_PAGE_SIZE) await gate;
        return result(
          all.slice(filters.offset, filters.offset + filters.limit),
          450,
        );
      },
    );

    fireEvent.click(screen.getByTestId("phone-units-export-excel"));

    await waitFor(() =>
      expect(screen.getByTestId("phone-units-export-excel")).toHaveTextContent(
        "Exporting…",
      ),
    );
    expect(screen.getByTestId("phone-units-export-excel")).toBeDisabled();
    expect(screen.getByTestId("phone-units-export-pdf")).toBeDisabled();

    await act(async () => {
      release!();
      await gate;
    });

    await waitFor(() => expect(mockExportExcel).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId("phone-units-export-excel")).not.toBeDisabled(),
    );
    expect(screen.getByTestId("phone-units-export-excel")).toHaveTextContent(
      "Excel",
    );
  });

  it("asks before exporting a capped prefix, and exports exactly the cap on OK", async () => {
    serveRows(PHONE_UNITS_EXPORT_MAX_ROWS + 400);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("phone-units-range")).toHaveTextContent("5400"),
    );

    fireEvent.click(screen.getByTestId("phone-units-export-excel"));

    await waitFor(() => expect(mockExportExcel).toHaveBeenCalledTimes(1));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    const prompt = (window.confirm as jest.Mock).mock.calls[0]![0] as string;
    expect(prompt).toContain("5,000");
    expect(prompt).toContain("5,400");

    const [tableData] = mockExportExcel.mock.calls[0] as [{ rows: string[][] }];
    expect(tableData.rows).toHaveLength(PHONE_UNITS_EXPORT_MAX_ROWS);
  });

  it("writes NOTHING and fetches NOTHING when the cap confirm is dismissed", async () => {
    serveRows(PHONE_UNITS_EXPORT_MAX_ROWS + 400);
    window.confirm = jest.fn().mockReturnValue(false);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("phone-units-range")).toHaveTextContent("5400"),
    );
    const before = mockList.mock.calls.length;

    fireEvent.click(screen.getByTestId("phone-units-export-excel"));

    expect(window.confirm).toHaveBeenCalled();
    expect(mockExportExcel).not.toHaveBeenCalled();
    expect(mockList.mock.calls.length).toBe(before);
  });

  it("does NOT confirm when the result set is within the cap", async () => {
    serveRows(450);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("phone-units-range")).toHaveTextContent("450"),
    );

    fireEvent.click(screen.getByTestId("phone-units-export-excel"));
    await waitFor(() => expect(mockExportExcel).toHaveBeenCalledTimes(1));
    expect(window.confirm).not.toHaveBeenCalled();
  });

  /**
   * Switching DataTable's own `exportExcel`/`exportPdf` off must NOT take its
   * count bar with it — `ExportBar` renders the label independently of the
   * buttons, and this pins that so a future prop tidy-up can't silently drop
   * "Showing 25 of 450 entries" from the page.
   */
  it("keeps DataTable's row-count label after its export buttons are switched off", async () => {
    serveRows(450);
    renderPage();
    expect(
      await screen.findByText(
        `Showing ${PHONE_UNITS_PAGE_SIZE} of 450 entries`,
      ),
    ).toBeInTheDocument();
    // …and DataTable's own export buttons are gone: only the header pair.
    expect(screen.getAllByTitle(/Export/i)).toHaveLength(2);
    expect(
      screen.queryByTestId("export-column-picker"),
    ).not.toBeInTheDocument();
  });

  it("disables both export buttons when nothing matches the filters", async () => {
    mockList.mockResolvedValue(result([]));
    renderPage();

    await screen.findByText("No units match these filters.");
    expect(screen.getByTestId("phone-units-export-excel")).toBeDisabled();
    expect(screen.getByTestId("phone-units-export-pdf")).toBeDisabled();
  });

  it("surfaces a failed export page instead of writing a partial file", async () => {
    serveRows(450);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("phone-units-range")).toHaveTextContent("450"),
    );

    mockList.mockRejectedValue(new Error("IPC failed"));
    fireEvent.click(screen.getByTestId("phone-units-export-excel"));

    await waitFor(() =>
      expect(screen.getByTestId("phone-units-export-excel")).not.toBeDisabled(),
    );
    expect(mockExportExcel).not.toHaveBeenCalled();
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
