/**
 * SupplierRepository — CQ-7 journal integrity (funnel + dead-corner fixes)
 *
 * docs/plans/todo_plans/COUNTERPARTY_CONSOLIDATION_PLAN.md — CQ-7. Four
 * fixes proven here; every one is constructed to FAIL on pre-fix code
 * (rule 17):
 *
 *  1. settleTransactions()/recordSupplierCashflow() funnel their unified
 *     transaction row through TransactionRepository.createTransaction()
 *     instead of a raw `INSERT INTO transactions` — the row now gains the
 *     funnel's exchange-rate snapshot (pre-fix: always NULL, since the raw
 *     INSERT never set the column).
 *  2. addLedgerEntry's dead corner: entry_type "PAYMENT" with NO drawer_name
 *     now creates the same journal-only SUPPLIER_PAYMENT transaction row the
 *     non-PAYMENT branch already created (pre-fix: no transaction row at
 *     all — the ledger row was an orphan).
 *  3. addLedgerEntry rejects drawer_name paired with any entry_type other
 *     than "PAYMENT" (pre-fix: silent no-op — drawer_name was prepared but
 *     never used for TOP_UP/SALE_COST/ADJUSTMENT/SETTLEMENT/SUPPLIER_PAYS_US).
 *  4. addLedgerEntry's new link-mode (`transaction_id` in the input) stamps
 *     the given id and creates NO second transaction row — the caller's own
 *     flow already made one in the same db.transaction().
 *
 * Also covers the `method` field (defaults "CASH", same as the pre-fix
 * hardcoded literal) on the PAYMENT+drawer branch.
 */

import Database from "better-sqlite3";
import { SupplierRepository } from "../SupplierRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

// ─── In-memory schema (mirrors SupplierRepository.settlement.test.ts, plus
// an exchange_rates table for the snapshot assertions) ─────────────────────

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
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE supplier_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL CHECK(entry_type IN ('TOP_UP','SALE_COST','PAYMENT','ADJUSTMENT','SETTLEMENT','CASH_PRIZE','SUPPLIER_PAYS_US')),
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

    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      service_type TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'USD',
      commission REAL DEFAULT 0,
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
      session_id     INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- recordSupplierCashflow's PAY branch always queries this table for FIFO
    -- purchase coverage.
    CREATE TABLE supplier_purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      total_usd REAL NOT NULL,
      paid_usd REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_by INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Exchange-rate snapshot source (TransactionRepository.snapshotExchangeRate
    -- reads the LBP row here). Mirrors TransactionRepository.createGuards.test.ts.
    CREATE TABLE exchange_rates (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      to_code     TEXT NOT NULL,
      market_rate REAL NOT NULL,
      buy_rate    REAL NOT NULL DEFAULT 0,
      sell_rate   REAL NOT NULL DEFAULT 0,
      is_stronger INTEGER NOT NULL DEFAULT 1,
      tenant_id   INTEGER NOT NULL DEFAULT 1,
      updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Seed drawers
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 1000);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_System', 'USD', 500);
  `);

  return db;
}

jest.mock("../../db/connection", () => {
  let _db: Database.Database | null = null;
  return {
    getDatabase: () => {
      if (!_db) throw new Error("DB not initialized");
      return _db;
    },
    setDb: (db: Database.Database) => {
      _db = db;
    },
  };
});

function seedSupplier(db: Database.Database, provider = "OMT"): number {
  const res = db
    .prepare(
      "INSERT INTO suppliers (name, provider, is_system) VALUES (?, ?, 1)",
    )
    .run(provider, provider);
  return Number(res.lastInsertRowid);
}

function seedUnsettledTransaction(
  db: Database.Database,
  provider: string,
  amount: number,
  commission: number,
): number {
  const res = db
    .prepare(
      `INSERT INTO financial_services
         (provider, service_type, amount, currency, commission, is_settled)
       VALUES (?, 'RECEIVE', ?, 'USD', ?, 0)`,
    )
    .run(provider, amount, commission);
  return Number(res.lastInsertRowid);
}

function seedLbpRate(db: Database.Database, marketRate: number): void {
  db.prepare(
    `INSERT INTO exchange_rates (to_code, market_rate, buy_rate, sell_rate, is_stronger, tenant_id)
     VALUES ('LBP', ?, ?, ?, 1, 1)`,
  ).run(marketRate, marketRate, marketRate);
}

function insertBareTransaction(db: Database.Database): number {
  // A transaction row created by SOME OTHER flow (standing in for e.g. a
  // RECHARGE_TOPUP row) — used to prove addLedgerEntry's link-mode reuses it
  // rather than minting a second one.
  const res = db
    .prepare(
      `INSERT INTO transactions (type, source_table, source_id, user_id, amount_usd, amount_lbp, summary, metadata_json, tenant_id)
       VALUES ('RECHARGE_TOPUP', 'recharges', 1, 1, 10, 0, 'Stand-in txn', '{}', 1)`,
    )
    .run();
  return Number(res.lastInsertRowid);
}

function countTransactions(db: Database.Database): number {
  return (
    db.prepare("SELECT COUNT(*) as cnt FROM transactions").get() as {
      cnt: number;
    }
  ).cnt;
}

describe("SupplierRepository — CQ-7 journal integrity", () => {
  let db: Database.Database;
  let repo: SupplierRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetTransactionRepository();
    repo = new SupplierRepository();
  });

  afterEach(() => {
    db.close();
    resetTransactionRepository();
    resetTenantContext();
  });

  // ── Fix #1: settle/cashflow funnel through createTransaction ────────────

  describe("exchange-rate snapshot on the funnel (bug fix #1)", () => {
    it("settleTransactions() stamps the transaction's exchange_rate from the configured LBP market rate", () => {
      seedLbpRate(db, 89_500);
      const supplierId = seedSupplier(db);
      const txnId = seedUnsettledTransaction(db, "OMT", 100, 0.1);

      repo.settleTransactions({
        supplier_id: supplierId,
        financial_service_ids: [txnId],
        amount_usd: 99.9,
        amount_lbp: 0,
        commission_usd: 0.1,
        commission_lbp: 0,
        created_by: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 99.9 }],
      });

      const txn = db
        .prepare(
          "SELECT exchange_rate FROM transactions WHERE type = 'SUPPLIER_SETTLEMENT'",
        )
        .get() as { exchange_rate: number | null };
      // Pre-fix: NULL (the raw INSERT never touched exchange_rate at all).
      expect(txn.exchange_rate).toBe(89_500);
    });

    it("recordSupplierCashflow() stamps the transaction's exchange_rate from the configured LBP market rate", () => {
      seedLbpRate(db, 90_000);
      const supplierId = seedSupplier(db);

      repo.recordSupplierCashflow({
        supplier_id: supplierId,
        direction: "PAY",
        payments: [{ method: "CASH", currency_code: "USD", amount: 50 }],
        created_by: 1,
      });

      const txn = db
        .prepare(
          "SELECT exchange_rate FROM transactions WHERE type = 'SUPPLIER_PAYMENT'",
        )
        .get() as { exchange_rate: number | null };
      // Pre-fix: NULL.
      expect(txn.exchange_rate).toBe(90_000);
    });

    // note 14 — thin-summary enrichment: recordSupplierCashflow's summary
    // already branches PAY vs RECEIVE wording but was missing the supplier's
    // name; appended after the existing prefix in both directions.
    it("PAY cashflow summary reads 'Supplier Payment: ... — paid to <name>'", () => {
      const supplierId = seedSupplier(db, "Acme Corp");

      repo.recordSupplierCashflow({
        supplier_id: supplierId,
        direction: "PAY",
        payments: [{ method: "CASH", currency_code: "USD", amount: 50 }],
        created_by: 1,
      });

      const txn = db
        .prepare(
          "SELECT summary FROM transactions WHERE type = 'SUPPLIER_PAYMENT'",
        )
        .get() as { summary: string };
      expect(txn.summary.startsWith("Supplier Payment: $50.00")).toBe(true);
      expect(txn.summary).toContain("paid to Acme Corp");
    });

    it("RECEIVE cashflow summary reads 'Supplier Payment Received: ... — received from <name>'", () => {
      const supplierId = seedSupplier(db, "Beta Ltd");

      repo.recordSupplierCashflow({
        supplier_id: supplierId,
        direction: "RECEIVE",
        payments: [{ method: "CASH", currency_code: "USD", amount: 30 }],
        created_by: 1,
      });

      const txn = db
        .prepare(
          "SELECT summary FROM transactions WHERE type = 'SUPPLIER_PAYMENT'",
        )
        .get() as { summary: string };
      expect(txn.summary.startsWith("Supplier Payment Received: $30.00")).toBe(
        true,
      );
      expect(txn.summary).toContain("received from Beta Ltd");
    });

    it("still fails soft to NULL when no LBP rate is configured (no regression)", () => {
      const supplierId = seedSupplier(db);
      const txnId = seedUnsettledTransaction(db, "OMT", 100, 0.1);

      repo.settleTransactions({
        supplier_id: supplierId,
        financial_service_ids: [txnId],
        amount_usd: 99.9,
        amount_lbp: 0,
        commission_usd: 0.1,
        commission_lbp: 0,
        created_by: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 99.9 }],
      });

      const txn = db
        .prepare(
          "SELECT exchange_rate FROM transactions WHERE type = 'SUPPLIER_SETTLEMENT'",
        )
        .get() as { exchange_rate: number | null };
      expect(txn.exchange_rate).toBeNull();
    });
  });

  // ── Fix #2: PAYMENT without drawer_name creates a linked journal txn ────

  describe("addLedgerEntry — PAYMENT without drawer_name (bug fix #2)", () => {
    it("creates a linked journal-only SUPPLIER_PAYMENT transaction row", () => {
      const supplierId = seedSupplier(db);

      const result = repo.addLedgerEntry({
        supplier_id: supplierId,
        entry_type: "PAYMENT",
        amount_usd: 40,
        amount_lbp: 0,
        created_by: 1,
        note: "Paid via bank transfer (no drawer)",
      });

      const ledgerRow = db
        .prepare(
          "SELECT transaction_id, amount_usd FROM supplier_ledger WHERE id = ?",
        )
        .get(result.id) as {
        transaction_id: number | null;
        amount_usd: number;
      };
      // Pre-fix: transaction_id stayed NULL — no transaction row existed at all.
      expect(ledgerRow.transaction_id).not.toBeNull();
      expect(ledgerRow.amount_usd).toBeCloseTo(-40, 2); // sign convention unchanged

      const txn = db
        .prepare("SELECT * FROM transactions WHERE id = ?")
        .get(ledgerRow.transaction_id) as {
        type: string;
        source_table: string;
        source_id: number;
        summary: string;
      };
      expect(txn).toBeDefined();
      expect(txn.type).toBe("SUPPLIER_PAYMENT");
      expect(txn.source_table).toBe("supplier_ledger");
      expect(txn.source_id).toBe(result.id);
      expect(txn.summary).toBeTruthy();
      // note 14 — thin-summary enrichment: supplier name appended after the
      // existing "Supplier Payment: $X + Y LBP" prefix.
      expect(txn.summary.startsWith("Supplier Payment: $40 + 0 LBP")).toBe(
        true,
      );
      expect(txn.summary).toContain("OMT");
    });

    it("shows the paid magnitude (positive) on the transaction row, not the negated ledger sign", () => {
      const supplierId = seedSupplier(db);
      const result = repo.addLedgerEntry({
        supplier_id: supplierId,
        entry_type: "PAYMENT",
        amount_usd: 25,
        amount_lbp: 0,
        created_by: 1,
      });
      const ledgerRow = db
        .prepare("SELECT transaction_id FROM supplier_ledger WHERE id = ?")
        .get(result.id) as { transaction_id: number };
      const txn = db
        .prepare("SELECT amount_usd FROM transactions WHERE id = ?")
        .get(ledgerRow.transaction_id) as { amount_usd: number };
      expect(txn.amount_usd).toBeCloseTo(25, 2);
    });
  });

  // ── Fix #3: drawer_name is rejected for any non-PAYMENT entry_type ──────

  describe("addLedgerEntry — drawer_name only valid with entry_type PAYMENT (bug fix #3)", () => {
    it("throws for TOP_UP + drawer_name (pre-fix: silent no-op)", () => {
      const supplierId = seedSupplier(db);
      expect(() =>
        repo.addLedgerEntry({
          supplier_id: supplierId,
          entry_type: "TOP_UP",
          amount_usd: 10,
          amount_lbp: 0,
          created_by: 1,
          drawer_name: "General",
        }),
      ).toThrow(/drawer_name/i);
    });

    it("throws for ADJUSTMENT + drawer_name (pre-fix: silent no-op)", () => {
      const supplierId = seedSupplier(db);
      expect(() =>
        repo.addLedgerEntry({
          supplier_id: supplierId,
          entry_type: "ADJUSTMENT",
          amount_usd: 10,
          amount_lbp: 0,
          created_by: 1,
          drawer_name: "General",
        }),
      ).toThrow(/drawer_name/i);
    });

    it("does NOT write any row when the guard rejects the combo", () => {
      const supplierId = seedSupplier(db);
      expect(() =>
        repo.addLedgerEntry({
          supplier_id: supplierId,
          entry_type: "SETTLEMENT",
          amount_usd: 10,
          amount_lbp: 0,
          created_by: 1,
          drawer_name: "General",
        }),
      ).toThrow();
      const count = (
        db.prepare("SELECT COUNT(*) as cnt FROM supplier_ledger").get() as {
          cnt: number;
        }
      ).cnt;
      expect(count).toBe(0);
    });

    it("still succeeds for PAYMENT + drawer_name (the one valid combo)", () => {
      const supplierId = seedSupplier(db);
      expect(() =>
        repo.addLedgerEntry({
          supplier_id: supplierId,
          entry_type: "PAYMENT",
          amount_usd: 10,
          amount_lbp: 0,
          created_by: 1,
          drawer_name: "General",
        }),
      ).not.toThrow();
    });
  });

  // ── Fix #4 / enabler: link-mode creates no second transaction row ───────

  describe("addLedgerEntry — link-mode (transaction_id)", () => {
    it("stamps the given transaction_id and creates NO new transaction row", () => {
      const existingTxnId = insertBareTransaction(db);
      const before = countTransactions(db);
      const supplierId = seedSupplier(db);

      const result = repo.addLedgerEntry({
        supplier_id: supplierId,
        entry_type: "TOP_UP",
        amount_usd: 5,
        amount_lbp: 0,
        created_by: 1,
        transaction_id: existingTxnId,
      });

      const after = countTransactions(db);
      expect(after).toBe(before); // no NEW transaction row created

      const ledgerRow = db
        .prepare("SELECT transaction_id FROM supplier_ledger WHERE id = ?")
        .get(result.id) as { transaction_id: number };
      expect(ledgerRow.transaction_id).toBe(existingTxnId);
    });

    it("link-mode also works for entry_type PAYMENT (skips the drawer-based txn creation)", () => {
      const existingTxnId = insertBareTransaction(db);
      const before = countTransactions(db);
      const supplierId = seedSupplier(db);

      const result = repo.addLedgerEntry({
        supplier_id: supplierId,
        entry_type: "PAYMENT",
        amount_usd: 5,
        amount_lbp: 0,
        created_by: 1,
        transaction_id: existingTxnId,
      });

      expect(countTransactions(db)).toBe(before);
      const ledgerRow = db
        .prepare(
          "SELECT transaction_id, amount_usd FROM supplier_ledger WHERE id = ?",
        )
        .get(result.id) as { transaction_id: number; amount_usd: number };
      expect(ledgerRow.transaction_id).toBe(existingTxnId);
      expect(ledgerRow.amount_usd).toBeCloseTo(-5, 2); // sign convention still applied
    });
  });

  // ── method field on the PAYMENT+drawer branch (bug fix #3 continued) ────

  describe("addLedgerEntry — configurable payments-row method (bug fix: hardcoded 'CASH')", () => {
    it("defaults to CASH when method is omitted (existing-caller behavior, unchanged)", () => {
      const supplierId = seedSupplier(db);
      const result = repo.addLedgerEntry({
        supplier_id: supplierId,
        entry_type: "PAYMENT",
        amount_usd: 30,
        amount_lbp: 0,
        drawer_name: "General",
        created_by: 1,
      });
      const ledgerRow = db
        .prepare("SELECT transaction_id FROM supplier_ledger WHERE id = ?")
        .get(result.id) as { transaction_id: number };
      const payment = db
        .prepare("SELECT method FROM payments WHERE transaction_id = ?")
        .get(ledgerRow.transaction_id) as { method: string };
      expect(payment.method).toBe("CASH");
    });

    it("uses the given method for the payments row when provided", () => {
      const supplierId = seedSupplier(db);
      const result = repo.addLedgerEntry({
        supplier_id: supplierId,
        entry_type: "PAYMENT",
        amount_usd: 30,
        amount_lbp: 0,
        drawer_name: "General",
        created_by: 1,
        method: "WHISH",
      });
      const ledgerRow = db
        .prepare("SELECT transaction_id FROM supplier_ledger WHERE id = ?")
        .get(result.id) as { transaction_id: number };
      const payment = db
        .prepare("SELECT method FROM payments WHERE transaction_id = ?")
        .get(ledgerRow.transaction_id) as { method: string };
      expect(payment.method).toBe("WHISH");
    });
  });
});
