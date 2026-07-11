/**
 * B6b — Loto supplier-ledger sign convention flip
 *
 * Loto used an INVERTED sign convention in supplier_ledger: ticket sales (shop
 * owes Loto) were booked as NEGATIVE 'PAYMENT' rows and cash prizes (Loto owes
 * shop) as POSITIVE 'CASH_PRIZE' rows. The Suppliers page sums ledger rows and
 * reads >0 as "You owe" — so Loto rendered backwards vs every other supplier.
 *
 * After the fix (repo writes + migration v119):
 *   - ticket sale   → entry_type 'TOP_UP',  amount_lbp = +(sale − commission)
 *   - cash prize    → entry_type 'CASH_PRIZE', amount_lbp = −prize
 *   - SETTLEMENT rows are UNCHANGED (they were already standard-oriented), so
 *     a settled ledger sums to exactly 0.
 *
 * Every test here is constructed to FAIL on the pre-fix code (rule 17).
 */

import Database from "better-sqlite3";
import { LotoTicketRepository } from "../LotoTicketRepository";
import { LotoCashPrizeRepository } from "../LotoCashPrizeRepository";
import { LotoCheckpointRepository } from "../LotoCheckpointRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { MIGRATIONS } from "../../db/migrations/index";

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
    INSERT INTO drawer_balances VALUES (1, 'General', 'USD', 100, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General', 'LBP', 10000000, CURRENT_TIMESTAMP);

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

function lotoLedgerRows(db: Database.Database) {
  return db
    .prepare(
      `SELECT sl.entry_type, sl.amount_lbp, sl.note FROM supplier_ledger sl
       JOIN suppliers s ON s.id = sl.supplier_id
       WHERE s.provider = 'LOTO'
       ORDER BY sl.id`,
    )
    .all() as Array<{ entry_type: string; amount_lbp: number; note: string }>;
}

function lotoBalance(db: Database.Database): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(sl.amount_lbp), 0) AS bal FROM supplier_ledger sl
       JOIN suppliers s ON s.id = sl.supplier_id
       WHERE s.provider = 'LOTO'`,
    )
    .get() as { bal: number };
  return row.bal;
}

describe("B6b — Loto supplier-ledger sign convention", () => {
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

  it("ticket sale books a POSITIVE TOP_UP row (shop owes Loto, standard convention)", () => {
    new LotoTicketRepository(db).createTicket({
      sale_amount: 100_000,
      commission_amount: 15_000,
      sale_date: "2026-07-04",
      payment_method: "CASH",
      currency: "LBP",
      userId: 1,
    });

    const rows = lotoLedgerRows(db);
    expect(rows).toHaveLength(1);
    // Pre-fix: entry_type 'PAYMENT', amount_lbp = -85000.
    expect(rows[0].entry_type).toBe("TOP_UP");
    expect(rows[0].amount_lbp).toBe(85_000);
  });

  it("cash prize books a NEGATIVE CASH_PRIZE row (Loto owes shop)", () => {
    new LotoCashPrizeRepository(db).createCashPrize({
      prize_amount: 50_000,
      prize_date: "2026-07-04",
      ticket_number: "T-9",
      userId: 1,
    });

    const rows = lotoLedgerRows(db);
    expect(rows).toHaveLength(1);
    // Pre-fix: amount_lbp = +50000.
    expect(rows[0].entry_type).toBe("CASH_PRIZE");
    expect(rows[0].amount_lbp).toBe(-50_000);
  });

  it("net Loto balance is POSITIVE when the shop owes Loto (ticket − prize)", () => {
    new LotoTicketRepository(db).createTicket({
      sale_amount: 100_000,
      commission_amount: 15_000,
      sale_date: "2026-07-04",
      payment_method: "CASH",
      currency: "LBP",
      userId: 1,
    });
    new LotoCashPrizeRepository(db).createCashPrize({
      prize_amount: 30_000,
      prize_date: "2026-07-04",
      userId: 1,
    });

    // Shop owes (100000 − 15000) = 85000, minus Loto's 30000 prize debt → +55000.
    // Pre-fix the same activity summed to −55000 (rendered green "They owe you").
    expect(lotoBalance(db)).toBe(55_000);
  });

  it("settling a checkpoint zeroes the Loto ledger (SETTLEMENT rows intentionally unchanged)", () => {
    new LotoTicketRepository(db).createTicket({
      sale_amount: 100_000,
      commission_amount: 15_000,
      sale_date: "2026-07-04",
      payment_method: "CASH",
      currency: "LBP",
      userId: 1,
    });
    new LotoCashPrizeRepository(db).createCashPrize({
      prize_amount: 30_000,
      prize_date: "2026-07-04",
      userId: 1,
    });

    const checkpoints = new LotoCheckpointRepository(db);
    const cp = checkpoints.createCheckpoint({
      checkpoint_date: "2026-07-04",
      period_start: "2026-07-01",
      period_end: "2026-07-04",
      total_sales: 100_000,
      total_commission: 15_000,
      total_tickets: 1,
      total_prizes: 0,
      total_cash_prizes: 30_000,
      total_cash_prizes_count: 1,
    });
    checkpoints.settleCheckpoint(
      cp.id,
      100_000,
      15_000,
      0,
      30_000,
      "2026-07-04T12:00:00.000Z",
      1,
    );

    // Flipped rows: +85000 (ticket) −30000 (prize) = +55000 pre-settlement.
    // SETTLEMENT row = (15000 + 30000) − 100000 = −55000 → total 0.
    // Pre-fix the same flow summed to −110000 (the doubling bug).
    expect(lotoBalance(db)).toBe(0);
  });

  describe("migration v119 — historical rows", () => {
    const v119 = MIGRATIONS.find((m) => m.version === 119)!;

    function seedLegacyRows(database: Database.Database): number {
      const supplierId = Number(
        database
          .prepare(
            `INSERT INTO suppliers (name, provider, is_active, is_system) VALUES ('Loto Liban', 'LOTO', 1, 1)`,
          )
          .run().lastInsertRowid,
      );
      const ins = database.prepare(
        `INSERT INTO supplier_ledger (supplier_id, entry_type, amount_usd, amount_lbp, note) VALUES (?, ?, 0, ?, ?)`,
      );
      // Legacy inverted ticket row.
      ins.run(
        supplierId,
        "PAYMENT",
        -85_000,
        "Ticket sale: we owe LOTO 85000 LBP (sale: 100000, commission: 15000)",
      );
      // Legacy inverted cash-prize row.
      ins.run(
        supplierId,
        "CASH_PRIZE",
        30_000,
        "Cash prize payout: LOTO owes us 30000 LBP (ticket: T-1)",
      );
      // SETTLEMENT row — already standard, must NOT be touched.
      ins.run(
        supplierId,
        "SETTLEMENT",
        -55_000,
        "Settlement for checkpoint #1",
      );
      // Decoy: a legitimate manual Loto settlement payment written by
      // addLedgerEntry (PAYMENT, negative) — must NOT be re-flipped.
      ins.run(supplierId, "PAYMENT", -40_000, "Manual settlement");
      return supplierId;
    }

    it("v119 exists and flips ONLY the legacy ticket/prize rows (decoy + SETTLEMENT untouched)", () => {
      expect(v119).toBeDefined();
      seedLegacyRows(db);

      v119.up(db);

      const rows = lotoLedgerRows(db);
      // Ticket row: relabeled + negated.
      expect(rows[0].entry_type).toBe("TOP_UP");
      expect(rows[0].amount_lbp).toBe(85_000);
      // Cash-prize row: negated.
      expect(rows[1].entry_type).toBe("CASH_PRIZE");
      expect(rows[1].amount_lbp).toBe(-30_000);
      // SETTLEMENT: untouched.
      expect(rows[2].entry_type).toBe("SETTLEMENT");
      expect(rows[2].amount_lbp).toBe(-55_000);
      // Decoy manual PAYMENT: untouched.
      expect(rows[3].entry_type).toBe("PAYMENT");
      expect(rows[3].amount_lbp).toBe(-40_000);

      // A settled historical ledger reconciles to ~0 after the flip
      // (85000 − 30000 − 55000 = 0, decoy excluded from this check).
      expect(85_000 - 30_000 - 55_000).toBe(0);
    });

    it("v119 down() round-trips all rows back to the legacy shape", () => {
      seedLegacyRows(db);
      const before = JSON.stringify(lotoLedgerRows(db));

      v119.up(db);
      v119.down!(db);

      expect(JSON.stringify(lotoLedgerRows(db))).toBe(before);
    });

    it("v119 up() is idempotent and never touches NEW-convention rows (same note prefixes)", () => {
      const supplierId = seedLegacyRows(db);
      // A post-fix cash-prize row: same note prefix as the legacy ones but
      // already NEGATIVE. Without the sign guard, any re-run of up() would
      // double-negate it into a phantom liability.
      db.prepare(
        `INSERT INTO supplier_ledger (supplier_id, entry_type, amount_usd, amount_lbp, note) VALUES (?, 'CASH_PRIZE', 0, ?, ?)`,
      ).run(
        supplierId,
        -70_000,
        "Cash prize payout: LOTO owes us 70000 LBP (ticket: NEW-1)",
      );

      v119.up(db);
      const afterOnce = JSON.stringify(lotoLedgerRows(db));
      v119.up(db); // simulate a re-run
      const afterTwice = JSON.stringify(lotoLedgerRows(db));

      expect(afterTwice).toBe(afterOnce);
      // And the new-convention row was never touched, even on the first run.
      const rows = lotoLedgerRows(db);
      const newRow = rows.find((r) => r.note.includes("NEW-1"))!;
      expect(newRow.amount_lbp).toBe(-70_000);
    });
  });

  it("settling the same checkpoint twice throws (would double-book the SETTLEMENT row)", () => {
    new LotoTicketRepository(db).createTicket({
      sale_amount: 100_000,
      commission_amount: 15_000,
      sale_date: "2026-07-04",
      payment_method: "CASH",
      currency: "LBP",
      userId: 1,
    });

    const checkpoints = new LotoCheckpointRepository(db);
    const cp = checkpoints.createCheckpoint({
      checkpoint_date: "2026-07-04",
      period_start: "2026-07-01",
      period_end: "2026-07-04",
      total_sales: 100_000,
      total_commission: 15_000,
      total_tickets: 1,
      total_prizes: 0,
      total_cash_prizes: 0,
      total_cash_prizes_count: 0,
    });
    const settle = () =>
      checkpoints.settleCheckpoint(
        cp.id,
        100_000,
        15_000,
        0,
        0,
        "2026-07-04T12:00:00.000Z",
        1,
      );

    settle();
    // Second settle must be rejected — pre-guard it wrote a second SETTLEMENT
    // row and flipped the Loto balance to a phantom "They owe you".
    expect(settle).toThrow(/already settled/);
    expect(lotoBalance(db)).toBe(0);
  });
});
