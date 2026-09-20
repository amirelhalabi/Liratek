/**
 * Owner ruling (2026-09-21, LIRA-194 follow-on) — Change 3: `RECHARGE_TOPUP`
 * (the client-funded Whish App top-up's fee-as-profit, `RechargeRepository
 * .topUpFromClient`) must reach a `PROFIT_TXN_TYPES`-gated profit surface —
 * before this change it reached NONE (By User, By Client, deferred profit
 * all excluded it, since `PROFIT_TXN_TYPES` — ProfitRepository.ts — never
 * listed the type at all).
 *
 * Deliberately narrow proof: this file only proves the type is now counted
 * by a `PROFIT_TXN_TYPES`-gated query (`getByUser`). It does NOT touch
 * `getRechargesByCurrency`/`getRechargesByCarrier` — those hardcode
 * `t.type = 'RECHARGE'` and are explicitly OUT of scope (a credit-buy top-up
 * is not a RECHARGE sale; folding it into that section's revenue/cost
 * columns would distort them — see the `PROFIT_TXN_TYPES` doc comment).
 *
 * Fixture pattern copied from `ProfitRepository.tenantIsolation.test.ts`
 * (in-memory better-sqlite3 + `__LIRATEK_TEST_DB__` + `runWithTenant`) —
 * `getByUser`'s SQL text references `financial_services`/`sales` inside CASE
 * branches unconditionally, so those tables must exist even though this
 * fixture's one transaction never touches them.
 *
 * Rule 17: proven to FAIL on pre-fix code by temporarily reverting
 * `PROFIT_TXN_TYPES` to omit `'RECHARGE_TOPUP'` and re-running this file —
 * see the accompanying report for the observed failure message.
 */

import Database from "better-sqlite3";
import { ProfitRepository } from "../ProfitRepository";
import { runWithTenant } from "../../db/tenantContext";

const D = "2026-07-01 10:00:00";
const FROM = "2026-07-01 00:00:00";
const TO = "2026-07-01 23:59:59";

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO tenants (id, name, slug) VALUES (1, 'One', 'one');

    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      username TEXT NOT NULL
    );

    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      full_name TEXT,
      phone_number TEXT
    );

    CREATE TABLE sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      status TEXT,
      final_amount_usd REAL DEFAULT 0,
      paid_usd REAL DEFAULT 0,
      paid_lbp REAL DEFAULT 0,
      exchange_rate_snapshot REAL DEFAULT 90000,
      created_at TEXT
    );

    CREATE TABLE sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      sale_id INTEGER,
      product_id INTEGER,
      sold_price_usd REAL DEFAULT 0,
      cost_price_snapshot_usd REAL DEFAULT 0,
      quantity INTEGER DEFAULT 1,
      is_refunded INTEGER DEFAULT 0
    );

    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER,
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      profit_usd REAL DEFAULT 0,
      profit_lbp REAL DEFAULT 0,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
      created_at TEXT
    );

    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      provider TEXT,
      omt_service_type TEXT,
      amount REAL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      commission REAL DEFAULT 0,
      omt_fee REAL,
      cost REAL DEFAULT 0,
      price REAL DEFAULT 0,
      is_settled INTEGER DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      payment_method_fee REAL DEFAULT 0,
      created_at TEXT
    , refunded_at TEXT DEFAULT NULL);

    CREATE TABLE recharges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      carrier TEXT,
      currency_code TEXT DEFAULT 'USD',
      price REAL DEFAULT 0,
      cost REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT
    , refunded_at TEXT DEFAULT NULL);

    -- Referenced by ProfitRepository's notPartnerPending / txnPartnerCoverageRatio
    -- fragments (PFT-6). Left empty: the coverage ratio then defaults to 1.0
    -- (fully recognised) for every row.
    CREATE TABLE partner_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      partner_id INTEGER NOT NULL,
      transaction_type TEXT,
      reference_table TEXT,
      reference_id INTEGER,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      notes TEXT,
      user_id INTEGER,
      settlement_method TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      covered_amount REAL NOT NULL DEFAULT 0
    );

    -- Referenced by ProfitRepository's notDebtPending fragment (DBT-1, v129).
    -- Left empty: the NOT EXISTS gate passes every row unchanged.
    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      transaction_id INTEGER,
      due_date TEXT,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER,
      is_refunded INTEGER DEFAULT 0,
      session_id INTEGER,
      covered_usd REAL NOT NULL DEFAULT 0,
      covered_lbp REAL NOT NULL DEFAULT 0
    , refunded_at TEXT DEFAULT NULL);
  `);
}

describe("ProfitRepository — RECHARGE_TOPUP reaches a PROFIT_TXN_TYPES-gated surface (owner ruling 2026-09-21)", () => {
  let db: Database.Database;
  let repo: ProfitRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    db.prepare(`INSERT INTO users (tenant_id, username) VALUES (1, 'alice')`).run();
    (globalThis as any).__LIRATEK_TEST_DB__ = db;
    repo = new ProfitRepository();
  });

  afterEach(() => {
    delete (globalThis as any).__LIRATEK_TEST_DB__;
    db.close();
  });

  it("getByUser counts a RECHARGE_TOPUP transaction's profit_usd/profit_lbp", () => {
    const userId = (
      db.prepare(`SELECT id FROM users WHERE username = 'alice'`).get() as {
        id: number;
      }
    ).id;

    // A client-funded Whish App top-up: amount 100, fee 7 (the shop's cut),
    // stamped as profit_usd = 7 by RechargeRepository.topUpFromClient.
    const recharge = db
      .prepare(
        `INSERT INTO recharges (tenant_id, carrier, currency_code, price, cost, is_refunded, created_at)
         VALUES (1, 'WHISH_APP', 'USD', 100, 93, 0, ?)`,
      )
      .run(D);
    db.prepare(
      `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, user_id, amount_usd, profit_usd, created_at)
       VALUES (1, 'RECHARGE_TOPUP', 'ACTIVE', 'recharges', ?, ?, ?, ?, ?)`,
    ).run(Number(recharge.lastInsertRowid), userId, 100, 7, D);

    const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
    expect(rows).toHaveLength(1);
    expect(rows[0].username).toBe("alice");
    expect(rows[0].profit_usd).toBe(7);
    expect(rows[0].transaction_count).toBe(1);
  });
});
