/**
 * LIRA-196 — `ExpenseRepository.getTodayExpenses()` hand-rolled
 * `DATE(expense_date) = DATE('now')`, with NO `'localtime'` modifier at
 * all — so even on desktop this compared the operator's local
 * `expense_date` against SQLite's bare UTC `'now'`. On a Fly web host (UTC,
 * no `TZ` pinned — rule 27), the gap is the full UTC offset: an expense
 * logged between 00:00 and 03:00 Beirut (`expense_date` still carrying
 * "today" in the shop's own calendar) fails `= DATE('now')` because the
 * host's own UTC day hasn't rolled over yet, and the expense silently drops
 * off the "Today's Expenses" list until the container's day catches up.
 *
 * The fix: reuse `isToday()` (`reportingTimeFragments.ts`, LIRA-237) instead
 * of a hand-rolled predicate (rule 14) — it shifts both sides by the
 * request's `clientTzOffsetMinutes` (threaded from `X-Client-Tz-Offset` on
 * web; `'localtime'`, i.e. the host's own OS zone, when no request context
 * is active, which is always true on desktop).
 *
 * Runs under ANY machine timezone and ANY real calendar date — the boundary
 * row's `expense_date` is computed from the REAL `Date.now()` at test-run
 * time via `dayBoundaryInstant()` (`testHelpers/boundaryInstant.ts`), not a
 * fixed anchor, mirroring `CustomServiceRepository.webTodayTzOffset.test.ts`
 * / `SalesRepository.webTodayTzOffset.test.ts`.
 *
 * Rule 17: written and run BEFORE `ExpenseRepository.ts` is touched — the
 * first test below is expected to FAIL on the current hand-rolled
 * `DATE(expense_date) = DATE('now')` predicate (see the recorded red run in
 * the task report).
 */

import Database from "better-sqlite3";
import { ExpenseRepository } from "../ExpenseRepository.js";
import { runWithTenant } from "../../db/tenantContext.js";
import { dayBoundaryInstant } from "../testHelpers/boundaryInstant.js";

let db: Database.Database;
let repo: ExpenseRepository;
let BOUNDARY_EXPENSE_UTC: string;

function createSchema(d: Database.Database): void {
  d.exec(`
    CREATE TABLE expenses (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id        INTEGER,
      description      TEXT,
      category         TEXT,
      expense_type     TEXT,
      amount_usd       DECIMAL(10, 2),
      amount_lbp       DECIMAL(15, 2),
      paid_by_method   TEXT DEFAULT 'CASH',
      status           TEXT NOT NULL DEFAULT 'active',
      expense_date     DATETIME DEFAULT CURRENT_TIMESTAMP,
      source_ref_table TEXT DEFAULT NULL,
      source_ref_id    INTEGER DEFAULT NULL,
      note             TEXT DEFAULT NULL,
      edited_by        TEXT DEFAULT NULL,
      edited_at        TEXT DEFAULT NULL,
      is_refunded      INTEGER DEFAULT 0,
      refunded_at      TEXT DEFAULT NULL,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

const BEIRUT_OFFSET_MINUTES = 180;

beforeEach(() => {
  BOUNDARY_EXPENSE_UTC = dayBoundaryInstant(Date.now(), BEIRUT_OFFSET_MINUTES);
  db = new Database(":memory:");
  createSchema(db);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  db.prepare(
    `INSERT INTO expenses (tenant_id, description, category, amount_usd, amount_lbp, status, expense_date)
     VALUES (1, 'Boundary rent', 'Rent', 50, 0, 'active', ?)`,
  ).run(BOUNDARY_EXPENSE_UTC);
  repo = new ExpenseRepository();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

describe("LIRA-196 — ExpenseRepository.getTodayExpenses() web 'today' boundary", () => {
  it("a UTC Fly host with no client offset (== explicit offset 0) drops the boundary expense from 'today', while a Beirut client offset (180) counts it — the bug, reproduced without depending on this runner's OS timezone", () => {
    const asUtcHost = runWithTenant(1, () => repo.getTodayExpenses(), {
      clientTzOffsetMinutes: 0,
    });
    const asBeirutClient = runWithTenant(1, () => repo.getTodayExpenses(), {
      clientTzOffsetMinutes: BEIRUT_OFFSET_MINUTES,
    });
    expect(asUtcHost).toHaveLength(0);
    expect(asBeirutClient).toHaveLength(1);
    expect(asBeirutClient[0].description).toBe("Boundary rent");
  });

  it("getTodayExpenses() counts the boundary expense when the request carries the client's (Beirut) offset (the fix)", () => {
    const expenses = runWithTenant(1, () => repo.getTodayExpenses(), {
      clientTzOffsetMinutes: BEIRUT_OFFSET_MINUTES,
    });
    expect(expenses).toHaveLength(1);
    expect(expenses[0].description).toBe("Boundary rent");
  });

  it("without a client offset, getTodayExpenses() still uses the HOST's OWN OS day (SQLite 'localtime') — the fallback is inert, not a silent fix", () => {
    const { matchesToday } = db
      .prepare(
        `SELECT (DATE(?, 'localtime') = DATE('now', 'localtime')) AS matchesToday`,
      )
      .get(BOUNDARY_EXPENSE_UTC) as { matchesToday: number };

    const expenses = runWithTenant(1, () => repo.getTodayExpenses());
    expect(expenses).toHaveLength(matchesToday ? 1 : 0);
  });
});
