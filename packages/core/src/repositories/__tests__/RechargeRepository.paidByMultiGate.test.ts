/**
 * RechargeRepository — CARRIER_LINES_VALIDITY_PLAN.md Phase 7 backend guard.
 *
 * THE BUG: `paid_by_method: "MULTI"` is only ever a truthful value when the
 * caller actually split the payment into 2+ legs (Recharge/index.tsx's
 * `derivePaidByMethod`, wired in this same phase — mirrors the crypto /
 * FinancialForm / KatchForm pattern). It is never a real payment method.
 * Before this guard, if `payments[]` arrived empty/absent anyway (a REST
 * caller whose legs got stripped, or any caller that lies about having
 * split), `processRecharge`'s legacy single-method fallback treated "MULTI"
 * as if it were a real method: `isDrawerAffectingMethod("MULTI")` resolves
 * true (it isn't in the NON_DRAWER_METHODS set) and
 * `paymentMethodToDrawerName("MULTI")` falls back to "General" (unknown
 * method) — so the WHOLE `data.price` silently posted into General instead
 * of being split across (or rejected for lacking) the real legs.
 *
 * On desktop this is unreachable: `MultiPaymentInput` always seeds >= 1 leg,
 * so `paid_by_method` can only read "MULTI" when `payments` genuinely holds
 * 2+ legs (rule 16 territory). The residual risk is a REST/legacy caller
 * that computes "MULTI" itself but never attaches the legs.
 *
 * Rule 17 (prove failing-first): see the companion `it.failing`-style note
 * below each assertion — this file was run once with the guard commented out
 * in RechargeRepository.ts and the "guard" tests failed (the drawer moved,
 * `result.success` was `true`) before the guard was added back.
 */

import Database from "better-sqlite3";
import { RechargeRepository } from "../RechargeRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
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

jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: jest.fn() }),
  resetDebtService: jest.fn(),
}));

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE recharges (
      tenant_id INTEGER DEFAULT 1,
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      carrier                TEXT NOT NULL,
      recharge_type          TEXT NOT NULL,
      amount                 REAL NOT NULL,
      cost                   REAL NOT NULL DEFAULT 0,
      price                  REAL NOT NULL DEFAULT 0,
      default_price_to_client REAL,
      currency_code          TEXT DEFAULT 'USD',
      paid_by                TEXT DEFAULT 'CASH',
      phone_number           TEXT,
      client_id              INTEGER,
      client_name            TEXT,
      note                   TEXT,
      created_by             INTEGER DEFAULT 1,
      created_at             DATETIME DEFAULT CURRENT_TIMESTAMP,
      edited_by              TEXT,
      edited_at              TEXT
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

    CREATE TABLE clients (
      tenant_id INTEGER DEFAULT 1,
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name    TEXT NOT NULL,
      phone_number TEXT,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
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
      due_date         TEXT,
      created_by       INTEGER,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE exchange_rates (
      to_code    TEXT,
      sell_rate  REAL,
      market_rate REAL
    );
    INSERT INTO exchange_rates (to_code, sell_rate) VALUES ('LBP', 90000);

    INSERT INTO drawer_balances VALUES (1, 'MTC',     'USD', 1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Alfa',    'USD', 1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General', 'USD', 5000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General', 'LBP', 500000000, CURRENT_TIMESTAMP);
  `);

  return db;
}

function drawerBalance(
  db: Database.Database,
  drawer: string,
  currency: string,
): number {
  const row = db
    .prepare(
      "SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?",
    )
    .get(drawer, currency) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

function counts(db: Database.Database): {
  recharges: number;
  transactions: number;
  payments: number;
} {
  const one = (table: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number })
      .n;
  return {
    recharges: one("recharges"),
    transactions: one("transactions"),
    payments: one("payments"),
  };
}

describe("RechargeRepository — Phase 7 MULTI-without-legs guard", () => {
  let db: Database.Database;
  let repo: RechargeRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetTransactionRepository();
    repo = new RechargeRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  it("REJECTS paid_by_method MULTI with an ABSENT payments[] — atomic, nothing persists, General untouched", () => {
    const before = counts(db);
    const generalUsdBefore = drawerBalance(db, "General", "USD");

    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_TRANSFER",
      amount: 6,
      cost: 5.0,
      price: 6.0,
      currency: "USD",
      phoneNumber: "03000199",
      paid_by_method: "MULTI",
      // payments intentionally omitted — the exact shape a REST caller
      // whose legs got stripped (or a buggy client) would produce.
      userId: 1,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/MULTI/);

    // Pre-fix, this is exactly where the bug landed: the WHOLE $6 price
    // posted into General/USD via the "unknown method → General" fallback,
    // instead of being rejected for lacking the legs it claimed to have.
    expect(drawerBalance(db, "General", "USD")).toBe(generalUsdBefore);
    expect(counts(db)).toEqual(before);
  });

  it("REJECTS paid_by_method MULTI with an EMPTY payments[] array", () => {
    const generalUsdBefore = drawerBalance(db, "General", "USD");

    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_TRANSFER",
      amount: 6,
      cost: 5.0,
      price: 6.0,
      currency: "USD",
      phoneNumber: "03000198",
      paid_by_method: "MULTI",
      payments: [],
      userId: 1,
    });

    expect(result.success).toBe(false);
    expect(drawerBalance(db, "General", "USD")).toBe(generalUsdBefore);
  });

  it("control: MULTI with REAL 2+ legs still reconciles and posts normally", () => {
    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_TRANSFER",
      amount: 6,
      cost: 5.0,
      price: 6.0,
      currency: "USD",
      phoneNumber: "03000197",
      paid_by_method: "MULTI",
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 3 },
        { method: "CASH", currencyCode: "LBP", amount: 270_000 },
      ],
      userId: 1,
    });

    expect(result.success).toBe(true);
    expect(drawerBalance(db, "General", "USD")).toBe(5000 + 3);
    expect(drawerBalance(db, "General", "LBP")).toBe(500000000 + 270_000);
  });

  it("control: a legitimate single-leg/legacy caller (paid_by_method CASH, no payments[]) is UNAFFECTED", () => {
    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_TRANSFER",
      amount: 3,
      cost: 2.5,
      price: 3.0,
      paid_by_method: "CASH",
      phoneNumber: "03000196",
      userId: 1,
    });

    expect(result.success).toBe(true);
  });

  it("control: a real single non-CASH method with no payments[] is also unaffected (e.g. CUSTOMER_ACCOUNT legacy debt sale)", () => {
    db.prepare(
      "INSERT INTO clients (id, full_name, phone_number) VALUES (1, 'Test Client', '03000000')",
    ).run();

    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_TRANSFER",
      amount: 3,
      cost: 2.5,
      price: 3.0,
      currency: "USD",
      paid_by_method: "CUSTOMER_ACCOUNT",
      clientId: 1,
      phoneNumber: "03000195",
      userId: 1,
    });

    expect(result.success).toBe(true);
    const debt = db
      .prepare("SELECT amount_usd FROM debt_ledger WHERE client_id = 1")
      .get() as { amount_usd: number } | undefined;
    expect(debt?.amount_usd).toBe(3);
  });
});
