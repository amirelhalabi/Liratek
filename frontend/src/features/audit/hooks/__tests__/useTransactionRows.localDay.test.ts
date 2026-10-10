/**
 * LIRA-289 T039 — the Transactions page's date filter uses the shop's local
 * date. created_at is stored in UTC (`YYYY-MM-DD HH:MM:SS` or ISO `…Z`), and
 * the filter compared its first 10 characters, so a 00:30 Beirut sale
 * (21:30 UTC the day before) dropped out of "today". Written FIRST against
 * the slice(0, 10) filter (rule 17).
 */
process.env.TZ = "Asia/Beirut";

import { renderHook, waitFor } from "@testing-library/react";
import { useTransactionRows } from "../useTransactionRows";
import { getRecentTransactions } from "@/api/backendApi";

jest.mock("@/api/backendApi", () => ({
  getRecentTransactions: jest.fn(),
}));

const mockFetch = getRecentTransactions as jest.MockedFunction<typeof getRecentTransactions>;

const rows = [
  { id: 1, type: "SALE", metadata_json: null, created_at: "2026-10-09 21:30:00" },
  { id: 2, type: "SALE", metadata_json: null, created_at: "2026-10-09T21:30:00.000Z" },
  { id: 3, type: "SALE", metadata_json: null, created_at: "2026-10-09 20:00:00" },
];

describe("useTransactionRows date filter (shop's local date)", () => {
  beforeEach(() => mockFetch.mockReset());

  it("puts a 00:30 Beirut sale on that Beirut day, in both stored shapes", async () => {
    mockFetch.mockResolvedValue(rows as never);
    const { result } = renderHook(() =>
      useTransactionRows({ limit: "10", selectedFilters: [], search: "", from: "2026-10-10", to: "2026-10-10" }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.filteredRows.map((r) => r.id).sort()).toEqual([1, 2]);
  });

  it("keeps a 23:00 Beirut sale on the previous Beirut day", async () => {
    mockFetch.mockResolvedValue(rows as never);
    const { result } = renderHook(() =>
      useTransactionRows({ limit: "10", selectedFilters: [], search: "", from: "2026-10-09", to: "2026-10-09" }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.filteredRows.map((r) => r.id)).toEqual([3]);
  });
});
