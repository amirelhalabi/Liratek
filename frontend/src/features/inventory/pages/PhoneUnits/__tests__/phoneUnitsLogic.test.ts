/**
 * LIRA-143 — Phone Units page pure logic: filter-state → query-args mapping
 * and the server-side pagination arithmetic. These are the two places the page
 * does its own maths, so they are covered here directly (in addition to the
 * component test that proves the page actually FEEDS them its state).
 */
import {
  PHONE_UNITS_PAGE_SIZE,
  PHONE_UNITS_SEARCH_MAX,
  buildUnitListFilters,
  computePageRange,
  unitStatusBadgeClass,
  type PhoneUnitsFilterState,
} from "../phoneUnitsLogic";

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
