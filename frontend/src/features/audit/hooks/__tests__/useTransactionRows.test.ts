/** @jest-environment jsdom */
/**
 * The window-widening fetch loop, tested directly.
 *
 * This logic used to live inside a `useCallback` in `TransactionsViewer`, so
 * the only way to reach it was to render the entire table — which is why it
 * had no tests at all despite being a real algorithm with real edge cases
 * (under-filled windows, an exhausted table, the fetch cap). Extracting it
 * into `useTransactionRows` is what makes this file possible.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { useTransactionRows } from "../useTransactionRows";
import { getRecentTransactions } from "@/api/backendApi";

jest.mock("@/api/backendApi", () => ({
  getRecentTransactions: jest.fn(),
}));

const mockFetch = getRecentTransactions as jest.MockedFunction<
  typeof getRecentTransactions
>;

type Row = {
  id: number;
  type: string;
  metadata_json: string | null;
  created_at: string;
  payments?: Array<{
    direction: "in" | "out";
    amount: number;
    signed_amount: number;
    currency_code: string;
    method: string;
  }>;
};

function makeRows(
  count: number,
  overrides: (i: number) => Partial<Row> = () => ({}),
): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    type: "SALE",
    metadata_json: null,
    created_at: `2026-08-${String((i % 28) + 1).padStart(2, "0")} 10:00:00`,
    ...overrides(i),
  }));
}

const BASE = {
  limit: "10",
  selectedFilter: "All",
  search: "",
  from: "",
  to: "",
};

describe("useTransactionRows", () => {
  beforeEach(() => mockFetch.mockReset());

  it("asks for 3× the requested rows up front and caps the result at the limit", async () => {
    mockFetch.mockResolvedValue(makeRows(30) as never);

    const { result } = renderHook(() => useTransactionRows(BASE));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe(30);
    expect(result.current.rows).toHaveLength(10);
  });

  it("excludes the blanket-hidden types at the SQL level", async () => {
    mockFetch.mockResolvedValue(makeRows(30) as never);

    renderHook(() => useTransactionRows(BASE));
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    const filters = mockFetch.mock.calls[0][1] as { excludeTypes?: string[] };
    expect(filters.excludeTypes).toEqual(["CLIENT_CREATED"]);
  });

  it("widens the window when client-side filtering under-fills it", async () => {
    // Every auto SUPPLIER_PAYMENT is dropped client-side (D2), so the first
    // pass yields far fewer than the 10 requested and must fetch again.
    const autoSupplier = (n: number) =>
      makeRows(n, () => ({
        type: "SUPPLIER_PAYMENT",
        metadata_json: JSON.stringify({ is_auto: true }),
      }));

    mockFetch
      .mockResolvedValueOnce([...autoSupplier(28), ...makeRows(2)] as never)
      .mockResolvedValueOnce([...autoSupplier(80), ...makeRows(10)] as never);

    const { result } = renderHook(() => useTransactionRows(BASE));
    await waitFor(() => expect(result.current.rows).toHaveLength(10));

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe(30);
    expect(mockFetch.mock.calls[1][0]).toBe(90); // widened 3×
  });

  it("stops widening once the table is exhausted (short raw page)", async () => {
    // Fewer rows came back than were asked for → there is nothing more to
    // fetch, so the loop must NOT keep widening even though the window is
    // still under-filled.
    mockFetch.mockResolvedValue(
      makeRows(4, () => ({
        type: "SUPPLIER_PAYMENT",
        metadata_json: JSON.stringify({ is_auto: true }),
      })) as never,
    );

    const { result } = renderHook(() => useTransactionRows(BASE));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.current.rows).toEqual([]);
  });

  it("stops widening at the fetch cap instead of looping forever", async () => {
    // A full page every time, all of it filtered out client-side: without the
    // cap this would widen until the process died.
    mockFetch.mockImplementation((size?: number) =>
      Promise.resolve(
        makeRows(size ?? 0, () => ({
          type: "SUPPLIER_PAYMENT",
          metadata_json: JSON.stringify({ is_auto: true }),
        })) as never,
      ),
    );

    const { result } = renderHook(() => useTransactionRows(BASE));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const sizes = mockFetch.mock.calls.map((c) => c[0]);
    expect(sizes).toEqual([30, 90, 270, 810, 2430, 7290]);
    expect(result.current.rows).toEqual([]);
  });

  it("keeps a foreign-currency top-up under the Cash only (till) filter", async () => {
    // Its EUR CASH leg is stripped upstream, so the row arrives with NO
    // payments — the metadata rebuild is what keeps it visible, matching the
    // "Cash" its Method column shows.
    mockFetch.mockResolvedValue([
      {
        id: 1,
        type: "DRAWER_TOPUP",
        created_at: "2026-08-28 09:54:53",
        payments: [],
        metadata_json: JSON.stringify({
          drawer: "General",
          extra_currencies: [{ currency_code: "EUR", amount: 100 }],
        }),
      },
      {
        id: 2,
        type: "SALE",
        created_at: "2026-08-28 09:00:00",
        payments: [],
        metadata_json: null,
      },
    ] as never);

    const { result } = renderHook(() =>
      useTransactionRows({ ...BASE, selectedFilter: "Cash only (till)" }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.rows.map((r) => r.id)).toEqual([1]);
  });

  it("narrows filteredRows to the from/to range without refetching", async () => {
    mockFetch.mockResolvedValue([
      {
        id: 1,
        type: "SALE",
        created_at: "2026-08-01 10:00:00",
        metadata_json: null,
      },
      {
        id: 2,
        type: "SALE",
        created_at: "2026-08-15 10:00:00",
        metadata_json: null,
      },
      {
        id: 3,
        type: "SALE",
        created_at: "2026-08-28 10:00:00",
        metadata_json: null,
      },
    ] as never);

    const { result } = renderHook(() =>
      useTransactionRows({ ...BASE, from: "2026-08-10", to: "2026-08-20" }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.rows).toHaveLength(3); // unfiltered count for the footer
    expect(result.current.filteredRows.map((r) => r.id)).toEqual([2]);
  });

  it("refetches when reload() is called", async () => {
    mockFetch.mockResolvedValue(makeRows(30) as never);

    const { result } = renderHook(() => useTransactionRows(BASE));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockFetch).toHaveBeenCalledTimes(1);

    result.current.reload();
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  });
});
