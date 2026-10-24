/** @jest-environment jsdom */
/**
 * Client twin of `TransactionRepository.getRecent`'s `paid_via_account` rule
 * (isRowVisibleForOption in useTransactionRows.ts).
 *
 * A Debts option (e.g. "Account Adjustment") also shows rows of OTHER types
 * linked to a customer account — the server's `paid_via_account` flag, since
 * a CUSTOMER_ACCOUNT leg never appears in `payments` — but never a row of
 * another Debts option, which shows only through its own tuple.
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
  // 1: Account Adjustment itself
  row(1, "ACCOUNT_ADJUSTMENT", { paid_via_account: true }),
  // 2: sale charged to the account
  row(2, "SALE", { paid_via_account: true }),
  // 3: cash sale
  row(3, "SALE", { paid_via_account: false }),
  // 4: Debt Repayment — another Debts option, must NOT be added
  row(4, "DEBT_REPAYMENT", { paid_via_account: true }),
  // 5: row from an older backend (no flag) — reads as not linked
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

describe("useTransactionRows — Debts options also show account-linked rows", () => {
  beforeEach(() => mockFetch.mockReset());

  it("sends paid_via_account on the Debts option's typeFilters tuple", async () => {
    await visibleIds(["Account Adjustment"]);
    const filters = mockFetch.mock.calls[0][1] as {
      typeFilters?: Array<Record<string, unknown>>;
    };
    expect(filters.typeFilters).toEqual([
      { type: "ACCOUNT_ADJUSTMENT", paid_via_account: true },
    ]);
  });

  it("Account Adjustment shows its own row plus the sale charged to the account", async () => {
    expect(await visibleIds(["Account Adjustment"])).toEqual([1, 2]);
  });

  it("Debt Repayment shows its own row plus the account-linked sale", async () => {
    expect(await visibleIds(["Debt Repayment"])).toEqual([2, 4]);
  });

  it("a non-Debts option adds nothing linked to an account", async () => {
    expect(await visibleIds(["Sale"])).toEqual([2, 3]);
  });
});
