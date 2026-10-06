/**
 * LIRA-258 — CustomServiceRepository posting integrity.
 *
 * G22 (POSTING_INTEGRITY_PLAN.md item 3.5, POSTING_MAP.md §7.3):
 * `deleteService` used to call `voidTransaction` (which already writes the
 * negated reversal `payments` rows and puts the drawers back) and THEN run a
 * second pass of its own: subtract every `payments` row of the service from
 * `drawer_balances` (original + reversal, so a net no-op) and hard-DELETE
 * both the original and the reversal rows. The drawer still netted to 0, but
 * the journal was gone — Σ payments no longer explained drawer_balances'
 * history and `recalculateDrawerBalances` could only stay consistent by luck.
 * After the fix, the void's own reversal rows are the record: nothing is
 * deleted, and Σ payments per drawer == drawer_balances.
 *
 * G13 (item 2.3): change kept as store credit (a CUSTOMER_ACCOUNT OUT leg)
 * went through `DebtService.addCredit`, which swallows errors — a failed
 * credit write let the service and its cash posting commit while the
 * customer silently lost the credit. Now `addCreditOrThrow`, so the whole
 * createService transaction rolls back. The failure is forced at the
 * database level (BEFORE INSERT trigger), nothing in the path is mocked.
 */

import Database from "better-sqlite3";
import { CustomServiceRepository } from "../CustomServiceRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetDebtService } from "../../services/DebtService";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { expectPostings, snapshotLedgers } from "../testHelpers/postingAssert";

const CLIENT_ID = 7;

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

// Schema follows CustomServiceRepository.payout.test.ts (a fixture that
// already runs deleteService end to end), plus clients and the debt_ledger
// session_id column DebtRepository.addCredit writes.
function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL);
    INSERT INTO users (id, username) VALUES (1, 'admin');

    CREATE TABLE clients (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO clients (id, full_name) VALUES (${CLIENT_ID}, 'CS Client');

    CREATE TABLE custom_services (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      cost_usd REAL NOT NULL DEFAULT 0,
      cost_lbp REAL NOT NULL DEFAULT 0,
      price_usd REAL NOT NULL DEFAULT 0,
      price_lbp REAL NOT NULL DEFAULT 0,
      profit_usd REAL,
      profit_lbp REAL,
      paid_by TEXT NOT NULL DEFAULT 'CASH',
      status TEXT NOT NULL DEFAULT 'completed',
      client_id INTEGER,
      client_name TEXT,
      phone_number TEXT,
      note TEXT,
      category TEXT,
      created_by INTEGER,
      edited_by TEXT,
      edited_at DATETIME,
      is_refunded INTEGER DEFAULT 0,
      refunded_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      product_id INTEGER,
      partner_mode TEXT,
      fulfillment_status TEXT,
      fulfilled_at TEXT,
      direction TEXT NOT NULL DEFAULT 'IN',
      work_status TEXT NOT NULL DEFAULT 'Received'
    );

    CREATE TABLE partners (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      phone TEXT,
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      system_association TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE partner_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id INTEGER NOT NULL REFERENCES partners(id),
      transaction_type TEXT,
      reference_table TEXT,
      reference_id INTEGER,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      covered_amount REAL NOT NULL DEFAULT 0,
      notes TEXT,
      user_id INTEGER,
      settlement_method TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    -- Seeded at 0 so "Σ payments per drawer == drawer_balances" is a direct
    -- equality, with no opening balance to subtract.
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 0);

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
      profit_usd REAL,
      profit_lbp REAL,
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

    CREATE TABLE debt_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      transaction_type TEXT,
      amount_usd REAL,
      amount_lbp REAL,
      transaction_id INTEGER,
      note TEXT,
      created_by TEXT,
      session_id INTEGER,
      covered_usd REAL DEFAULT 0,
      covered_lbp REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      due_date DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , refunded_at TEXT DEFAULT NULL);
  `);
  return db;
}

function paymentSums(db: Database.Database): Record<string, number> {
  const rows = db
    .prepare(
      `SELECT drawer_name, currency_code, SUM(amount) AS total
         FROM payments GROUP BY drawer_name, currency_code`,
    )
    .all() as { drawer_name: string; currency_code: string; total: number }[];
  const out: Record<string, number> = {};
  for (const r of rows) out[`${r.drawer_name}|${r.currency_code}`] = r.total;
  return out;
}

function drawerBalances(db: Database.Database): Record<string, number> {
  const rows = db
    .prepare(`SELECT drawer_name, currency_code, balance FROM drawer_balances`)
    .all() as { drawer_name: string; currency_code: string; balance: number }[];
  const out: Record<string, number> = {};
  for (const r of rows) out[`${r.drawer_name}|${r.currency_code}`] = r.balance;
  return out;
}

/** Σ payments per drawer|currency must explain drawer_balances exactly. */
function expectJournalExplainsDrawers(db: Database.Database): void {
  const sums = paymentSums(db);
  for (const [key, bal] of Object.entries(drawerBalances(db))) {
    expect({ key, value: sums[key] ?? 0 }).toEqual({
      key,
      value: expect.closeTo(bal, 6),
    });
  }
}

function paymentsFor(db: Database.Database, txnId: number) {
  return db
    .prepare(
      `SELECT method, drawer_name, currency_code, amount FROM payments
        WHERE transaction_id = ? ORDER BY id ASC`,
    )
    .all(txnId) as {
    method: string;
    drawer_name: string;
    currency_code: string;
    amount: number;
  }[];
}

function count(db: Database.Database, table: string): number {
  return (
    db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }
  ).c;
}

describe("LIRA-258 — CustomServiceRepository posting integrity", () => {
  let db: Database.Database;
  let repo: CustomServiceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetTransactionRepository();
    resetDebtRepository();
    resetDebtService();
    repo = new CustomServiceRepository();
  });

  afterEach(() => {
    resetTenantContext();
    resetTransactionRepository();
    resetDebtRepository();
    resetDebtService();
    db.close();
  });

  describe("G22 — deleteService keeps the payments journal", () => {
    it("USD + LBP cash legs: drawers back to pre-create, original AND reversal payments rows survive, Σ payments == drawer_balances", () => {
      const before = snapshotLedgers(db);

      const res = repo.createService(
        {
          description: "screen repair",
          cost_usd: 10,
          cost_lbp: 0,
          price_usd: 30,
          price_lbp: 450_000,
          paid_by: "CASH",
          status: "completed",
          payments: [
            { method: "CASH", currency_code: "USD", amount: 30 },
            { method: "CASH", currency_code: "LBP", amount: 450_000 },
          ],
        },
        1,
      );
      expect(res.success).toBe(true);
      const serviceId = res.id!;
      const original = db
        .prepare(
          `SELECT id FROM transactions WHERE source_table = 'custom_services' AND source_id = ? AND reverses_id IS NULL`,
        )
        .get(serviceId) as { id: number };
      // Rule 28a — the create really posted, so the net 0 below is earned.
      expect(paymentsFor(db, original.id)).toHaveLength(2);
      expect(drawerBalances(db)["General|USD"]).toBeCloseTo(30, 6);
      expect(drawerBalances(db)["General|LBP"]).toBeCloseTo(450_000, 6);

      const del = repo.deleteService(serviceId);
      expect(del.success).toBe(true);

      // Drawers (and every other ledger) back to pre-create, per currency.
      expectPostings(before, snapshotLedgers(db), {});

      // The journal survives: original legs untouched…
      expect(paymentsFor(db, original.id)).toEqual([
        { method: "CASH", drawer_name: "General", currency_code: "USD", amount: 30 },
        { method: "CASH", drawer_name: "General", currency_code: "LBP", amount: 450_000 },
      ]);
      // …and the void's reversal row carries the negated legs.
      const reversal = db
        .prepare(`SELECT id, status FROM transactions WHERE reverses_id = ?`)
        .get(original.id) as { id: number; status: string };
      expect(reversal).toBeDefined();
      expect(paymentsFor(db, reversal.id).map((p) => [p.currency_code, p.amount])).toEqual([
        ["USD", -30],
        ["LBP", -450_000],
      ]);
      expect(
        (db.prepare(`SELECT status FROM transactions WHERE id = ?`).get(original.id) as {
          status: string;
        }).status,
      ).toBe("VOIDED");

      expectJournalExplainsDrawers(db);

      // The service row itself stays, soft-deleted (existing convention).
      expect(repo.getById(serviceId)?.status).toBe("voided");
    });

    it("split CASH + CUSTOMER_ACCOUNT: debt and drawers net to 0, cash journal kept", () => {
      const before = snapshotLedgers(db);
      const res = repo.createService(
        {
          description: "software install",
          cost_usd: 5,
          cost_lbp: 0,
          price_usd: 40,
          price_lbp: 0,
          paid_by: "CASH",
          status: "completed",
          client_id: CLIENT_ID,
          payments: [
            { method: "CASH", currency_code: "USD", amount: 25 },
            { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 15 },
          ],
        },
        1,
      );
      expect(res.success).toBe(true);
      expect(snapshotLedgers(db).debt[`${CLIENT_ID}|USD`]).toBeCloseTo(15, 6);
      const paymentsAfterCreate = count(db, "payments");
      expect(paymentsAfterCreate).toBe(1);

      expect(repo.deleteService(res.id!).success).toBe(true);

      expectPostings(before, snapshotLedgers(db), {});
      // Original cash leg + its reversal, nothing deleted.
      expect(count(db, "payments")).toBe(2);
      expectJournalExplainsDrawers(db);
    });
  });

  // Characterization (not failing-first): today deleteService picks the
  // newest ACTIVE row for the service (getBySourceId), which after an earlier
  // void/refund is the reversal row, and voidTransaction refuses it — the
  // whole delete rolls back. Identical before and after the G22 fix (the
  // throw happens before the removed code). Pinned so a future change to
  // that lookup cannot silently double-reverse a drawer now that there is no
  // second drawer pass to mask it.
  describe("G22 — deleteService after an earlier reversal from the Transactions page", () => {
    const createCash = () => {
      const res = repo.createService(
        {
          description: "battery swap",
          cost_usd: 5,
          cost_lbp: 0,
          price_usd: 20,
          price_lbp: 0,
          paid_by: "CASH",
          status: "completed",
          payments: [{ method: "CASH", currency_code: "USD", amount: 20 }],
        },
        1,
      );
      expect(res.success).toBe(true);
      const original = db
        .prepare(
          `SELECT id FROM transactions WHERE source_table = 'custom_services' AND source_id = ? AND reverses_id IS NULL`,
        )
        .get(res.id!) as { id: number };
      return { serviceId: res.id!, originalId: original.id };
    };

    it("already VOIDED, then deleted: delete is refused and rolls back — drawers stay at pre-create, Σ payments == drawer_balances", () => {
      const before = snapshotLedgers(db);
      const { serviceId, originalId } = createCash();
      getTransactionRepository().voidTransaction(originalId, 1);
      expectPostings(before, snapshotLedgers(db), {});

      const paymentsBefore = count(db, "payments");
      const del = repo.deleteService(serviceId);
      expect(del.success).toBe(false);
      expect(del.error).toContain("Cannot void or refund a reversal transaction");
      expectPostings(before, snapshotLedgers(db), {});
      expect(count(db, "payments")).toBe(paymentsBefore);
      expectJournalExplainsDrawers(db);
      expect(repo.getById(serviceId)?.status).toBe("completed");
    });

    it("already REFUNDED, then deleted: delete is refused and rolls back — drawers stay at pre-create, Σ payments == drawer_balances", () => {
      const before = snapshotLedgers(db);
      const { serviceId, originalId } = createCash();
      getTransactionRepository().refundTransaction(originalId, 1);
      expectPostings(before, snapshotLedgers(db), {});

      const paymentsBefore = count(db, "payments");
      const del = repo.deleteService(serviceId);
      expect(del.success).toBe(false);
      expect(del.error).toContain("REFUND transactions cannot be voided or refunded");
      expectPostings(before, snapshotLedgers(db), {});
      expect(count(db, "payments")).toBe(paymentsBefore);
      expectJournalExplainsDrawers(db);
      expect(repo.getById(serviceId)?.status).toBe("completed");
    });
  });

  describe("G13 — change kept as store credit cannot be silently dropped", () => {
    const createWithStoreCreditChange = () =>
      repo.createService(
        {
          description: "unlock",
          cost_usd: 2,
          cost_lbp: 0,
          price_usd: 10,
          price_lbp: 0,
          paid_by: "CASH",
          status: "completed",
          client_id: CLIENT_ID,
          payments: [
            { method: "CASH", currency_code: "USD", amount: 15 },
            {
              method: "CUSTOMER_ACCOUNT",
              currency_code: "USD",
              amount: 5,
              direction: "OUT",
            },
          ],
        },
        1,
      );

    it("sanity: a working credit write books +$15 cash and a $5 CREDIT_DEPOSIT", () => {
      const before = snapshotLedgers(db);
      const res = createWithStoreCreditChange();
      expect(res.success).toBe(true);
      expectPostings(before, snapshotLedgers(db), {
        drawers: { "General|USD": 15 },
        debt: { [`${CLIENT_ID}|USD`]: -5 },
      });
    });

    it("a failed credit write rolls the WHOLE service back — no cash, no service, no transaction", () => {
      db.exec(`
        CREATE TRIGGER fail_credit_deposit BEFORE INSERT ON debt_ledger
        WHEN NEW.transaction_type = 'CREDIT_DEPOSIT'
        BEGIN SELECT RAISE(ABORT, 'simulated credit write failure'); END;
      `);
      const before = snapshotLedgers(db);
      const servicesBefore = count(db, "custom_services");
      const txnsBefore = count(db, "transactions");
      const paymentsBefore = count(db, "payments");

      const res = createWithStoreCreditChange();

      expect(res.success).toBe(false);
      expectPostings(before, snapshotLedgers(db), {});
      expect(count(db, "custom_services")).toBe(servicesBefore);
      expect(count(db, "transactions")).toBe(txnsBefore);
      expect(count(db, "payments")).toBe(paymentsBefore);
    });
  });
});
