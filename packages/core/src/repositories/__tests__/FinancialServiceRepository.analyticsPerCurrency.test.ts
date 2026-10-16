/**
 * Shop-day bug (2026-10-16): `/api/services/analytics` returned
 * `today.commission` = 317851.43 — LBP and USDT commissions ADDED together
 * into one number. `getAnalytics()`'s top-level `commission` /
 * `pending_commission` summed the `commission` column across every
 * currency (each row's commission is in its own `currency`).
 *
 * Contract after the fix: the top-level scalars are USD only; every
 * currency keeps its own figure in `byCurrency` (realized `commission` AND
 * `pending_commission`), so nothing is ever added across currencies.
 *
 * Rule 17: written and run before FinancialServiceRepository.getAnalytics
 * was changed — see fixes.md for the recorded red run.
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository.js";
import { runWithTenant } from "../../db/tenantContext.js";

let db: Database.Database;
let repo: FinancialServiceRepository;

function createSchema(d: Database.Database): void {
  d.exec(`
    CREATE TABLE financial_services (
      tenant_id INTEGER,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL, service_type TEXT NOT NULL, amount REAL NOT NULL,
      currency TEXT DEFAULT 'USD' NOT NULL, commission REAL DEFAULT 0,
      cost REAL DEFAULT 0, price REAL DEFAULT 0, paid_by TEXT DEFAULT 'CASH',
      client_id INTEGER, client_name TEXT, reference_number TEXT, phone_number TEXT,
      omt_service_type TEXT, omt_fee REAL DEFAULT 0, whish_fee REAL DEFAULT 0,
      profit_rate REAL, pay_fee INTEGER DEFAULT 0, payment_method_fee REAL DEFAULT 0,
      payment_method_fee_rate REAL, item_key TEXT, note TEXT,
      sender_name TEXT, sender_phone TEXT, receiver_name TEXT, receiver_phone TEXT,
      sender_client_id INTEGER, receiver_client_id INTEGER,
      is_settled INTEGER NOT NULL DEFAULT 1, settled_at TEXT, settlement_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, created_by INTEGER,
      paid_amount REAL DEFAULT NULL, paid_currency TEXT DEFAULT NULL,
      partner_id INTEGER, partner_mode TEXT,
      edited_by TEXT DEFAULT NULL, edited_at TEXT DEFAULT NULL,
      is_refunded INTEGER NOT NULL DEFAULT 0, refunded_at TEXT,
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      commission_model INTEGER NOT NULL DEFAULT 0
    );
  `);
}

function addRow(currency: string, commission: number, isSettled: 0 | 1): void {
  db.prepare(
    `INSERT INTO financial_services
       (tenant_id, provider, service_type, amount, currency, commission, is_settled, commission_model)
     VALUES (1, 'WHISH_APP', 'RECEIVE', 100, ?, ?, ?, 0)`,
  ).run(currency, commission, isSettled);
}

beforeEach(() => {
  db = new Database(":memory:");
  createSchema(db);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  repo = new FinancialServiceRepository();
  // Realized (settled) today: $5, 300,000 LBP, 2 USDT.
  addRow("USD", 5, 1);
  addRow("LBP", 300_000, 1);
  addRow("USDT", 2, 1);
  // Pending (not settled) today: $1, 50,000 LBP.
  addRow("USD", 1, 0);
  addRow("LBP", 50_000, 0);
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

describe("getAnalytics never adds commissions of different currencies", () => {
  it("today/month scalar commission and pending_commission are USD only", () => {
    const a = runWithTenant(1, () => repo.getAnalytics());
    expect(a.today.commission).toBe(5);
    expect(a.today.pending_commission).toBe(1);
    expect(a.month.commission).toBe(5);
    expect(a.month.pending_commission).toBe(1);
  });

  it("byCurrency keeps each currency's realized and pending commission apart", () => {
    const a = runWithTenant(1, () => repo.getAnalytics());
    for (const bucket of [a.today, a.month]) {
      const by = Object.fromEntries(
        bucket.byCurrency.map((c) => [
          c.currency,
          { commission: c.commission, pending: c.pending_commission },
        ]),
      );
      expect(by).toEqual({
        USD: { commission: 5, pending: 1 },
        LBP: { commission: 300_000, pending: 50_000 },
        USDT: { commission: 2, pending: 0 },
      });
    }
  });
});
