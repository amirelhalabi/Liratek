/** @jest-environment jsdom */
/**
 * LIRA-389 SC-002 — the List | Summary toggle on Audit & Transactions:
 *
 *  - Summary asks the server (`useApi().getTransactionSummary`) with the
 *    SAME options / search / days the list uses, the grouping (default:
 *    Product when the selection is Sales, Service type for one module, Type
 *    otherwise) and "include refunded" (off by default);
 *  - it shows one row per group and a TOTAL row, and never a profit, cost,
 *    margin or commission column, in any grouping;
 *  - clicking a row goes back to the List, filtered to that row (a chip
 *    says so, and the product reaches the list query as `sale_product_id`).
 *
 * Payload field names come from the core schema (rule 24): the expected
 * payload is parsed through `transactionSummarySchema`.
 *
 * Written before the page changes (rule 17).
 */
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import TransactionsViewer from "../TransactionsViewer";
import { getRecentTransactions } from "@/api/backendApi";
import {
  transactionSummarySchema,
  type TransactionSummaryResult,
} from "@liratek/core";

const mockUser = { id: 1, username: "tester", role: "staff" };
jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser }),
}));

jest.mock("@/api/backendApi", () => ({
  getRecentTransactions: jest.fn(),
}));

const mockGetTransactionSummary = jest.fn();
// rule 25: ONE identity for the whole file.
const mockApi = { getTransactionSummary: mockGetTransactionSummary };
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

const mockMethods = {
  methods: [],
  drawerAffectingMethods: [],
  allMethods: [],
  loading: false,
  refresh: jest.fn(),
};
jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => mockMethods,
}));
const mockShop = { name: "Test Shop", phone: "", location: "", logo: "" };
jest.mock("@/hooks/useShopName", () => ({ useShopInfo: () => mockShop }));
const mockRate = { sellRate: 89500, buyRate: 89000, isLoading: false };
jest.mock("@/hooks/useSellRate", () => ({ useSellRate: () => mockRate }));

const mockGetRecent = getRecentTransactions as jest.MockedFunction<
  typeof getRecentTransactions
>;

function result(
  group_by: TransactionSummaryResult["group_by"],
): TransactionSummaryResult {
  if (group_by === "product") {
    return {
      group_by,
      rows: [
        {
          key: "product:5",
          label: "Lenovo IdeaPad 3",
          count: 3,
          units: 3,
          volume_usd: 1335,
          volume_lbp: 0,
          product_id: 5,
          deleted: false,
        },
        {
          key: "product:9",
          label: "Old charger",
          count: 1,
          units: 2,
          volume_usd: 20,
          volume_lbp: 0,
          product_id: 9,
          deleted: true,
        },
      ],
      total: { count: 4, units: 5, volume_usd: 1355, volume_lbp: 0 },
      truncated: false,
    };
  }
  return {
    group_by,
    rows: [
      {
        key: group_by === "type" ? "sales" : "OMT System Send",
        label: group_by === "type" ? "Sales" : "OMT System Send",
        count: 4,
        units: null,
        volume_usd: 1840,
        volume_lbp: 0,
      },
    ],
    total: { count: 4, units: null, volume_usd: 1840, volume_lbp: 0 },
    truncated: false,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetRecent.mockResolvedValue([] as never);
  mockGetTransactionSummary.mockImplementation(
    async (p: { group_by: TransactionSummaryResult["group_by"] }) => ({
      success: true,
      data: result(p.group_by),
    }),
  );
});

function renderViewer(selectedFilters: string[], search = "") {
  render(
    <TransactionsViewer
      limit="50"
      selectedFilters={selectedFilters}
      search={search}
      from="2026-11-01"
      to="2026-11-30"
      onDayRangeChange={() => {}}
    />,
  );
}

async function openSummary() {
  fireEvent.click(await screen.findByTestId("transactions-view-summary"));
  return screen.findByTestId("transactions-summary-table");
}

const lastPayload = () =>
  mockGetTransactionSummary.mock.calls[
    mockGetTransactionSummary.mock.calls.length - 1
  ][0];

describe("LIRA-389 — Summary view", () => {
  it("Sales selection: groups by Product and sends the list's own filters", async () => {
    renderViewer(["Sale"], "laptop");
    const table = await openSummary();
    expect(lastPayload()).toEqual(
      transactionSummarySchema.parse({
        group_by: "product",
        include_refunded: false,
        options: [{ type: "SALE" }],
        search: "laptop",
        day_from: "2026-11-01",
        day_to: "2026-11-30",
      }),
    );
    const rows = within(table).getAllByRole("row");
    expect(within(table).getByText("Lenovo IdeaPad 3")).toBeTruthy();
    expect(within(table).getByText(/Old charger/)).toBeTruthy();
    expect(within(table).getByText(/deleted/i)).toBeTruthy();
    // header + 2 rows + TOTAL
    expect(rows).toHaveLength(4);
    const total = within(table).getByTestId("transactions-summary-total");
    expect(total.textContent).toContain("TOTAL");
    expect(total.textContent).toContain("$1,355.00");
    // zero LBP volume shows "—"
    expect(total.textContent).toContain("—");
  });

  it.each([
    [[] as string[], "type"],
    [["OMT System"], "service"],
    [["Sale"], "product"],
  ])("default grouping for %j is %s", async (filters, expected) => {
    renderViewer(filters);
    await openSummary();
    expect(lastPayload().group_by).toBe(expected);
  });

  it("has no profit, cost, margin or commission column in any grouping", async () => {
    renderViewer([]);
    await openSummary();
    for (const g of ["type", "service", "product", "category"]) {
      fireEvent.click(screen.getByTestId(`summary-group-${g}`));
      await waitFor(() => expect(lastPayload().group_by).toBe(g));
      const table = await screen.findByTestId("transactions-summary-table");
      const headers = within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent ?? "");
      expect(headers.join("|")).not.toMatch(/profit|cost|margin|commission/i);
    }
  });

  it("include refunded is off by default and sent when ticked", async () => {
    renderViewer(["Sale"]);
    await openSummary();
    expect(lastPayload().include_refunded).toBe(false);
    fireEvent.click(screen.getByTestId("summary-include-refunded"));
    await waitFor(() => expect(lastPayload().include_refunded).toBe(true));
  });

  it("a Type row shows its module name in the page's language", async () => {
    renderViewer([]);
    const table = await openSummary();
    expect(within(table).getByText("Sales")).toBeTruthy();
  });

  it("clicking a product row opens the List filtered to that product", async () => {
    renderViewer(["Sale"]);
    const table = await openSummary();
    fireEvent.click(within(table).getByText("Lenovo IdeaPad 3"));
    expect(await screen.findByTestId("data-table")).toBeTruthy();
    const chip = await screen.findByTestId("transactions-drill-chip");
    expect(chip.textContent).toContain("Lenovo IdeaPad 3");
    await waitFor(() =>
      expect(mockGetRecent).toHaveBeenLastCalledWith(
        expect.any(Number),
        expect.objectContaining({ sale_product_id: 5 }),
      ),
    );
    // removing the chip lifts the drill-down
    fireEvent.click(within(chip).getByRole("button"));
    await waitFor(() =>
      expect(screen.queryByTestId("transactions-drill-chip")).toBeNull(),
    );
    const last = mockGetRecent.mock.calls[mockGetRecent.mock.calls.length - 1];
    expect(last[1]).not.toHaveProperty("sale_product_id");
  });
});
