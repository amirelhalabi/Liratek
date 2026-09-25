/**
 * SupplierRepository.updateAccountLink() — LIRA-191
 * (OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §5): set/clear a supplier's account
 * parent (`suppliers.account_supplier_id`, migration v176). This column
 * reshapes what `getAccountBalances`/`getAccountLedger`/`getAccountUnsettled`
 * roll up together, so every invariant is hard-validated server-side:
 *
 *  - a supplier cannot be its own parent;
 *  - accounts are exactly ONE level deep (no A→B→C chains) — the new parent
 *    must not itself be a child, and the supplier being updated must not
 *    already be a parent of its own children;
 *  - the parent must exist, be in the SAME tenant, and be active;
 *  - detaching (account_supplier_id: null) a supplier that currently has a
 *    parent AND still carries open unsettled rows is refused;
 *  - re-parenting a child from one valid parent straight to another is
 *    ALLOWED without the orphan check (the debt moves, it doesn't vanish).
 *
 * Same in-memory schema/mocking shape as
 * `SupplierRepository.accountRollup.test.ts` (the v176 fixture this whole
 * epic's tests share).
 */

import Database from "better-sqlite3";
import {
  SupplierRepository,
  resetSupplierRepository,
} from "../SupplierRepository";
import { resetFinancialServiceRepository } from "../FinancialServiceRepository";
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

// FinancialServiceRepository.ts imports DebtService at module scope (used by
// unrelated write paths this file never exercises) — mocked the same way
// SupplierRepository.accountRollup.test.ts does so the module-level import
// resolves without a real DB.
jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: jest.fn() }),
  resetDebtService: jest.fn(),
}));

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
      account_supplier_id INTEGER REFERENCES suppliers(id),
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE supplier_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL CHECK(entry_type IN ('TOP_UP', 'SALE_COST', 'PAYMENT', 'ADJUSTMENT', 'SETTLEMENT', 'CASH_PRIZE', 'SUPPLIER_PAYS_US', 'DISCOUNT', 'STOCK_INTAKE')),
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_by INTEGER,
      transaction_id INTEGER,
      is_auto INTEGER NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_at DATETIME,
      source_ref_table TEXT,
      source_ref_id INTEGER,
      settlement_id INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      service_type TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'USD' NOT NULL,
      commission REAL DEFAULT 0,
      cost REAL DEFAULT 0,
      price REAL DEFAULT 0,
      paid_by TEXT DEFAULT 'CASH',
      client_id INTEGER,
      client_name TEXT,
      reference_number TEXT,
      phone_number TEXT,
      omt_service_type TEXT,
      omt_fee REAL DEFAULT 0,
      whish_fee REAL DEFAULT 0,
      profit_rate REAL,
      pay_fee INTEGER DEFAULT 0,
      payment_method_fee REAL DEFAULT 0,
      payment_method_fee_rate REAL,
      item_key TEXT,
      note TEXT,
      sender_name TEXT,
      sender_phone TEXT,
      receiver_name TEXT,
      receiver_phone TEXT,
      sender_client_id INTEGER,
      receiver_client_id INTEGER,
      is_settled INTEGER NOT NULL DEFAULT 0,
      settled_at TEXT,
      settlement_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER,
      edited_by INTEGER,
      edited_at DATETIME,
      paid_amount REAL DEFAULT NULL,
      paid_currency TEXT DEFAULT NULL,
      partner_id INTEGER,
      partner_mode TEXT CHECK(partner_mode IN ('THROUGH', 'FOR')),
      commission_model INTEGER NOT NULL DEFAULT 0,
      receive_fee_model INTEGER NOT NULL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL
    );

    CREATE TABLE service_providers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      code TEXT NOT NULL,
      label TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      is_system_provider INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_system INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE system_settings (
      key_name TEXT NOT NULL,
      value TEXT,
      tenant_id INTEGER DEFAULT 1,
      PRIMARY KEY (tenant_id, key_name)
    );
  `);

  return db;
}

function seedSupplier(
  db: Database.Database,
  data: {
    name: string;
    provider?: string | null;
    accountSupplierId?: number | null;
    isActive?: number;
    tenantId?: number;
  },
): number {
  const res = db
    .prepare(
      `INSERT INTO suppliers (name, provider, account_supplier_id, is_active, tenant_id)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      data.name,
      data.provider ?? null,
      data.accountSupplierId ?? null,
      data.isActive ?? 1,
      data.tenantId ?? 1,
    );
  return Number(res.lastInsertRowid);
}

function seedLedgerEntry(
  db: Database.Database,
  data: {
    supplierId: number;
    entryType: string;
    amountUsd?: number;
    amountLbp?: number;
    settlementId?: number | null;
    isRefunded?: number;
  },
): number {
  const res = db
    .prepare(
      `INSERT INTO supplier_ledger
         (supplier_id, entry_type, amount_usd, amount_lbp, settlement_id, is_refunded)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      data.supplierId,
      data.entryType,
      data.amountUsd ?? 0,
      data.amountLbp ?? 0,
      data.settlementId ?? null,
      data.isRefunded ?? 0,
    );
  return Number(res.lastInsertRowid);
}

describe("SupplierRepository.updateAccountLink() — LIRA-191", () => {
  let db: Database.Database;
  let repo: SupplierRepository;
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetSupplierRepository();
    repo = new SupplierRepository();
    resetFinancialServiceRepository();
  });

  afterEach(() => {
    db.close();
    resetFinancialServiceRepository();
    resetTenantContext();
  });

  it("sets a standalone supplier's parent", () => {
    const omtId = seedSupplier(db, { name: "OMT", provider: "OMT" });
    const ipickId = seedSupplier(db, { name: "iPick", provider: "iPick" });

    const res = repo.updateAccountLink({
      supplier_id: ipickId,
      account_supplier_id: omtId,
    });

    expect(res.id).toBe(ipickId);
    const row = db
      .prepare(`SELECT account_supplier_id FROM suppliers WHERE id = ?`)
      .get(ipickId) as { account_supplier_id: number };
    expect(row.account_supplier_id).toBe(omtId);
  });

  it("clears an existing link back to standalone", () => {
    const omtId = seedSupplier(db, { name: "OMT", provider: "OMT" });
    const ipickId = seedSupplier(db, {
      name: "iPick",
      provider: "iPick",
      accountSupplierId: omtId,
    });

    repo.updateAccountLink({
      supplier_id: ipickId,
      account_supplier_id: null,
    });

    const row = db
      .prepare(`SELECT account_supplier_id FROM suppliers WHERE id = ?`)
      .get(ipickId) as { account_supplier_id: number | null };
    expect(row.account_supplier_id).toBeNull();
  });

  it("rejects a supplier being its own parent", () => {
    const omtId = seedSupplier(db, { name: "OMT", provider: "OMT" });

    expect(() =>
      repo.updateAccountLink({
        supplier_id: omtId,
        account_supplier_id: omtId,
      }),
    ).toThrow(/cannot be its own account parent/);
  });

  it("rejects a not-found target supplier", () => {
    expect(() =>
      repo.updateAccountLink({
        supplier_id: 9999,
        account_supplier_id: null,
      }),
    ).toThrow(/not found/);
  });

  it("rejects a not-found parent", () => {
    const ipickId = seedSupplier(db, { name: "iPick", provider: "iPick" });

    expect(() =>
      repo.updateAccountLink({
        supplier_id: ipickId,
        account_supplier_id: 9999,
      }),
    ).toThrow(/Parent supplier #9999 not found/);
  });

  it("rejects an inactive parent", () => {
    const omtId = seedSupplier(db, {
      name: "OMT",
      provider: "OMT",
      isActive: 0,
    });
    const ipickId = seedSupplier(db, { name: "iPick", provider: "iPick" });

    expect(() =>
      repo.updateAccountLink({
        supplier_id: ipickId,
        account_supplier_id: omtId,
      }),
    ).toThrow(/inactive and cannot be an account parent/);
  });

  it("rejects a parent from a different tenant", () => {
    const otherTenantOmtId = seedSupplier(db, {
      name: "OMT",
      provider: "OMT",
      tenantId: 2,
    });
    const ipickId = seedSupplier(db, { name: "iPick", provider: "iPick" });

    expect(() =>
      repo.updateAccountLink({
        supplier_id: ipickId,
        account_supplier_id: otherTenantOmtId,
      }),
    ).toThrow(/not found in this tenant/);
  });

  it("rejects a parent that is itself already a child (no A→B→C chains)", () => {
    const omtId = seedSupplier(db, { name: "OMT", provider: "OMT" });
    const ipickId = seedSupplier(db, {
      name: "iPick",
      provider: "iPick",
      accountSupplierId: omtId,
    });
    const thirdId = seedSupplier(db, { name: "Third", provider: "THIRD" });

    // Trying to parent "Third" under "iPick" — iPick is already a child of
    // OMT, so this would be a two-level chain.
    expect(() =>
      repo.updateAccountLink({
        supplier_id: thirdId,
        account_supplier_id: ipickId,
      }),
    ).toThrow(/is itself a child of another account/);
  });

  it("rejects re-parenting an existing account parent into a child (no A→B→C chains)", () => {
    const omtId = seedSupplier(db, { name: "OMT", provider: "OMT" });
    seedSupplier(db, {
      name: "iPick",
      provider: "iPick",
      accountSupplierId: omtId,
    });
    const whishId = seedSupplier(db, { name: "Whish", provider: "WHISH" });

    // OMT already has a child (iPick) — parenting OMT itself under Whish
    // would make OMT a mid-level node with its own child beneath it.
    expect(() =>
      repo.updateAccountLink({
        supplier_id: omtId,
        account_supplier_id: whishId,
      }),
    ).toThrow(/already has its own children/);
  });

  it("rejects detaching a child that still has open unsettled ledger rows", () => {
    const omtId = seedSupplier(db, { name: "OMT", provider: "OMT" });
    const ipickId = seedSupplier(db, {
      name: "iPick",
      provider: "iPick",
      accountSupplierId: omtId,
    });
    seedLedgerEntry(db, {
      supplierId: ipickId,
      entryType: "TOP_UP",
      amountUsd: 200,
    });

    expect(() =>
      repo.updateAccountLink({
        supplier_id: ipickId,
        account_supplier_id: null,
      }),
    ).toThrow(/still has 1 unsettled row/);

    // Unchanged — the write must not have happened.
    const row = db
      .prepare(`SELECT account_supplier_id FROM suppliers WHERE id = ?`)
      .get(ipickId) as { account_supplier_id: number | null };
    expect(row.account_supplier_id).toBe(omtId);
  });

  it("allows detaching a child whose rows are already settled", () => {
    const omtId = seedSupplier(db, { name: "OMT", provider: "OMT" });
    const ipickId = seedSupplier(db, {
      name: "iPick",
      provider: "iPick",
      accountSupplierId: omtId,
    });
    seedLedgerEntry(db, {
      supplierId: ipickId,
      entryType: "TOP_UP",
      amountUsd: 200,
      settlementId: 42, // already settled
    });

    repo.updateAccountLink({
      supplier_id: ipickId,
      account_supplier_id: null,
    });

    const row = db
      .prepare(`SELECT account_supplier_id FROM suppliers WHERE id = ?`)
      .get(ipickId) as { account_supplier_id: number | null };
    expect(row.account_supplier_id).toBeNull();
  });

  it("allows re-parenting a child with open unsettled rows straight to a new valid parent (debt moves, doesn't vanish)", () => {
    const omtId = seedSupplier(db, { name: "OMT", provider: "OMT" });
    const whishId = seedSupplier(db, { name: "Whish", provider: "WHISH" });
    const ipickId = seedSupplier(db, {
      name: "iPick",
      provider: "iPick",
      accountSupplierId: omtId,
    });
    seedLedgerEntry(db, {
      supplierId: ipickId,
      entryType: "TOP_UP",
      amountUsd: 200,
    });

    // Not a detach-to-null — a straight re-parent. The orphan check must
    // NOT fire here.
    repo.updateAccountLink({
      supplier_id: ipickId,
      account_supplier_id: whishId,
    });

    const row = db
      .prepare(`SELECT account_supplier_id FROM suppliers WHERE id = ?`)
      .get(ipickId) as { account_supplier_id: number };
    expect(row.account_supplier_id).toBe(whishId);
  });

  it("allows clearing an already-standalone supplier's link (no-op, never checks unsettled rows)", () => {
    const ipickId = seedSupplier(db, { name: "iPick", provider: "iPick" });
    seedLedgerEntry(db, {
      supplierId: ipickId,
      entryType: "TOP_UP",
      amountUsd: 200,
    });

    // Already has no parent — clearing again must succeed even though it
    // carries unsettled rows (nothing is being orphaned FROM an account).
    expect(() =>
      repo.updateAccountLink({
        supplier_id: ipickId,
        account_supplier_id: null,
      }),
    ).not.toThrow();
  });
});
