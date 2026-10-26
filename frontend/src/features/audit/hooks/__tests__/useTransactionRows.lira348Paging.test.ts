/** @jest-environment jsdom */
/**
 * LIRA-348 — the Transactions tab shows 50 at a time and loads more as the
 * operator scrolls:
 *   - the day range is sent to the server (`day_from` / `day_to`, the
 *     operator's days — rule 27) instead of being cut client-side from
 *     whatever window happened to load;
 *   - `loadMore()` continues AFTER the last row already shown (keyset
 *     `before`, never an offset), appending without repeating or skipping;
 *   - a short page means there is nothing more (`hasMore` false).
 * Field names come from the shared core schema (rule 24).
 * Written before the hook change (rule 17).
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { transactionPageFiltersSchema } from "@liratek/core";
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
};

/** `count` rows with descending ids starting at `topId`, one per second. */
function rowsFrom(topId: number, count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: topId - i,
    type: "SALE",
    metadata_json: null,
    created_at: `2026-10-26 10:${String(Math.floor((topId - i) / 60) % 60).padStart(2, "0")}:${String((topId - i) % 60).padStart(2, "0")}`,
  }));
}

const PAGE = { limit: "50", selectedFilters: [] as string[], search: "" };

describe("useTransactionRows — LIRA-348 paging", () => {
  beforeEach(() => mockFetch.mockReset());

  it("sends the day range to the server, as the shared schema names it", async () => {
    mockFetch.mockResolvedValue([] as never);
    renderHook(() =>
      useTransactionRows({ ...PAGE, from: "2026-10-26", to: "2026-10-26" }),
    );
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const filters = mockFetch.mock.calls[0][1] as Record<string, unknown>;
    const expected = transactionPageFiltersSchema.parse({
      day_from: "2026-10-26",
      day_to: "2026-10-26",
    });
    expect(filters).toMatchObject(expected);
    expect(filters.before).toBeUndefined();
  });

  it("changing the day range refetches instead of narrowing the old window", async () => {
    mockFetch.mockResolvedValue([] as never);
    const { rerender } = renderHook((p) => useTransactionRows(p), {
      initialProps: { ...PAGE, from: "2026-10-26", to: "2026-10-26" },
    });
    // Only the table's own reads (the separate REFUND-only lookup for the
    // basket buttons is not a page read).
    const pageReads = () =>
      mockFetch.mock.calls
        .map((c) => c[1] as Record<string, unknown>)
        .filter((f) => Array.isArray(f.excludeTypes));
    await waitFor(() => expect(pageReads()).toHaveLength(1));
    rerender({ ...PAGE, from: "2026-10-25", to: "2026-10-25" });
    await waitFor(() => expect(pageReads()).toHaveLength(2));
    expect(pageReads()[1]).toMatchObject({
      day_from: "2026-10-25",
      day_to: "2026-10-25",
    });
  });

  it("shows at most 50, then loadMore() continues after the last row shown", async () => {
    // 150 raw rows back (a full raw window): 50 shown, more to come.
    mockFetch.mockResolvedValueOnce(rowsFrom(400, 150) as never);
    const { result } = renderHook(() =>
      useTransactionRows({ ...PAGE, from: "", to: "" }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toHaveLength(50);
    expect(result.current.rows[49].id).toBe(351);
    expect(result.current.hasMore).toBe(true);

    // The next page starts right after row 351 and is short: the end.
    mockFetch.mockResolvedValueOnce(rowsFrom(350, 20) as never);
    await act(async () => {
      await result.current.loadMore();
    });
    const second = mockFetch.mock.calls[1][1] as Record<string, unknown>;
    expect(second.before).toEqual({
      created_at: result.current.rows[49].created_at,
      id: 351,
    });
    const ids = result.current.rows.map((r) => r.id);
    expect(ids).toHaveLength(70);
    expect(new Set(ids).size).toBe(70);
    expect(ids[50]).toBe(350);
    expect(result.current.hasMore).toBe(false);
  });
});
