/**
 * BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md Phase B — LIRA-078 refund-override on a
 * fee-on-top RECEIVE (plan §2 bug 4).
 *
 * A fee-on-top OMT/WHISH RECEIVE books TWO overridable legs in the SAME
 * currency with OPPOSITE signs: the payout (shop pays the customer x, a
 * negative leg) and the customer-paid fee (the customer pays f back, a
 * positive leg) — net = f - x, always negative since f < x. Before this
 * phase, `_validateRefundLegOverride` compared that SIGNED negative net
 * directly against the operator's POSITIVE override sum (every override leg
 * amount is validated > 0), so `|f - x - override| ` always exceeded epsilon
 * and every such refund hard-rejected; and even if validation had passed,
 * `_reversePayments`'s override-application loop always wrote
 * `-leg.amount`, which would have subtracted from the drawer instead of
 * ADDING back the money the shop had paid out — leaving the fee credited to
 * the drawer forever.
 *
 * RULE 17 (failing-first): every case below was proven failing against the
 * pre-Phase-B repository (i.e. `_validateRefundLegOverride` comparing the
 * signed `originalNet` directly to `overrideNet`, and `_reversePayments`'s
 * override loop always negating `leg.amount`) — see the task's final report
 * for the exact revert/observed-failure/restore transcript. Case (a) failed
 * with "Refund method override: USD totals do not match the original
 * payment — original -95, refund legs total 95" pre-fix; case (b) already
 * throws pre-fix (a rejection path, not a behavioral flip — kept here to
 * pin the exact wrong-magnitude message post-fix too); case (c) is the
 * unchanged-behavior regression guard for the plain money-IN path this
 * phase must not disturb.
 *
 * Harness: same in-memory schema/mock pattern as
 * FinancialServiceRepository.receiveFeeLegs.test.ts (Phase A's fixture),
 * plus a `payment_methods` table — required because
 * `_validateRefundLegOverride` calls `paymentMethodRepo.getByCode(...)`
 * UNCAUGHT (unlike `isDrawerAffectingMethod`'s try/catch fallback), so a
 * missing table would throw before the money-contract assertion is even
 * reached.
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import {
  TransactionRepository,
  resetTransactionRepository,
  type RefundLegOverride,
} from "../TransactionRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { resetSupplierRepository } from "../SupplierRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";

// ─── Mock DB connection (shared by all sub-repositories) ─────────────────────

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
    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1, id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, role TEXT DEFAULT 'staff');
    INSERT INTO users (id, username, role) VALUES (1, 'admin', 'admin');

    CREATE TABLE clients (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE partners (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE financial_services (
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
      client_id INTEGER REFERENCES clients(id),
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
      is_settled INTEGER NOT NULL DEFAULT 1,
      settled_at TEXT,
      settlement_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER,
      paid_amount REAL DEFAULT NULL,
      paid_currency TEXT DEFAULT NULL,
      partner_id INTEGER REFERENCES partners(id),
      partner_mode TEXT CHECK(partner_mode IN ('THROUGH', 'FOR')),
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL
    );

    CREATE TABLE partner_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id INTEGER NOT NULL REFERENCES partners(id),
      transaction_type TEXT NOT NULL,
      reference_table TEXT,
      reference_id INTEGER,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      notes TEXT,
      user_id INTEGER REFERENCES users(id),
      settlement_method TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
      exchange_rate REAL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
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

    CREATE TABLE payment_methods (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      label TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      affects_drawer INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO payment_methods (code, label, drawer_name, affects_drawer, is_active, is_system) VALUES
      ('CASH', 'Cash', 'General', 1, 1, 1),
      ('OMT', 'OMT Wallet', 'OMT_App', 1, 1, 0),
      ('WHISH', 'Whish Wallet', 'Whish_App', 1, 1, 0),
      ('CUSTOMER_ACCOUNT', 'Customer Account', 'General', 0, 1, 1),
      ('OLDCARD', 'Retired Card Method', 'General', 1, 0, 0);

    CREATE TABLE suppliers (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_name TEXT,
      phone TEXT,
      note TEXT,
      provider TEXT,
      is_active INTEGER DEFAULT 1,
      is_system INTEGER DEFAULT 0,
      module_key TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE system_settings (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_name TEXT NOT NULL UNIQUE,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

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
      covered_usd REAL NOT NULL DEFAULT 0,
      covered_lbp REAL NOT NULL DEFAULT 0
    );

    -- Needed only by case (c)'s plain SALE-shaped fixture — refundTransaction's
    -- SALE-specific step (mark sale/items refunded, restore stock) touches
    -- these tables whenever source_table = 'sales'.
    CREATE TABLE sales (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT DEFAULT 'completed',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE sale_items (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      product_id INTEGER,
      quantity INTEGER NOT NULL DEFAULT 1,
      is_refunded INTEGER DEFAULT 0
    );
    CREATE TABLE products (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      stock_quantity INTEGER NOT NULL DEFAULT 0
    );

    -- Included for schema completeness; NOT queried on this code path since
    -- every call below passes an explicit exchangeRate.
    CREATE TABLE currencies (
      tenant_id INTEGER DEFAULT 1,
      code TEXT PRIMARY KEY,
      name TEXT
    );
    CREATE TABLE currency_drawers (
      tenant_id INTEGER DEFAULT 1,
      currency_code TEXT NOT NULL,
      drawer_name TEXT NOT NULL
    );

    INSERT INTO drawer_balances VALUES (1, 'General',      'USD', 1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General',      'LBP', 100000000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_App',      'USD', 500,  CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Whish_App',    'USD', 500,  CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_System',   'USD', 500,  CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Whish_System', 'USD', 500,  CURRENT_TIMESTAMP);

    -- Primary (base) system supplier row — required for the supplier-ledger
    -- auto-booking block to fire at all (getByProvider lookup).
    INSERT INTO suppliers (name, provider, is_system) VALUES ('OMT', 'OMT', 1);
    INSERT INTO system_settings (key_name, value) VALUES ('shop_base_system', 'OMT');
  `);

  return db;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DRAWERS: Array<[string, string]> = [
  ["General", "USD"],
  ["OMT_System", "USD"],
  ["OMT_App", "USD"],
  ["Whish_App", "USD"],
];

function balance(
  db: Database.Database,
  drawer: string,
  currency: string,
): number {
  const row = db
    .prepare(
      "SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?",
    )
    .get(drawer, currency) as { balance: number } | undefined;
  return row ? row.balance : 0;
}

function snapshotDrawers(db: Database.Database): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, currency] of DRAWERS) {
    out[`${name}_${currency}`] = balance(db, name, currency);
  }
  return out;
}

function txnIdForFsRow(db: Database.Database, fsId: number): number {
  const row = db
    .prepare(
      "SELECT id FROM transactions WHERE source_table = 'financial_services' AND source_id = ?",
    )
    .get(fsId) as { id: number } | undefined;
  if (!row)
    throw new Error(`No transaction row found for financial_services #${fsId}`);
  return row.id;
}

function rowCount(db: Database.Database, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as {
    c: number;
  };
  return row.c;
}

describe("TransactionRepository — refund method-override on a fee-on-top RECEIVE (BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md Phase B)", () => {
  let db: Database.Database;
  let fsRepo: FinancialServiceRepository;
  let txnRepo: TransactionRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetSupplierRepository();
    resetTransactionRepository();
    resetPaymentMethodRepository();
    fsRepo = new FinancialServiceRepository();
    txnRepo = new TransactionRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    resetSupplierRepository();
    resetTransactionRepository();
    resetPaymentMethodRepository();
  });

  /** x=100 payout, f=5 CASH fee leg, cashoutMethod CASH — matches
   *  FinancialServiceRepository.receiveFeeLegs.test.ts case (a) exactly, so
   *  this file's baseline (-95 on OMT_System) is directly diffable against
   *  it. */
  function createFeeOnTopReceive(): number {
    const { id: fsId } = fsRepo.createTransaction({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 1,
      omtFee: 5,
      cashoutMethod: "CASH",
      feePayments: [{ method: "CASH", currencyCode: "USD", amount: 5 }],
      exchangeRate: 90000,
    });
    return fsId;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // (a) FAILING-FIRST: override refund on a fee-on-top RECEIVE nets to 0
  // ═══════════════════════════════════════════════════════════════════════
  it("(a) a $100/$5-fee RECEIVE refunded via a $95 CASH override nets every drawer to 0", () => {
    const before = snapshotDrawers(db);

    const fsId = createFeeOnTopReceive();
    const txnId = txnIdForFsRow(db, fsId);

    const afterCreate = snapshotDrawers(db);
    // Sanity on the forward state (matches Phase A's case (a) exactly): the
    // PCD absorbs -100 (payout) + 5 (fee) = -95.
    expect(afterCreate.OMT_System_USD - before.OMT_System_USD).toBeCloseTo(
      -95,
      5,
    );

    const refundLegs: RefundLegOverride[] = [
      { method: "CASH", currencyCode: "USD", amount: 95 },
    ];
    const refundId = txnRepo.refundTransaction(txnId, 1, { refundLegs });

    const afterRefund = snapshotDrawers(db);
    for (const [name, currency] of DRAWERS) {
      const key = `${name}_${currency}`;
      expect(afterRefund[key] - before[key]).toBeCloseTo(0, 5);
    }

    // The override leg itself: a POSITIVE +95 (restoring the ORIGINAL net's
    // sign, which was negative — see _validateRefundLegOverride's doc), not
    // -95 — this is the exact assertion that would fail pre-fix (the old
    // code always wrote -leg.amount regardless of the original net's sign).
    const overrideLeg = db
      .prepare(
        `SELECT method, drawer_name, amount, note FROM payments
         WHERE transaction_id = ? AND note LIKE '%method override%'`,
      )
      .get(refundId) as {
      method: string;
      drawer_name: string;
      amount: number;
      note: string;
    };
    expect(overrideLeg.method).toBe("CASH");
    expect(overrideLeg.drawer_name).toBe("OMT_System");
    expect(overrideLeg.amount).toBeCloseTo(95, 5);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // (b) wrong-magnitude override still hard-rejects
  // ═══════════════════════════════════════════════════════════════════════
  it("(b) an override summing to 60 (not 95) is rejected — nothing partial written", () => {
    const fsId = createFeeOnTopReceive();
    const txnId = txnIdForFsRow(db, fsId);
    const before = snapshotDrawers(db);
    const paymentsCountBefore = rowCount(db, "payments");
    const txnCountBefore = rowCount(db, "transactions");

    expect(() =>
      txnRepo.refundTransaction(txnId, 1, {
        refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 60 }],
      }),
    ).toThrow(/do not match/i);

    expect(snapshotDrawers(db)).toEqual(before);
    expect(rowCount(db, "payments")).toBe(paymentsCountBefore);
    expect(rowCount(db, "transactions")).toBe(txnCountBefore);
  });

  it("(b2) an override summing to 200 (too much) is also rejected", () => {
    const fsId = createFeeOnTopReceive();
    const txnId = txnIdForFsRow(db, fsId);

    expect(() =>
      txnRepo.refundTransaction(txnId, 1, {
        refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 200 }],
      }),
    ).toThrow(/do not match/i);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // (c) money-IN regression: a plain positive-net row overridden to another
  // method must behave EXACTLY as before this phase — the sign-restore logic
  // must not perturb the already-correct positive-net path.
  // ═══════════════════════════════════════════════════════════════════════
  it("(c) a plain money-IN CASH leg refunded via an OMT override still debits OMT_App by -100 (unchanged)", () => {
    const before = snapshotDrawers(db);

    const txn = db
      .prepare(
        `INSERT INTO transactions (type, source_table, source_id, user_id, amount_usd, summary, tenant_id)
         VALUES ('SALE', 'sales', 1, 1, 100, 'Cash sale', 1)`,
      )
      .run();
    const txnId = Number(txn.lastInsertRowid);
    db.prepare(
      `INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount, note, created_by, tenant_id)
       VALUES (?, 'CASH', 'General', 'USD', 100, NULL, 1, 1)`,
    ).run(txnId);
    db.prepare(
      `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance)
       VALUES (1, 'General', 'USD', 100)
       ON CONFLICT(tenant_id, drawer_name, currency_code) DO UPDATE SET balance = drawer_balances.balance + excluded.balance`,
    ).run();

    const afterCash = snapshotDrawers(db);
    expect(afterCash.General_USD - before.General_USD).toBeCloseTo(100, 2);

    const refundId = txnRepo.refundTransaction(txnId, 1, {
      refundLegs: [{ method: "OMT", currencyCode: "USD", amount: 100 }],
    });

    const after = snapshotDrawers(db);
    // Untouched — the CASH leg is replaced by the override, never mirrored.
    expect(after.General_USD - before.General_USD).toBeCloseTo(100, 2);
    // Chosen drawer absorbs the refund instead (unchanged sign from before
    // this phase: a positive original net still reverses by SUBTRACTING).
    expect(after.OMT_App_USD - before.OMT_App_USD).toBeCloseTo(-100, 2);

    const overrideLeg = db
      .prepare(
        `SELECT amount, note FROM payments WHERE transaction_id = ? AND method = 'OMT'`,
      )
      .get(refundId) as { amount: number; note: string };
    expect(overrideLeg.amount).toBeCloseTo(-100, 2);
    expect(overrideLeg.note).toMatch(/method override/i);
  });
});
