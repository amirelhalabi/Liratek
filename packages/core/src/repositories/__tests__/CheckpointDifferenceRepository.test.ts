/**
 * LIRA-335 T007 — checkpoint open differences: what a checkpoint records,
 * how a difference reads, and Close / Reopen (spec FR-001/002/011/012/014/
 * 015/022, data-model.md).
 *
 * Real schema (create_db.sql + every migration), real `createCheckpoint`,
 * real `ExpenseRepository`. Resolutions are written by Lane B's engine
 * (`checkpointResolution.ts`); here they are inserted by hand so this file
 * covers only the repository's reading of them.
 *
 * Rule 17: written before migration v222 and `CheckpointDifferenceRepository`
 * existed; the first run failed with
 * "Cannot find module '../CheckpointDifferenceRepository'".
 * (c) — the FR-023 stored-expected fix — lives in its own file,
 * `ClosingRepository.storedExpected.test.ts`, so its failure was the real
 * assertion rather than a missing module.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initDatabase } from "../../db/connection";
import { runMigrations } from "../../db/migrations/index";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  getClosingRepository,
  resetClosingRepository,
} from "../ClosingRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetExpenseRepository } from "../ExpenseRepository";
import { getProfitRepository, resetProfitRepository } from "../ProfitRepository";
import {
  getCheckpointDifferenceRepository,
  resetCheckpointDifferenceRepository,
} from "../CheckpointDifferenceRepository";
import {
  CHECKPOINT_DIFFERENCE_SOURCE_TABLE,
  DRAWER_SHORTAGE_EXPENSE_CATEGORY,
} from "../drawerShortageExpense";

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf-8",
);

const DAY = "2026-10-18";
let db: Database.Database;

function resetAll(): void {
  resetClosingRepository();
  resetTransactionRepository();
  resetExpenseRepository();
  resetProfitRepository();
  resetCheckpointDifferenceRepository();
}

beforeEach(() => {
  resetAll();
  db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  initDatabase(db);
  runMigrations(db);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  const seed = db.prepare(
    `INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, ?, ?, ?)`,
  );
  for (const [d, c, b] of [
    ["General", "USD", 1000],
    ["General", "LBP", 9_000_000],
    ["General", "EUR", 200],
    ["OMT_System", "USD", 500],
  ] as const)
    seed.run(d, c, b);
});

afterEach(() => {
  resetTenantContext();
  resetAll();
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

// ─── helpers ────────────────────────────────────────────────────────────────

function checkpoint(
  drawer: string,
  amounts: Array<[drawer: string, currency: string, physical: number]>,
): number {
  const res = getClosingRepository().createCheckpoint({
    user_id: 1,
    drawer_name: drawer,
    closing_date: DAY,
    amounts: amounts.map(([d, c, p]) => ({
      drawer_name: d,
      currency_code: c,
      expected_amount: 0,
      physical_amount: p,
    })),
  });
  if (!res.success) throw new Error(res.error);
  return Number(res.id);
}

function balance(drawer: string, currency: string): number {
  return (
    db
      .prepare(
        `SELECT balance FROM drawer_balances WHERE tenant_id = 1 AND drawer_name = ? AND currency_code = ?`,
      )
      .get(drawer, currency) as { balance: number }
  ).balance;
}

function diffRows(closingId: number) {
  return db
    .prepare(
      `SELECT drawer_name, currency_code, amount, closed_at FROM checkpoint_differences WHERE closing_id = ? ORDER BY drawer_name, currency_code`,
    )
    .all(closingId) as Array<{
    drawer_name: string;
    currency_code: string;
    amount: number;
    closed_at: string | null;
  }>;
}

function onlyDifference(closingId: number) {
  const list = getCheckpointDifferenceRepository()
    .listForClosings([closingId])
    .get(closingId)!;
  expect(list).toHaveLength(1);
  return list[0];
}

function shortageExpenses(differenceId: number) {
  return db
    .prepare(
      `SELECT id, category, amount_usd, amount_lbp, expense_date, is_refunded, source_ref_table, source_ref_id
         FROM expenses WHERE source_ref_table = ? AND source_ref_id = ? ORDER BY id`,
    )
    .all(CHECKPOINT_DIFFERENCE_SOURCE_TABLE, differenceId) as Array<{
    id: number;
    category: string;
    amount_usd: number;
    amount_lbp: number;
    expense_date: string;
    is_refunded: number;
    source_ref_table: string;
    source_ref_id: number;
  }>;
}

function dayExpensesUsd(): number {
  return getProfitRepository().getExpenseTotals(
    `${DAY} 00:00:00`,
    `${DAY} 23:59:59`,
  ).total_usd;
}

/** Stand-in for Lane B's engine: a resolving transaction + its row. */
function addResolution(
  differenceId: number,
  amount: number,
  status: "ACTIVE" | "VOIDED" = "ACTIVE",
): number {
  const t = db
    .prepare(
      `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, summary, created_at)
       VALUES (1, 'SALE', ?, 'sales', 1, 1, ?, 0, 'Missed sale', '2026-10-18 11:10:00')`,
    )
    .run(status, Math.abs(amount));
  db.prepare(
    `INSERT INTO checkpoint_difference_resolutions (tenant_id, difference_id, transaction_id, amount, created_at, updated_at)
     VALUES (1, ?, ?, ?, '2026-10-19 10:05:00', '2026-10-19 10:05:00')`,
  ).run(differenceId, t.lastInsertRowid, amount);
  return Number(t.lastInsertRowid);
}

// ─── what a checkpoint records ──────────────────────────────────────────────

describe("createCheckpoint records its open differences", () => {
  it("(a) Over $50 USD with LBP matched writes exactly one difference: +50, General, USD", () => {
    const id = checkpoint("General", [
      ["General", "USD", 1050],
      ["General", "LBP", 9_000_000],
    ]);
    expect(diffRows(id)).toEqual([
      { drawer_name: "General", currency_code: "USD", amount: 50, closed_at: null },
    ]);
  });

  it("(b) an all-drawers checkpoint writes one row per real drawer, never AGGREGATED", () => {
    const id = checkpoint("AGGREGATED", [
      ["General", "USD", 990],
      ["OMT_System", "USD", 480],
    ]);
    expect(diffRows(id)).toEqual([
      { drawer_name: "General", currency_code: "USD", amount: -10, closed_at: null },
      { drawer_name: "OMT_System", currency_code: "USD", amount: -20, closed_at: null },
    ]);
  });

  it("a sub-cent correction is posted but records no difference", () => {
    const id = checkpoint("General", [["General", "USD", 1000.004]]);
    expect(diffRows(id)).toEqual([]);
  });
});

// ─── how a difference reads ─────────────────────────────────────────────────

describe("listForClosings / getById", () => {
  it("(d) a fresh difference reads OPEN with its view fields", () => {
    const id = checkpoint("General", [["General", "USD", 1050]]);
    const d = onlyDifference(id);
    expect(d).toMatchObject({
      closing_id: id,
      drawer_name: "General",
      currency_code: "USD",
      amount: 50,
      direction: "OVER",
      resolved: 0,
      open: 50,
      status: "OPEN",
      closed_at: null,
      closed_by_name: null,
      shortage_expense_id: null,
      resolutions: [],
    });
    expect(typeof d.closing_created_at).toBe("string");
    expect(getCheckpointDifferenceRepository().getById(d.id)).toEqual(d);
  });

  it("an active resolution counts and is listed; a voided one does not", () => {
    const id = checkpoint("General", [["General", "USD", 980]]);
    const diff = onlyDifference(id);
    const txn = addResolution(diff.id, -12);
    addResolution(diff.id, -5, "VOIDED");
    const d = getCheckpointDifferenceRepository().getById(diff.id)!;
    expect(d.resolved).toBe(12);
    expect(d.open).toBe(8);
    expect(d.status).toBe("PARTLY_RESOLVED");
    expect(d.resolutions).toEqual([
      {
        transaction_id: txn,
        transaction_type: "SALE",
        summary: "Missed sale",
        amount: -12,
        effective_time: "2026-10-18 11:10:00",
        entered_at: "2026-10-19 10:05:00",
        user_name: "admin",
      },
    ]);
  });

  it("(j) a checkpoint with no difference rows (saved before the update) yields []", () => {
    const legacy = db
      .prepare(
        `INSERT INTO daily_closings (tenant_id, closing_date, drawer_name, created_at) VALUES (1, '2026-10-01', 'General', '2026-10-01 18:00:00')`,
      )
      .run();
    const id = Number(legacy.lastInsertRowid);
    expect(getCheckpointDifferenceRepository().listForClosings([id]).get(id)).toEqual([]);
    expect(getCheckpointDifferenceRepository().listForClosings([]).size).toBe(0);
  });
});

// ─── close / reopen ─────────────────────────────────────────────────────────

describe("close and reopen", () => {
  it("(e) closing a Short books one books-only Drawer shortage expense on the checkpoint day", () => {
    const id = checkpoint("General", [["General", "USD", 980]]); // Short 20
    const diff = onlyDifference(id);
    addResolution(diff.id, -12); // 8 still open
    const before = { general: balance("General", "USD"), expenses: dayExpensesUsd() };
    const paymentsBefore = (db.prepare(`SELECT COUNT(*) AS n FROM payments`).get() as { n: number }).n;

    expect(getCheckpointDifferenceRepository().close(diff.id, 1)).toEqual({ success: true });

    const rows = shortageExpenses(diff.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      category: DRAWER_SHORTAGE_EXPENSE_CATEGORY,
      amount_usd: 8,
      amount_lbp: 0,
      expense_date: DAY,
      is_refunded: 0,
      source_ref_table: "checkpoint_differences",
      source_ref_id: diff.id,
    });
    // Books-only: no payments row, no drawer movement.
    expect((db.prepare(`SELECT COUNT(*) AS n FROM payments`).get() as { n: number }).n).toBe(paymentsBefore);
    expect(balance("General", "USD")).toBe(before.general);
    // Net profit for the checkpoint day drops by it (SC-004).
    expect(dayExpensesUsd()).toBe(before.expenses + 8);
    // Auto sibling (rule 26): hidden by default in the Transactions table.
    const txn = getTransactionRepository().getBySourceId("expenses", rows[0].id)!;
    expect(JSON.parse(txn.metadata_json as string).is_auto).toBe(true);

    const d = getCheckpointDifferenceRepository().getById(diff.id)!;
    expect(d.status).toBe("CLOSED");
    expect(d.direction).toBe("SHORT");
    expect(d.closed_by_name).toBe("admin");
    expect(d.closed_at).not.toBeNull();
    expect(d.shortage_expense_id).toBe(rows[0].id);
  });

  it("(f) closing an Over records nothing in Expenses and moves no drawer", () => {
    const id = checkpoint("General", [["General", "USD", 1015]]);
    const diff = onlyDifference(id);
    const before = { general: balance("General", "USD"), expenses: dayExpensesUsd() };
    expect(getCheckpointDifferenceRepository().close(diff.id, 1).success).toBe(true);
    expect(shortageExpenses(diff.id)).toEqual([]);
    expect(balance("General", "USD")).toBe(before.general);
    expect(dayExpensesUsd()).toBe(before.expenses);
    const d = getCheckpointDifferenceRepository().getById(diff.id)!;
    expect(d.status).toBe("CLOSED");
    expect(d.direction).toBe("OVER");
    expect(d.shortage_expense_id).toBeNull();
  });

  it("(g) reopening a closed Short voids its expense and returns it to open", () => {
    const id = checkpoint("General", [["General", "USD", 992]]); // Short 8
    const diff = onlyDifference(id);
    const expensesBefore = dayExpensesUsd();
    getCheckpointDifferenceRepository().close(diff.id, 1);
    expect(dayExpensesUsd()).toBe(expensesBefore + 8);

    expect(getCheckpointDifferenceRepository().reopen(diff.id, 1)).toEqual({ success: true });

    const rows = shortageExpenses(diff.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].is_refunded).toBe(1);
    expect(dayExpensesUsd()).toBe(expensesBefore);
    const d = getCheckpointDifferenceRepository().getById(diff.id)!;
    expect(d.status).toBe("OPEN");
    expect(d.open).toBe(8);
    expect(d.closed_at).toBeNull();
    expect(d.shortage_expense_id).toBeNull();
  });

  it("an LBP Short books the expense in LBP", () => {
    const id = checkpoint("General", [["General", "LBP", 8_550_000]]);
    const diff = onlyDifference(id);
    getCheckpointDifferenceRepository().close(diff.id, 1);
    expect(shortageExpenses(diff.id)[0]).toMatchObject({ amount_usd: 0, amount_lbp: 450_000 });
  });

  it("(h) closing a Short in a currency expenses cannot hold (EUR) records closed with no expense", () => {
    const id = checkpoint("General", [["General", "EUR", 190]]);
    const diff = onlyDifference(id);
    expect(getCheckpointDifferenceRepository().close(diff.id, 1).success).toBe(true);
    expect(shortageExpenses(diff.id)).toEqual([]);
    expect(getCheckpointDifferenceRepository().getById(diff.id)!.status).toBe("CLOSED");
  });

  it("(i) close with nothing open, close twice, and reopen when not closed are refused", () => {
    const repo = getCheckpointDifferenceRepository();
    const id = checkpoint("General", [["General", "USD", 1050]]);
    const diff = onlyDifference(id);

    const notClosed = repo.reopen(diff.id, 1);
    expect(notClosed.success).toBe(false);
    expect(notClosed.error).toMatch(/not closed/i);

    expect(repo.close(diff.id, 1).success).toBe(true);
    const twice = repo.close(diff.id, 1);
    expect(twice.success).toBe(false);
    expect(twice.error).toMatch(/already closed/i);

    const id2 = checkpoint("General", [["General", "USD", 1100]]); // Over 50 again
    const diff2 = onlyDifference(id2);
    addResolution(diff2.id, 50);
    const nothingOpen = repo.close(diff2.id, 1);
    expect(nothingOpen.success).toBe(false);
    expect(nothingOpen.error).toMatch(/nothing (left )?open/i);

    const missing = repo.close(999_999, 1);
    expect(missing.success).toBe(false);
  });
});

// ─── syncShortageExpense (FR-016) ───────────────────────────────────────────

describe("syncShortageExpense", () => {
  it("shrinks a closed Short's expense as resolutions arrive, voids it when fully explained, and grows it back", () => {
    const repo = getCheckpointDifferenceRepository();
    const id = checkpoint("General", [["General", "USD", 980]]); // Short 20
    const diff = onlyDifference(id);
    repo.close(diff.id, 1);
    expect(dayExpensesUsd()).toBe(20);

    // Idempotent: nothing changed, nothing rewritten.
    repo.syncShortageExpense(diff.id, 1);
    expect(shortageExpenses(diff.id)).toHaveLength(1);

    const first = addResolution(diff.id, -12);
    repo.syncShortageExpense(diff.id, 1);
    expect(dayExpensesUsd()).toBe(8);
    expect(shortageExpenses(diff.id).filter((e) => e.is_refunded === 0)).toHaveLength(1);

    addResolution(diff.id, -8);
    repo.syncShortageExpense(diff.id, 1);
    expect(dayExpensesUsd()).toBe(0);
    expect(shortageExpenses(diff.id).filter((e) => e.is_refunded === 0)).toHaveLength(0);
    expect(repo.getById(diff.id)!.status).toBe("RESOLVED");

    // The first resolver is voided: 12 is open again and the expense comes back.
    db.prepare(`UPDATE transactions SET status = 'VOIDED' WHERE id = ?`).run(first);
    repo.syncShortageExpense(diff.id, 1);
    expect(dayExpensesUsd()).toBe(12);
    expect(repo.getById(diff.id)!.status).toBe("CLOSED");
  });

  it("does nothing for an open (not closed) Short", () => {
    const repo = getCheckpointDifferenceRepository();
    const id = checkpoint("General", [["General", "USD", 980]]);
    const diff = onlyDifference(id);
    repo.syncShortageExpense(diff.id, 1);
    expect(shortageExpenses(diff.id)).toEqual([]);
  });
});
