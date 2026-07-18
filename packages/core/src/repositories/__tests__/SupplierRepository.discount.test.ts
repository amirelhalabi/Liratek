/**
 * CQ-10 — Supplier ledger discounts / write-offs.
 *
 * A supplier can forgive part of what the shop owes them, bundled with a PAY
 * cashflow (SupplierRepository.recordSupplierCashflow's `discount` param) or
 * posted standalone (writeOffSupplierDebt / SupplierService.writeOffSupplierDebt).
 * The discount MUST FIFO-cover supplier_purchases the same way a cash PAY
 * does — otherwise a "fully settled on paper" purchase batch stays open
 * forever in that report.
 *
 * Per the migration's own test (SupplierLedgerDiscountCheckMigration), the
 * discount entry_type only exists after v131 widens the CHECK — these tests
 * build their fixture with the WIDENED CHECK directly (proving the write path
 * itself, not the migration).
 *
 * Note: unlike debt/partner, there is no `notSupplierPending`-style
 * profit-recognition gate for a raw supplier_purchases batch (the only
 * supplier profit gate, `fs.is_settled`, belongs to financial_services
 * settlement, a different flow) — so this suite asserts ledger nets to 0,
 * supplier_purchases coverage, signed profit, and drawer isolation; it does
 * NOT assert a recognition-gate flip (there isn't one here).
 */

import Database from "better-sqlite3";
import { SupplierRepository } from "../SupplierRepository";
import { SupplierService } from "../../services/SupplierService";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { counterpartyMetadataSchema } from "../../validators/counterparty";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL);
    INSERT INTO users (id, username) VALUES (1, 'admin');

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
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO suppliers (id, name) VALUES (1, 'Discount Supplier');

    -- Widened CHECK (post-v131) — proves the write path, not the migration.
    CREATE TABLE supplier_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL CHECK(entry_type IN ('TOP_UP','SALE_COST','PAYMENT','ADJUSTMENT','SETTLEMENT','CASH_PRIZE','SUPPLIER_PAYS_US','DISCOUNT')),
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_by INTEGER,
      transaction_id INTEGER,
      is_auto INTEGER NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_at DATETIME,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE supplier_purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      total_usd REAL NOT NULL CHECK(total_usd > 0),
      paid_usd REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_by INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE financial_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      service_type TEXT NOT NULL DEFAULT 'BILL',
      amount REAL NOT NULL DEFAULT 0,
      is_settled INTEGER NOT NULL DEFAULT 0,
      settled_at TEXT,
      settlement_id INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 0);

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
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

function ledgerSum(db: Database.Database, supplierId: number) {
  return db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_lbp), 0) AS lbp
       FROM supplier_ledger WHERE supplier_id = ?`,
    )
    .get(supplierId) as { usd: number; lbp: number };
}

function purchaseRow(db: Database.Database, id: number) {
  return db
    .prepare(`SELECT total_usd, paid_usd FROM supplier_purchases WHERE id = ?`)
    .get(id) as { total_usd: number; paid_usd: number };
}

function discountTxn(db: Database.Database) {
  return db
    .prepare(
      `SELECT * FROM transactions WHERE type = 'COUNTERPARTY_DISCOUNT' ORDER BY id DESC LIMIT 1`,
    )
    .get() as {
    amount_usd: number;
    amount_lbp: number;
    profit_usd: number;
    profit_lbp: number;
    metadata_json: string;
    status: string;
  };
}

function drawerBalance(db: Database.Database, drawer: string, ccy: string) {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`,
    )
    .get(drawer, ccy) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

describe("CQ-10 — SupplierRepository discount/write-off", () => {
  let db: Database.Database;
  let repo: SupplierRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    resetTransactionRepository();
    repo = new SupplierRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
  });

  describe("bundled with a PAY cashflow (owed $100, paid $60, discount $40)", () => {
    let purchaseId: number;

    beforeEach(() => {
      // Accrual: the shop owes the supplier $100 (a TOP_UP, "+ = shop owes").
      db.prepare(
        `INSERT INTO supplier_ledger (supplier_id, entry_type, amount_usd, created_by) VALUES (1, 'TOP_UP', 100, 1)`,
      ).run();
      purchaseId = Number(
        db
          .prepare(
            `INSERT INTO supplier_purchases (supplier_id, total_usd) VALUES (1, 100)`,
          )
          .run().lastInsertRowid,
      );
    });

    it("nets the supplier's ledger to exactly 0 (accrual $100 − paid $60 − discount $40)", () => {
      repo.recordSupplierCashflow({
        supplier_id: 1,
        direction: "PAY",
        payments: [{ method: "CASH", currency_code: "USD", amount: 60 }],
        discount: { amount_usd: 40, amount_lbp: 0, reason: "goodwill" },
        created_by: 1,
      });
      const sum = ledgerSum(db, 1);
      expect(sum.usd).toBeCloseTo(0, 2);
      expect(sum.lbp).toBeCloseTo(0, 2);
    });

    it("advances supplier_purchases.paid_usd by cash + discount (fully paid)", () => {
      repo.recordSupplierCashflow({
        supplier_id: 1,
        direction: "PAY",
        payments: [{ method: "CASH", currency_code: "USD", amount: 60 }],
        discount: { amount_usd: 40, amount_lbp: 0 },
        created_by: 1,
      });
      const row = purchaseRow(db, purchaseId);
      expect(row.paid_usd).toBeGreaterThanOrEqual(row.total_usd - 0.005);
    });

    it("posts ONE COUNTERPARTY_DISCOUNT transaction: amount 0, profit = +discount, valid counterparty metadata", () => {
      repo.recordSupplierCashflow({
        supplier_id: 1,
        direction: "PAY",
        payments: [{ method: "CASH", currency_code: "USD", amount: 60 }],
        discount: { amount_usd: 40, amount_lbp: 0, reason: "goodwill" },
        created_by: 1,
      });
      const txn = discountTxn(db);
      expect(txn.amount_usd).toBe(0);
      expect(txn.amount_lbp).toBe(0);
      expect(txn.profit_usd).toBeCloseTo(40, 2);
      expect(txn.status).toBe("ACTIVE");

      const meta = JSON.parse(txn.metadata_json);
      const parsed = counterpartyMetadataSchema.parse(meta.counterparty);
      expect(parsed.kind).toBe("supplier");
      expect(parsed.flow).toBe("OUT");
      expect(parsed.discount?.amount_usd).toBeCloseTo(40, 2);
    });

    it("moves the drawer ONLY by the cash part ($60), never the discount", () => {
      repo.recordSupplierCashflow({
        supplier_id: 1,
        direction: "PAY",
        payments: [{ method: "CASH", currency_code: "USD", amount: 60 }],
        discount: { amount_usd: 40, amount_lbp: 0 },
        created_by: 1,
      });
      expect(drawerBalance(db, "General", "USD")).toBeCloseTo(-60, 2);
    });
  });

  describe("RECEIVE-direction discount rejected", () => {
    it("throws when discount is supplied on a RECEIVE cashflow", () => {
      expect(() =>
        repo.recordSupplierCashflow({
          supplier_id: 1,
          direction: "RECEIVE",
          payments: [{ method: "CASH", currency_code: "USD", amount: 10 }],
          discount: { amount_usd: 5, amount_lbp: 0 },
          created_by: 1,
        }),
      ).toThrow(/discount is only valid on PAY/i);

      // No rows written on rejection.
      expect(ledgerSum(db, 1).usd).toBeCloseTo(0, 2);
    });
  });

  describe("standalone write-off (repository level)", () => {
    it("posts a 'DISCOUNT' ledger row (negative) + COUNTERPARTY_DISCOUNT txn, and covers an outstanding purchase", () => {
      db.prepare(
        `INSERT INTO supplier_ledger (supplier_id, entry_type, amount_usd, created_by) VALUES (1, 'TOP_UP', 25, 1)`,
      ).run();
      const purchaseId = Number(
        db
          .prepare(
            `INSERT INTO supplier_purchases (supplier_id, total_usd) VALUES (1, 25)`,
          )
          .run().lastInsertRowid,
      );

      const result = repo.writeOffSupplierDebt({
        supplier_id: 1,
        amount_usd: 25,
        amount_lbp: 0,
        reason: "full forgiveness",
        created_by: 1,
      });
      expect(result.id).toBeGreaterThan(0);

      const ledgerRow = db
        .prepare(
          `SELECT amount_usd FROM supplier_ledger WHERE supplier_id = 1 AND entry_type = 'DISCOUNT'`,
        )
        .get() as { amount_usd: number };
      expect(ledgerRow.amount_usd).toBeCloseTo(-25, 2);
      expect(ledgerSum(db, 1).usd).toBeCloseTo(0, 2);

      const row = purchaseRow(db, purchaseId);
      expect(row.paid_usd).toBeGreaterThanOrEqual(row.total_usd - 0.005);

      // No cash moved by a pure write-off.
      expect(drawerBalance(db, "General", "USD")).toBeCloseTo(0, 2);
    });
  });

  describe("SupplierService.writeOffSupplierDebt — per-currency balance guard", () => {
    let service: SupplierService;

    beforeEach(() => {
      // SupplierService resolves its own repo via getSupplierRepository();
      // the `.db` getter it (and `repo` above) inherit from BaseRepository
      // is dynamic (always getDatabase()), so both instances read/write the
      // SAME test db regardless of which object constructed them.
      service = new SupplierService();
    });

    it("rejects a write-off that exceeds what the shop owes the supplier", () => {
      db.prepare(
        `INSERT INTO supplier_ledger (supplier_id, entry_type, amount_usd, created_by) VALUES (1, 'TOP_UP', 30, 1)`,
      ).run();
      const result = service.writeOffSupplierDebt({
        supplier_id: 1,
        amount_usd: 30.5,
        amount_lbp: 0,
        created_by: 1,
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/exceeds/i);
      expect(ledgerSum(db, 1).usd).toBeCloseTo(30, 2);
    });

    it("rejects a write-off when the shop owes the supplier nothing", () => {
      const result = service.writeOffSupplierDebt({
        supplier_id: 1,
        amount_usd: 10,
        amount_lbp: 0,
        created_by: 1,
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/no outstanding balance/i);
    });

    it("accepts a write-off within the outstanding balance", () => {
      db.prepare(
        `INSERT INTO supplier_ledger (supplier_id, entry_type, amount_usd, created_by) VALUES (1, 'TOP_UP', 30, 1)`,
      ).run();
      const result = service.writeOffSupplierDebt({
        supplier_id: 1,
        amount_usd: 30,
        amount_lbp: 0,
        created_by: 1,
      });
      expect(result.success).toBe(true);
      expect(ledgerSum(db, 1).usd).toBeCloseTo(0, 2);
    });
  });
});
