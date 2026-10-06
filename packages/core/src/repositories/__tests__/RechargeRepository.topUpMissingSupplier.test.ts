/**
 * LIRA-258 G10 (POSTING_INTEGRITY_PLAN.md item 2.2, POSTING_MAP.md §7, owner
 * decision D2): `RechargeRepository.topUpFromSupplier` credited the provider
 * drawer even when `getByProvider` found no (active) supplier row — the
 * wallet balance went up but no TOP_UP debt was booked, so the shop silently
 * stopped owing the supplier for it. `cashoutToSupplier` had the mirror gap:
 * the wallet went down, and the provider's credit to the shop was skipped
 * with only a warning.
 *
 * D2: never skip the debt. The supplier is created / re-activated
 * (`SupplierRepository.ensureSystemSupplier`), and if even that cannot
 * produce one the whole operation is refused — the drawer never moves
 * without its supplier posting.
 *
 * Identity + delta assertions (rule 15) via postingAssert, and create + void
 * nets every ledger to 0 per currency (rule 20).
 */

import Database from "better-sqlite3";
import { RechargeRepository } from "../RechargeRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetSupplierRepository } from "../SupplierRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { omtAppCashoutCommission } from "../../constants/omtAppCashout";
import {
  snapshotLedgers,
  expectPostings,
} from "../testHelpers/postingAssert";

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
    CREATE TABLE recharges (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      carrier TEXT NOT NULL,
      recharge_type TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      default_price_to_client REAL,
      currency_code TEXT NOT NULL DEFAULT 'USD',
      paid_by TEXT NOT NULL,
      phone_number TEXT,
      client_id INTEGER,
      client_name TEXT,
      note TEXT,
      created_by INTEGER NOT NULL DEFAULT 1,
      edited_by TEXT,
      edited_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL
    );

    CREATE TABLE transactions (
      tenant_id INTEGER DEFAULT 1,
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
      summary TEXT,
      metadata_json TEXT,
      device_id TEXT,
      transaction_time DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    CREATE TABLE suppliers (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_name TEXT,
      phone TEXT,
      note TEXT,
      provider TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_system INTEGER NOT NULL DEFAULT 0,
      module_key TEXT,
      commission_eligible INTEGER NOT NULL DEFAULT 1,
      commission_entry_mode TEXT NOT NULL DEFAULT 'LUMP',
      commission_rate REAL,
      commission_rate_currency TEXT NOT NULL DEFAULT 'USD',
      account_supplier_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, name)
    );
    -- NO supplier rows: this file is about the shop that has none (a web
    -- tenant provisioned before v191, or a deleted/never-seeded row).

    -- seedSystemSuppliers resolves module_key against the tenant's modules.
    CREATE TABLE modules (
      tenant_id INTEGER DEFAULT 1,
      key TEXT NOT NULL,
      PRIMARY KEY (tenant_id, key)
    );
    INSERT INTO modules (key) VALUES ('ipec_katch'), ('omt_whish');

    -- v136 shape (source_ref_table/id) — cashoutToSupplier's ledger row is a
    -- source-ref sibling (NOT link-mode), so these columns must be present
    -- for the back-link to actually be stored and for the void cascade to
    -- find it.
    CREATE TABLE supplier_ledger (
      tenant_id INTEGER DEFAULT 1,
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
      source_ref_table TEXT DEFAULT NULL,
      source_ref_id INTEGER DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- voidTransaction() unconditionally runs _cancelDebt(), which SELECTs
    -- from debt_ledger for EVERY void regardless of transaction type (it's
    -- a no-op SELECT when nothing matches, but the table must exist or the
    -- query itself throws — the exact "missing table kills every test in
    -- the file" trap this repo has been bitten by before). Same shape as
    -- TransactionRepository.supplierSiblingVoidCascade.test.ts's fixture.
    CREATE TABLE debt_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      transaction_id INTEGER,
      note TEXT,
      due_date TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL
    );

    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_App', 'USD', 500);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_App', 'LBP', 50000000);
    -- Seeded non-zero so a regression that ever touches the PCD is visible.
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_System', 'USD', 250);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_System', 'LBP', 25000000);
  `);

  return db;
}

function supplierIdFor(db: Database.Database, provider: string): number | undefined {
  return (
    db
      .prepare(`SELECT id FROM suppliers WHERE provider = ? AND is_active = 1`)
      .get(provider) as { id: number } | undefined
  )?.id;
}

function txnIdOfType(db: Database.Database, type: string): number {
  return (
    db
      .prepare(`SELECT id FROM transactions WHERE type = ? ORDER BY id DESC LIMIT 1`)
      .get(type) as { id: number }
  ).id;
}

describe("RechargeRepository — supplier posting is never skipped for a missing supplier (G10)", () => {
  let db: Database.Database;
  let repo: RechargeRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetSupplierRepository();
    resetTransactionRepository();
    repo = new RechargeRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    resetSupplierRepository();
    resetTransactionRepository();
  });

  describe("topUpFromSupplier", () => {
    it.each([
      ["USD", 100] as const,
      ["LBP", 9_000_000] as const,
    ])(
      "%s, no supplier row: the drawer credit comes WITH the TOP_UP debt, and void nets to 0",
      (currency, amount) => {
        const before = snapshotLedgers(db);
        const result = repo.topUpFromSupplier({
          provider: "iPick",
          amount,
          currency,
          userId: 1,
        });
        expect(result).toEqual({ success: true });

        const iPickId = supplierIdFor(db, "iPick");
        expect(iPickId).toBeDefined();
        expectPostings(before, snapshotLedgers(db), {
          drawers: { [`iPick|${currency}`]: amount },
          supplier: { [`${iPickId}|${currency}`]: amount },
        });

        getTransactionRepository().voidTransaction(
          txnIdOfType(db, "RECHARGE_TOPUP"),
          1,
        );
        expectPostings(before, snapshotLedgers(db), {});
      },
    );

    it("an inactive supplier row is re-activated and the debt lands on it", () => {
      db.prepare(
        `INSERT INTO suppliers (name, provider, is_active, is_system) VALUES ('Katsh', 'Katsh', 0, 1)`,
      ).run();
      const katshId = (
        db.prepare(`SELECT id FROM suppliers WHERE provider = 'Katsh'`).get() as {
          id: number;
        }
      ).id;

      const before = snapshotLedgers(db);
      expect(
        repo.topUpFromSupplier({ provider: "Katsh", amount: 50, currency: "USD", userId: 1 }),
      ).toEqual({ success: true });

      expect(supplierIdFor(db, "Katsh")).toBe(katshId);
      expectPostings(before, snapshotLedgers(db), {
        drawers: { "Katsh|USD": 50 },
        supplier: { [`${katshId}|USD`]: 50 },
      });
    });

    it("when no supplier can be produced, the top-up is refused and NOTHING moves", () => {
      // A hand-added supplier already owns the name "iPick" with another
      // provider: seedSystemSuppliers must skip it (skippedByName), so
      // ensureSystemSupplier cannot return an iPick supplier.
      db.prepare(
        `INSERT INTO suppliers (name, provider, is_active) VALUES ('iPick', 'CUSTOM', 1)`,
      ).run();
      const before = snapshotLedgers(db);
      const txnsBefore = (
        db.prepare(`SELECT COUNT(*) AS n FROM transactions`).get() as { n: number }
      ).n;

      const result = repo.topUpFromSupplier({
        provider: "iPick",
        amount: 100,
        currency: "USD",
        userId: 1,
      });

      expect(result.success).toBe(false);
      expectPostings(before, snapshotLedgers(db), {});
      expect(
        (db.prepare(`SELECT COUNT(*) AS n FROM transactions`).get() as { n: number }).n,
      ).toBe(txnsBefore);
    });
  });

  describe("cashoutToSupplier", () => {
    it.each([
      ["USD", 100] as const,
      ["LBP", 9_000_000] as const,
    ])(
      "%s, no 'OMT App' supplier: the wallet debit comes WITH the account credit, and void nets to 0",
      (currency, amount) => {
        const commission = omtAppCashoutCommission(amount, currency);
        const before = snapshotLedgers(db);
        const result = repo.cashoutToSupplier({
          provider: "OMT_APP",
          amount,
          currency,
          userId: 1,
        });
        expect(result.success).toBe(true);

        const omtAppId = supplierIdFor(db, "OMT_APP");
        expect(omtAppId).toBeDefined();
        expectPostings(before, snapshotLedgers(db), {
          drawers: { [`OMT_App|${currency}`]: -amount },
          supplier: { [`${omtAppId}|${currency}`]: -(amount + commission) },
        });

        getTransactionRepository().voidTransaction(
          txnIdOfType(db, "WALLET_CASHOUT"),
          1,
        );
        expectPostings(before, snapshotLedgers(db), {});
      },
    );
  });
});
