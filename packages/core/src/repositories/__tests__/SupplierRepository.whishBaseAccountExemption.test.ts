/**
 * SupplierRepository — LIRA-191 (OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §5): the
 * Whish-base exemption to the secondary-system hide predicate.
 *
 * `listSuppliers()`/`getSupplierBalances()` hide a supplier whose `provider`
 * is 'OMT' or 'WHISH' when it isn't the shop's `shop_base_system` (its
 * obligations live in partner_ledger — see `_secondarySystemHideClause`'s
 * own doc comment). On a Whish-base shop that still parents iPick/OMT App
 * under the OMT supplier, that predicate used to take the whole account
 * card down with it — hiding a card nobody expected is cosmetic, hiding a
 * rolled-up account's real debt is a money error. This file proves the
 * fix: an account PARENT with at least one ACTIVE child is exempted from
 * the hide rule; a CHILDLESS secondary-system supplier keeps the exact old
 * (hidden) behaviour.
 *
 * Same v176 in-memory fixture shape as
 * `SupplierRepository.accountRollup.test.ts`.
 */

import Database from "better-sqlite3";
import {
  SupplierRepository,
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
      entry_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_by INTEGER,
      transaction_id INTEGER,
      is_auto INTEGER NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_at DATETIME,
      settlement_id INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
  },
): number {
  const res = db
    .prepare(
      `INSERT INTO suppliers (name, provider, account_supplier_id, is_active)
       VALUES (?, ?, ?, ?)`,
    )
    .run(
      data.name,
      data.provider ?? null,
      data.accountSupplierId ?? null,
      data.isActive ?? 1,
    );
  return Number(res.lastInsertRowid);
}

function setBaseSystem(db: Database.Database, value: "OMT" | "WHISH"): void {
  db.prepare(
    `INSERT INTO system_settings (key_name, value, tenant_id) VALUES ('shop_base_system', ?, 1)`,
  ).run(value);
}

describe("SupplierRepository — LIRA-191 Whish-base account exemption", () => {
  let db: Database.Database;
  let repo: SupplierRepository;

  beforeEach(() => {
    db = createTestDb();
    const { setDb } = require("../../db/connection");
    setDb(db);
    initFixedTenantContext(1);
    resetSupplierRepository();
    repo = new SupplierRepository();
  });

  afterEach(() => {
    db.close();
    resetTenantContext();
  });

  it("still hides a CHILDLESS secondary-system supplier on a Whish-base shop (unchanged behaviour)", () => {
    setBaseSystem(db, "WHISH");
    const omtId = seedSupplier(db, { name: "OMT", provider: "OMT" });

    const balanceIds = repo.getSupplierBalances().map((b) => b.supplier_id);
    expect(balanceIds).not.toContain(omtId);

    const listIds = repo.listSuppliers().map((s) => s.id);
    expect(listIds).not.toContain(omtId);
  });

  it("exempts an account PARENT with an ACTIVE child from the hide rule on a Whish-base shop", () => {
    setBaseSystem(db, "WHISH");
    const omtId = seedSupplier(db, { name: "OMT", provider: "OMT" });
    seedSupplier(db, {
      name: "iPick",
      provider: "iPick",
      accountSupplierId: omtId,
    });

    const balanceIds = repo.getSupplierBalances().map((b) => b.supplier_id);
    expect(balanceIds).toContain(omtId);

    const listIds = repo.listSuppliers().map((s) => s.id);
    expect(listIds).toContain(omtId);
  });

  it("does NOT exempt a secondary-system supplier whose only child is INACTIVE (childless-equivalent)", () => {
    setBaseSystem(db, "WHISH");
    const omtId = seedSupplier(db, { name: "OMT", provider: "OMT" });
    seedSupplier(db, {
      name: "iPick",
      provider: "iPick",
      accountSupplierId: omtId,
      isActive: 0,
    });

    const balanceIds = repo.getSupplierBalances().map((b) => b.supplier_id);
    expect(balanceIds).not.toContain(omtId);

    const listIds = repo.listSuppliers().map((s) => s.id);
    expect(listIds).not.toContain(omtId);
  });

  it("leaves the base-system supplier (OMT on an OMT-base shop) visible, exemption or not", () => {
    setBaseSystem(db, "OMT");
    const omtId = seedSupplier(db, { name: "OMT", provider: "OMT" });
    seedSupplier(db, {
      name: "iPick",
      provider: "iPick",
      accountSupplierId: omtId,
    });

    expect(repo.getSupplierBalances().map((b) => b.supplier_id)).toContain(
      omtId,
    );
    expect(repo.listSuppliers().map((s) => s.id)).toContain(omtId);
  });

  it("keeps hiding the secondary system with no account link column at all pre-v176 (schema-drift guard)", () => {
    // Simulate a pre-v176 connection: drop the account_supplier_id column
    // entirely so _suppliersHasAccountLinkColumn() returns false and the
    // bare, unexempted hide rule applies — byte-identical to pre-LIRA-191.
    db.exec(`
      CREATE TABLE suppliers_old (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        contact_name TEXT,
        phone TEXT,
        note TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        module_key TEXT,
        provider TEXT,
        is_system INTEGER NOT NULL DEFAULT 0,
        tenant_id INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO suppliers_old SELECT id, name, contact_name, phone, note, is_active, module_key, provider, is_system, tenant_id, created_at FROM suppliers;
      DROP TABLE suppliers;
      ALTER TABLE suppliers_old RENAME TO suppliers;
    `);
    setBaseSystem(db, "WHISH");
    const res = db
      .prepare(`INSERT INTO suppliers (name, provider) VALUES (?, ?)`)
      .run("OMT", "OMT");
    const omtId = Number(res.lastInsertRowid);
    resetSupplierRepository();
    repo = new SupplierRepository();

    expect(repo.getSupplierBalances().map((b) => b.supplier_id)).not.toContain(
      omtId,
    );
  });
});
