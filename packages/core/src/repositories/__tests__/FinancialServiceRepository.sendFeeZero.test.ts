/**
 * FinancialServiceRepository — "OMT Send with fee 0 is refused" (owner-
 * approved fix, 2026-10-02).
 *
 * The validator fix (`financial.sendFeeZero.test.ts`) stops the schema from
 * rejecting a SEND payload that carries an explicit `omtFee: 0`. This file
 * proves the REPOSITORY handles that same payload correctly once it gets
 * past the schema: drawer/supplier legs post with 0 commission, the stored
 * `omt_fee` column keeps the 0 (not NULL — see the `data.omtFee ?? null`
 * fix in `createTransaction`'s INSERT), and voiding the transaction nets
 * every ledger back to 0 (rule 20).
 *
 * RULE 17 — PROVEN FAILING-FIRST 2026-10-02: before the `data.omtFee ??
 * null` fix, case (c) below ("omt_fee persists as 0, not NULL") failed —
 * the column read back NULL for an explicit `omtFee: 0` payload (the
 * pre-fix `data.omtFee || null` collapses 0 and "absent" to the same
 * stored value). Cases (a)/(b)/(d) do not depend on that column fix (every
 * downstream consumer already reads `COALESCE(omt_fee, 0)`), so they were
 * never red — they pin the drawer/commission/void behavior this ticket
 * also asked to be checked, which was already correct.
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import {
  getSupplierRepository,
  resetSupplierRepository,
} from "../SupplierRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

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

jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: jest.fn() }),
  resetDebtService: jest.fn(),
}));

// Schema copied from FinancialServiceRepository.partner.test.ts (proven to
// support a full create + void round trip, including the supplier-ledger
// void cascade — see that file's own column-by-column comments for why each
// one is required).
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

    CREATE TABLE partners (
      tenant_id INTEGER DEFAULT 1,
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,
      phone       TEXT,
      notes       TEXT,
      is_active   INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
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
      partner_id            INTEGER REFERENCES partners(id),
      partner_mode          TEXT CHECK(partner_mode IN ('THROUGH', 'FOR')),
      commission_model INTEGER NOT NULL DEFAULT 0,
      receive_fee_model INTEGER NOT NULL DEFAULT 0,
      is_refunded           INTEGER NOT NULL DEFAULT 0,
      refunded_at           TEXT DEFAULT NULL
    );

    CREATE TABLE partner_ledger (
      tenant_id INTEGER DEFAULT 1,
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id       INTEGER NOT NULL REFERENCES partners(id),
      transaction_type TEXT NOT NULL,
      reference_table  TEXT,
      reference_id     INTEGER,
      amount           REAL NOT NULL,
      currency         TEXT NOT NULL DEFAULT 'USD',
      direction        TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      notes            TEXT,
      user_id          INTEGER REFERENCES users(id),
      settlement_method TEXT,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
      covered_amount   REAL NOT NULL DEFAULT 0
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
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      tenant_id INTEGER DEFAULT 1,
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id     INTEGER,
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
      provider     TEXT,
      is_active    INTEGER DEFAULT 1,
      is_system    INTEGER DEFAULT 0,
      module_key   TEXT,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO suppliers (name, provider, is_system) VALUES ('OMT', 'OMT', 1);

    CREATE TABLE supplier_ledger (
      tenant_id INTEGER DEFAULT 1,
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      entry_type  TEXT NOT NULL,
      amount_usd  REAL NOT NULL DEFAULT 0,
      amount_lbp  REAL NOT NULL DEFAULT 0,
      note        TEXT,
      created_by  INTEGER,
      transaction_id INTEGER,
      is_auto     INTEGER NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_at DATETIME,
      source_ref_table TEXT DEFAULT NULL,
      source_ref_id    INTEGER DEFAULT NULL,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE debt_ledger (
      tenant_id INTEGER DEFAULT 1,
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd       REAL NOT NULL DEFAULT 0,
      amount_lbp       REAL NOT NULL DEFAULT 0,
      transaction_id   INTEGER,
      note             TEXT,
      created_by       INTEGER,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

    INSERT INTO drawer_balances VALUES (1, 'General',    'USD', 1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General',    'LBP',    0, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_System', 'USD',  500, CURRENT_TIMESTAMP);
  `);

  return db;
}

function drawerBalance(
  db: Database.Database,
  drawer: string,
  currency = "USD",
): number {
  const row = db
    .prepare(
      "SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?",
    )
    .get(drawer, currency) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

function supplierIdByProvider(db: Database.Database, provider: string): number {
  const row = db
    .prepare("SELECT id FROM suppliers WHERE provider = ?")
    .get(provider) as { id: number };
  return row.id;
}

function supplierBalance(db: Database.Database, supplierId: number): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS bal FROM supplier_ledger
       WHERE supplier_id = ? AND is_refunded = 0`,
    )
    .get(supplierId) as { bal: number };
  return row.bal;
}

describe("FinancialServiceRepository — OMT SEND with fee 0 (owner-approved fix)", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    repo = new FinancialServiceRepository();
    resetTransactionRepository();
    resetSupplierRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  for (const omtServiceType of [
    "CASH_TO_BUSINESS",
    "CASH_TO_GOV",
    "OMT_CARD",
    "OGERO_MECANIQUE",
  ] as const) {
    it(`(a) ${omtServiceType} SEND, omtFee: 0 — posts the bare $100 to the PCD drawer (no fee leg)`, () => {
      const pcdBefore = drawerBalance(db, "OMT_System");

      const { id: fsId } = repo.createTransaction({
        provider: "OMT",
        serviceType: "SEND",
        amount: 100,
        currency: "USD",
        commission: 0,
        omtServiceType,
        omtFee: 0,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
        exchangeRate: 90000,
      });

      const pcdDelta = drawerBalance(db, "OMT_System") - pcdBefore;
      expect(pcdDelta).toBeCloseTo(100, 5);

      const fsRow = db
        .prepare("SELECT omt_fee, commission FROM financial_services WHERE id = ?")
        .get(fsId) as { omt_fee: number | null; commission: number };
      expect(fsRow.commission).toBe(0);
    });
  }

  it("(b) CASH_TO_BUSINESS SEND, omtFee: 0 — books the gross supplier TOP_UP at exactly $100 (no phantom fee)", () => {
    const omtId = supplierIdByProvider(db, "OMT");
    const balBefore = supplierBalance(db, omtId);

    repo.createTransaction({
      provider: "OMT",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 0,
      omtServiceType: "CASH_TO_BUSINESS",
      omtFee: 0,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
      exchangeRate: 90000,
    });

    const balAfter = supplierBalance(db, omtId);
    // grossOwedDelta = x + f - c = 100 + 0 - 0 = 100 (the shop owes the
    // supplier the transfer, no commission netted at creation).
    expect(balAfter - balBefore).toBeCloseTo(100, 5);
  });

  it("(c) CASH_TO_BUSINESS SEND, omtFee: 0 — persists omt_fee as 0, NOT NULL (fixed `?? null`, was `|| null`)", () => {
    const { id: fsId } = repo.createTransaction({
      provider: "OMT",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 0,
      omtServiceType: "CASH_TO_BUSINESS",
      omtFee: 0,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
      exchangeRate: 90000,
    });

    const row = db
      .prepare("SELECT omt_fee FROM financial_services WHERE id = ?")
      .get(fsId) as { omt_fee: number | null };
    expect(row.omt_fee).toBe(0);
    expect(row.omt_fee).not.toBeNull();
  });

  it("(d) CASH_TO_BUSINESS SEND, omtFee: 0 — void nets the PCD drawer AND the supplier ledger back to exactly 0 (rule 20)", () => {
    const omtId = supplierIdByProvider(db, "OMT");
    const pcdBefore = drawerBalance(db, "OMT_System");
    const supplierBefore = supplierBalance(db, omtId);

    const { id: fsId } = repo.createTransaction({
      provider: "OMT",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 0,
      omtServiceType: "CASH_TO_BUSINESS",
      omtFee: 0,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
      exchangeRate: 90000,
    });

    const parentTxn = getTransactionRepository().getBySourceId(
      "financial_services",
      fsId,
    );
    expect(parentTxn).not.toBeNull();

    getTransactionRepository().voidTransaction(parentTxn!.id, 1);

    expect(drawerBalance(db, "OMT_System")).toBeCloseTo(pcdBefore, 5);
    expect(supplierBalance(db, omtId)).toBeCloseTo(supplierBefore, 5);
  });
});
