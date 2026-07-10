/**
 * FinancialServiceRepository — prepaid-units supplier debt model (C5)
 *
 * Supplier debt is booked ONCE at top-up time (a TOP_UP ledger entry via
 * topUpFromSupplier); a SALE through a cost/price provider (Katsh / iPick,
 * card sales via Whish App / OMT App) only draws down the provider drawer —
 * it books NO per-sale supplier ledger entry. (Pre-C5, every sale booked a
 * SALE_COST entry, double-counting the debt already created by the top-up.
 * Loto is the exception and books its own ledger in LotoTicketRepository.)
 *
 * Covered here:
 *   1. Cost/price-flow SEND: no ledger entry; drawers still move (−cost/+price).
 *   2. Settle tab: post-C5 sales (supplier_debt_booked=0) are NOT individually
 *      settleable; LEGACY rows (backfilled supplier_debt_booked=1, which DID
 *      book a SALE_COST) still surface and settle to a zero balance.
 *   3. Prepaid reconciliation: TOP_UP at top-up → sales leave the balance
 *      unchanged → PAYMENT pays it down.
 *   4. BILL commission (LIRA-062) unchanged: one SUPPLIER_PAYS_US −20,000 LBP.
 *
 * All tests run against an in-memory SQLite database. DebtService is mocked.
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { SupplierRepository } from "../SupplierRepository";

// ─── Mock DB connection (shared by all sub-repositories) ─────────────────────

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

// ─── Mock DebtService (CUSTOMER_ACCOUNT cashout / on-account only) ────────────

const mockAddCredit = jest.fn();
jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: mockAddCredit }),
  resetDebtService: jest.fn(),
}));

// ─── In-memory schema ────────────────────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1,
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      role TEXT DEFAULT 'staff',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO users (id, username, role) VALUES (1, 'admin', 'admin');

    CREATE TABLE clients (
      tenant_id INTEGER DEFAULT 1,
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name    TEXT NOT NULL,
      phone_number TEXT,
      balance_usd  REAL DEFAULT 0,
      balance_lbp  REAL DEFAULT 0,
      notes        TEXT,
      whatsapp_opt_in INTEGER DEFAULT 0,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE financial_services (
      tenant_id INTEGER DEFAULT 1,
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      provider              TEXT NOT NULL,
      service_type          TEXT NOT NULL,
      amount                REAL NOT NULL,
      currency              TEXT DEFAULT 'USD' NOT NULL,
      commission            REAL DEFAULT 0,
      cost                  REAL DEFAULT 0,
      price                 REAL DEFAULT 0,
      paid_by               TEXT DEFAULT 'CASH',
      client_id             INTEGER REFERENCES clients(id),
      client_name           TEXT,
      reference_number      TEXT,
      phone_number          TEXT,
      omt_service_type      TEXT,
      omt_fee               REAL DEFAULT 0,
      whish_fee             REAL DEFAULT 0,
      profit_rate           REAL,
      pay_fee               INTEGER DEFAULT 0,
      payment_method_fee    REAL DEFAULT 0,
      payment_method_fee_rate REAL,
      item_key              TEXT,
      note                  TEXT,
      sender_name           TEXT,
      sender_phone          TEXT,
      receiver_name         TEXT,
      receiver_phone        TEXT,
      sender_client_id      INTEGER,
      receiver_client_id    INTEGER,
      is_settled            INTEGER NOT NULL DEFAULT 1,
      settled_at            TEXT,
      settlement_id         INTEGER,
      created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by            INTEGER,
      edited_by             TEXT,
      edited_at             TEXT,
      paid_amount           REAL DEFAULT NULL,
      paid_currency         TEXT DEFAULT NULL,
      partner_id            INTEGER,
      partner_mode          TEXT,
      supplier_debt_booked  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE transactions (
      tenant_id INTEGER DEFAULT 1,
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      type         TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id    INTEGER NOT NULL,
      user_id      INTEGER NOT NULL DEFAULT 1,
      amount_usd   REAL NOT NULL DEFAULT 0,
      amount_lbp   REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id    INTEGER,
      client_name  TEXT,
      client_phone TEXT,
      reverses_id  INTEGER,
      profit_usd   REAL NOT NULL DEFAULT 0,
      profit_lbp   REAL NOT NULL DEFAULT 0,
      summary      TEXT,
      metadata_json TEXT,
      device_id    TEXT,
      transaction_time DATETIME,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      tenant_id INTEGER DEFAULT 1,
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      method         TEXT NOT NULL,
      drawer_name    TEXT NOT NULL,
      currency_code  TEXT NOT NULL,
      amount         REAL NOT NULL,
      note           TEXT,
      created_by     INTEGER,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1,
      drawer_name   TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance       REAL NOT NULL DEFAULT 0,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    CREATE TABLE suppliers (
      tenant_id INTEGER DEFAULT 1,
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      contact_name TEXT,
      phone        TEXT,
      note         TEXT,
      is_active    INTEGER NOT NULL DEFAULT 1,
      module_key   TEXT,
      provider     TEXT,
      is_system    INTEGER NOT NULL DEFAULT 0,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- supplier_ledger WITH the post-v103 CHECK (SALE_COST + SUPPLIER_PAYS_US)
    CREATE TABLE supplier_ledger (
      tenant_id INTEGER DEFAULT 1,
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id   INTEGER NOT NULL,
      entry_type    TEXT NOT NULL CHECK(entry_type IN ('TOP_UP','SALE_COST','PAYMENT','ADJUSTMENT','SETTLEMENT','CASH_PRIZE','SUPPLIER_PAYS_US')),
      amount_usd    REAL NOT NULL DEFAULT 0,
      amount_lbp    REAL NOT NULL DEFAULT 0,
      note          TEXT,
      created_by    INTEGER,
      transaction_id INTEGER,
      is_auto       INTEGER NOT NULL DEFAULT 0,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Provider drawers for the cost/price flow
    INSERT INTO drawer_balances VALUES (1, 'General', 'USD',  1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General', 'LBP',     0, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Katsh',   'USD',   500, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Katsh',   'LBP',     0, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'iPick',   'USD',   500, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'iPick',   'LBP',     0, CURRENT_TIMESTAMP);
  `);

  return db;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seedSupplier(db: Database.Database, provider: string): number {
  return Number(
    db
      .prepare(
        "INSERT INTO suppliers (name, provider, is_active, is_system) VALUES (?, ?, 1, 1)",
      )
      .run(`${provider} Supplier`, provider).lastInsertRowid,
  );
}

function ledgerRows(
  db: Database.Database,
  supplierId: number,
): Array<{
  entry_type: string;
  amount_usd: number;
  amount_lbp: number;
  note: string | null;
}> {
  return db
    .prepare(
      "SELECT entry_type, amount_usd, amount_lbp, note FROM supplier_ledger WHERE supplier_id = ? ORDER BY id ASC",
    )
    .all(supplierId) as Array<{
    entry_type: string;
    amount_usd: number;
    amount_lbp: number;
    note: string | null;
  }>;
}

function balanceUsd(db: Database.Database, supplierId: number): number {
  const row = db
    .prepare(
      "SELECT COALESCE(SUM(amount_usd), 0) AS total FROM supplier_ledger WHERE supplier_id = ?",
    )
    .get(supplierId) as { total: number };
  return row.total;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("FinancialServiceRepository — cost/price SEND books NO supplier debt (C5 prepaid-units)", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    repo = new FinancialServiceRepository();
    mockAddCredit.mockClear();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  function drawer(name: string, currency = "USD"): number {
    const row = db
      .prepare(
        "SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?",
      )
      .get(name, currency) as { balance: number } | undefined;
    return row ? row.balance : 0;
  }

  // ── The C5 model: sale = drawer draw-down only ─────────────────────────────

  it("Katsh SEND books NO supplier ledger entry — the drawer draw-down is the whole story", () => {
    const supplierId = seedSupplier(db, "Katsh");
    const katshBefore = drawer("Katsh");
    const generalBefore = drawer("General");

    // cost $90 from Katsh balance, price $100 to customer → $10 profit
    repo.createTransaction({
      provider: "Katsh",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 0,
      cost: 90,
      price: 100,
      paidByMethod: "CASH",
    });

    // No per-sale supplier debt (pre-C5: a SALE_COST entry of +90).
    expect(ledgerRows(db, supplierId)).toHaveLength(0);
    expect(balanceUsd(db, supplierId)).toBeCloseTo(0, 4);
    // The drawers still move: provider stock down by cost, cash up by price.
    expect(drawer("Katsh")).toBeCloseTo(katshBefore - 90, 2);
    expect(drawer("General")).toBeCloseTo(generalBefore + 100, 2);
  });

  it("iPick SEND also books no supplier ledger entry", () => {
    const supplierId = seedSupplier(db, "iPick");

    repo.createTransaction({
      provider: "iPick",
      serviceType: "SEND",
      amount: 50,
      currency: "USD",
      commission: 0,
      cost: 45,
      price: 50,
      paidByMethod: "CASH",
    });

    expect(ledgerRows(db, supplierId)).toHaveLength(0);
    expect(balanceUsd(db, supplierId)).toBeCloseTo(0, 4);
  });

  it("an LBP cost/price SEND books no supplier ledger entry either", () => {
    const supplierId = seedSupplier(db, "Katsh");

    repo.createTransaction({
      provider: "Katsh",
      serviceType: "SEND",
      amount: 1_000_000,
      currency: "LBP",
      commission: 0,
      cost: 900_000,
      price: 1_000_000,
      paidByMethod: "CASH",
    });

    expect(ledgerRows(db, supplierId)).toHaveLength(0);
  });

  // ── Settle tab: post-C5 sales are NOT individually settleable ──────────────

  it("does NOT surface a post-C5 sale in getUnsettledBySupplier (no SALE_COST to net)", () => {
    seedSupplier(db, "Katsh");

    repo.createTransaction({
      provider: "Katsh",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 0,
      cost: 90,
      price: 100,
      paidByMethod: "CASH",
    });

    // Settling this row would write a SETTLEMENT with no offsetting SALE_COST
    // and corrupt the supplier balance — it must not be offered.
    expect(repo.getUnsettledBySupplier("Katsh")).toHaveLength(0);
  });

  it("STILL surfaces a LEGACY sale (supplier_debt_booked=1) projected as amount=cost", () => {
    const supplierId = seedSupplier(db, "Katsh");

    repo.createTransaction({
      provider: "Katsh",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 0,
      cost: 90,
      price: 100,
      paidByMethod: "CASH",
    });
    // Simulate a pre-C5 row: the migration backfills supplier_debt_booked=1 and
    // the old code had booked a matching SALE_COST entry.
    db.prepare(
      "UPDATE financial_services SET supplier_debt_booked = 1 WHERE provider = 'Katsh'",
    ).run();
    db.prepare(
      `INSERT INTO supplier_ledger (supplier_id, entry_type, amount_usd, amount_lbp, is_auto)
       VALUES (?, 'SALE_COST', 90, 0, 1)`,
    ).run(supplierId);

    const unsettled = repo.getUnsettledBySupplier("Katsh");
    expect(unsettled).toHaveLength(1);
    expect(unsettled[0].amount).toBeCloseTo(90, 2);
    expect(unsettled[0].commission).toBe(0);
    expect(unsettled[0].service_type).toBe("SEND");
  });

  it("does NOT surface a settled legacy row again (settlement_id stamped)", () => {
    seedSupplier(db, "Katsh");

    repo.createTransaction({
      provider: "Katsh",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 0,
      cost: 90,
      price: 100,
      paidByMethod: "CASH",
    });
    db.prepare(
      "UPDATE financial_services SET supplier_debt_booked = 1, settlement_id = 999 WHERE provider = 'Katsh'",
    ).run();

    expect(repo.getUnsettledBySupplier("Katsh")).toHaveLength(0);
  });
});

// ─── Reconciliation paths under the C5 model ─────────────────────────────────

describe("Supplier debt reconciliation (C5 prepaid-units)", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;
  let supplierRepo: SupplierRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    repo = new FinancialServiceRepository();
    supplierRepo = new SupplierRepository();
    mockAddCredit.mockClear();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  it("LEGACY per-transaction settle still nets its SALE_COST entry to zero", () => {
    const supplierId = seedSupplier(db, "Katsh");

    repo.createTransaction({
      provider: "Katsh",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 0,
      cost: 90,
      price: 100,
      paidByMethod: "CASH",
    });
    // Simulate the pre-C5 state for this row (backfilled flag + SALE_COST entry)
    db.prepare(
      "UPDATE financial_services SET supplier_debt_booked = 1 WHERE provider = 'Katsh'",
    ).run();
    db.prepare(
      `INSERT INTO supplier_ledger (supplier_id, entry_type, amount_usd, amount_lbp, is_auto)
       VALUES (?, 'SALE_COST', 90, 0, 1)`,
    ).run(supplierId);
    expect(balanceUsd(db, supplierId)).toBeCloseTo(90, 2);

    const unsettled = repo.getUnsettledBySupplier("Katsh");
    expect(unsettled).toHaveLength(1);

    supplierRepo.settleTransactions({
      supplier_id: supplierId,
      financial_service_ids: [unsettled[0].id],
      amount_usd: 90,
      amount_lbp: 0,
      commission_usd: 0,
      commission_lbp: 0,
      drawer_name: "General",
      created_by: 1,
      note: "Settle legacy Katsh sale cost",
    });

    expect(balanceUsd(db, supplierId)).toBeCloseTo(0, 4);
    expect(repo.getUnsettledBySupplier("Katsh")).toHaveLength(0);
  });

  it("prepaid model: top-up books the debt once; sales leave it unchanged; PAYMENT pays it down", () => {
    const supplierId = seedSupplier(db, "iPick");

    // Top-up: supplier extends $55 of credit → debt booked ONCE.
    supplierRepo.addLedgerEntry({
      supplier_id: supplierId,
      entry_type: "TOP_UP",
      amount_usd: 55,
      amount_lbp: 0,
      created_by: 1,
      note: "iPick supplier top-up",
      is_auto: true,
    });
    expect(balanceUsd(db, supplierId)).toBeCloseTo(55, 2);

    // Two sales draw down the drawer but do NOT touch the supplier balance.
    repo.createTransaction({
      provider: "iPick",
      serviceType: "SEND",
      amount: 30,
      currency: "USD",
      commission: 0,
      cost: 25,
      price: 30,
      paidByMethod: "CASH",
    });
    repo.createTransaction({
      provider: "iPick",
      serviceType: "SEND",
      amount: 35,
      currency: "USD",
      commission: 0,
      cost: 30,
      price: 35,
      paidByMethod: "CASH",
    });
    expect(balanceUsd(db, supplierId)).toBeCloseTo(55, 2); // unchanged by sales

    // Pay the supplier back → balance nets to zero.
    supplierRepo.addLedgerEntry({
      supplier_id: supplierId,
      entry_type: "PAYMENT",
      amount_usd: 55,
      amount_lbp: 0,
      drawer_name: "iPick",
      created_by: 1,
      note: "Pay down iPick top-up",
    });
    expect(balanceUsd(db, supplierId)).toBeCloseTo(0, 4);
  });
});

// ─── BILL commission path (LIRA-062) ─────────────────────────────────────────
//
// A Katsh / iPick BILL books a FIXED 20,000-LBP commission the supplier owes the
// shop, as a SUPPLIER_PAYS_US ledger entry (negative amount = credit to us). It
// must NOT book the usual SALE_COST/TOP_UP even though cost/price are supplied
// (the provider-drawer movement already accounts for the bill amount).
describe("FinancialServiceRepository — BILL books SUPPLIER_PAYS_US commission (LIRA-062)", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    repo = new FinancialServiceRepository();
    mockAddCredit.mockClear();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  it("Katsh BILL writes exactly one SUPPLIER_PAYS_US entry of -20,000 LBP (no SALE_COST)", () => {
    const supplierId = seedSupplier(db, "Katsh");

    repo.createTransaction({
      provider: "Katsh",
      serviceType: "BILL",
      amount: 50_000,
      currency: "LBP",
      commission: 0,
      cost: 50_000,
      price: 50_000,
      paidByMethod: "CASH",
    });

    // financial_services row is stamped BILL
    const fs = db
      .prepare(
        "SELECT service_type FROM financial_services WHERE provider = 'Katsh' ORDER BY id DESC LIMIT 1",
      )
      .get() as { service_type: string };
    expect(fs.service_type).toBe("BILL");

    // The BILL books ONE supplier-ledger entry, and it's the fixed commission.
    const rows = ledgerRows(db, supplierId);
    expect(rows).toHaveLength(1);
    expect(rows[0].entry_type).toBe("SUPPLIER_PAYS_US");
    expect(rows[0].amount_lbp).toBe(-20_000);
    expect(rows[0].amount_usd).toBe(0);
    // Never the cost/price SALE_COST or a manual TOP_UP.
    expect(rows.map((r) => r.entry_type)).not.toContain("SALE_COST");
    expect(rows.map((r) => r.entry_type)).not.toContain("TOP_UP");
  });

  it("iPick BILL books the same -20,000 LBP SUPPLIER_PAYS_US commission", () => {
    const supplierId = seedSupplier(db, "iPick");

    repo.createTransaction({
      provider: "iPick",
      serviceType: "BILL",
      amount: 50_000,
      currency: "LBP",
      commission: 0,
      cost: 50_000,
      price: 50_000,
      paidByMethod: "CASH",
    });

    const rows = ledgerRows(db, supplierId);
    expect(rows).toHaveLength(1);
    expect(rows[0].entry_type).toBe("SUPPLIER_PAYS_US");
    expect(rows[0].amount_lbp).toBe(-20_000);
    expect(rows[0].amount_usd).toBe(0);
  });
});
