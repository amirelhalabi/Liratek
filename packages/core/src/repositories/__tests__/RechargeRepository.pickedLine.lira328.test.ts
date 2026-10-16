import Database from "better-sqlite3";
import { RechargeRepository } from "../RechargeRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetDebtService } from "../../services/DebtService";
import { resetDebtRepository } from "../DebtRepository";
import {
  CarrierLineRepository,
  resetCarrierLineRepository,
} from "../CarrierLineRepository";
import { resetCarrierLineMovementRepository } from "../CarrierLineMovementRepository";
import { resetCarrierLineService } from "../../services/CarrierLineService";
import { getTransactionRepository } from "../TransactionRepository";

const FUTURE_EXPIRY = "2099-01-01";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      role     TEXT DEFAULT 'staff'
    );
    INSERT INTO users (id, username, role) VALUES (1, 'admin', 'admin');

    CREATE TABLE clients (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name    TEXT NOT NULL,
      phone_number TEXT,
      notes        TEXT,
      tenant_id    INTEGER DEFAULT 1,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE system_settings (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id  INTEGER NOT NULL DEFAULT 1,
      key_name   TEXT NOT NULL,
      value      TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, key_name)
    );

    CREATE TABLE transactions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      type          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table  TEXT,
      source_id     INTEGER,
      user_id       INTEGER,
      amount_usd    REAL NOT NULL DEFAULT 0,
      amount_lbp    REAL NOT NULL DEFAULT 0,
      profit_usd    REAL NOT NULL DEFAULT 0,
      profit_lbp    REAL NOT NULL DEFAULT 0,
      extra_usd REAL NOT NULL DEFAULT 0,
      extra_lbp REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id     INTEGER,
      client_name   TEXT,
      client_phone  TEXT,
      reverses_id   INTEGER,
      summary       TEXT,
      metadata_json TEXT,
      device_id     TEXT,
      tenant_id     INTEGER DEFAULT 1,
      created_at    TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id     INTEGER,
      method         TEXT NOT NULL,
      drawer_name    TEXT NOT NULL,
      currency_code  TEXT NOT NULL,
      amount         REAL NOT NULL,
      note           TEXT,
      created_by     INTEGER,
      tenant_id      INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id     INTEGER NOT NULL DEFAULT 1,
      drawer_name   TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance       REAL NOT NULL DEFAULT 0,
      updated_at    TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'MTC',     'USD', 1000);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'Alfa',    'USD', 1000);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'General', 'USD', 5000);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'General', 'LBP', 100000000);

    -- Needed by the void path (_cancelDebt / _markSourceRefunded); empty here.
    CREATE TABLE debt_ledger (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd       REAL NOT NULL DEFAULT 0,
      amount_lbp       REAL NOT NULL DEFAULT 0,
      transaction_id   INTEGER,
      session_id       INTEGER,
      note             TEXT,
      due_date         TEXT,
      created_by       INTEGER,
      is_refunded      INTEGER DEFAULT 0,
      refunded_at      TEXT,
      covered_usd      REAL NOT NULL DEFAULT 0,
      covered_lbp      REAL NOT NULL DEFAULT 0,
      tenant_id        INTEGER DEFAULT 1,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE financial_services (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      provider  TEXT
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

    CREATE TABLE sales (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id              INTEGER DEFAULT 1,
      final_amount_usd       REAL NOT NULL DEFAULT 0,
      paid_usd               REAL NOT NULL DEFAULT 0,
      paid_lbp               REAL NOT NULL DEFAULT 0,
      exchange_rate_snapshot REAL,
      status                 TEXT NOT NULL DEFAULT 'completed',
      created_at             TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE recharges (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id               INTEGER DEFAULT 1,
      carrier                 TEXT NOT NULL,
      recharge_type           TEXT NOT NULL DEFAULT 'CREDIT_TRANSFER',
      amount                  REAL NOT NULL,
      cost                    REAL NOT NULL DEFAULT 0,
      price                   REAL NOT NULL DEFAULT 0,
      default_price_to_client REAL DEFAULT NULL,
      currency_code           TEXT NOT NULL DEFAULT 'USD',
      paid_by                 TEXT DEFAULT 'CASH',
      phone_number            TEXT,
      client_id               INTEGER,
      client_name             TEXT,
      note                    TEXT,
      created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by              INTEGER DEFAULT 1,
      edited_by                TEXT DEFAULT NULL,
      edited_at               TEXT DEFAULT NULL,
      is_refunded             INTEGER DEFAULT 0,
      refunded_at             TEXT DEFAULT NULL
    );

    CREATE TABLE expenses (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id         INTEGER DEFAULT 1,
      description       TEXT,
      category          TEXT,
      expense_type      TEXT,
      amount_usd        DECIMAL(10, 2),
      amount_lbp        DECIMAL(15, 2),
      paid_by_method    TEXT DEFAULT 'CASH',
      status            TEXT NOT NULL DEFAULT 'active',
      expense_date      DATETIME DEFAULT CURRENT_TIMESTAMP,
      note              TEXT DEFAULT NULL,
      edited_by         TEXT DEFAULT NULL,
      edited_at         TEXT DEFAULT NULL,
      is_refunded       INTEGER DEFAULT 0,
      refunded_at       TEXT DEFAULT NULL,
      source_ref_table  TEXT DEFAULT NULL,
      source_ref_id     INTEGER DEFAULT NULL,
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE carrier_lines (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id           INTEGER DEFAULT 1,
      carrier             TEXT NOT NULL CHECK(carrier IN ('alfa','mtc')),
      phone_number        TEXT NOT NULL,
      label               TEXT,
      credits             REAL NOT NULL DEFAULT 0,
      validity_expires_at TEXT,
      days_owed           INTEGER NOT NULL DEFAULT 0,
      notes               TEXT,
      is_active           INTEGER NOT NULL DEFAULT 1,
      is_primary          INTEGER NOT NULL DEFAULT 0,
      created_at          TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at          TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_carrier_lines_one_primary_per_carrier
      ON carrier_lines(tenant_id, carrier)
      WHERE is_primary = 1;

    CREATE TABLE carrier_line_movements (
      id                            INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id                     INTEGER,
      carrier_line_id               INTEGER NOT NULL,
      transaction_id                INTEGER,
      credits_delta                 REAL NOT NULL DEFAULT 0,
      validity_days_delta           INTEGER NOT NULL DEFAULT 0,
      previous_validity_expires_at  TEXT,
      days_owed_delta               INTEGER NOT NULL DEFAULT 0,
      previous_days_owed            INTEGER NOT NULL DEFAULT 0,
      reason                        TEXT NOT NULL,
      is_reversed                   INTEGER NOT NULL DEFAULT 0,
      created_at                    DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at                    DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

function setTestDb(db: Database.Database): void {
  (
    globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
  ).__LIRATEK_TEST_DB__ = db;
}

function clearTestDb(): void {
  delete (globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database })
    .__LIRATEK_TEST_DB__;
}

function getLineCredits(db: Database.Database, id: number): number {
  return (
    db.prepare(`SELECT credits FROM carrier_lines WHERE id = ?`).get(id) as {
      credits: number;
    }
  ).credits;
}

function drawerBalance(
  db: Database.Database,
  drawer: string,
  currency = "USD",
): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`,
    )
    .get(drawer, currency) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

describe("RechargeRepository — a sale moves credits on the line the cashier picked (LIRA-328)", () => {
  let db: Database.Database;
  let repo: RechargeRepository;
  let lines: CarrierLineRepository;

  beforeEach(() => {
    db = createTestDb();
    setTestDb(db);
    initFixedTenantContext(1);
    resetTransactionRepository();
    resetDebtService();
    resetDebtRepository();
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
    resetCarrierLineService();
    repo = new RechargeRepository();
    lines = new CarrierLineRepository();
  });

  afterEach(() => {
    clearTestDb();
    resetTenantContext();
    resetTransactionRepository();
    resetDebtService();
    resetDebtRepository();
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
    resetCarrierLineService();
    db.close();
  });

  const sale = (extra: Record<string, unknown> = {}) =>
    repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_TRANSFER",
      amount: 3,
      cost: 2.5,
      price: 3,
      currency: "USD",
      paid_by_method: "CASH",
      phoneNumber: "03123456",
      userId: 1,
      ...extra,
    } as Parameters<RechargeRepository["processRecharge"]>[0]);

  function twoLines() {
    const primary = lines.createLine(
      { carrier: "mtc", phone_number: "03111111", credits: 50, validity_expires_at: FUTURE_EXPIRY },
      1,
    );
    const second = lines.createLine(
      { carrier: "mtc", phone_number: "03222222", credits: 20, validity_expires_at: FUTURE_EXPIRY },
      1,
    );
    expect(primary.is_primary).toBe(1);
    expect(second.is_primary).toBe(0);
    return { primary, second };
  }

  it("takes the credits from the picked (non-primary) line, not the primary", () => {
    const { primary, second } = twoLines();
    const r = sale({ carrier_line_id: second.id });
    expect(r.success).toBe(true);
    expect(getLineCredits(db, primary.id)).toBe(50);
    expect(getLineCredits(db, second.id)).toBeCloseTo(16.84, 6);
  });

  it("without a picked line it still uses the primary (unchanged)", () => {
    const { primary, second } = twoLines();
    expect(sale().success).toBe(true);
    expect(getLineCredits(db, primary.id)).toBeCloseTo(46.84, 6);
    expect(getLineCredits(db, second.id)).toBe(20);
  });

  it("refuses a picked line of the other carrier, and writes nothing", () => {
    twoLines();
    const alfa = lines.createLine(
      { carrier: "alfa", phone_number: "03333333", credits: 10, validity_expires_at: FUTURE_EXPIRY },
      1,
    );
    const before = drawerBalance(db, "MTC");
    const r = sale({ carrier_line_id: alfa.id });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/line/i);
    expect(drawerBalance(db, "MTC")).toBe(before);
  });

  it("refuses an unknown line id", () => {
    twoLines();
    const r = sale({ carrier_line_id: 9999 });
    expect(r.success).toBe(false);
  });
});
