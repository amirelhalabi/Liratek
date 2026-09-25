/**
 * Pending Profit – ProfitService.getPendingProfit()
 *
 * Verifies:
 *   - SQL query filters completed + not-fully-paid sales
 *   - SQL excludes refunded items (is_refunded = 0)
 *   - SQL query does NOT date-range-filter unpaid sales (PA-3.8,
 *     OWNER_NOTES_2026-09-21.md §6.5, owner decision: "Pending means as of
 *     now" — a receivables view, not a period report; it used to hide an
 *     unpaid sale older than the tab's date range)
 *   - SQL joins to clients via transactions for name/phone
 *   - Totals aggregation (count, outstanding, pending profit) is correct
 *   - Error handling RETHROWS instead of returning a fake-empty success
 *     (PA-4.16 — a swallowed error used to be indistinguishable on screen
 *     from a legitimately quiet period)
 *
 * The discount-subtraction and partner-coverage-weighting arithmetic
 * (PA-3.3 / PA-3.2) are proven against a REAL better-sqlite3 DB, not this
 * file's mock, in
 * `packages/core/src/repositories/__tests__/ProfitRepository.pendingTabFixes.test.ts`
 * — a mocked `.prepare()` can assert the SQL TEXT contains the right
 * fragments (below) but cannot prove the arithmetic is actually correct.
 */

import { resetAllMocks, mockDatabase } from "../__mocks__/better-sqlite3";
import { ProfitService, resetProfitService } from "@liratek/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return the SQL string from the last (or Nth) `db.prepare(sql)` call.
 */
function getLastPreparedSql(callIndex?: number): string {
  const calls = (mockDatabase.prepare as any).mock.calls;
  const idx = callIndex !== undefined ? callIndex : calls.length - 1;
  return calls[idx]?.[0] ?? "";
}

/**
 * Set up the mock so the next `.prepare().all()` call returns `rows`.
 */
function mockAllReturns(rows: any[]) {
  (mockDatabase.prepare as any).mockImplementationOnce((sql: string) => ({
    _sql: sql,
    run: jest.fn(() => ({ changes: 0 })),
    get: jest.fn(() => undefined),
    all: jest.fn(() => rows),
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProfitService.getPendingProfit", () => {
  let service: ProfitService;

  beforeEach(() => {
    resetAllMocks();
    (globalThis as any).__LIRATEK_TEST_DB__ = mockDatabase;
    resetProfitService();
    service = new ProfitService();
    // PA-3.7: getPendingProfit now ALSO calls getUnsettledCommissions and
    // getDeferredProfit (both after getPendingSaleProfit). Both issue
    // aggregate `.get()`/`.all()` queries that — in real SQLite — always
    // return a well-shaped row/array; this mock's generic default (.get()
    // -> undefined) does not, and getDeferredProfit dereferences its
    // `.get()` result unconditionally. Default every `.prepare()` call
    // (module-wide default, not per-test) to a shape every query in this
    // file's call chain can consume; individual tests below still override
    // the FIRST call with `mockAllReturns`/`mockImplementationOnce`, which
    // takes precedence over this base implementation for that one call.
    (mockDatabase.prepare as any).mockImplementation((sql: string) => ({
      _sql: sql,
      run: jest.fn(() => ({ changes: 0 })),
      get: jest.fn(() => ({ profit_usd: 0, profit_lbp: 0 })),
      all: jest.fn(() => []),
    }));
  });

  // =========================================================================
  // SQL correctness
  // =========================================================================

  describe("SQL query", () => {
    it("filters by status = completed", () => {
      service.getPendingProfit("2026-02-22", "2026-02-22");
      const sql = getLastPreparedSql(0);
      expect(sql).toContain("s.status = 'completed'");
    });

    it("filters for NOT fully-paid (paid < final - 0.05)", () => {
      service.getPendingProfit("2026-02-22", "2026-02-22");
      const sql = getLastPreparedSql(0);
      expect(sql).toContain("< s.final_amount_usd - 0.05");
    });

    it("PA-3.8: does NOT date-range-filter unpaid sales — 'pending' means as of now, not 'unpaid within this period'", () => {
      service.getPendingProfit("2026-02-22", "2026-02-22");
      const sql = getLastPreparedSql(0);
      expect(sql).not.toContain("datetime(s.created_at, 'localtime')");
    });

    it("PA-3.8: binds only tenant_id params (6 total) — no date params at all", () => {
      service.getPendingProfit("2026-02-20", "2026-02-22");

      // getPendingSaleProfit is still the FIRST statement getPendingProfit
      // prepares (getUnsettledCommissions/getDeferredProfit run after it),
      // so index 0 — not the last result — is the one under test here.
      const calls = (mockDatabase.prepare as any).mock.results;
      const firstStmt = calls[0].value;
      const allArgs = (firstStmt.all as any).mock.calls[0];

      // Multi-tenant retrofit (WP3e) left 6 tenant_id binds (potential_profit
      // subquery, items products join, items si predicate, transactions
      // join, clients join, WHERE s.tenant_id) — see
      // ProfitRepository.getPendingSaleProfit's .all(...) param comments.
      // No date strings anywhere in the bind list post-PA-3.8.
      expect(allArgs).toHaveLength(6);
      expect(allArgs.some((a: unknown) => typeof a === "string")).toBe(false);
    });

    it("excludes refunded items with is_refunded = 0 filter", () => {
      service.getPendingProfit("2026-02-22", "2026-02-22");
      const sql = getLastPreparedSql(0);
      expect(sql).toContain("si.is_refunded = 0");
    });

    it("joins transactions and clients for client info", () => {
      service.getPendingProfit("2026-02-22", "2026-02-22");
      const sql = getLastPreparedSql(0);
      expect(sql).toContain("LEFT JOIN transactions t");
      expect(sql).toContain("LEFT JOIN clients c");
      expect(sql).toContain("c.full_name");
      expect(sql).toContain("c.phone_number");
    });

    it("does NOT reference s.client_name or s.client_phone (non-existent columns)", () => {
      service.getPendingProfit("2026-02-22", "2026-02-22");
      const sql = getLastPreparedSql(0);
      expect(sql).not.toContain("s.client_name");
      expect(sql).not.toContain("s.client_phone");
    });

    it("calculates effective paid = paid_usd + paid_lbp / exchange_rate", () => {
      service.getPendingProfit("2026-02-22", "2026-02-22");
      const sql = getLastPreparedSql(0);
      expect(sql).toContain("s.paid_usd + COALESCE(s.paid_lbp, 0)");
      expect(sql).toContain("NULLIF(s.exchange_rate_snapshot, 0)");
    });

    it("computes potential_profit from sale_items subquery", () => {
      service.getPendingProfit("2026-02-22", "2026-02-22");
      const sql = getLastPreparedSql(0);
      expect(sql).toContain(
        "SUM((si.sold_price_usd - si.cost_price_snapshot_usd) * si.quantity)",
      );
    });

    it("builds items_summary with GROUP_CONCAT", () => {
      service.getPendingProfit("2026-02-22", "2026-02-22");
      const sql = getLastPreparedSql(0);
      expect(sql).toContain("GROUP_CONCAT");
    });

    it("orders results by created_at DESC", () => {
      service.getPendingProfit("2026-02-22", "2026-02-22");
      const sql = getLastPreparedSql(0);
      expect(sql).toContain("ORDER BY s.created_at DESC");
    });
  });

  // =========================================================================
  // Totals aggregation
  // =========================================================================

  describe("totals aggregation", () => {
    it("aggregates totals across multiple rows", () => {
      mockAllReturns([
        {
          sale_id: 1,
          created_at: "2026-02-22 10:00:00",
          client_name: "Amir",
          client_phone: "+961123",
          total_amount_usd: 1570,
          paid_usd: 1400,
          outstanding_usd: 170,
          potential_profit_usd: 70,
          items_summary: "1x iPhone 15",
        },
        {
          sale_id: 2,
          created_at: "2026-02-22 11:00:00",
          client_name: "Sara",
          client_phone: "",
          total_amount_usd: 800,
          paid_usd: 300,
          outstanding_usd: 500,
          potential_profit_usd: 200,
          items_summary: "1x Samsung S24",
        },
      ]);

      const result = service.getPendingProfit("2026-02-22", "2026-02-22");

      expect(result.totals.count).toBe(2);
      expect(result.totals.total_outstanding_usd).toBe(670);
      expect(result.totals.total_pending_profit_usd).toBe(270);
    });

    it("returns zero totals for empty results", () => {
      const result = service.getPendingProfit("2026-01-01", "2026-01-01");

      expect(result.totals.count).toBe(0);
      expect(result.totals.total_outstanding_usd).toBe(0);
      expect(result.totals.total_pending_profit_usd).toBe(0);
      expect(result.rows).toHaveLength(0);
    });

    it("returns single-row totals correctly", () => {
      mockAllReturns([
        {
          sale_id: 1,
          created_at: "2026-02-22 12:00:00",
          client_name: "Unknown",
          client_phone: "",
          total_amount_usd: 100,
          paid_usd: 40,
          outstanding_usd: 60,
          potential_profit_usd: 25,
          items_summary: "2x USB Cable",
        },
      ]);

      const result = service.getPendingProfit("2026-02-22", "2026-02-22");

      expect(result.totals.count).toBe(1);
      expect(result.totals.total_outstanding_usd).toBe(60);
      expect(result.totals.total_pending_profit_usd).toBe(25);
    });
  });

  // =========================================================================
  // Row passthrough
  // =========================================================================

  describe("row data passthrough", () => {
    it("returns all row fields from query results", () => {
      const mockRow = {
        sale_id: 42,
        created_at: "2026-02-22 14:30:00",
        client_name: "Amir",
        client_phone: "+961123",
        total_amount_usd: 1570,
        paid_usd: 1400,
        outstanding_usd: 170,
        potential_profit_usd: 70,
        items_summary: "1x iPhone 15",
      };
      mockAllReturns([mockRow]);

      const result = service.getPendingProfit("2026-02-22", "2026-02-22");

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toEqual(mockRow);
    });
  });

  // =========================================================================
  // Error handling
  // =========================================================================

  describe("error handling", () => {
    // PA-4.16 (OWNER_NOTES_2026-09-21.md §6.6): this used to assert the
    // OPPOSITE — a caught error silently became a normal-shaped, all-zero
    // SUCCESS payload, indistinguishable on screen from "no pending profit
    // this period". It must now rethrow so the IPC handler / REST route (and
    // ultimately the Pending tab) see a real failure.
    it("rethrows on a database error instead of returning a fake-empty success", () => {
      (mockDatabase.prepare as any).mockImplementationOnce(() => {
        throw new Error("DB crash");
      });

      expect(() =>
        service.getPendingProfit("2026-02-22", "2026-02-22"),
      ).toThrow("DB crash");
    });
  });
});
