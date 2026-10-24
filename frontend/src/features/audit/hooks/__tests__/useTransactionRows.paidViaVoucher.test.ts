/** @jest-environment jsdom */
/**
 * Client twin of `TransactionRepository.getRecent`'s `paid_via_voucher` rule (LIRA-339)
 * (isRowVisibleForOption in useTransactionRows.ts).
 *
 * A Vouchers option also shows rows of OTHER types paid with a voucher (the
 * server's `paid_via_voucher` flag) but never a row of the other Vouchers
 * option, which shows only through its own tuple.
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

const BASE = { limit: "50", search: "", from: "", to: "" };

function row(
  id: number,
  type: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    type,
    created_at: `2026-08-28 10:${String(60 - id).padStart(2, "0")}:00`,
    metadata_json: null,
    payments: [],
    ...extra,
  };
}

const ROWS = [
  row(1, "VOUCHER_SALE", { paid_via_voucher: false }),
  // 2: sale paid with a voucher
  row(2, "SALE", { paid_via_voucher: true }),
  // 3: cash sale
  row(3, "SALE", { paid_via_voucher: false }),
  // 4: the other Vouchers option's own row — must NOT be added
  row(4, "VOUCHER_CANCEL", { paid_via_voucher: true }),
  // 5: older backend (no flag) — reads as not linked
  row(5, "MAINTENANCE"),
];

async function visibleIds(selectedFilters: string[]): Promise<number[]> {
  mockFetch.mockResolvedValue(ROWS as never);
  const { result } = renderHook(() =>
    useTransactionRows({ ...BASE, selectedFilters }),
  );
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result.current.rows.map((r) => r.id).sort((a, b) => a - b);
}

describe("useTransactionRows — Vouchers options also show voucher-paid rows", () => {
  beforeEach(() => mockFetch.mockReset());

  it("sends paid_via_voucher on the Vouchers option's typeFilters tuple", async () => {
    await visibleIds(["Voucher Sold"]);
    const filters = mockFetch.mock.calls[0][1] as {
      typeFilters?: Array<Record<string, unknown>>;
    };
    expect(filters.typeFilters).toEqual([
      { type: "VOUCHER_SALE", paid_via_voucher: true },
    ]);
  });

  it("Voucher Sold shows its own row plus the voucher-paid sale", async () => {
    expect(await visibleIds(["Voucher Sold"])).toEqual([1, 2]);
  });

  it("Voucher Cancelled shows its own row plus the voucher-paid sale", async () => {
    expect(await visibleIds(["Voucher Cancelled"])).toEqual([2, 4]);
  });

  it("a non-Vouchers option adds nothing paid with a voucher", async () => {
    expect(await visibleIds(["Sale"])).toEqual([2, 3]);
  });
});
