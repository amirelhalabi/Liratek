/**
 * LIRA-143 — Phone Units page pure logic: filter-state → query-args mapping
 * and the server-side pagination arithmetic. These are the two places the page
 * does its own maths, so they are covered here directly (in addition to the
 * component test that proves the page actually FEEDS them its state).
 */
import {
  PHONE_UNITS_EXPORT_HEADERS,
  PHONE_UNITS_EXPORT_MAX_ROWS,
  PHONE_UNITS_EXPORT_PAGE_SIZE,
  PHONE_UNITS_PAGE_SIZE,
  PHONE_UNITS_SEARCH_MAX,
  buildUnitExportTable,
  buildUnitListFilters,
  computePageRange,
  exportCapConfirmMessage,
  phoneUnitsExportFilename,
  planExportFetch,
  unitStatusBadgeClass,
  type PhoneUnitsFilterState,
} from "../phoneUnitsLogic";
import type { UnitListRowWithWarranty } from "../../../hooks/useProductUnits";

const base: PhoneUnitsFilterState = {
  status: "",
  defectiveOnly: false,
  search: "",
  page: 0,
  pageSize: PHONE_UNITS_PAGE_SIZE,
};

describe("buildUnitListFilters — filter state → query args", () => {
  it("sends limit/offset only when nothing is filtered", () => {
    expect(buildUnitListFilters(base)).toEqual({
      limit: PHONE_UNITS_PAGE_SIZE,
      offset: 0,
    });
  });

  it("OMITS status/defectiveOnly/search rather than sending empty values", () => {
    const filters = buildUnitListFilters({ ...base, search: "   " });
    expect(Object.keys(filters).sort()).toEqual(["limit", "offset"]);
    expect("status" in filters).toBe(false);
    expect("defectiveOnly" in filters).toBe(false);
    expect("search" in filters).toBe(false);
  });

  it("includes status when one is chosen", () => {
    expect(buildUnitListFilters({ ...base, status: "IN_STOCK" })).toEqual({
      limit: PHONE_UNITS_PAGE_SIZE,
      offset: 0,
      status: "IN_STOCK",
    });
    expect(buildUnitListFilters({ ...base, status: "SOLD" }).status).toBe(
      "SOLD",
    );
  });

  it("includes defectiveOnly only when the toggle is on", () => {
    expect(
      buildUnitListFilters({ ...base, defectiveOnly: true }).defectiveOnly,
    ).toBe(true);
    expect(
      "defectiveOnly" in buildUnitListFilters({ ...base, defectiveOnly: false }),
    ).toBe(false);
  });

  it("trims the search term", () => {
    expect(buildUnitListFilters({ ...base, search: "  35693  " }).search).toBe(
      "35693",
    );
  });

  it("caps the search term at the Zod maximum (64 chars)", () => {
    const long = "9".repeat(200);
    const filters = buildUnitListFilters({ ...base, search: long });
    expect(filters.search).toHaveLength(PHONE_UNITS_SEARCH_MAX);
    expect(PHONE_UNITS_SEARCH_MAX).toBe(64);
  });

  it("derives offset from the 0-based page index and page size", () => {
    expect(buildUnitListFilters({ ...base, page: 0 }).offset).toBe(0);
    expect(buildUnitListFilters({ ...base, page: 1 }).offset).toBe(
      PHONE_UNITS_PAGE_SIZE,
    );
    expect(buildUnitListFilters({ ...base, page: 4 }).offset).toBe(
      PHONE_UNITS_PAGE_SIZE * 4,
    );
  });

  it("keeps the page size under the contract's limit ceiling (200)", () => {
    expect(PHONE_UNITS_PAGE_SIZE).toBeGreaterThan(0);
    expect(PHONE_UNITS_PAGE_SIZE).toBeLessThanOrEqual(200);
  });

  it("combines every filter at once", () => {
    expect(
      buildUnitListFilters({
        status: "SOLD",
        defectiveOnly: true,
        search: " iPhone ",
        page: 2,
        pageSize: 25,
      }),
    ).toEqual({
      limit: 25,
      offset: 50,
      status: "SOLD",
      defectiveOnly: true,
      search: "iPhone",
    });
  });
});

describe("computePageRange — pagination against the server total", () => {
  it("labels a first full page and offers Next only", () => {
    const range = computePageRange(0, 25, 137);
    expect(range).toEqual({
      start: 1,
      end: 25,
      hasPrev: false,
      hasNext: true,
      label: "1–25 of 137",
    });
  });

  it("labels a middle page and offers both directions", () => {
    const range = computePageRange(25, 25, 137);
    expect(range.label).toBe("26–50 of 137");
    expect(range.hasPrev).toBe(true);
    expect(range.hasNext).toBe(true);
  });

  it("labels a short last page and disables Next", () => {
    const range = computePageRange(125, 12, 137);
    expect(range.label).toBe("126–137 of 137");
    expect(range.hasPrev).toBe(true);
    expect(range.hasNext).toBe(false);
  });

  it("disables Next when the last page is exactly full", () => {
    const range = computePageRange(112, 25, 137);
    expect(range.end).toBe(137);
    expect(range.hasNext).toBe(false);
  });

  it("shows 0 of 0 with both buttons disabled when nothing matched", () => {
    expect(computePageRange(0, 0, 0)).toEqual({
      start: 0,
      end: 0,
      hasPrev: false,
      hasNext: false,
      label: "0 of 0",
    });
  });

  it("offers Prev but never Next on an over-paged (empty) page", () => {
    // Filters narrowed while sitting on page 3: the page comes back empty
    // even though `total` is still positive.
    const range = computePageRange(50, 0, 12);
    expect(range.hasPrev).toBe(true);
    expect(range.hasNext).toBe(false);
    expect(range.label).toBe("0 of 12");
  });

  it("handles a single partial page (total below one page)", () => {
    const range = computePageRange(0, 3, 3);
    expect(range.label).toBe("1–3 of 3");
    expect(range.hasPrev).toBe(false);
    expect(range.hasNext).toBe(false);
  });
});

describe("unitStatusBadgeClass", () => {
  it("uses sky for IN_STOCK and slate for SOLD", () => {
    expect(unitStatusBadgeClass("IN_STOCK")).toContain("sky");
    expect(unitStatusBadgeClass("SOLD")).toContain("slate");
  });
});

/**
 * Owner item #6 — the export must cover every row matching the CURRENT
 * filters, not the 25 on screen. This is the page-loop arithmetic behind that:
 * how many `productUnits.list` calls, at what offsets, and where the hard cap
 * stops it.
 */
describe("planExportFetch — the export page loop", () => {
  it("fires ZERO calls when nothing matched", () => {
    expect(planExportFetch(0)).toEqual({
      rowCount: 0,
      calls: 0,
      capped: false,
      pages: [],
    });
  });

  it("450 rows at 200 per call -> 3 calls, the last one short", () => {
    const plan = planExportFetch(450);
    expect(plan.calls).toBe(3);
    expect(plan.rowCount).toBe(450);
    expect(plan.capped).toBe(false);
    expect(plan.pages).toEqual([
      { limit: 200, offset: 0 },
      { limit: 200, offset: 200 },
      { limit: 50, offset: 400 },
    ]);
  });

  it("a single short page when the total fits in one call", () => {
    expect(planExportFetch(12).pages).toEqual([{ limit: 12, offset: 0 }]);
    expect(planExportFetch(12).calls).toBe(1);
  });

  it("does not add an empty trailing call on an exact multiple", () => {
    const plan = planExportFetch(400);
    expect(plan.calls).toBe(2);
    expect(plan.pages[plan.pages.length - 1]).toEqual({
      limit: 200,
      offset: 200,
    });
  });

  it("honours the hard cap, flags it, and stops exactly ON it", () => {
    const plan = planExportFetch(12_431);
    expect(plan.capped).toBe(true);
    expect(plan.rowCount).toBe(PHONE_UNITS_EXPORT_MAX_ROWS);
    // 5000 / 200 = 25 full calls, no overshoot past the cap.
    expect(plan.calls).toBe(25);
    expect(plan.pages[24]).toEqual({ limit: 200, offset: 4800 });
    const planned = plan.pages.reduce((sum, p) => sum + p.limit, 0);
    expect(planned).toBe(PHONE_UNITS_EXPORT_MAX_ROWS);
  });

  it("is NOT capped at exactly the cap", () => {
    const plan = planExportFetch(PHONE_UNITS_EXPORT_MAX_ROWS);
    expect(plan.capped).toBe(false);
    expect(plan.rowCount).toBe(PHONE_UNITS_EXPORT_MAX_ROWS);
  });

  it("is capped one row past it, and the last page is short-limited", () => {
    const plan = planExportFetch(PHONE_UNITS_EXPORT_MAX_ROWS + 1);
    expect(plan.capped).toBe(true);
    expect(plan.rowCount).toBe(PHONE_UNITS_EXPORT_MAX_ROWS);
  });

  it("keeps the fetch page size within the list contract's limit ceiling", () => {
    expect(PHONE_UNITS_EXPORT_PAGE_SIZE).toBe(200);
    expect(PHONE_UNITS_EXPORT_PAGE_SIZE).toBeLessThanOrEqual(200);
  });

  it("treats a negative or non-finite total as nothing to export", () => {
    expect(planExportFetch(-5).calls).toBe(0);
    expect(planExportFetch(Number.NaN).calls).toBe(0);
  });

  it("respects a caller-supplied page size and cap", () => {
    const plan = planExportFetch(450, 100, 250);
    expect(plan.rowCount).toBe(250);
    expect(plan.capped).toBe(true);
    expect(plan.pages).toEqual([
      { limit: 100, offset: 0 },
      { limit: 100, offset: 100 },
      { limit: 50, offset: 200 },
    ]);
  });
});

describe("exportCapConfirmMessage", () => {
  it("names BOTH the cap and the real total so the operator can narrow instead", () => {
    const message = exportCapConfirmMessage(12_431);
    expect(message).toContain("12,431");
    expect(message).toContain("5,000");
    expect(message).toMatch(/narrow the filters/i);
  });
});

describe("phoneUnitsExportFilename", () => {
  it("stamps the same <name>-<dd-mm-yyyy> shape every other table's export uses", () => {
    expect(phoneUnitsExportFilename(new Date(2026, 7, 5))).toBe(
      "phone-units-05-08-2026",
    );
    expect(phoneUnitsExportFilename(new Date(2026, 11, 31))).toBe(
      "phone-units-31-12-2026",
    );
  });
});

describe("buildUnitExportTable", () => {
  const row = (
    overrides: Partial<UnitListRowWithWarranty> = {},
  ): UnitListRowWithWarranty => ({
    id: 1,
    product_id: 7,
    imei: "356938035643809",
    status: "IN_STOCK",
    is_defective: 0,
    warranty_override_until: null,
    created_at: "2026-08-01 10:00:00",
    product_name: "iPhone 15 Pro",
    product_warranty_months: null,
    sale_item_id: null,
    sold_at: null,
    sold_price_usd: null,
    client_name: null,
    warranty_until: null,
    sale_refunded: null,
    warranty: { source: null, until: null, state: "NONE" },
    ...overrides,
  });

  it("exports the visible columns, Actions excluded", () => {
    const table = buildUnitExportTable([row()]);
    expect(table.headers).toEqual([...PHONE_UNITS_EXPORT_HEADERS]);
    expect(table.headers).not.toContain("Actions");
    expect(table.rows[0]).toHaveLength(table.headers.length);
  });

  it("writes the same text the table cells show, em dashes included", () => {
    const table = buildUnitExportTable([
      row({ imei: "111111111111111", is_defective: 1 }),
    ]);
    expect(table.rows[0]).toEqual([
      "111111111111111",
      "iPhone 15 Pro",
      "IN_STOCK",
      "Defective",
      "—", // never sold
      "—", // no client
      "No warranty",
    ]);
  });

  it("uses the TABLE warranty mapping, so refunded stock exports its next-sale term", () => {
    const table = buildUnitExportTable([
      row({
        status: "IN_STOCK",
        product_warranty_months: 6,
        warranty: { source: "REFUND", until: null, state: "VOID" },
      }),
    ]);
    // The story card would say "Void (refunded)"; the table — and therefore
    // its export — says what the next sale will carry.
    expect(table.rows[0]![6]).toBe("6 mo — starts at sale");
  });

  it("renders a sold unit's date and client", () => {
    const table = buildUnitExportTable([
      row({
        status: "SOLD",
        sale_item_id: 9,
        sold_at: "2026-07-04 09:30:00",
        client_name: "Rita Haddad",
        warranty: { source: "SALE", until: "2027-01-31", state: "COVERED" },
      }),
    ]);
    expect(table.rows[0]![2]).toBe("SOLD");
    expect(table.rows[0]![5]).toBe("Rita Haddad");
    expect(table.rows[0]![6]).toBe("Covered (until 2027-01-31)");
    // Locale-formatted, so assert the parse rather than one locale's layout.
    expect(table.rows[0]![4]).toBe(
      new Date("2026-07-04T09:30:00Z").toLocaleDateString(),
    );
  });

  it("returns headers and no rows for an empty set", () => {
    expect(buildUnitExportTable([])).toEqual({
      headers: [...PHONE_UNITS_EXPORT_HEADERS],
      rows: [],
    });
  });
});
