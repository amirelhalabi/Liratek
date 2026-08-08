/**
 * BUG REPRO (owner report, 2026-08-08): "Validity is not decreasing when we
 * charge days from a shop line, only credits are. The shop line validity
 * days should be decreased by the charged amount — if we are charging 10
 * days to the customer, our shop line used to charge the customer validity
 * should decrease by the amount of days charged."
 *
 * This file proves that `RechargeRepository.processRecharge({type: "DAYS"})`
 * — the Telecom "Days" tab's backend, reached from
 * `frontend/src/features/recharge/components/TelecomForm.tsx` — NEVER
 * touches `carrier_lines.validity_expires_at` for the shop's own line,
 * regardless of how many days are charged to the customer.
 *
 * IMPORTANT CONTEXT for whoever fixes this: this is NOT a plain regression.
 * `docs/plans/done_plans/CARRIER_LINES_VALIDITY_PLAN.md` Phase 0 / decision
 * D12, ratified in an owner interview on 2026-08-06 (two days before this
 * report), explicitly rules the OPPOSITE: "a DAYS sale costs credits only —
 * the shop's expiry never moves" (quote: "We charge the customer by sending
 * SMS. Each SMS adds 10 days to the client's phone number. We lose $0.30 per
 * each ten days sent."). That ruling is shipped, commented in
 * `RechargeRepository.telecomStockLeg` ("the shop's own validity never
 * moves"), and guarded by `RechargeRepository.daysStockCost.test.ts`. The
 * 2026-08-08 report asks for the literal reverse of that ruling. This test
 * encodes the NEW request so its current-vs-desired gap is visible; it does
 * NOT contradict `daysStockCost.test.ts`, which only asserts the *credits*
 * leg (unaffected by this fix) and never asserts anything about validity.
 *
 * A full repository sweep (every call site of
 * `CarrierLineService.applyMovement` / `CarrierLineRepository.applyMovement`
 * in `packages/core/src`) confirms there is no OTHER path that decrements a
 * shop line's validity for a customer-facing sale either — self-charge
 * (`FinancialServiceRepository.selfChargeTelecomItem`) only ADDS validity
 * (shop restocking itself), `processTelecomCreditReturn`
 * ("ONLY_DAYS_RETURN") only ever adjusts credits, `CREDIT_BUYBACK` is
 * credits-only by D9, and `ClosingRepository`'s checkpoint passes
 * `validityDaysDelta: 0`. So this is category (a): never decremented, in
 * every flow, not merely one broken arm among several working ones.
 */

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

/** Owner's per-block cost: each SMS adds 10 days and costs the shop $0.30. */
const DAYS_PER_BLOCK = 10;
const COST_PER_BLOCK_USD = 0.3;
const CREDIT_COST_RATE_LBP = 85_000;

function daysCostUsd(days: number): number {
  return (days / DAYS_PER_BLOCK) * COST_PER_BLOCK_USD;
}

/** Far enough out that it is never "already expired" relative to real-world
 *  "today" for as long as this test file exists. */
const SHOP_LINE_EXPIRY = "2099-01-01";

/** `2099-01-01` minus 10 days, computed by an INDEPENDENT method (plain
 *  calendar subtraction, not the repository's own date-math helper) — rule 4:
 *  re-derive, don't trust the same formula that would also be under test. */
const EXPECTED_EXPIRY_AFTER_10_DAYS = "2098-12-22";
const EXPECTED_EXPIRY_AFTER_30_DAYS = "2098-12-02";

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
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      provider  TEXT
    );

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

    CREATE TABLE carrier_lines (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id           INTEGER DEFAULT 1,
      carrier             TEXT NOT NULL CHECK(carrier IN ('alfa','mtc')),
      phone_number        TEXT NOT NULL,
      label               TEXT,
      credits             REAL NOT NULL DEFAULT 0,
      validity_expires_at TEXT,
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

function setCreditCostRate(db: Database.Database, rateLbp: number): void {
  db.prepare(
    `INSERT INTO system_settings (tenant_id, key_name, value)
     VALUES (1, 'alfa_credit_cost_lbp', ?)
     ON CONFLICT(tenant_id, key_name) DO UPDATE SET value = excluded.value`,
  ).run(String(rateLbp));
}

function getLineById(
  db: Database.Database,
  id: number,
): { credits: number; validity_expires_at: string | null } {
  return db
    .prepare(
      `SELECT credits, validity_expires_at FROM carrier_lines WHERE id = ?`,
    )
    .get(id) as { credits: number; validity_expires_at: string | null };
}

describe("RechargeRepository — DAYS sale must decrement the shop's OWN carrier line validity (owner report 2026-08-08)", () => {
  let db: Database.Database;
  let repo: RechargeRepository;
  let carrierLineRepo: CarrierLineRepository;

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
    carrierLineRepo = new CarrierLineRepository();
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

  it("charging 10 days to a customer decreases the shop's MTC line validity by exactly 10 days", () => {
    setCreditCostRate(db, CREDIT_COST_RATE_LBP);

    const shopLine = carrierLineRepo.createLine({
      carrier: "mtc",
      phone_number: "03999999", // the SHOP'S OWN line — distinct from the customer below
      credits: 100,
      validity_expires_at: SHOP_LINE_EXPIRY,
    });
    expect(shopLine.is_primary).toBe(1); // sanity: first active line auto-primary

    const before = getLineById(db, shopLine.id);
    expect(before.validity_expires_at).toBe(SHOP_LINE_EXPIRY);

    const result = repo.processRecharge({
      provider: "MTC",
      type: "DAYS",
      amount: 10,
      cost: daysCostUsd(10) * CREDIT_COST_RATE_LBP, // $0.30 → LBP
      price: 100_000,
      currency: "LBP",
      paid_by_method: "CASH",
      phoneNumber: "03123456", // the CUSTOMER's own phone — different number
      userId: 1,
    });
    expect(result.success).toBe(true);

    const after = getLineById(db, shopLine.id);

    // THE BUG: today this reads unchanged (`SHOP_LINE_EXPIRY`), not decreased
    // by 10 days. Owner: "if we are charging 10 days to the customer, our
    // shop line ... validity should decrease by the amount of days charged."
    expect(after.validity_expires_at).toBe(EXPECTED_EXPIRY_AFTER_10_DAYS);
  });

  it("charging 30 days to a customer decreases the shop's Alfa line validity by exactly 30 days", () => {
    setCreditCostRate(db, CREDIT_COST_RATE_LBP);

    const shopLine = carrierLineRepo.createLine({
      carrier: "alfa",
      phone_number: "70999999",
      credits: 100,
      validity_expires_at: SHOP_LINE_EXPIRY,
    });

    repo.processRecharge({
      provider: "Alfa",
      type: "DAYS",
      amount: 30,
      cost: daysCostUsd(30) * CREDIT_COST_RATE_LBP,
      price: 250_000,
      currency: "LBP",
      paid_by_method: "CASH",
      phoneNumber: "71123456",
      userId: 1,
    });

    const after = getLineById(db, shopLine.id);
    expect(after.validity_expires_at).toBe(EXPECTED_EXPIRY_AFTER_30_DAYS);
  });

  it("credits DID move (the documented, already-working half) while validity should ALSO have moved (the missing half)", () => {
    setCreditCostRate(db, CREDIT_COST_RATE_LBP);

    const shopLine = carrierLineRepo.createLine({
      carrier: "mtc",
      phone_number: "03999998",
      credits: 100,
      validity_expires_at: SHOP_LINE_EXPIRY,
    });

    const mtcDrawerBefore = (
      db
        .prepare(
          `SELECT balance FROM drawer_balances WHERE drawer_name = 'MTC' AND currency_code = 'USD'`,
        )
        .get() as { balance: number }
    ).balance;

    repo.processRecharge({
      provider: "MTC",
      type: "DAYS",
      amount: 10,
      cost: daysCostUsd(10) * CREDIT_COST_RATE_LBP,
      price: 100_000,
      currency: "LBP",
      paid_by_method: "CASH",
      phoneNumber: "03123457",
      userId: 1,
    });

    const mtcDrawerAfter = (
      db
        .prepare(
          `SELECT balance FROM drawer_balances WHERE drawer_name = 'MTC' AND currency_code = 'USD'`,
        )
        .get() as { balance: number }
    ).balance;

    // Credits (the drawer's USD balance) DID move — owner: "only credits are
    // [decreasing]". This assertion documents that half already works.
    expect(mtcDrawerAfter).toBeCloseTo(mtcDrawerBefore - 0.3, 6);

    // Validity — the missing half. The line's OWN `credits` column (as
    // opposed to the drawer sum) is untouched by this flow either way (D1/
    // Outbound Ticket D — pre-existing, out of scope here); the point of this
    // assertion is validity specifically.
    const after = getLineById(db, shopLine.id);
    expect(after.validity_expires_at).toBe(EXPECTED_EXPIRY_AFTER_10_DAYS);
  });
});
