/**
 * Cross-tenant isolation — LotoCheckpointRepository & LotoTicketRepository
 * (WP3d, multi-tenant retrofit)
 *
 * Two tenants' checkpoints/tickets/settlements are seeded into the SAME
 * physical tables (shared-DB multi-tenancy — see
 * docs/plans/todo_plans/MULTI_TENANT_IMPLEMENTATION_PLAN.md §6), deliberately mirrored
 * on the same dates/amounts-shape so a query that forgot `tenant_id` would
 * still "look right" by date/status filtering alone. This proves every
 * read/aggregate method on both repos scopes by tenant_id:
 *   - findById-style lookups return null cross-tenant
 *   - date-range / unsettled / uncheckpointed list queries return ONLY the
 *     calling tenant's rows
 *   - SUM/COUNT aggregates never blend the other tenant's amounts in
 *   - a write under tenant 2 (createTicket) never surfaces in tenant 1's reads
 *
 * Per CLAUDE.md rule 17 / plan §6: `getUnsettledCheckpoints`'s
 * `AND tenant_id = ?` predicate was deliberately deleted and this suite was
 * confirmed to go RED (tenant 1's read picked up tenant 2's unsettled
 * checkpoint) before the predicate was restored and the suite went GREEN
 * again — see the WP3d report for the transcript.
 */

import Database from "better-sqlite3";
import { LotoCheckpointRepository } from "../LotoCheckpointRepository";
import { LotoTicketRepository } from "../LotoTicketRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { runWithTenant } from "../../db/tenantContext";

jest.mock("../../db/connection", () => {
  let _db: Database.Database | null = null;
  return {
    getDatabase: () => {
      if (!_db) throw new Error("Test DB not initialized");
      return _db;
    },
    setDb: (db: Database.Database) => {
      _db = db;
    },
  };
});

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL);
    INSERT INTO users (id, username) VALUES (1, 'admin');

    CREATE TABLE loto_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      ticket_number TEXT,
      sale_amount REAL NOT NULL,
      commission_rate REAL DEFAULT 0.0445,
      commission_amount REAL NOT NULL,
      is_winner INTEGER DEFAULT 0,
      prize_amount REAL DEFAULT 0,
      prize_paid_date TEXT,
      sale_date TEXT,
      payment_method TEXT,
      currency TEXT DEFAULT 'LBP',
      note TEXT,
      checkpoint_id INTEGER,
      client_id INTEGER,
      client_name TEXT,
      edited_by TEXT,
      edited_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE loto_checkpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      checkpoint_date TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      total_sales REAL NOT NULL DEFAULT 0,
      total_commission REAL NOT NULL DEFAULT 0,
      total_tickets INTEGER NOT NULL DEFAULT 0,
      total_prizes REAL NOT NULL DEFAULT 0,
      total_cash_prizes REAL NOT NULL DEFAULT 0,
      total_cash_prizes_count INTEGER NOT NULL DEFAULT 0,
      is_settled INTEGER NOT NULL DEFAULT 0,
      settled_at TEXT,
      settlement_id INTEGER,
      note TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE loto_settlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      settlement_date TEXT NOT NULL,
      checkpoint_ids TEXT NOT NULL,
      total_sales REAL NOT NULL DEFAULT 0,
      total_commission REAL NOT NULL DEFAULT 0,
      total_cash_prizes REAL NOT NULL DEFAULT 0,
      net_settlement REAL NOT NULL,
      note TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE loto_cash_prizes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      ticket_number TEXT,
      prize_amount REAL NOT NULL,
      customer_name TEXT,
      prize_date TEXT NOT NULL,
      is_reimbursed INTEGER NOT NULL DEFAULT 0,
      reimbursed_date TEXT,
      reimbursed_in_settlement_id INTEGER,
      checkpoint_id INTEGER,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL DEFAULT 1,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
      summary TEXT,
      metadata_json TEXT,
      device_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      transaction_id INTEGER,
      session_id INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- tenant_id joins the PRIMARY KEY (multi-tenant retrofit v123 — matches
    -- production's per-tenant drawer_balances rebuild).
    CREATE TABLE drawer_balances (
      tenant_id INTEGER NOT NULL DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances VALUES (1, 'General', 'USD', 0, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General', 'LBP', 0, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (2, 'General', 'USD', 0, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (2, 'General', 'LBP', 0, CURRENT_TIMESTAMP);

    CREATE TABLE suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      name TEXT NOT NULL,
      contact_name TEXT,
      phone TEXT,
      note TEXT,
      provider TEXT,
      is_active INTEGER DEFAULT 1,
      is_system INTEGER DEFAULT 0,
      module_key TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE supplier_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      supplier_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_by INTEGER,
      transaction_id INTEGER,
      is_auto INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      transaction_id INTEGER,
      note TEXT,
      due_date TEXT,
      created_by INTEGER,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

/** Seed two tenants' checkpoints, mirrored on the SAME dates/status shape. */
function seedCheckpoints(db: Database.Database) {
  const insert = db.prepare(`
    INSERT INTO loto_checkpoints (
      id, tenant_id, checkpoint_date, period_start, period_end,
      total_sales, total_commission, total_tickets, total_prizes,
      total_cash_prizes, total_cash_prizes_count, is_settled
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  // Tenant 1: one unsettled (id 1), one settled (id 2) — both 2026-01-05.
  insert.run(
    1,
    1,
    "2026-01-05",
    "2026-01-01",
    "2026-01-05",
    100,
    10,
    2,
    0,
    0,
    0,
    0,
  );
  insert.run(
    2,
    1,
    "2026-01-10",
    "2026-01-06",
    "2026-01-10",
    50,
    5,
    1,
    0,
    0,
    0,
    1,
  );
  // Tenant 2: mirrored dates, different amounts — one unsettled, one settled.
  insert.run(
    3,
    2,
    "2026-01-05",
    "2026-01-01",
    "2026-01-05",
    900,
    90,
    5,
    0,
    0,
    0,
    0,
  );
  insert.run(
    4,
    2,
    "2026-01-10",
    "2026-01-06",
    "2026-01-10",
    400,
    40,
    3,
    0,
    0,
    0,
    1,
  );

  db.prepare(
    `INSERT INTO loto_settlements (id, tenant_id, settlement_date, checkpoint_ids, total_sales, total_commission, total_cash_prizes, net_settlement)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(1, 1, "2026-01-10", "[2]", 50, 5, 0, -45);
  db.prepare(
    `INSERT INTO loto_settlements (id, tenant_id, settlement_date, checkpoint_ids, total_sales, total_commission, total_cash_prizes, net_settlement)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(2, 2, "2026-01-10", "[4]", 400, 40, 0, -360);
}

/** Seed two tenants' tickets, mirrored on the SAME dates. */
function seedTickets(db: Database.Database) {
  const insert = db.prepare(`
    INSERT INTO loto_tickets (
      id, tenant_id, ticket_number, sale_amount, commission_amount,
      is_winner, prize_amount, prize_paid_date, sale_date, checkpoint_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  // Tenant 1: T1-1 uncheckpointed winner, T1-2 already checkpointed.
  insert.run(1, 1, "T1-1", 100_000, 5_000, 1, 50_000, null, "2026-01-02", null);
  insert.run(2, 1, "T1-2", 200_000, 10_000, 0, 0, null, "2026-01-03", 1);
  // Tenant 2: mirrored dates, much larger amounts — same shape.
  insert.run(
    3,
    2,
    "T2-1",
    900_000,
    45_000,
    1,
    80_000,
    null,
    "2026-01-02",
    null,
  );
  insert.run(4, 2, "T2-2", 400_000, 20_000, 0, 0, null, "2026-01-03", 3);
}

describe("LotoCheckpointRepository — cross-tenant isolation", () => {
  let db: Database.Database;
  let repo: LotoCheckpointRepository;

  beforeEach(() => {
    db = createTestDb();
    seedCheckpoints(db);
    repo = new LotoCheckpointRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it("getCheckpointById never returns the other tenant's row", () => {
    expect(runWithTenant(1, () => repo.getCheckpointById(1))?.total_sales).toBe(
      100,
    );
    expect(runWithTenant(1, () => repo.getCheckpointById(3))).toBeUndefined(); // tenant 2's row (better-sqlite3 .get() miss)
    expect(runWithTenant(2, () => repo.getCheckpointById(3))?.total_sales).toBe(
      900,
    );
    expect(runWithTenant(2, () => repo.getCheckpointById(1))).toBeUndefined(); // tenant 1's row
  });

  it("getCheckpointByDate and getCheckpointsByDateRange scope by tenant even on identical dates", () => {
    const t1ByDate = runWithTenant(1, () =>
      repo.getCheckpointByDate("2026-01-05"),
    );
    expect(t1ByDate?.id).toBe(1);
    expect(t1ByDate?.total_sales).toBe(100);

    const t2ByDate = runWithTenant(2, () =>
      repo.getCheckpointByDate("2026-01-05"),
    );
    expect(t2ByDate?.id).toBe(3);
    expect(t2ByDate?.total_sales).toBe(900);

    const t1Range = runWithTenant(1, () =>
      repo.getCheckpointsByDateRange("2026-01-01", "2026-01-31"),
    );
    expect(t1Range.map((c) => c.id).sort()).toEqual([1, 2]);

    const t2Range = runWithTenant(2, () =>
      repo.getCheckpointsByDateRange("2026-01-01", "2026-01-31"),
    );
    expect(t2Range.map((c) => c.id).sort()).toEqual([3, 4]);
  });

  // Rule 17: this predicate was deliberately deleted from
  // getUnsettledCheckpoints() ("WHERE is_settled = 0" only, no
  // "AND tenant_id = ?") and this exact test went RED — tenant 1's read
  // returned 2 rows (its own id=1 PLUS tenant 2's id=3) instead of 1. The
  // predicate was restored and the test went GREEN again. See WP3d report.
  it("getUnsettledCheckpoints returns ONLY the calling tenant's unsettled rows", () => {
    const t1Unsettled = runWithTenant(1, () => repo.getUnsettledCheckpoints());
    expect(t1Unsettled.map((c) => c.id)).toEqual([1]);

    const t2Unsettled = runWithTenant(2, () => repo.getUnsettledCheckpoints());
    expect(t2Unsettled.map((c) => c.id)).toEqual([3]);
  });

  it("aggregates over unsettled checkpoints never blend the other tenant's amounts", () => {
    expect(
      runWithTenant(1, () => repo.getTotalSalesFromUnsettledCheckpoints()),
    ).toBe(100);
    expect(
      runWithTenant(2, () => repo.getTotalSalesFromUnsettledCheckpoints()),
    ).toBe(900);

    expect(
      runWithTenant(1, () => repo.getTotalCommissionFromUnsettledCheckpoints()),
    ).toBe(10);
    expect(
      runWithTenant(2, () => repo.getTotalCommissionFromUnsettledCheckpoints()),
    ).toBe(90);
  });

  it("getLastCheckpoint and getSettlementHistory scope by tenant", () => {
    expect(runWithTenant(1, () => repo.getLastCheckpoint())?.id).toBe(2);
    expect(runWithTenant(2, () => repo.getLastCheckpoint())?.id).toBe(4);

    const t1History = runWithTenant(1, () => repo.getSettlementHistory());
    expect(t1History.map((s) => s.id)).toEqual([1]);
    const t2History = runWithTenant(2, () => repo.getSettlementHistory());
    expect(t2History.map((s) => s.id)).toEqual([2]);
  });
});

describe("LotoTicketRepository — cross-tenant isolation", () => {
  let db: Database.Database;
  let repo: LotoTicketRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    seedTickets(db);
    setDb(db);
    resetTransactionRepository();
    repo = new LotoTicketRepository(db);
  });

  afterEach(() => {
    db.close();
    resetTransactionRepository();
  });

  it("getTicketById never returns the other tenant's row", () => {
    expect(runWithTenant(1, () => repo.getTicketById(1))?.sale_amount).toBe(
      100_000,
    );
    expect(runWithTenant(1, () => repo.getTicketById(3))).toBeUndefined(); // tenant 2's row (better-sqlite3 .get() miss)
    expect(runWithTenant(2, () => repo.getTicketById(3))?.sale_amount).toBe(
      900_000,
    );
    expect(runWithTenant(2, () => repo.getTicketById(1))).toBeUndefined(); // tenant 1's row
  });

  it("getTicketsByDateRange scopes by tenant on identical dates", () => {
    const t1 = runWithTenant(1, () =>
      repo.getTicketsByDateRange("2026-01-01", "2026-01-31"),
    );
    expect(t1.map((t) => t.id).sort()).toEqual([1, 2]);

    const t2 = runWithTenant(2, () =>
      repo.getTicketsByDateRange("2026-01-01", "2026-01-31"),
    );
    expect(t2.map((t) => t.id).sort()).toEqual([3, 4]);
  });

  it("aggregates (sales/commission/prizes/count) never blend the other tenant's amounts", () => {
    expect(
      runWithTenant(1, () => repo.getTotalSales("2026-01-01", "2026-01-31")),
    ).toBe(300_000);
    expect(
      runWithTenant(2, () => repo.getTotalSales("2026-01-01", "2026-01-31")),
    ).toBe(1_300_000);

    expect(
      runWithTenant(1, () =>
        repo.getTotalCommission("2026-01-01", "2026-01-31"),
      ),
    ).toBe(15_000);
    expect(
      runWithTenant(2, () =>
        repo.getTotalCommission("2026-01-01", "2026-01-31"),
      ),
    ).toBe(65_000);

    expect(
      runWithTenant(1, () => repo.getTotalPrizes("2026-01-01", "2026-01-31")),
    ).toBe(50_000);
    expect(
      runWithTenant(2, () => repo.getTotalPrizes("2026-01-01", "2026-01-31")),
    ).toBe(80_000);

    expect(
      runWithTenant(1, () => repo.getTicketCount("2026-01-01", "2026-01-31")),
    ).toBe(2);
    expect(
      runWithTenant(2, () => repo.getTicketCount("2026-01-01", "2026-01-31")),
    ).toBe(2);
  });

  it("getOutstandingPrizes and getUncheckpointedTickets/-Totals scope by tenant", () => {
    expect(runWithTenant(1, () => repo.getOutstandingPrizes())).toBe(50_000);
    expect(runWithTenant(2, () => repo.getOutstandingPrizes())).toBe(80_000);

    const t1Uncheckpointed = runWithTenant(1, () =>
      repo.getUncheckpointedTickets(),
    );
    expect(t1Uncheckpointed.map((t) => t.id)).toEqual([1]); // T1-2 is already checkpointed

    const t2Uncheckpointed = runWithTenant(2, () =>
      repo.getUncheckpointedTickets(),
    );
    expect(t2Uncheckpointed.map((t) => t.id)).toEqual([3]); // T2-2 is already checkpointed

    const t1Totals = runWithTenant(1, () => repo.getUncheckpointedTotals());
    expect(t1Totals).toMatchObject({
      count: 1,
      totalSales: 100_000,
      totalCommission: 5_000,
      totalPrizes: 50_000,
    });

    const t2Totals = runWithTenant(2, () => repo.getUncheckpointedTotals());
    expect(t2Totals).toMatchObject({
      count: 1,
      totalSales: 900_000,
      totalCommission: 45_000,
      totalPrizes: 80_000,
    });
  });

  it("createTicket under tenant 2 stamps tenant_id and never surfaces in tenant 1's reads", () => {
    runWithTenant(2, () =>
      repo.createTicket({
        sale_amount: 555_000,
        commission_amount: 25_000,
        sale_date: "2026-01-20",
        payment_method: "CASH",
        currency: "LBP",
        userId: 1,
      }),
    );

    // Tenant 1 sees nothing new for this date.
    expect(
      runWithTenant(1, () =>
        repo.getTicketsByDateRange("2026-01-20", "2026-01-20"),
      ),
    ).toHaveLength(0);

    // Tenant 2 sees exactly the new ticket.
    const t2New = runWithTenant(2, () =>
      repo.getTicketsByDateRange("2026-01-20", "2026-01-20"),
    );
    expect(t2New).toHaveLength(1);
    expect(t2New[0].sale_amount).toBe(555_000);
  });
});
