/**
 * COMMISSION_AT_SETTLEMENT_PLAN.md reviewer finding #3 (PLAUSIBLE, harden):
 * `settleTransactions` never verified the caller's `financial_service_ids`
 * belong to `data.supplier_id` — only `settlement_id IS NULL` + tenant were
 * checked. Harmless while commission was purely informational; now
 * `_bookCommissionAtSettlement` books a REAL `SUPPLIER_PAYS_US` credit
 * against `data.supplier_id` regardless of which supplier's rows were
 * actually selected.
 *
 * A `financial_services` row has no `supplier_id` FK — system suppliers are
 * keyed by their `provider` string (`FinancialServiceRepository
 * .getUnsettledBySupplier(provider)`; the Settlement UI always fetches
 * unsettled rows by `selectedSupplier.provider`) — so "belongs to
 * `data.supplier_id`" means "its own `provider` matches that supplier's
 * `provider`".
 *
 * Rule 17: the "rejects a batch whose rows belong to a different supplier"
 * test below was run against the pre-fix `settleTransactions` (no ownership
 * check) and OBSERVED FAILING — it committed the settlement instead of
 * throwing:
 *
 *   expect(received).toThrow()
 *   Received function did not throw
 *
 *   (and, inspecting the committed state:) a SUPPLIER_PAYS_US credit for
 *   $5 was booked against the WRONG supplier (Katsh Co, id 2) even though
 *   every selected financial_services row's provider was "OMT" (belonging
 *   to supplier id 1) — the exact cross-supplier booking this test guards.
 */

import Database from "better-sqlite3";
import {
  SupplierRepository,
  resetSupplierRepository,
} from "../SupplierRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
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
      commission_entry_mode TEXT CHECK(commission_entry_mode IN ('LUMP', 'RATE')) DEFAULT 'LUMP',
      commission_rate REAL,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE supplier_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL CHECK(entry_type IN ('TOP_UP', 'SALE_COST', 'PAYMENT', 'ADJUSTMENT', 'SETTLEMENT', 'CASH_PRIZE', 'SUPPLIER_PAYS_US', 'DISCOUNT')),
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_by INTEGER,
      transaction_id INTEGER,
      is_auto INTEGER NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_at DATETIME,
      source_ref_table TEXT DEFAULT NULL,
      source_ref_id INTEGER DEFAULT NULL,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE financial_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      service_type TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'USD',
      commission REAL DEFAULT 0,
      cost REAL DEFAULT 0,
      price REAL DEFAULT 0,
      paid_by TEXT DEFAULT 'CASH',
      paid_amount REAL DEFAULT NULL,
      paid_currency TEXT DEFAULT NULL,
      client_id INTEGER,
      client_name TEXT,
      reference_number TEXT,
      phone_number TEXT,
      sender_name TEXT,
      sender_phone TEXT,
      receiver_name TEXT,
      receiver_phone TEXT,
      sender_client_id INTEGER,
      receiver_client_id INTEGER,
      omt_service_type TEXT,
      omt_fee REAL DEFAULT 0,
      whish_fee REAL DEFAULT 0,
      profit_rate REAL,
      pay_fee INTEGER DEFAULT 0,
      item_key TEXT,
      note TEXT,
      is_settled INTEGER NOT NULL DEFAULT 0,
      settled_at TEXT,
      settlement_id INTEGER,
      payment_method_fee REAL DEFAULT 0,
      payment_method_fee_rate REAL,
      created_by INTEGER,
      edited_by TEXT DEFAULT NULL,
      edited_at TEXT DEFAULT NULL,
      partner_id INTEGER,
      partner_mode TEXT CHECK(partner_mode IN ('THROUGH', 'FOR')),
      commission_model INTEGER NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE supplier_settlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      supplier_id INTEGER NOT NULL,
      ledger_entry_id INTEGER NOT NULL UNIQUE,
      gross_usd REAL NOT NULL DEFAULT 0,
      gross_lbp REAL NOT NULL DEFAULT 0,
      commission_usd REAL NOT NULL DEFAULT 0,
      commission_lbp REAL NOT NULL DEFAULT 0,
      entry_mode TEXT NOT NULL DEFAULT 'LUMP' CHECK(entry_mode IN ('LUMP', 'RATE')),
      rate REAL,
      unit_count INTEGER,
      model INTEGER NOT NULL CHECK(model IN (0, 1)),
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE settlement_commission_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      settlement_ledger_id INTEGER NOT NULL,
      financial_service_id INTEGER NOT NULL,
      service_type TEXT NOT NULL,
      provider TEXT NOT NULL,
      commission_usd REAL NOT NULL DEFAULT 0,
      commission_lbp REAL NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL DEFAULT 1,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
      device_id TEXT,
      summary TEXT,
      metadata_json TEXT,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE system_settings (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL DEFAULT 1,
      key_name  TEXT NOT NULL,
      value     TEXT
    );

    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_System', 'USD', 500);
  `);

  return db;
}

function seedSupplier(
  db: Database.Database,
  name: string,
  provider: string,
): number {
  const res = db
    .prepare(
      "INSERT INTO suppliers (name, provider, is_system) VALUES (?, ?, 1)",
    )
    .run(name, provider);
  return Number(res.lastInsertRowid);
}

function seedFs(
  db: Database.Database,
  opts: { provider: string; amount: number; commissionModel: 0 | 1 },
): number {
  const res = db
    .prepare(
      `INSERT INTO financial_services
         (provider, service_type, amount, currency, commission, commission_model, is_settled)
       VALUES (?, 'RECEIVE', ?, 'USD', 0, ?, 0)`,
    )
    .run(opts.provider, opts.amount, opts.commissionModel);
  return Number(res.lastInsertRowid);
}

describe("SupplierRepository.settleTransactions() — supplier ownership scoping", () => {
  let db: Database.Database;
  let repo: SupplierRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetSupplierRepository();
    repo = new SupplierRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetSupplierRepository();
    resetTenantContext();
  });

  it("rejects a batch whose rows belong to a different supplier (new-model)", () => {
    const omtSupplierId = seedSupplier(db, "OMT Co", "OMT");
    const katshSupplierId = seedSupplier(db, "Katsh Co", "Katsh");
    const omtFsId = seedFs(db, {
      provider: "OMT",
      amount: 100,
      commissionModel: 1,
    });

    expect(() =>
      repo.settleTransactions({
        // Wrong supplier: the selected row's provider is "OMT", not "Katsh".
        supplier_id: katshSupplierId,
        financial_service_ids: [omtFsId],
        amount_usd: 95,
        amount_lbp: 0,
        commission_usd: 5,
        commission_lbp: 0,
        created_by: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 95 }],
      }),
    ).toThrow(/different supplier|does not belong|provider/i);

    // Atomic: nothing committed by the rejected attempt — no ledger row for
    // EITHER supplier, and the fs row stays unsettled.
    const ledgerCount = (
      db.prepare("SELECT COUNT(*) as cnt FROM supplier_ledger").get() as any
    ).cnt;
    expect(ledgerCount).toBe(0);
    const fsRow = db
      .prepare(
        "SELECT is_settled, settlement_id FROM financial_services WHERE id = ?",
      )
      .get(omtFsId) as any;
    expect(fsRow.is_settled).toBe(0);
    expect(fsRow.settlement_id).toBeNull();
    void omtSupplierId;
  });

  it("still allows a batch whose rows genuinely belong to the selected supplier", () => {
    const omtSupplierId = seedSupplier(db, "OMT Co", "OMT");
    const omtFsId = seedFs(db, {
      provider: "OMT",
      amount: 100,
      commissionModel: 1,
    });

    expect(() =>
      repo.settleTransactions({
        supplier_id: omtSupplierId,
        financial_service_ids: [omtFsId],
        amount_usd: 95,
        amount_lbp: 0,
        commission_usd: 5,
        commission_lbp: 0,
        created_by: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 95 }],
      }),
    ).not.toThrow();
  });
});
