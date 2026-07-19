/**
 * CQ-7 — normalized raw supplier_ledger / partner_ledger INSERTs.
 *
 * docs/plans/todo_plans/COUNTERPARTY_CONSOLIDATION_PLAN.md — CQ-7 task 4.
 * Four call sites used to write a supplier_ledger/partner_ledger row with a
 * raw INSERT instead of going through the owning repository's
 * addLedgerEntry:
 *
 *  - RechargeRepository.topUpFromSupplier (supplier_ledger) — the raw INSERT
 *    never had a transaction_id column at all → always NULL.
 *  - RechargeRepository.topUpFromPartner (partner_ledger) — bypassed
 *    PartnerRepository.addLedgerEntry entirely ("inlined ... to stay in this
 *    transaction").
 *  - LotoTicketRepository.createTicket (supplier_ledger) — explicitly passed
 *    transaction_id = null ("to avoid FK constraint issues").
 *  - LotoCashPrizeRepository.createCashPrize (supplier_ledger) — this one
 *    ALREADY passed transaction_id = txnId pre-fix; the assertion here is a
 *    behavior-preservation check (not a bug-fix proof).
 *
 * All four now route through the owning repo's addLedgerEntry (Supplier's
 * new link-mode / PartnerRepository's existing addLedgerEntry), preserving
 * every existing column value (entry_type, signed amounts, note text,
 * is_auto) and adding the transaction_id link where it was missing. The
 * topUpFromSupplier and LotoTicketRepository transaction_id assertions FAIL
 * on pre-fix code (rule 17).
 */

import Database from "better-sqlite3";
import { RechargeRepository } from "../RechargeRepository";
import { LotoTicketRepository } from "../LotoTicketRepository";
import { LotoCashPrizeRepository } from "../LotoCashPrizeRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

jest.mock("../../db/connection", () => {
  let _db: Database.Database | null = null;
  return {
    getDatabase: () => {
      if (!_db) throw new Error("DB not initialized");
      return _db;
    },
    setDb: (db: Database.Database) => {
      _db = db;
    },
  };
});

// ─── Part A/B: RechargeRepository.topUpFromSupplier / topUpFromPartner ─────

function createRechargeTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE recharges (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      carrier TEXT NOT NULL,
      recharge_type TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      default_price_to_client REAL,
      currency_code TEXT NOT NULL DEFAULT 'USD',
      paid_by TEXT NOT NULL,
      phone_number TEXT,
      client_id INTEGER,
      client_name TEXT,
      note TEXT,
      created_by INTEGER NOT NULL DEFAULT 1,
      edited_by TEXT,
      edited_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_name TEXT,
      phone TEXT,
      note TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      module_key TEXT,
      provider TEXT,
      is_system INTEGER NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE supplier_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL CHECK(entry_type IN ('TOP_UP','SALE_COST','PAYMENT','ADJUSTMENT','SETTLEMENT','CASH_PRIZE','SUPPLIER_PAYS_US')),
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_by INTEGER,
      transaction_id INTEGER,
      is_auto INTEGER NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_at DATETIME,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE partners (
      tenant_id INTEGER DEFAULT 1,
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      name               TEXT NOT NULL UNIQUE,
      phone              TEXT,
      notes              TEXT,
      is_active          INTEGER NOT NULL DEFAULT 1,
      system_association TEXT,
      created_at         TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at         TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE partner_ledger (
      tenant_id INTEGER DEFAULT 1,
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id        INTEGER NOT NULL REFERENCES partners(id),
      transaction_type  TEXT,
      reference_table   TEXT,
      reference_id      INTEGER,
      amount            REAL NOT NULL,
      currency          TEXT NOT NULL DEFAULT 'USD',
      direction         TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      covered_amount    REAL NOT NULL DEFAULT 0,
      notes             TEXT,
      user_id           INTEGER,
      settlement_method TEXT,
      created_at        TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    CREATE TABLE transactions (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL DEFAULT 1,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      profit_usd REAL,
      profit_lbp REAL,
      exchange_rate REAL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      summary TEXT,
      metadata_json TEXT,
      device_id TEXT,
      transaction_time DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id     INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Seed provider drawers
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Katsh', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Katsh', 'LBP', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('iPick', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('iPick', 'LBP', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Whish_App', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Whish_App', 'LBP', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 500);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 0);
  `);

  return db;
}

describe("RechargeRepository.topUpFromSupplier — supplier_ledger transaction_id link", () => {
  let db: Database.Database;
  let repo: RechargeRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createRechargeTestDb();
    setDb(db);
    initFixedTenantContext(1);
    repo = new RechargeRepository();
  });

  afterEach(() => {
    db.close();
    resetTenantContext();
  });

  it("links the TOP_UP ledger row to the RECHARGE_TOPUP transaction (pre-fix: NULL)", () => {
    const supplierRes = db
      .prepare(
        "INSERT INTO suppliers (name, provider, is_active) VALUES (?, ?, 1)",
      )
      .run("Katsh Supplier", "Katsh");
    const supplierId = Number(supplierRes.lastInsertRowid);

    repo.topUpFromSupplier({
      provider: "Katsh",
      amount: 100,
      currency: "USD",
      userId: 1,
    });

    const txn = db
      .prepare("SELECT id FROM transactions WHERE type = 'RECHARGE_TOPUP'")
      .get() as { id: number };
    const ledger = db
      .prepare(
        "SELECT transaction_id, is_auto FROM supplier_ledger WHERE supplier_id = ? AND entry_type = 'TOP_UP'",
      )
      .get(supplierId) as { transaction_id: number | null; is_auto: number };

    expect(ledger.transaction_id).toBe(txn.id);
    // Preserved exactly: the raw INSERT never set is_auto → schema default 0.
    expect(ledger.is_auto).toBe(0);
  });
});

describe("RechargeRepository.topUpFromPartner — routed through PartnerRepository.addLedgerEntry", () => {
  let db: Database.Database;
  let repo: RechargeRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createRechargeTestDb();
    setDb(db);
    initFixedTenantContext(1);
    repo = new RechargeRepository();
  });

  afterEach(() => {
    db.close();
    resetTenantContext();
  });

  function seedPartner(name = "Whish Partner"): number {
    const res = db
      .prepare("INSERT INTO partners (name, is_active) VALUES (?, 1)")
      .run(name);
    return Number(res.lastInsertRowid);
  }

  it("creates a WHISH_TOPUP CREDIT partner_ledger row with the same values as the raw INSERT", () => {
    const partnerId = seedPartner();

    repo.topUpFromPartner({
      provider: "WHISH_APP",
      partnerId,
      amount: 100,
      currency: "USD",
      userId: 1,
    });

    const rows = db
      .prepare("SELECT * FROM partner_ledger WHERE partner_id = ?")
      .all(partnerId) as Array<{
      transaction_type: string;
      direction: string;
      amount: number;
      currency: string;
      reference_table: string;
      notes: string | null;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].transaction_type).toBe("WHISH_TOPUP");
    expect(rows[0].direction).toBe("CREDIT");
    expect(rows[0].amount).toBeCloseTo(100, 2);
    expect(rows[0].currency).toBe("USD");
    expect(rows[0].reference_table).toBe("recharges");
    // The prior raw INSERT's column list omitted `notes` entirely → NULL.
    expect(rows[0].notes).toBeNull();
  });

  it("does NOT apply FIFO settlement coverage to an open FOR_% row (WHISH_TOPUP is neither SETTLEMENT nor applyCoverage)", () => {
    const partnerId = seedPartner();
    // An open FOR_RECHARGE DEBIT row (partner owes the shop), uncovered.
    db.prepare(
      `INSERT INTO partner_ledger (partner_id, transaction_type, amount, currency, direction, covered_amount, tenant_id)
       VALUES (?, 'FOR_RECHARGE', 50, 'USD', 'DEBIT', 0, 1)`,
    ).run(partnerId);

    repo.topUpFromPartner({
      provider: "WHISH_APP",
      partnerId,
      amount: 100,
      currency: "USD",
      userId: 1,
    });

    const forRow = db
      .prepare(
        "SELECT covered_amount FROM partner_ledger WHERE partner_id = ? AND transaction_type = 'FOR_RECHARGE'",
      )
      .get(partnerId) as { covered_amount: number };
    expect(forRow.covered_amount).toBe(0);
  });
});

// ─── Part C/D: Loto repositories' supplier_ledger transaction_id link ──────

function createLotoTestDb(): Database.Database {
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
      refunded_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

describe("LotoTicketRepository.createTicket — supplier_ledger transaction_id link (pre-fix: null)", () => {
  let db: Database.Database;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { resetTransactionRepository } =
    require("../TransactionRepository") as typeof import("../TransactionRepository");

  beforeEach(() => {
    db = createLotoTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetTransactionRepository();
  });

  afterEach(() => {
    db.close();
    resetTransactionRepository();
    resetTenantContext();
  });

  it("links the TOP_UP ledger row to the LOTO transaction", () => {
    new LotoTicketRepository(db).createTicket({
      sale_amount: 100_000,
      commission_amount: 15_000,
      sale_date: "2026-07-04",
      payment_method: "CASH",
      currency: "LBP",
      userId: 1,
    });

    const txn = db
      .prepare("SELECT id FROM transactions WHERE type = 'LOTO'")
      .get() as { id: number };
    const ledger = db
      .prepare(
        "SELECT transaction_id, is_auto FROM supplier_ledger WHERE entry_type = 'TOP_UP'",
      )
      .get() as { transaction_id: number | null; is_auto: number };

    // Pre-fix: the raw INSERT passed transaction_id = null explicitly.
    expect(ledger.transaction_id).toBe(txn.id);
    expect(ledger.is_auto).toBe(0);
  });
});

describe("LotoCashPrizeRepository.createCashPrize — supplier_ledger transaction_id link (preserved)", () => {
  let db: Database.Database;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { resetTransactionRepository } =
    require("../TransactionRepository") as typeof import("../TransactionRepository");

  beforeEach(() => {
    db = createLotoTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetTransactionRepository();
  });

  afterEach(() => {
    db.close();
    resetTransactionRepository();
    resetTenantContext();
  });

  it("links the CASH_PRIZE ledger row to the LOTO_CASH_PRIZE transaction (already correct pre-fix)", () => {
    new LotoCashPrizeRepository(db).createCashPrize({
      prize_amount: 50_000,
      prize_date: "2026-07-04",
      ticket_number: "T-9",
      userId: 1,
    });

    const txn = db
      .prepare("SELECT id FROM transactions WHERE type = 'LOTO_CASH_PRIZE'")
      .get() as { id: number };
    const ledger = db
      .prepare(
        "SELECT transaction_id, is_auto FROM supplier_ledger WHERE entry_type = 'CASH_PRIZE'",
      )
      .get() as { transaction_id: number | null; is_auto: number };

    expect(ledger.transaction_id).toBe(txn.id);
    expect(ledger.is_auto).toBe(0);
  });
});

// ─── FK enforcement (production parity) ────────────────────────────────────
//
// electron-app/main.ts and backend/src/database/connection.ts both run
// `PRAGMA foreign_keys = ON`, and electron-app/create_db.sql declares
// `supplier_ledger.transaction_id REFERENCES transactions(id)`. None of the
// fixtures above declare that FK, so they can't prove the new link-mode
// writes (transaction_id stamped at INSERT time, referencing a transactions
// row created earlier in the SAME db.transaction()) survive real FK
// enforcement. This schema mirrors production exactly for the three
// normalized call sites (rule 17 spirit: prove the risk the sibling-agent
// coordination note flagged, not just assume insert-order makes it safe).

function createFkStrictTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON"); // matches electron-app/main.ts at runtime

  db.exec(`
    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL
    );
    INSERT INTO users (id, username) VALUES (1, 'admin');

    CREATE TABLE suppliers (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_name TEXT,
      phone TEXT,
      note TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      module_key TEXT,
      provider TEXT,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE transactions (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
      summary TEXT,
      metadata_json TEXT,
      device_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (reverses_id) REFERENCES transactions(id)
    );

    -- Same FK shape as electron-app/create_db.sql: supplier_id/transaction_id/
    -- created_by are all REFERENCES, and foreign_keys=ON above enforces them.
    CREATE TABLE supplier_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL CHECK(entry_type IN ('TOP_UP','SALE_COST','PAYMENT','ADJUSTMENT','SETTLEMENT','CASH_PRIZE','SUPPLIER_PAYS_US')),
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_by INTEGER,
      transaction_id INTEGER,
      is_auto INTEGER NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
      FOREIGN KEY (transaction_id) REFERENCES transactions(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE payments (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id     INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (transaction_id) REFERENCES transactions(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Katsh', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Katsh', 'LBP', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 500);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 10000000);

    CREATE TABLE recharges (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      carrier TEXT NOT NULL,
      recharge_type TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      default_price_to_client REAL,
      currency_code TEXT NOT NULL DEFAULT 'USD',
      paid_by TEXT NOT NULL,
      phone_number TEXT,
      client_id INTEGER,
      client_name TEXT,
      note TEXT,
      created_by INTEGER NOT NULL DEFAULT 1,
      edited_by TEXT,
      edited_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

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
  `);

  return db;
}

describe("CQ-7 — supplier_ledger.transaction_id link survives PRAGMA foreign_keys = ON (production parity)", () => {
  let db: Database.Database;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { resetTransactionRepository } =
    require("../TransactionRepository") as typeof import("../TransactionRepository");

  beforeEach(() => {
    db = createFkStrictTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetTransactionRepository();
  });

  afterEach(() => {
    db.close();
    resetTransactionRepository();
    resetTenantContext();
  });

  it("RechargeRepository.topUpFromSupplier does not violate the transaction_id FK", () => {
    db.prepare(
      "INSERT INTO suppliers (name, provider, is_active) VALUES (?, ?, 1)",
    ).run("Katsh Supplier", "Katsh");

    const repo = new RechargeRepository();
    expect(() =>
      repo.topUpFromSupplier({
        provider: "Katsh",
        amount: 100,
        currency: "USD",
        userId: 1,
      }),
    ).not.toThrow();

    const ledger = db
      .prepare(
        "SELECT transaction_id FROM supplier_ledger WHERE entry_type = 'TOP_UP'",
      )
      .get() as { transaction_id: number | null };
    expect(ledger.transaction_id).not.toBeNull();
  });

  it("LotoTicketRepository.createTicket does not violate the transaction_id FK", () => {
    expect(() =>
      new LotoTicketRepository(db).createTicket({
        sale_amount: 100_000,
        commission_amount: 15_000,
        sale_date: "2026-07-04",
        payment_method: "CASH",
        currency: "LBP",
        userId: 1,
      }),
    ).not.toThrow();

    const ledger = db
      .prepare(
        "SELECT transaction_id FROM supplier_ledger WHERE entry_type = 'TOP_UP'",
      )
      .get() as { transaction_id: number | null };
    expect(ledger.transaction_id).not.toBeNull();
  });

  it("LotoCashPrizeRepository.createCashPrize does not violate the transaction_id FK", () => {
    expect(() =>
      new LotoCashPrizeRepository(db).createCashPrize({
        prize_amount: 50_000,
        prize_date: "2026-07-04",
        ticket_number: "T-9",
        userId: 1,
      }),
    ).not.toThrow();

    const ledger = db
      .prepare(
        "SELECT transaction_id FROM supplier_ledger WHERE entry_type = 'CASH_PRIZE'",
      )
      .get() as { transaction_id: number | null };
    expect(ledger.transaction_id).not.toBeNull();
  });
});
