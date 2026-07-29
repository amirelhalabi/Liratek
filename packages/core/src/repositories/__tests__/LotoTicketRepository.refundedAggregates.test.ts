/**
 * LotoTicketRepository — dashboard/checkpoint aggregates exclude refunded tickets
 *
 * A void/refund of a loto ticket sale soft-flags `loto_tickets.is_refunded = 1`
 * (via the generic `_markSourceRefunded`, owned by TransactionRepository — out
 * of scope here). But NONE of LotoTicketRepository's own aggregate/list
 * queries filtered on it, so a reversed ticket kept counting toward the Loto
 * dashboard forever AND — worse — kept getting swept into the NEXT checkpoint
 * by `getUncheckpointedTickets`/`getUncheckpointedTotals`, permanently
 * poisoning that checkpoint's settle-to-zero math even though the ticket's
 * supplier-ledger row was separately soft-voided.
 *
 * This test proves the fix by directly flipping `is_refunded` on a ticket
 * (simulating what the reversal path does) rather than driving the full
 * void/refund flow — that flow lives in TransactionRepository, a peer's file.
 */

import Database from "better-sqlite3";
import { LotoTicketRepository } from "../LotoTicketRepository";
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
      prize_paid_date TEXT,
      sale_date TEXT,
      payment_method TEXT,
      currency TEXT DEFAULT 'LBP',
      note TEXT,
      client_id INTEGER,
      client_name TEXT,
      checkpoint_id INTEGER,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL,
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
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_at TEXT,
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
      created_by INTEGER,
      due_date TEXT,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

/** Simulate the generic reversal's soft-void of the ticket row (owned by
 *  TransactionRepository, out of scope for this file) so we can test that
 *  LotoTicketRepository's OWN queries correctly honor the flag afterward. */
function markRefunded(db: Database.Database, ticketId: number): void {
  db.prepare(
    `UPDATE loto_tickets SET is_refunded = 1, refunded_at = CURRENT_TIMESTAMP WHERE id = ?`,
  ).run(ticketId);
}

describe("LotoTicketRepository — refunded-ticket exclusion from aggregates", () => {
  let db: Database.Database;
  let repo: LotoTicketRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    resetTransactionRepository();
    repo = new LotoTicketRepository(db);
  });

  afterEach(() => {
    db.close();
    resetTransactionRepository();
  });

  function sellTwoTickets(): { keptId: number; refundedId: number } {
    const kept = repo.createTicket({
      sale_amount: 100_000,
      commission_amount: 4_450,
      sale_date: "2026-07-10",
      payment_method: "CASH",
      currency: "LBP",
      userId: 1,
    });
    const refunded = repo.createTicket({
      sale_amount: 50_000,
      commission_amount: 2_225,
      sale_date: "2026-07-10",
      payment_method: "CASH",
      currency: "LBP",
      userId: 1,
      is_winner: 1,
      prize_amount: 20_000,
    });
    return { keptId: kept.id, refundedId: refunded.id };
  }

  it("getTotalSales excludes a refunded ticket but includes a normal one", () => {
    const { refundedId } = sellTwoTickets();
    markRefunded(db, refundedId);

    expect(repo.getTotalSales("2026-07-10", "2026-07-10")).toBe(100_000);
  });

  it("getTotalCommission excludes a refunded ticket but includes a normal one", () => {
    const { refundedId } = sellTwoTickets();
    markRefunded(db, refundedId);

    expect(repo.getTotalCommission("2026-07-10", "2026-07-10")).toBe(4_450);
  });

  it("getTicketCount excludes a refunded ticket but includes a normal one", () => {
    const { refundedId } = sellTwoTickets();
    markRefunded(db, refundedId);

    expect(repo.getTicketCount("2026-07-10", "2026-07-10")).toBe(1);
  });

  it("getTotalPrizes excludes a refunded winning ticket", () => {
    // Make the KEPT ticket the winner this time so a non-zero baseline exists.
    const kept = repo.createTicket({
      sale_amount: 10_000,
      commission_amount: 445,
      sale_date: "2026-07-11",
      payment_method: "CASH",
      currency: "LBP",
      userId: 1,
      is_winner: 1,
      prize_amount: 30_000,
    });
    const refundedWinner = repo.createTicket({
      sale_amount: 10_000,
      commission_amount: 445,
      sale_date: "2026-07-11",
      payment_method: "CASH",
      currency: "LBP",
      userId: 1,
      is_winner: 1,
      prize_amount: 15_000,
    });
    void kept;
    markRefunded(db, refundedWinner.id);

    expect(repo.getTotalPrizes("2026-07-11", "2026-07-11")).toBe(30_000);
  });

  it("getOutstandingPrizes excludes a refunded unpaid-prize ticket", () => {
    const kept = repo.createTicket({
      sale_amount: 10_000,
      commission_amount: 445,
      sale_date: "2026-07-12",
      payment_method: "CASH",
      currency: "LBP",
      userId: 1,
      is_winner: 1,
      prize_amount: 30_000,
    });
    const refundedWinner = repo.createTicket({
      sale_amount: 10_000,
      commission_amount: 445,
      sale_date: "2026-07-12",
      payment_method: "CASH",
      currency: "LBP",
      userId: 1,
      is_winner: 1,
      prize_amount: 99_000,
    });
    void kept;
    markRefunded(db, refundedWinner.id);

    expect(repo.getOutstandingPrizes()).toBe(30_000);
  });

  // ── The dangerous one: checkpoint sweep must not pick up a refunded ticket ──

  it("getUncheckpointedTickets excludes a refunded ticket from the sweep", () => {
    const { keptId, refundedId } = sellTwoTickets();
    markRefunded(db, refundedId);

    const sweep = repo.getUncheckpointedTickets();
    const ids = sweep.map((t) => t.id);
    expect(ids).toContain(keptId);
    expect(ids).not.toContain(refundedId);
  });

  it("getUncheckpointedTotals excludes a refunded ticket's amounts from the frozen checkpoint totals", () => {
    const { refundedId } = sellTwoTickets();
    markRefunded(db, refundedId);

    const totals = repo.getUncheckpointedTotals();
    expect(totals.count).toBe(1);
    expect(totals.totalSales).toBe(100_000);
    expect(totals.totalCommission).toBe(4_450);
    expect(totals.totalPrizes).toBe(0); // the kept ticket wasn't a winner
  });

  // ── History display must NOT be affected — a refunded ticket still shows up ──

  it("getTicketsByDateRange still returns a refunded ticket (history view)", () => {
    const { keptId, refundedId } = sellTwoTickets();
    markRefunded(db, refundedId);

    const rows = repo.getTicketsByDateRange("2026-07-10", "2026-07-10");
    const ids = rows.map((t) => t.id);
    expect(ids).toContain(keptId);
    expect(ids).toContain(refundedId);
    expect(rows.find((t) => t.id === refundedId)?.is_refunded).toBe(1);
  });

  it("getTicketById still returns a refunded ticket (reversal path needs it)", () => {
    const { refundedId } = sellTwoTickets();
    markRefunded(db, refundedId);

    const ticket = repo.getTicketById(refundedId);
    expect(ticket).not.toBeNull();
    expect(ticket?.is_refunded).toBe(1);
  });

  // ── Legacy-NULL is_refunded rows (pre-v68 data) must still be INCLUDED ──

  it("treats a legacy NULL is_refunded row as not-refunded (COALESCE)", () => {
    const kept = repo.createTicket({
      sale_amount: 77_000,
      commission_amount: 3_426.5,
      sale_date: "2026-07-13",
      payment_method: "CASH",
      currency: "LBP",
      userId: 1,
    });
    db.prepare(`UPDATE loto_tickets SET is_refunded = NULL WHERE id = ?`).run(
      kept.id,
    );

    expect(repo.getTotalSales("2026-07-13", "2026-07-13")).toBe(77_000);
    expect(
      repo.getUncheckpointedTickets().map((t) => t.id),
    ).toContain(kept.id);
  });
});
