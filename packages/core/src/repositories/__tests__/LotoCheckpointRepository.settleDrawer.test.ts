/**
 * Loto settlement — drawer conservation (no commission double-credit)
 *
 * The settlement payment leg the frontend sends is already the NET amount
 * (commission − sales, negative when the shop pays the Loto rep) — the
 * commission is kept back from the cash handed over. Steps 4 of both
 * settleCheckpoint and settleCheckpoints ADDITIONALLY credited General by
 * +totalCommission, minting the commission a second time: a full
 * sale → settle cycle inflated the drawers by 2× commission while the stamped
 * profit (and reality) is 1×.
 *
 * Invariant proven here: across a full cycle (ticket sale + checkpoint
 * settlement with the net payment leg), the TOTAL LBP across all drawers
 * changes by exactly the commission. Ticket cash in (+sale) and the net
 * payout (−(sale − commission)) leave +commission — nothing else may move.
 *
 * Rule 17: constructed to FAIL on the pre-fix code (which yields
 * +2× commission).
 */

import Database from "better-sqlite3";
import { LotoTicketRepository } from "../LotoTicketRepository";
import { LotoCheckpointRepository } from "../LotoCheckpointRepository";
import { resetTransactionRepository } from "../TransactionRepository";

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
      sale_date TEXT,
      payment_method TEXT,
      currency TEXT DEFAULT 'LBP',
      note TEXT,
      client_id INTEGER,
      client_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

    CREATE TABLE drawer_balances (
      tenant_id INTEGER NOT NULL DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances VALUES (1, 'General', 'USD', 100, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General', 'LBP', 10000000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Loto', 'LBP', 0, CURRENT_TIMESTAMP);

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
  `);
  return db;
}

function totalLbpAcrossDrawers(db: Database.Database): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(balance), 0) AS total FROM drawer_balances WHERE currency_code = 'LBP'`,
    )
    .get() as { total: number };
  return row.total;
}

function lotoLedgerBalance(db: Database.Database): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(sl.amount_lbp), 0) AS bal FROM supplier_ledger sl
       JOIN suppliers s ON s.id = sl.supplier_id
       WHERE s.provider = 'LOTO'`,
    )
    .get() as { bal: number };
  return row.bal;
}

const SALE = 100_000;
const COMMISSION = 4_450; // 4.45% of 100,000
const NET_PAY = SALE - COMMISSION; // 95,550 physically handed to the Loto rep

describe("Loto settlement drawer conservation — commission credited exactly once", () => {
  let db: Database.Database;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    resetTransactionRepository();
  });

  afterEach(() => {
    db.close();
    resetTransactionRepository();
  });

  function sellTicket() {
    new LotoTicketRepository(db).createTicket({
      sale_amount: SALE,
      commission_amount: COMMISSION,
      sale_date: "2026-07-18",
      payment_method: "CASH",
      currency: "LBP",
      userId: 1,
    });
  }

  it("settleCheckpoint: full cycle nets drawers +commission, not +2× commission", () => {
    const before = totalLbpAcrossDrawers(db);
    sellTicket();

    const checkpoints = new LotoCheckpointRepository(db);
    const cp = checkpoints.createCheckpoint({
      checkpoint_date: "2026-07-18",
      period_start: "2026-07-18",
      period_end: "2026-07-18",
      total_sales: SALE,
      total_commission: COMMISSION,
      total_tickets: 1,
      total_prizes: 0,
      total_cash_prizes: 0,
      total_cash_prizes_count: 0,
    });

    // The frontend sends the NET payment leg (commission already kept back).
    checkpoints.settleCheckpoint(cp.id, SALE, COMMISSION, 0, 0, undefined, 1, [
      { method: "CASH", currency_code: "LBP", amount: -NET_PAY },
    ]);

    // Pre-fix: +2× commission (step 4 minted the commission on top of the net leg).
    expect(totalLbpAcrossDrawers(db) - before).toBeCloseTo(COMMISSION, 2);
    // Supplier ledger still zeroes: TOP_UP +(sale − commission) + SETTLEMENT −net.
    expect(lotoLedgerBalance(db)).toBeCloseTo(0, 2);
  });

  it("settleCheckpoints (batch): full cycle nets drawers +commission, not +2× commission", () => {
    const before = totalLbpAcrossDrawers(db);
    sellTicket();
    sellTicket();

    const checkpoints = new LotoCheckpointRepository(db);
    const mkCp = () =>
      checkpoints.createCheckpoint({
        checkpoint_date: "2026-07-18",
        period_start: "2026-07-18",
        period_end: "2026-07-18",
        total_sales: SALE,
        total_commission: COMMISSION,
        total_tickets: 1,
        total_prizes: 0,
        total_cash_prizes: 0,
        total_cash_prizes_count: 0,
      });
    const cp1 = mkCp();
    const cp2 = mkCp();

    checkpoints.settleCheckpoints(
      [cp1.id, cp2.id],
      2 * SALE,
      2 * COMMISSION,
      undefined,
      1,
      {
        method: "CASH",
        drawer_name: "Loto",
        currency_code: "LBP",
        amount: -(2 * NET_PAY),
      },
    );

    expect(totalLbpAcrossDrawers(db) - before).toBeCloseTo(2 * COMMISSION, 2);
    expect(lotoLedgerBalance(db)).toBeCloseTo(0, 2);
  });
});
