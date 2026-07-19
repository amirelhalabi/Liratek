/**
 * FinancialServiceRepository — cross-tenant isolation (WP3b, multi-tenant
 * retrofit, CLAUDE.md rule 17 regression proof).
 *
 * Every hand-written SELECT/INSERT/UPDATE in FinancialServiceRepository now
 * carries a `tenant_id` predicate/column, bound from `getCurrentTenantId()`.
 * This seeds tenant 1 and tenant 2 with MIRRORED financial_services +
 * drawer_balances rows and proves that under `runWithTenant(1, ...)`:
 *   - List/history reads (getHistory) see ONLY tenant 1's rows.
 *   - Aggregate reads (getAnalytics, getUnsettledSummaryByProvider) sum
 *     ONLY tenant 1's rows — a tenant-2 commission never leaks into the total.
 *   - A write (createTransaction) stamps tenant_id = 1 on the new row and
 *     only moves tenant 1's drawer_balances row — tenant 2's mirrored drawer
 *     is untouched.
 *
 * Per rule 17: the getHistory assertion below was verified to FAIL when the
 * `AND tenant_id = ?` predicate was temporarily removed from
 * FinancialServiceRepository.getHistory() (both tenants' rows leaked back in,
 * inflating the count from 1 to 2) — the predicate was then restored and the
 * revert verified identical via `git diff` before this file was finalized.
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import { runWithTenant } from "../../db/tenantContext";

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
    CREATE TABLE tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    );
    INSERT INTO tenants (id, name) VALUES (1, 'Tenant One'), (2, 'Tenant Two');

    CREATE TABLE users (
      tenant_id INTEGER,
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, role TEXT DEFAULT 'staff'
    );
    INSERT INTO users (id, username, role, tenant_id) VALUES (1, 'admin1', 'admin', 1);
    INSERT INTO users (id, username, role, tenant_id) VALUES (2, 'admin2', 'admin', 2);

    CREATE TABLE clients (
      tenant_id INTEGER,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

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
      edited_by TEXT DEFAULT NULL, edited_at TEXT DEFAULT NULL
    );

    CREATE TABLE transactions (
      tenant_id INTEGER,
      id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE', source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL, user_id INTEGER NOT NULL DEFAULT 1,
      amount_usd REAL NOT NULL DEFAULT 0, amount_lbp REAL NOT NULL DEFAULT 0,
      exchange_rate REAL, client_id INTEGER, client_name TEXT, client_phone TEXT,
      reverses_id INTEGER, profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0, summary TEXT, metadata_json TEXT,
      device_id TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      tenant_id INTEGER,
      id INTEGER PRIMARY KEY AUTOINCREMENT, transaction_id INTEGER, session_id INTEGER,
      method TEXT NOT NULL, drawer_name TEXT NOT NULL, currency_code TEXT NOT NULL,
      amount REAL NOT NULL, note TEXT, created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER,
      drawer_name TEXT NOT NULL, currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    -- Mirrored General/USD drawer for both tenants — a leak would show up as
    -- the WRONG tenant's balance moving.
    INSERT INTO drawer_balances VALUES (1, 'General', 'USD', 1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (2, 'General', 'USD', 5000, CURRENT_TIMESTAMP);

    CREATE TABLE suppliers (
      tenant_id INTEGER,
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, provider TEXT,
      is_active INTEGER DEFAULT 1, is_system INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE supplier_ledger (
      tenant_id INTEGER,
      id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL, amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0, note TEXT, created_by INTEGER,
      transaction_id INTEGER, is_auto INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE system_settings (
      tenant_id INTEGER,
      id INTEGER PRIMARY KEY AUTOINCREMENT, key_name TEXT NOT NULL, value TEXT
    );

    -- Partner ledger (referenced by FOR-partner dispatch; empty here — no
    -- test in this file exercises the partner path, but the table must
    -- exist since FinancialServiceRepository.createTransaction references it).
    CREATE TABLE partner_ledger (
      tenant_id         INTEGER DEFAULT 1,
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id        INTEGER NOT NULL,
      transaction_type  TEXT,
      reference_table   TEXT,
      reference_id      INTEGER,
      amount            REAL NOT NULL,
      currency          TEXT NOT NULL DEFAULT 'USD',
      direction         TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      notes             TEXT,
      user_id           INTEGER,
      settlement_method TEXT,
      created_at        TEXT DEFAULT CURRENT_TIMESTAMP,
      covered_amount    REAL NOT NULL DEFAULT 0
    );

    -- Mirrored financial_services rows: same provider/shape, different
    -- commission, one per tenant. Seeded with DATE('now','localtime') to
    -- match the 'today' predicate FinancialServiceRepository.getAnalytics()
    -- actually queries with (DATE(created_at) = DATE('now','localtime')) —
    -- DATE('now') alone is UTC and flakes near local midnight when the UTC
    -- and local calendar days differ.
    INSERT INTO financial_services
      (tenant_id, provider, service_type, amount, currency, commission, is_settled, created_at)
      VALUES (1, 'OMT', 'SEND', 100, 'USD', 5, 1, DATE('now', 'localtime'));
    INSERT INTO financial_services
      (tenant_id, provider, service_type, amount, currency, commission, is_settled, created_at)
      VALUES (2, 'OMT', 'SEND', 100, 'USD', 9999, 1, DATE('now', 'localtime'));
  `);
  return db;
}

describe("FinancialServiceRepository — cross-tenant isolation", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    repo = new FinancialServiceRepository();
  });

  afterEach(() => {
    db.close();
  });

  it("getHistory() under tenant 1 sees ONLY tenant 1's row", () => {
    const rows = runWithTenant(1, () => repo.getHistory("OMT"));
    expect(rows).toHaveLength(1);
    expect(rows[0].commission).toBe(5);
  });

  it("getHistory() under tenant 2 sees ONLY tenant 2's row", () => {
    const rows = runWithTenant(2, () => repo.getHistory("OMT"));
    expect(rows).toHaveLength(1);
    expect(rows[0].commission).toBe(9999);
  });

  it("getAnalytics() under tenant 1 never sums in tenant 2's commission", () => {
    const analytics = runWithTenant(1, () => repo.getAnalytics());
    // Tenant 2's row is is_settled=1 too, but created_at is DATE('now') so it
    // would land in "today" for both tenants if the predicate leaked.
    expect(analytics.today.commission).toBeLessThan(9999);
    expect(analytics.today.commission).toBe(5);
  });

  it("getUnsettledSummaryByProvider() under tenant 1 does not see tenant 2's unsettled rows", () => {
    db.prepare(
      `UPDATE financial_services SET is_settled = 0 WHERE tenant_id = 1`,
    ).run();
    db.prepare(
      `UPDATE financial_services SET is_settled = 0 WHERE tenant_id = 2`,
    ).run();

    const summaryT1 = runWithTenant(1, () =>
      repo.getUnsettledSummaryByProvider(),
    );
    expect(summaryT1).toHaveLength(1);
    expect(summaryT1[0].pending_commission_usd).toBe(5);

    const summaryT2 = runWithTenant(2, () =>
      repo.getUnsettledSummaryByProvider(),
    );
    expect(summaryT2).toHaveLength(1);
    expect(summaryT2[0].pending_commission_usd).toBe(9999);
  });

  it("createTransaction() under tenant 1 stamps tenant_id=1 and only moves tenant 1's drawer", () => {
    const t2DrawerBefore = db
      .prepare(
        `SELECT balance FROM drawer_balances WHERE tenant_id = 2 AND drawer_name = 'General' AND currency_code = 'USD'`,
      )
      .get() as { balance: number };

    runWithTenant(1, () =>
      repo.createTransaction({
        provider: "BOB",
        serviceType: "SEND",
        amount: 50,
        currency: "USD",
        commission: 1,
        paidByMethod: "CASH",
        userId: 1,
      }),
    );

    const newRow = db
      .prepare(
        `SELECT tenant_id FROM financial_services WHERE provider = 'BOB' ORDER BY id DESC LIMIT 1`,
      )
      .get() as { tenant_id: number };
    expect(newRow.tenant_id).toBe(1);

    const t1DrawerAfter = db
      .prepare(
        `SELECT balance FROM drawer_balances WHERE tenant_id = 1 AND drawer_name = 'General' AND currency_code = 'USD'`,
      )
      .get() as { balance: number };
    const t2DrawerAfter = db
      .prepare(
        `SELECT balance FROM drawer_balances WHERE tenant_id = 2 AND drawer_name = 'General' AND currency_code = 'USD'`,
      )
      .get() as { balance: number };

    // Tenant 1's General/USD drawer moved (+51: amount + commission, cash paid).
    expect(t1DrawerAfter.balance).toBeCloseTo(1000 + 51, 2);
    // Tenant 2's mirrored drawer is untouched — a leak would move this too.
    expect(t2DrawerAfter.balance).toBe(t2DrawerBefore.balance);
  });

  it("payments rows written under tenant 2 carry tenant_id = 2 (CQ-3 sabotage gap)", () => {
    // The CQ-3 sabotage check found NO suite read back payments.tenant_id
    // after a write — a helper hardcoding tenant 1 passed the whole wall.
    // This is that missing guard.
    const beforeMax = (
      db.prepare(`SELECT COALESCE(MAX(id), 0) AS m FROM payments`).get() as {
        m: number;
      }
    ).m;

    runWithTenant(2, () =>
      repo.createTransaction({
        provider: "BOB",
        serviceType: "SEND",
        amount: 50,
        currency: "USD",
        commission: 1,
        paidByMethod: "CASH",
        userId: 1,
      }),
    );

    const newRows = db
      .prepare(`SELECT tenant_id FROM payments WHERE id > ?`)
      .all(beforeMax) as Array<{ tenant_id: number }>;
    expect(newRows.length).toBeGreaterThan(0);
    expect(newRows.every((r) => r.tenant_id === 2)).toBe(true);
  });
});
