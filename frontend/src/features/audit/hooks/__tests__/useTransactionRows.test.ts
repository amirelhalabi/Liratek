/**
 * useTransactionRows — 5 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 5).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { transactionPageFiltersSchema } from "@liratek/core";
import { useTransactionRows } from "../useTransactionRows";
import { getRecentTransactions } from "@/api/backendApi";

jest.mock("@/api/backendApi", () => ({
  getRecentTransactions: jest.fn(),
}));

function resetBetweenFiles() {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("useTransactionRows.lira348Paging (LIRA-348)", () => {
  beforeAll(resetBetweenFiles);

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
});

describe("useTransactionRows.paidViaAccount", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Client twin of `TransactionRepository.getRecent`'s `paid_via_account` rule
   * (isRowVisibleForOption in useTransactionRows.ts).
   *
   * A Debts option (e.g. "Account Adjustment") also shows rows of OTHER types
   * linked to a customer account — the server's `paid_via_account` flag, since
   * a CUSTOMER_ACCOUNT leg never appears in `payments` — but never a row of
   * another Debts option, which shows only through its own tuple.
   */

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
});

describe("useTransactionRows.paidViaDrawer (LIRA-323)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-323 — client twin of `TransactionRepository.getRecent`'s
   * `paid_via_drawer` rule (isRowVisibleForOption in useTransactionRows.ts).
   *
   * A wallet option (e.g. "OMT App Send") also shows rows of OTHER types whose
   * payment detail moved money through that wallet's drawer — the row's own
   * `payments` OR the session basket's pooled `session_payments` — but never a
   * row of one of that wallet's OWN filter options (OMT App Recv/Top-up/
   * Cash-Out), which show only through their own tuple. The server already
   * strips internal legs from `payments`, so the twin only checks the drawer.
   */

  const mockFetch = getRecentTransactions as jest.MockedFunction<
    typeof getRecentTransactions
  >;

  const BASE = { limit: "50", search: "", from: "", to: "" };

  const leg = (method: string, drawer_name: string, signed_amount = 30) => ({
    direction: signed_amount < 0 ? "out" : "in",
    amount: Math.abs(signed_amount),
    signed_amount,
    currency_code: "USD",
    method,
    drawer_name,
  });

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
    // 1: OMT App Send itself
    row(1, "FINANCIAL_SERVICE", {
      metadata_json: JSON.stringify({
        provider: "OMT_APP",
        service_type: "SEND",
      }),
    }),
    // 2: Maintenance paid Cash + OMT Wallet
    row(2, "MAINTENANCE", {
      payments: [leg("CASH", "General", 10), leg("OMT", "OMT_App")],
    }),
    // 3: Maintenance paid cash only
    row(3, "MAINTENANCE", { payments: [leg("CASH", "General", 10)] }),
    // 4: OMT App Recv with an OMT_App leg — own option, must NOT be added
    row(4, "FINANCIAL_SERVICE", {
      metadata_json: JSON.stringify({
        provider: "OMT_APP",
        service_type: "RECEIVE",
      }),
      payments: [leg("OMT", "OMT_App", -30)],
    }),
    // 5: session member, basket paid by OMT Wallet (pooled leg only)
    row(5, "CUSTOM_SERVICE", {
      session_id: 9,
      session_payments: [leg("OMT", "OMT_App")],
    }),
    // 6: refund paid out by OMT Wallet
    row(6, "REFUND", { payments: [leg("OMT", "OMT_App", -10)] }),
    // 7: Whish-paid sale — not an OMT row
    row(7, "SALE", { payments: [leg("WHISH", "Whish_App")] }),
  ];

  async function visibleIds(selectedFilters: string[]): Promise<number[]> {
    mockFetch.mockResolvedValue(ROWS as never);
    const { result } = renderHook(() =>
      useTransactionRows({ ...BASE, selectedFilters }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    return result.current.rows.map((r) => r.id).sort((a, b) => a - b);
  }

  describe("useTransactionRows — LIRA-323 paid via wallet drawer", () => {
    beforeEach(() => mockFetch.mockReset());

    it("sends paid_via_drawer on the wallet option's typeFilters tuple", async () => {
      await visibleIds(["OMT App Send"]);
      const filters = mockFetch.mock.calls[0][1] as {
        typeFilters?: Array<Record<string, unknown>>;
      };
      expect(filters.typeFilters).toEqual([
        {
          type: "FINANCIAL_SERVICE",
          provider: "OMT_APP",
          service_type: "SEND",
          paid_via_drawer: "OMT_App",
        },
      ]);
    });

    it("OMT App Send shows its own rows plus other-type rows paid through OMT_App (own legs, pooled legs, refund OUT legs)", async () => {
      expect(await visibleIds(["OMT App Send"])).toEqual([1, 2, 5, 6]);
    });

    it("a non-wallet option is unchanged (MTC adds nothing paid by OMT Wallet)", async () => {
      expect(await visibleIds(["MTC"])).toEqual([]);
    });

    it("mixed with Cash only (till): union of the cash rows and the OMT-paid rows", async () => {
      expect(await visibleIds(["OMT App Send", "Cash only (till)"])).toEqual([
        1, 2, 3, 5, 6,
      ]);
    });

    it("Whish App Send adds the Whish-paid sale and none of the OMT rows", async () => {
      expect(await visibleIds(["Whish App Send"])).toEqual([7]);
    });
  });
});

describe("useTransactionRows.paidViaVoucher (LIRA-339)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Client twin of `TransactionRepository.getRecent`'s `paid_via_voucher` rule (LIRA-339)
   * (isRowVisibleForOption in useTransactionRows.ts).
   *
   * A Vouchers option also shows rows of OTHER types paid with a voucher (the
   * server's `paid_via_voucher` flag) but never a row of the other Vouchers
   * option, which shows only through its own tuple.
   */

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
});

describe("useTransactionRows (LIRA-201)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * The window-widening fetch loop, tested directly.
   *
   * This logic used to live inside a `useCallback` in `TransactionsViewer`, so
   * the only way to reach it was to render the entire table — which is why it
   * had no tests at all despite being a real algorithm with real edge cases
   * (under-filled windows, an exhausted table, the fetch cap). Extracting it
   * into `useTransactionRows` is what makes this file possible.
   *
   * The final describe block below is NEW (NOT RUN — proven at the
   * end-of-batch gate, owner process rule, 2026-09-24 batch) — LIRA-201b
   * (owner note #11-B): guards a regression `_attachPaymentLegs`'s fix would
   * otherwise introduce here. Rule 17: reverting `isRowVisibleForOption`'s
   * `cash_only` branch to read only `row.payments` (dropping the
   * `row.session_payments` merge) must make that test FAIL — a session member
   * with no own legs would then read as NOT cash and vanish from the
   * "Cash only (till)" filter even though its session basket was paid in cash.
   */

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
    selectedFilters: [] as string[],
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
        useTransactionRows({ ...BASE, selectedFilters: ["Cash only (till)"] }),
      );
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.rows.map((r) => r.id)).toEqual([1]);
    });

    // LIRA-348 (rule 24): the from/to days are now applied by the SERVER
    // (`day_from`/`day_to` — see useTransactionRows.lira348Paging.test.ts),
    // so a range change refetches. `filteredRows` keeps the same local-day
    // cut as a safety net over whatever comes back; this guards that net.
    it("filteredRows still cuts anything outside the from/to days that comes back", async () => {
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

    it("hides an auto EXPENSE row (SMS_Transfer_Fee) under the default 'All types' filter", async () => {
      // ExpenseRepository.createExpense stamps metadata.is_auto = true on the
      // auto-generated SMS_Transfer_Fee sibling row (source_ref_table set) —
      // same D2-style default-view hide as auto SUPPLIER_PAYMENT rows.
      //
      // Rule 17: this is the guard test named in useTransactionRows.ts's
      // filterVisible comment — commenting out the `r.type === "EXPENSE"`
      // branch there (falling through to `return true`) must make this fail.
      mockFetch.mockResolvedValue([
        {
          id: 1,
          type: "EXPENSE",
          created_at: "2026-08-28 09:00:00",
          metadata_json: JSON.stringify({
            is_auto: true,
            source_ref_table: "recharge_transactions",
          }),
        },
        {
          id: 2,
          type: "EXPENSE",
          created_at: "2026-08-28 08:00:00",
          metadata_json: null, // manual expense — no is_auto key at all
        },
      ] as never);

      const { result } = renderHook(() => useTransactionRows(BASE));
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.rows.map((r) => r.id)).toEqual([2]);
    });

    it("reveals the auto EXPENSE row under the 'Expense' filter, manual row stays visible", async () => {
      mockFetch.mockResolvedValue([
        {
          id: 1,
          type: "EXPENSE",
          created_at: "2026-08-28 09:00:00",
          metadata_json: JSON.stringify({
            is_auto: true,
            source_ref_table: "recharge_transactions",
          }),
        },
        {
          id: 2,
          type: "EXPENSE",
          created_at: "2026-08-28 08:00:00",
          metadata_json: null,
        },
      ] as never);

      const { result } = renderHook(() =>
        useTransactionRows({ ...BASE, selectedFilters: ["Expense"] }),
      );
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.rows.map((r) => r.id).sort()).toEqual([1, 2]);
    });

    it("refetches when reload() is called", async () => {
      mockFetch.mockResolvedValue(makeRows(30) as never);

      const { result } = renderHook(() => useTransactionRows(BASE));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(mockFetch).toHaveBeenCalledTimes(1);

      result.current.reload();
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    });

    // ---------------------------------------------------------------------
    // Multi-select Type filter — the crux of this ticket: selecting two
    // FILTER_GROUPS options that SHARE a type but differ by provider/
    // service_type (e.g. "Whish App Send" vs "Katsh") must send BOTH tuples
    // to the repository, OR'd — not just the first, and not degrade into
    // "any row of that type".
    // ---------------------------------------------------------------------

    it("sends one typeFilters tuple per selected option when selecting two options", async () => {
      mockFetch.mockResolvedValue([] as never);

      renderHook(() =>
        useTransactionRows({
          ...BASE,
          selectedFilters: ["Whish App Send", "Katsh"],
        }),
      );
      await waitFor(() => expect(mockFetch).toHaveBeenCalled());

      const filters = mockFetch.mock.calls[0][1] as {
        typeFilters?: Array<Record<string, unknown>>;
      };
      expect(filters.typeFilters).toEqual([
        {
          type: "FINANCIAL_SERVICE",
          provider: "WHISH_APP",
          service_type: "SEND",
          has_item_key: false,
          // LIRA-323 — wallet options carry their drawer.
          paid_via_drawer: "Whish_App",
        },
        {
          type: "FINANCIAL_SERVICE",
          provider: "Katsh",
        },
      ]);
    });

    it("returns the UNION of two selected options — rows matching EITHER, not just the first", async () => {
      mockFetch.mockResolvedValue([
        {
          id: 1,
          type: "FINANCIAL_SERVICE",
          created_at: "2026-08-28 09:00:00",
          metadata_json: JSON.stringify({
            provider: "WHISH_APP",
            service_type: "SEND",
          }),
        },
        {
          id: 2,
          type: "FINANCIAL_SERVICE",
          created_at: "2026-08-28 08:00:00",
          metadata_json: JSON.stringify({ provider: "Katsh" }),
        },
        // Same TYPE as both selected options but a DIFFERENT provider — must
        // be excluded from the union.
        {
          id: 3,
          type: "FINANCIAL_SERVICE",
          created_at: "2026-08-28 07:00:00",
          metadata_json: JSON.stringify({ provider: "iPick" }),
        },
      ] as never);

      const { result } = renderHook(() =>
        useTransactionRows({
          ...BASE,
          selectedFilters: ["Whish App Send", "Katsh"],
        }),
      );
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.rows.map((r) => r.id).sort()).toEqual([1, 2]);
    });

    it("mixing an untyped option (Cash only) with a typed option omits the SQL typeFilters restriction but still unions correctly client-side", async () => {
      mockFetch.mockResolvedValue([
        // Matches "MTC" by type+provider — no cash leg, but still visible via
        // the type-tuple branch of the union.
        {
          id: 1,
          type: "RECHARGE",
          created_at: "2026-08-28 09:00:00",
          payments: [],
          metadata_json: JSON.stringify({ provider: "MTC" }),
        },
        // Doesn't match "MTC" (different provider) but HAS a cash leg — still
        // visible via the cash_only branch of the union.
        {
          id: 2,
          type: "SALE",
          created_at: "2026-08-28 08:00:00",
          payments: [
            {
              direction: "in",
              amount: 10,
              signed_amount: 10,
              currency_code: "USD",
              method: "CASH",
            },
          ],
          metadata_json: null,
        },
        // Matches NEITHER — different type/provider, no cash leg.
        {
          id: 3,
          type: "RECHARGE",
          created_at: "2026-08-28 07:00:00",
          payments: [],
          metadata_json: JSON.stringify({ provider: "Alfa" }),
        },
      ] as never);

      const { result } = renderHook(() =>
        useTransactionRows({
          ...BASE,
          selectedFilters: ["Cash only (till)", "MTC"],
        }),
      );
      await waitFor(() => expect(result.current.loading).toBe(false));

      const filters = mockFetch.mock.calls[0][1] as {
        typeFilters?: unknown;
      };
      // An untyped option (cash_only) can match a row of ANY type, so the
      // union can't be expressed as a SQL type restriction — the fetch must
      // stay unrestricted by type and rely on the client-side union filter.
      expect(filters.typeFilters).toBeUndefined();
      expect(result.current.rows.map((r) => r.id).sort()).toEqual([1, 2]);
    });
  });

  describe("useTransactionRows — LIRA-201b: cash_only sees a session's pooled leg", () => {
    beforeEach(() => mockFetch.mockReset());

    it("a session member with NO own legs still counts as cash when the session's pooled session_payments has a CASH leg", async () => {
      mockFetch.mockResolvedValue([
        // No own legs at all (post-LIRA-201b, this is the normal shape for a
        // session member other than whichever one — if any — has its own
        // cost-flow leg): the basket's actual cash leg lives on
        // session_payments only.
        {
          id: 1,
          type: "LOTO_CASH_PRIZE",
          created_at: "2026-09-24 10:00:00",
          metadata_json: null,
          session_id: 7,
          payments: [],
          session_payments: [
            {
              direction: "in",
              amount: 50,
              signed_amount: 50,
              currency_code: "USD",
              method: "CASH",
            },
          ],
        },
        // A non-session row with no cash leg — must still be excluded.
        {
          id: 2,
          type: "SALE",
          created_at: "2026-09-24 09:00:00",
          metadata_json: null,
          session_id: null,
          payments: [],
        },
      ] as never);

      const { result } = renderHook(() =>
        useTransactionRows({ ...BASE, selectedFilters: ["Cash only (till)"] }),
      );
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.rows.map((r) => r.id)).toEqual([1]);
    });
  });
});

describe("useTransactionRows — LIRA-389 drill-down keeps the item-refund set honest", () => {
  beforeAll(resetBetweenFiles);

  /**
   * A Summary drill-down narrows the rows like a type filter does, so it can
   * hide the one REFUND row that proves a session basket was touched by an
   * item refund. `sessionsWithItemRefund` must then come from the dedicated
   * unfiltered REFUND query (LIRA-232 finding 3), or "Void basket" would
   * reappear on a basket the server refuses to void.
   * Written before the hook change (rule 17).
   */
  const mockFetch = getRecentTransactions as jest.MockedFunction<
    typeof getRecentTransactions
  >;

  const saleMember = {
    id: 20,
    type: "SALE",
    status: "ACTIVE",
    metadata_json: null,
    created_at: "2026-11-10 10:00:00",
    session_id: 7,
  };
  const itemRefund = {
    id: 21,
    type: "REFUND",
    status: "ACTIVE",
    metadata_json: JSON.stringify({ refundType: "sessionItem" }),
    created_at: "2026-11-10 10:05:00",
    session_id: 7,
  };

  it("a module drill-down still knows the basket had an item refund", async () => {
    mockFetch.mockImplementation(async (_limit, filters) => {
      const isRefundOnly = filters?.typeFilters?.some(
        (t) => t.type === "REFUND",
      );
      return (isRefundOnly ? [itemRefund] : [itemRefund, saleMember]) as never;
    });
    const { result } = renderHook(() =>
      useTransactionRows({
        limit: "50",
        selectedFilters: [],
        search: "",
        from: "",
        to: "",
        drill: { dimension: "type", key: "sales", label: "Sales" },
      }),
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(result.current.rows[0]!.id).toBe(20);
    await waitFor(() =>
      expect(result.current.sessionsWithItemRefund.has(7)).toBe(true),
    );
  });
});
