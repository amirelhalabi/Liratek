/**
 * RechargeRepository — a DAYS sale costs the DAYS COST, never the day count
 * (CARRIER_LINES_VALIDITY_PLAN.md Phase 0).
 *
 * The bug this file guards: `processRecharge` deducted
 * `-Math.abs(data.amount)` from the provider (MTC/Alfa) credit drawer for
 * EVERY recharge type. `data.amount` is the USD face value of the credit sent
 * for every type EXCEPT `DAYS`, where it is a **day count** — so selling 30
 * days debited the MTC drawer $30.00 instead of the $0.90 the three SMSes
 * actually cost. A 33x over-deduction on every days sale.
 *
 * Owner ruling (2026-08-06): "We charge the customer by sending SMS. Each SMS
 * adds 10 days to the client's phone number. We lose $0.30 per each ten days
 * sent." The shop's own validity never moves.
 *
 * The amount debited is the operator-submitted `data.cost` (plan §0.3 — the
 * Days tab's `Cost ($)` field is editable, so recomputing from the day count
 * would make the drawer and the profit stamp disagree about the same sale).
 * The Days tab submits in LBP (`cost = costUsd × alfa_credit_cost_lbp`), so the
 * repository inverts at that SAME tenant rate — never the USD/LBP sell rate,
 * which would land on a different number than the operator saw.
 *
 * Rule 20: the debit is a `payments` row, so `_reversePayments` owns its
 * reversal — proved by the void case at the bottom.
 */

import Database from "better-sqlite3";
import { RechargeRepository } from "../RechargeRepository";
import { TransactionRepository } from "../TransactionRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetDebtService } from "../../services/DebtService";
import { resetDebtRepository } from "../DebtRepository";

/**
 * The rate the Days tab multiplies its `Cost ($)` field by before submitting:
 * the `alfa_credit_cost_lbp` setting (Settings → Shop Config), or 85,000 when
 * unset. NOT `telecom_credit_cost_rate_lbp` — a different key for a different
 * acquisition channel that nothing keeps in sync with this one.
 */
const CREDIT_COST_RATE_LBP = 85_000;

/** Owner's per-block cost: each SMS adds 10 days and costs the shop $0.30. */
const DAYS_PER_BLOCK = 10;
const COST_PER_BLOCK_USD = 0.3;

/** $0.90 for 30 days — the figure the whole file is about. */
const THIRTY_DAY_COST_USD = (30 / DAYS_PER_BLOCK) * COST_PER_BLOCK_USD;

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
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
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
      edited_by               TEXT DEFAULT NULL,
      edited_at               TEXT DEFAULT NULL,
      is_refunded             INTEGER DEFAULT 0,
      refunded_at             TEXT DEFAULT NULL
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

function drawer(db: Database.Database, name: string, currency: string): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`,
    )
    .get(name, currency) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

/** Every leg posted against a provider stock drawer, in insertion order. */
function providerLegs(
  db: Database.Database,
  drawerName: string,
): Array<{ method: string; amount: number; note: string | null }> {
  return db
    .prepare(
      `SELECT method, amount, note FROM payments
       WHERE drawer_name = ? AND currency_code = 'USD' ORDER BY id ASC`,
    )
    .all(drawerName) as Array<{
    method: string;
    amount: number;
    note: string | null;
  }>;
}

function txnIdFor(
  db: Database.Database,
  sourceTable: string,
  sourceId: number,
): number {
  const row = db
    .prepare(
      `SELECT id FROM transactions WHERE source_table = ? AND source_id = ?`,
    )
    .get(sourceTable, sourceId) as { id: number };
  return row.id;
}

function setCreditCostRate(db: Database.Database, rateLbp: number): void {
  db.prepare(
    `INSERT INTO system_settings (tenant_id, key_name, value)
     VALUES (1, 'alfa_credit_cost_lbp', ?)
     ON CONFLICT(tenant_id, key_name) DO UPDATE SET value = excluded.value`,
  ).run(String(rateLbp));
}

describe("RechargeRepository — DAYS sale debits the days cost, not the day count", () => {
  let db: Database.Database;
  let repo: RechargeRepository;
  let txnRepo: TransactionRepository;

  beforeEach(() => {
    db = createTestDb();
    setTestDb(db);
    initFixedTenantContext(1);
    resetTransactionRepository();
    resetDebtService();
    resetDebtRepository();
    repo = new RechargeRepository();
    txnRepo = new TransactionRepository();
  });

  afterEach(() => {
    clearTestDb();
    resetTenantContext();
    resetTransactionRepository();
    resetDebtService();
    resetDebtRepository();
    db.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // The headline bug
  // ═══════════════════════════════════════════════════════════════════════════

  it("30 days sold moves the MTC drawer by the $0.90 days cost, NOT by 30", () => {
    setCreditCostRate(db, CREDIT_COST_RATE_LBP);
    const before = drawer(db, "MTC", "USD");

    // Exactly what the Days tab submits: 30 days, cost typed as $0.90 and sent
    // in LBP at the tenant credit-cost rate, priced 250,000 LBP.
    const result = repo.processRecharge({
      provider: "MTC",
      type: "DAYS",
      amount: 30,
      cost: THIRTY_DAY_COST_USD * CREDIT_COST_RATE_LBP, // 76,500 LBP
      price: 250_000,
      currency: "LBP",
      paid_by_method: "CASH",
      phoneNumber: "03123456",
      userId: 1,
    });

    expect(result.success).toBe(true);
    // Pre-fix this reads `before - 30`.
    expect(drawer(db, "MTC", "USD")).toBeCloseTo(before - 0.9, 6);
  });

  it("posts exactly ONE provider leg for a DAYS sale — the labelled days cost, no 'Telecom balance sent' row", () => {
    setCreditCostRate(db, CREDIT_COST_RATE_LBP);

    repo.processRecharge({
      provider: "MTC",
      type: "DAYS",
      amount: 30,
      cost: THIRTY_DAY_COST_USD * CREDIT_COST_RATE_LBP,
      price: 250_000,
      currency: "LBP",
      paid_by_method: "CASH",
      phoneNumber: "03123457",
      userId: 1,
    });

    const legs = providerLegs(db, "MTC");
    expect(legs).toHaveLength(1);
    expect(legs[0].method).toBe("VALIDITY_DAYS_COST");
    expect(legs[0].amount).toBeCloseTo(-0.9, 6);
    expect(legs[0].note).toContain("30");
    // The day count must never reach the drawer under any label.
    expect(legs.some((l) => l.note === "Telecom balance sent")).toBe(false);
  });

  it("inverts the submitted LBP cost at the tenant's credit-cost rate, not the USD/LBP sell rate", () => {
    // 90,000 ≠ the 89,500 USD/LBP sell-rate fallback: inverting at the wrong
    // rate lands on $0.905, not $0.90.
    setCreditCostRate(db, 90_000);
    const before = drawer(db, "Alfa", "USD");

    repo.processRecharge({
      provider: "Alfa",
      type: "DAYS",
      amount: 30,
      cost: THIRTY_DAY_COST_USD * 90_000, // 81,000 LBP
      price: 250_000,
      currency: "LBP",
      paid_by_method: "CASH",
      phoneNumber: "71123456",
      userId: 1,
    });

    expect(drawer(db, "Alfa", "USD")).toBeCloseTo(before - 0.9, 6);
  });

  it("honours an operator-edited Cost ($) instead of recomputing from the day count (plan §0.3)", () => {
    setCreditCostRate(db, CREDIT_COST_RATE_LBP);
    const before = drawer(db, "MTC", "USD");

    // Operator overrode the cost to $1.20 for 30 days.
    repo.processRecharge({
      provider: "MTC",
      type: "DAYS",
      amount: 30,
      cost: 1.2 * CREDIT_COST_RATE_LBP, // 102,000 LBP
      price: 250_000,
      currency: "LBP",
      paid_by_method: "CASH",
      phoneNumber: "03123458",
      userId: 1,
    });

    expect(drawer(db, "MTC", "USD")).toBeCloseTo(before - 1.2, 6);
  });

  it("treats a USD-priced DAYS sale's cost as already-USD (no rate inversion)", () => {
    setCreditCostRate(db, CREDIT_COST_RATE_LBP);
    const before = drawer(db, "MTC", "USD");

    repo.processRecharge({
      provider: "MTC",
      type: "DAYS",
      amount: 30,
      cost: 0.9,
      price: 3,
      currency: "USD",
      paid_by_method: "CASH",
      phoneNumber: "03123459",
      userId: 1,
    });

    expect(drawer(db, "MTC", "USD")).toBeCloseTo(before - 0.9, 6);
  });

  it("posts no provider leg at all when the days cost is zero", () => {
    setCreditCostRate(db, CREDIT_COST_RATE_LBP);
    const before = drawer(db, "MTC", "USD");

    repo.processRecharge({
      provider: "MTC",
      type: "DAYS",
      amount: 30,
      cost: 0,
      price: 250_000,
      currency: "LBP",
      paid_by_method: "CASH",
      phoneNumber: "03123460",
      userId: 1,
    });

    expect(drawer(db, "MTC", "USD")).toBeCloseTo(before, 6);
    expect(providerLegs(db, "MTC")).toHaveLength(0);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // The other union members must NOT change — their `amount` really is USD
  // ═══════════════════════════════════════════════════════════════════════════

  it("CREDIT_TRANSFER still consumes the credit face value plus the SMS fee", () => {
    const before = drawer(db, "MTC", "USD");

    repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_TRANSFER",
      amount: 3,
      cost: 2.5,
      price: 3,
      currency: "USD",
      paid_by_method: "CASH",
      phoneNumber: "03000001",
      userId: 1,
    });

    // -3.00 stock, -0.16 SMS
    expect(drawer(db, "MTC", "USD")).toBeCloseTo(before - 3.16, 6);
    const legs = providerLegs(db, "MTC");
    expect(legs.map((l) => l.method)).toEqual(["MTC", "SMS_COST"]);
  });

  it("ALFA_GIFT still consumes its USD face value 1:1", () => {
    const before = drawer(db, "Alfa", "USD");

    repo.processRecharge({
      provider: "Alfa",
      type: "ALFA_GIFT",
      amount: 3.5,
      cost: 3,
      price: 3.5,
      currency: "USD",
      paid_by_method: "CASH",
      phoneNumber: "70111111",
      userId: 1,
    });

    expect(drawer(db, "Alfa", "USD")).toBeCloseTo(before - 3.5, 6);
  });

  it("VOUCHER and TOP_UP still consume their USD face value 1:1", () => {
    const beforeVoucher = drawer(db, "MTC", "USD");
    repo.processRecharge({
      provider: "MTC",
      type: "VOUCHER",
      amount: 5,
      cost: 4,
      price: 5,
      currency: "USD",
      paid_by_method: "CASH",
      userId: 1,
    });
    expect(drawer(db, "MTC", "USD")).toBeCloseTo(beforeVoucher - 5, 6);

    const beforeTopUp = drawer(db, "MTC", "USD");
    repo.processRecharge({
      provider: "MTC",
      type: "TOP_UP",
      amount: 5,
      cost: 4,
      price: 5,
      currency: "USD",
      paid_by_method: "CASH",
      userId: 1,
    });
    expect(drawer(db, "MTC", "USD")).toBeCloseTo(beforeTopUp - 5, 6);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Rule 20 — the days-cost leg's reversal owner is _reversePayments
  // ═══════════════════════════════════════════════════════════════════════════

  it("voiding a DAYS sale returns the MTC drawer (and General) to their pre-sale values", () => {
    setCreditCostRate(db, CREDIT_COST_RATE_LBP);
    const mtcBefore = drawer(db, "MTC", "USD");
    const generalBefore = drawer(db, "General", "LBP");

    const result = repo.processRecharge({
      provider: "MTC",
      type: "DAYS",
      amount: 30,
      cost: THIRTY_DAY_COST_USD * CREDIT_COST_RATE_LBP,
      price: 250_000,
      currency: "LBP",
      paid_by_method: "CASH",
      phoneNumber: "03123461",
      userId: 1,
    });
    expect(result.success).toBe(true);

    expect(drawer(db, "MTC", "USD")).toBeCloseTo(mtcBefore - 0.9, 6);
    expect(drawer(db, "General", "LBP")).toBeCloseTo(
      generalBefore + 250_000,
      6,
    );

    txnRepo.voidTransaction(txnIdFor(db, "recharges", result.id as number), 1);

    expect(drawer(db, "MTC", "USD")).toBeCloseTo(mtcBefore, 6);
    expect(drawer(db, "General", "LBP")).toBeCloseTo(generalBefore, 6);
  });
});
