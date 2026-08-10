/**
 * BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md Phase A — `feePayments[]` on a system
 * RECEIVE with a fee ON TOP (`includingFees` false/omitted).
 *
 * Owner decision #1 (2026-08-06): "It doesn't only arrive as cash. The
 * customer can pay by wish, can pay by any payment method we have in the
 * system." Split allowed, any real tender method including CUSTOMER_ACCOUNT.
 *
 * Notation (shared with OmtSystemFeeCharacterization.test.ts, FEATURE_GUIDE
 * §8.1): x = principal, f = customer-facing fee, c = the shop's commission.
 * Every case here uses OMT / USD / x=100 / f=5 / c=1 (the same numbers
 * OmtSystemFeeCharacterization CASE 1 uses), so the fee-leg cases are
 * directly diffable against that file's baseline (bare `+f`/no-fee cases).
 *
 * Plan §1.4 per-case table:
 *
 *   Fee via CASH              → PCD -x, PCD +f   | receivable 0 | owed -(x-(f-c)) | net +c
 *   Fee via WHISH wallet      → PCD -x, Whish_App +f | receivable 0 | owed same | net +c
 *   Fee split CASH+OMT wallet → PCD -x, PCD +f1, OMT_App +f2 | receivable 0 | net +c
 *   Fee via CUSTOMER_ACCOUNT  → PCD -x            | receivable +f | owed same | net +c
 *
 * This file shares the exact harness (in-memory schema, jest.mock on
 * db/connection, snapshot/assertInvariant helpers) as
 * OmtSystemFeeCharacterization.test.ts — see that file for the harness
 * rationale. Extended here with `is_refunded`/`refunded_at` columns on
 * `financial_services` (required by TransactionRepository._markSourceRefunded
 * for the reversal-symmetry cases, i) and a `TransactionRepository` instance
 * for `voidTransaction`.
 *
 * RULE 17 (failing-first): every case below was proven failing against the
 * pre-Phase-A repository by reverting ONLY the new fee-handling block inside
 * `createTransaction`'s RECEIVE branch back to its previous single-implicit-
 * "FEE"-leg shape (no `!skipSystemDrawer` gate, no `feePayments` branch), and
 * separately reverting ONLY the two new `.refine()`s on
 * `createFinancialServiceSchema` for the schema-level case (f). See the
 * task's final report for the exact revert/observed-failure/restore
 * transcript — this file's production code is the POST-fix state.
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import { TransactionRepository } from "../TransactionRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { resetSupplierRepository } from "../SupplierRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { createFinancialServiceSchema } from "../../validators/financial";

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

// ─── Mock DebtService (only used by CUSTOMER_ACCOUNT cashout — unused here;
// every case in this file uses cashoutMethod CASH for the payout, only the
// FEE leg varies) ──────────────────────────────────────────────────────────

jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: jest.fn() }),
  resetDebtService: jest.fn(),
}));

// ─── In-memory schema — same as OmtSystemFeeCharacterization.test.ts, plus
// is_refunded/refunded_at on financial_services (needed for voidTransaction's
// _markSourceRefunded, exercised by the reversal-symmetry cases) ────────────

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1,id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, role TEXT DEFAULT 'staff');
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
      commission_model INTEGER NOT NULL DEFAULT 0,
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

function supplierLedgerSumUsd(db: Database.Database, provider: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(sl.amount_usd), 0) as total
         FROM supplier_ledger sl JOIN suppliers s ON s.id = sl.supplier_id
        WHERE s.provider = ?`,
    )
    .get(provider) as { total: number };
  return row.total;
}

function debtLedgerSumUsd(db: Database.Database): number {
  const row = db
    .prepare(`SELECT COALESCE(SUM(amount_usd), 0) as total FROM debt_ledger`)
    .get() as { total: number };
  return row.total;
}

function rowCount(db: Database.Database, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as {
    c: number;
  };
  return row.c;
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

/** Every payment row this transaction's fee leg(s) wrote (matched by note —
 *  the discriminator per owner decision #9, since the method column now
 *  stores the real tender). */
function feeLegRows(
  db: Database.Database,
  fsId: number,
): Array<{
  method: string;
  drawer_name: string;
  currency_code: string;
  amount: number;
  note: string;
}> {
  const txnId = txnIdForFsRow(db, fsId);
  return db
    .prepare(
      `SELECT method, drawer_name, currency_code, amount, note
       FROM payments WHERE transaction_id = ? AND note LIKE '%RECEIVE fee (customer-paid)%'`,
    )
    .all(txnId) as Array<{
    method: string;
    drawer_name: string;
    currency_code: string;
    amount: number;
    note: string;
  }>;
}

// Drawers snapshotted for every case.
const DRAWERS: Array<[string, string]> = [
  ["General", "USD"],
  ["OMT_System", "USD"],
  ["OMT_App", "USD"],
  ["Whish_App", "USD"],
];

interface Snapshot {
  drawers: Record<string, number>;
  supplierUsd: number;
  debtUsd: number;
}

function snapshot(db: Database.Database): Snapshot {
  const drawers: Record<string, number> = {};
  for (const [name, currency] of DRAWERS) {
    drawers[`${name}_${currency}`] = balance(db, name, currency);
  }
  return {
    drawers,
    supplierUsd: supplierLedgerSumUsd(db, "OMT"),
    debtUsd: debtLedgerSumUsd(db),
  };
}

function drawerDelta(before: Snapshot, after: Snapshot, key: string): number {
  return after.drawers[key] - before.drawers[key];
}

function drawerDeltaSum(before: Snapshot, after: Snapshot): number {
  let sum = 0;
  for (const [name, currency] of DRAWERS) {
    sum += drawerDelta(before, after, `${name}_${currency}`);
  }
  return sum;
}

/** THE invariant (FEATURE_GUIDE §8.1/§8.4) — see
 *  OmtSystemFeeCharacterization.test.ts's identical helper for the full doc. */
function assertInvariant(
  before: Snapshot,
  after: Snapshot,
  opts: { commission: number; keptChange?: number; debtDeltaUsd?: number },
): void {
  const sigma = drawerDeltaSum(before, after) + (opts.debtDeltaUsd ?? 0);
  const owedDelta = after.supplierUsd - before.supplierUsd;
  const lhs = sigma - owedDelta;
  const rhs = opts.commission + (opts.keptChange ?? 0);
  expect(lhs).toBeCloseTo(rhs, 5);
}

describe("FinancialServiceRepository — RECEIVE fee legs (BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md Phase A)", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;
  let txnRepo: TransactionRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetSupplierRepository();
    resetTransactionRepository();
    repo = new FinancialServiceRepository();
    txnRepo = new TransactionRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    resetSupplierRepository();
    resetTransactionRepository();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // (a) fee via single CASH leg
  // ═══════════════════════════════════════════════════════════════════════
  it("(a) fee collected via a single CASH leg — PCD +f -x, ledger -(x-(f-c)), method stored CASH", () => {
    const before = snapshot(db);

    const { id: fsId } = repo.createTransaction({
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

    const after = snapshot(db);

    expect(drawerDelta(before, after, "General_USD")).toBeCloseTo(0, 5);
    // PCD: +5 (fee) - 100 (payout) = -95, same as
    // OmtSystemFeeCharacterization CASE 1 (implicit leg) — the collection
    // METHOD must not change the drawer math.
    expect(drawerDelta(before, after, "OMT_System_USD")).toBeCloseTo(-95, 5);
    expect(after.supplierUsd - before.supplierUsd).toBeCloseTo(-96, 5);
    assertInvariant(before, after, { commission: 1 });

    const legs = feeLegRows(db, fsId);
    expect(legs).toHaveLength(1);
    expect(legs[0].method).toBe("CASH");
    expect(legs[0].drawer_name).toBe("OMT_System");
    expect(legs[0].amount).toBeCloseTo(5, 5);
    expect(legs[0].note).toBe("OMT RECEIVE fee (customer-paid)");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // (b) fee via WHISH wallet leg
  // ═══════════════════════════════════════════════════════════════════════
  it("(b) fee collected via a WHISH wallet leg — Whish_App +f, PCD -x, invariant holds across drawers", () => {
    const before = snapshot(db);

    repo.createTransaction({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 1,
      omtFee: 5,
      cashoutMethod: "CASH",
      feePayments: [{ method: "WHISH", currencyCode: "USD", amount: 5 }],
      exchangeRate: 90000,
    });

    const after = snapshot(db);

    expect(drawerDelta(before, after, "General_USD")).toBeCloseTo(0, 5);
    expect(drawerDelta(before, after, "Whish_App_USD")).toBeCloseTo(5, 5);
    expect(drawerDelta(before, after, "OMT_System_USD")).toBeCloseTo(-100, 5); // payout only, no fee leg here
    expect(after.supplierUsd - before.supplierUsd).toBeCloseTo(-96, 5);
    assertInvariant(before, after, { commission: 1 });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // (c) split fee: CASH 2 + OMT wallet 3
  // ═══════════════════════════════════════════════════════════════════════
  it("(c) split fee CASH 2 + OMT wallet 3 — both drawers move, invariant holds", () => {
    const before = snapshot(db);

    repo.createTransaction({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 1,
      omtFee: 5,
      cashoutMethod: "CASH",
      feePayments: [
        { method: "CASH", currencyCode: "USD", amount: 2 },
        { method: "OMT", currencyCode: "USD", amount: 3 },
      ],
      exchangeRate: 90000,
    });

    const after = snapshot(db);

    expect(drawerDelta(before, after, "General_USD")).toBeCloseTo(0, 5);
    expect(drawerDelta(before, after, "OMT_App_USD")).toBeCloseTo(3, 5);
    // PCD: +2 (CASH fee leg) - 100 (payout) = -98
    expect(drawerDelta(before, after, "OMT_System_USD")).toBeCloseTo(-98, 5);
    expect(after.supplierUsd - before.supplierUsd).toBeCloseTo(-96, 5);
    assertInvariant(before, after, { commission: 1 });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // (d) fee via CUSTOMER_ACCOUNT
  // ═══════════════════════════════════════════════════════════════════════
  it("(d) fee charged to CUSTOMER_ACCOUNT — no drawer for the fee, debt_ledger 'Service Debt' +f", () => {
    const before = snapshot(db);

    const { id: fsId } = repo.createTransaction({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 1,
      omtFee: 5,
      cashoutMethod: "CASH",
      clientName: "Fee Customer",
      phoneNumber: "70111111",
      feePayments: [
        { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 5 },
      ],
      exchangeRate: 90000,
    });

    const after = snapshot(db);

    expect(drawerDelta(before, after, "General_USD")).toBeCloseTo(0, 5);
    // PCD: only the payout (-100) — the fee never touches a drawer.
    expect(drawerDelta(before, after, "OMT_System_USD")).toBeCloseTo(-100, 5);
    expect(after.debtUsd - before.debtUsd).toBeCloseTo(5, 5);
    expect(after.supplierUsd - before.supplierUsd).toBeCloseTo(-96, 5);
    assertInvariant(before, after, {
      commission: 1,
      debtDeltaUsd: after.debtUsd - before.debtUsd,
    });

    const debtRow = db
      .prepare(
        `SELECT transaction_type, amount_usd FROM debt_ledger WHERE transaction_id = (
           SELECT id FROM transactions WHERE source_table = 'financial_services' AND source_id = ?
         )`,
      )
      .get(fsId) as { transaction_type: string; amount_usd: number };
    expect(debtRow.transaction_type).toBe("Service Debt");
    expect(debtRow.amount_usd).toBeCloseTo(5, 5);
  });

  it("(d2) fee via CUSTOMER_ACCOUNT with no resolvable client throws, writes nothing", () => {
    const before = snapshot(db);
    const fsCountBefore = rowCount(db, "financial_services");
    const txnCountBefore = rowCount(db, "transactions");

    expect(() =>
      repo.createTransaction({
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USD",
        commission: 1,
        omtFee: 5,
        cashoutMethod: "CASH",
        // No clientName/clientId/phoneNumber — resolvedPrimaryClientId stays undefined.
        feePayments: [
          { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 5 },
        ],
        exchangeRate: 90000,
      }),
    ).toThrow(/client is required to charge the receive fee/i);

    const after = snapshot(db);
    expect(rowCount(db, "financial_services")).toBe(fsCountBefore);
    expect(rowCount(db, "transactions")).toBe(txnCountBefore);
    expect(after.drawers).toEqual(before.drawers);
    expect(after.debtUsd).toBeCloseTo(before.debtUsd, 5);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // (e) reconcile mismatch — hard-reject, nothing written
  // ═══════════════════════════════════════════════════════════════════════
  it("(e) fee legs summing to 4 against a $5 fee hard-rejects — nothing written", () => {
    const before = snapshot(db);
    const fsCountBefore = rowCount(db, "financial_services");
    const txnCountBefore = rowCount(db, "transactions");
    const paymentsCountBefore = rowCount(db, "payments");

    expect(() =>
      repo.createTransaction({
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USD",
        commission: 1,
        omtFee: 5,
        cashoutMethod: "CASH",
        feePayments: [{ method: "CASH", currencyCode: "USD", amount: 4 }],
        exchangeRate: 90000,
      }),
    ).toThrow(/do not reconcile/i);

    const after = snapshot(db);
    expect(rowCount(db, "financial_services")).toBe(fsCountBefore);
    expect(rowCount(db, "transactions")).toBe(txnCountBefore);
    expect(rowCount(db, "payments")).toBe(paymentsCountBefore);
    expect(after.drawers).toEqual(before.drawers);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // (j) a fee leg that is neither CUSTOMER_ACCOUNT nor drawer-affecting
  // (e.g. GIFT_CARD) must hard-reject — reconcileLegs counts every leg
  // toward the fee total, so silently skipping the booking would pass
  // reconciliation while no drawer/receivable ever receives the fee: the
  // supplier ledger and profit would book a fee nobody collected — the
  // phantom-fee bug class (plan §2 bug 1) inside the new code path itself.
  // ═══════════════════════════════════════════════════════════════════════
  it("(j) GIFT_CARD fee leg hard-rejects — nothing written", () => {
    const before = snapshot(db);
    const fsCountBefore = rowCount(db, "financial_services");
    const txnCountBefore = rowCount(db, "transactions");
    const paymentsCountBefore = rowCount(db, "payments");

    expect(() =>
      repo.createTransaction({
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USD",
        commission: 1,
        omtFee: 5,
        cashoutMethod: "CASH",
        feePayments: [{ method: "GIFT_CARD", currencyCode: "USD", amount: 5 }],
        exchangeRate: 90000,
      }),
    ).toThrow(/GIFT_CARD.*fee/i);

    const after = snapshot(db);
    expect(rowCount(db, "financial_services")).toBe(fsCountBefore);
    expect(rowCount(db, "transactions")).toBe(txnCountBefore);
    expect(rowCount(db, "payments")).toBe(paymentsCountBefore);
    expect(after.drawers).toEqual(before.drawers);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // (k)-(n) BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §6bis adversarial-review
  // findings 1/2/4/5 — Phase A2. Every path below used to silently DISCARD
  // `feePayments` (success returned, no booking, no reconcile) because the
  // only gate lived INSIDE the RECEIVE fee-leg block itself. The repository
  // guard added in Phase A2 (createTransaction, right after
  // `resolvedProviderFee` resolves, before the PFT-3b FOR-partner dispatch)
  // now hard-rejects each of these before any row is written.
  // ═══════════════════════════════════════════════════════════════════════
  it("(k) FOR-partner RECEIVE + feePayments throws before any row is written (§6bis finding 1)", () => {
    db.prepare(`INSERT INTO partners (name) VALUES ('Test Partner FOR')`).run();
    const before = snapshot(db);
    const fsCountBefore = rowCount(db, "financial_services");
    const txnCountBefore = rowCount(db, "transactions");
    const paymentsCountBefore = rowCount(db, "payments");
    const partnerLedgerCountBefore = rowCount(db, "partner_ledger");

    expect(() =>
      repo.createTransaction({
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USD",
        commission: 1,
        omtFee: 5,
        cashoutMethod: "CASH",
        partnerId: 1,
        partnerMode: "FOR",
        feePayments: [{ method: "CASH", currencyCode: "USD", amount: 5 }],
        exchangeRate: 90000,
      }),
    ).toThrow(/feePayments cannot be used on a partner transaction/i);

    const after = snapshot(db);
    expect(rowCount(db, "financial_services")).toBe(fsCountBefore);
    expect(rowCount(db, "transactions")).toBe(txnCountBefore);
    expect(rowCount(db, "payments")).toBe(paymentsCountBefore);
    expect(rowCount(db, "partner_ledger")).toBe(partnerLedgerCountBefore);
    expect(after.drawers).toEqual(before.drawers);
  });

  it("(l) THROUGH-partner RECEIVE + feePayments throws before any row is written (§6bis finding 1)", () => {
    db.prepare(
      `INSERT INTO partners (name) VALUES ('Test Partner THROUGH')`,
    ).run();
    const before = snapshot(db);
    const fsCountBefore = rowCount(db, "financial_services");
    const txnCountBefore = rowCount(db, "transactions");
    const paymentsCountBefore = rowCount(db, "payments");

    expect(() =>
      repo.createTransaction({
        provider: "WHISH",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USD",
        commission: 0,
        whishFee: 5,
        cashoutMethod: "CASH",
        partnerId: 1,
        // partnerMode omitted → defaults to THROUGH (isThroughPartner).
        feePayments: [{ method: "CASH", currencyCode: "USD", amount: 5 }],
        exchangeRate: 90000,
      }),
    ).toThrow(/feePayments cannot be used on a partner transaction/i);

    const after = snapshot(db);
    expect(rowCount(db, "financial_services")).toBe(fsCountBefore);
    expect(rowCount(db, "transactions")).toBe(txnCountBefore);
    expect(rowCount(db, "payments")).toBe(paymentsCountBefore);
    expect(after.drawers).toEqual(before.drawers);
  });

  it("(m) deferPayment + feePayments throws before any row is written (§6bis finding 4)", () => {
    const before = snapshot(db);
    const fsCountBefore = rowCount(db, "financial_services");
    const txnCountBefore = rowCount(db, "transactions");
    const paymentsCountBefore = rowCount(db, "payments");

    expect(() =>
      repo.createTransaction({
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USD",
        commission: 1,
        omtFee: 5,
        cashoutMethod: "CASH",
        deferPayment: true,
        feePayments: [{ method: "CASH", currencyCode: "USD", amount: 5 }],
        exchangeRate: 90000,
      }),
    ).toThrow(/feePayments is not supported in a session basket/i);

    const after = snapshot(db);
    expect(rowCount(db, "financial_services")).toBe(fsCountBefore);
    expect(rowCount(db, "transactions")).toBe(txnCountBefore);
    expect(rowCount(db, "payments")).toBe(paymentsCountBefore);
    expect(after.drawers).toEqual(before.drawers);
  });

  it("(n) omtFee: 0 + feePayments throws before any row is written (§6bis finding 2)", () => {
    const before = snapshot(db);
    const fsCountBefore = rowCount(db, "financial_services");
    const txnCountBefore = rowCount(db, "transactions");
    const paymentsCountBefore = rowCount(db, "payments");

    expect(() =>
      repo.createTransaction({
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USD",
        commission: 1,
        omtFee: 0,
        cashoutMethod: "CASH",
        feePayments: [{ method: "CASH", currencyCode: "USD", amount: 5 }],
        exchangeRate: 90000,
      }),
    ).toThrow(
      /feePayments requires a fee-on-top RECEIVE with a non-zero omtFee\/whishFee/i,
    );

    const after = snapshot(db);
    expect(rowCount(db, "financial_services")).toBe(fsCountBefore);
    expect(rowCount(db, "transactions")).toBe(txnCountBefore);
    expect(rowCount(db, "payments")).toBe(paymentsCountBefore);
    expect(after.drawers).toEqual(before.drawers);
  });

  it("(n2) omtFee omitted (defaults to 0) + feePayments throws before any row is written (§6bis finding 2)", () => {
    const before = snapshot(db);
    const fsCountBefore = rowCount(db, "financial_services");
    const txnCountBefore = rowCount(db, "transactions");

    expect(() =>
      repo.createTransaction({
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USD",
        commission: 1,
        // omtFee omitted entirely → resolvedProviderFee resolves to 0.
        cashoutMethod: "CASH",
        feePayments: [{ method: "CASH", currencyCode: "USD", amount: 5 }],
        exchangeRate: 90000,
      }),
    ).toThrow(
      /feePayments requires a fee-on-top RECEIVE with a non-zero omtFee\/whishFee/i,
    );

    const after = snapshot(db);
    expect(rowCount(db, "financial_services")).toBe(fsCountBefore);
    expect(rowCount(db, "transactions")).toBe(txnCountBefore);
    expect(after.drawers).toEqual(before.drawers);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // (f) schema-level: feePayments + includingFees:true is rejected
  // ═══════════════════════════════════════════════════════════════════════
  describe("(f) createFinancialServiceSchema rejects invalid feePayments combinations", () => {
    const basePayload = {
      provider: "OMT" as const,
      serviceType: "RECEIVE" as const,
      amount: 100,
      currency: "USD" as const,
      commission: 1,
      omtFee: 5,
      cashoutMethod: "CASH" as const,
      feePayments: [{ method: "CASH", currencyCode: "USD", amount: 5 }],
    };

    it("rejects feePayments when includingFees is true", () => {
      const result = createFinancialServiceSchema.safeParse({
        ...basePayload,
        includingFees: true,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) => i.path.join(".") === "feePayments"),
        ).toBe(true);
      }
    });

    it("rejects feePayments when serviceType is SEND", () => {
      const result = createFinancialServiceSchema.safeParse({
        ...basePayload,
        serviceType: "SEND",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) => i.path.join(".") === "feePayments"),
        ).toBe(true);
      }
    });

    it("accepts feePayments on a plain fee-on-top RECEIVE", () => {
      const result = createFinancialServiceSchema.safeParse(basePayload);
      expect(result.success).toBe(true);
    });

    // §6bis Phase A2 — the two NEW refines (findings 1 and 2).
    it("rejects feePayments when partnerId is present", () => {
      const result = createFinancialServiceSchema.safeParse({
        ...basePayload,
        partnerId: 1,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) => i.path.join(".") === "feePayments"),
        ).toBe(true);
      }
    });

    it("rejects feePayments when the resolved fee is zero/absent (omtFee: 0, whishFee absent)", () => {
      const result = createFinancialServiceSchema.safeParse({
        ...basePayload,
        omtFee: 0,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) => i.path.join(".") === "feePayments"),
        ).toBe(true);
      }
    });

    // §10.2 — BINANCE has no omtFee/whishFee field of its own; its fee
    // travels in `commission` (the live frontend contract, CryptoForm.tsx's
    // `commission: fee`). Without this escape clause the zero-fee refine
    // above would reject every legitimate BINANCE mode-C payload at the
    // schema layer, before it ever reaches the repository's own
    // (already-correct) `calculatedCommission`-aware guard.
    it("accepts feePayments on a BINANCE fee-on-top RECEIVE via commission (no omtFee/whishFee)", () => {
      const result = createFinancialServiceSchema.safeParse({
        provider: "BINANCE",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USDT",
        commission: 5,
        cashoutMethod: "CASH",
        feePayments: [{ method: "CASH", currencyCode: "USD", amount: 5 }],
      });
      expect(result.success).toBe(true);
    });

    it("rejects feePayments on a BINANCE RECEIVE when commission is 0 (no fee to collect)", () => {
      const result = createFinancialServiceSchema.safeParse({
        provider: "BINANCE",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USDT",
        commission: 0,
        cashoutMethod: "CASH",
        feePayments: [{ method: "CASH", currencyCode: "USD", amount: 5 }],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) => i.path.join(".") === "feePayments"),
        ).toBe(true);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // (g) THROUGH-partner RECEIVE with a fee — bug 5 guard
  // ═══════════════════════════════════════════════════════════════════════
  it("(g) THROUGH-partner WHISH RECEIVE with a fee books NO fee leg (bug 5)", () => {
    db.prepare(`INSERT INTO partners (name) VALUES ('Test Partner')`).run();
    const before = snapshot(db);

    const { id: fsId } = repo.createTransaction({
      provider: "WHISH",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 0,
      whishFee: 5,
      cashoutMethod: "CASH",
      partnerId: 1,
      exchangeRate: 90000,
    });

    const after = snapshot(db);

    // No fee leg at all — the partner handles the fee/payout, not our cash.
    expect(feeLegRows(db, fsId)).toHaveLength(0);
    // No drawer this file tracks moves — the payout is also skipped
    // (skipSystemDrawer), and WHISH is the secondary provider here so the fee
    // wouldn't route to the PCD anyway (it would have landed in General
    // pre-fix — the bug this case guards).
    expect(after.drawers).toEqual(before.drawers);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // (h) legacy fallback — no feePayments
  // ═══════════════════════════════════════════════════════════════════════
  it("(h) legacy fallback (no feePayments): single +f leg, method CASH not FEE", () => {
    const before = snapshot(db);

    const { id: fsId } = repo.createTransaction({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 1,
      omtFee: 5,
      cashoutMethod: "CASH",
      exchangeRate: 90000,
      // No feePayments — legacy synthesize-one-leg fallback.
    });

    const after = snapshot(db);

    expect(drawerDelta(before, after, "OMT_System_USD")).toBeCloseTo(-95, 5); // +5 - 100, same drawer as (a)
    assertInvariant(before, after, { commission: 1 });

    const legs = feeLegRows(db, fsId);
    expect(legs).toHaveLength(1);
    expect(legs[0].method).toBe("CASH"); // NOT "FEE" (owner decision #9)
    expect(legs[0].drawer_name).toBe("OMT_System");
    expect(legs[0].amount).toBeCloseTo(5, 5);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // (i) reversal symmetry (rule 20) — create then void nets every ledger to 0
  // ═══════════════════════════════════════════════════════════════════════
  describe("(i) reversal symmetry", () => {
    it("case (b) [WHISH wallet fee] create + void nets every drawer to 0", () => {
      const before = snapshot(db);

      const { id: fsId } = repo.createTransaction({
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USD",
        commission: 1,
        omtFee: 5,
        cashoutMethod: "CASH",
        feePayments: [{ method: "WHISH", currencyCode: "USD", amount: 5 }],
        exchangeRate: 90000,
      });

      const afterCreate = snapshot(db);
      expect(drawerDeltaSum(before, afterCreate)).not.toBeCloseTo(0, 5); // sanity: money actually moved

      const txnId = txnIdForFsRow(db, fsId);
      txnRepo.voidTransaction(txnId, 1);

      const afterVoid = snapshot(db);
      for (const [name, currency] of DRAWERS) {
        expect(
          drawerDelta(before, afterVoid, `${name}_${currency}`),
        ).toBeCloseTo(0, 5);
      }
      // Supplier ledger: the auto TOP_UP/PAYMENT sibling is a SEPARATE
      // transaction (LIRA-091) not cascaded by this minimal fixture (no
      // source_ref_table/source_ref_id columns on this file's supplier_ledger
      // — see _supplierLedgerHasSourceRefColumns), so it is intentionally
      // NOT asserted back to 0 here; the drawer/debt reversal (what THIS
      // ticket's fee-leg code touches) is the property under test.
    });

    it("case (d) [CUSTOMER_ACCOUNT fee] create + void cancels the 'Service Debt' row via the generic _cancelDebt", () => {
      const before = snapshot(db);

      const { id: fsId } = repo.createTransaction({
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USD",
        commission: 1,
        omtFee: 5,
        cashoutMethod: "CASH",
        clientName: "Fee Customer 2",
        phoneNumber: "70222222",
        feePayments: [
          { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 5 },
        ],
        exchangeRate: 90000,
      });

      const afterCreate = snapshot(db);
      expect(afterCreate.debtUsd - before.debtUsd).toBeCloseTo(5, 5);

      const txnId = txnIdForFsRow(db, fsId);
      txnRepo.voidTransaction(txnId, 1);

      const afterVoid = snapshot(db);
      // debt_ledger nets back to 0 for the client (the charge + the
      // generic 'Refund Reversal' negation MODULE_DEBT_TRANSACTION_TYPES
      // already covers, since 'Service Debt' is whitelisted there).
      expect(afterVoid.debtUsd - before.debtUsd).toBeCloseTo(0, 5);
      for (const [name, currency] of DRAWERS) {
        expect(
          drawerDelta(before, afterVoid, `${name}_${currency}`),
        ).toBeCloseTo(0, 5);
      }

      const reversalRow = db
        .prepare(
          `SELECT transaction_type, amount_usd FROM debt_ledger
           WHERE transaction_id = (SELECT id FROM transactions WHERE source_table = 'financial_services' AND source_id = ?)
             AND transaction_type = 'Refund Reversal'`,
        )
        .get(fsId) as
        | { transaction_type: string; amount_usd: number }
        | undefined;
      expect(reversalRow).toBeDefined();
      expect(reversalRow?.amount_usd).toBeCloseTo(-5, 5);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════
// BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase D (owner decision Q7,
// 2026-08-06: "yes, it happens — the customer can pay the fee separately in
// different payment methods") — app-wallet (OMT_APP/WHISH_APP) RECEIVE
// mode C: the fee is collected SEPARATELY over the counter via
// `feePayments[]` instead of being netted out of the wallet spread (modes
// A/B). Booked by the SAME shared `bookFeeCollectionLegs` helper the system
// OMT/WHISH branch above uses (rule 14) — cases (p)-(t) mirror (a)-(n2)'s
// coverage for the app-wallet branch. BINANCE is explicitly DEFERRED for
// this capability (its payload builder lives in the Recharge crypto form,
// untouched by this phase) — case (r) proves it hard-rejects instead of
// silently falling back to netting.
//
// RULE 17 (failing-first): every case below was proven failing against the
// pre-Phase-D repository — reverting ONLY the `isFeeCollectedSeparately`
// branch (restoring `payoutAmount = cryptoAmount - fee` unconditionally, no
// `bookFeeCollectionLegs` call in the wallet-transfer RECEIVE branch) and
// separately reverting ONLY the A2 guard's provider-aware fee source (back
// to plain `resolvedProviderFee > 0`, which is always 0 for app wallets) —
// see the task's final report for the exact revert/observed-failure/restore
// transcript. Cases (p1)-(p4)/(q)/(s) failed with the OLD guard message
// ("feePayments requires a fee-on-top RECEIVE with a non-zero
// omtFee/whishFee") since `resolvedProviderFee` is always 0 for OMT_APP/
// WHISH_APP; (r)/(r2)/(t2) are guard-shape assertions that passed
// incidentally pre-fix (same reject family) but are re-verified here against
// the POST-fix message text/branch to guard against a future regression
// silently changing which check fires.
// ═════════════════════════════════════════════════════════════════════════
describe("FinancialServiceRepository — app-wallet RECEIVE mode C (BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md Phase D)", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;
  let txnRepo: TransactionRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetSupplierRepository();
    resetTransactionRepository();
    repo = new FinancialServiceRepository();
    txnRepo = new TransactionRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    resetSupplierRepository();
    resetTransactionRepository();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // (p) WHISH_APP / OMT_APP RECEIVE mode C — wallet +bare amount, payout legs
  // -FULL amount (no netting), fee leg +f, profit = commission = f.
  // ═══════════════════════════════════════════════════════════════════════
  it("(p1) WHISH_APP mode C, fee via CASH — wallet +100, payout -100 General, fee +5 General, no netting", () => {
    const before = snapshot(db);

    const { id: fsId } = repo.createTransaction({
      provider: "WHISH_APP",
      serviceType: "RECEIVE",
      amount: 100, // bare wallet inflow (mode C never folds the fee into amount)
      currency: "USD",
      commission: 5, // full fee = shop profit, unchanged contract
      whishFee: 5, // display persistence + guard fee source
      cashoutMethod: "CASH",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }], // FULL payout
      feePayments: [{ method: "CASH", currencyCode: "USD", amount: 5 }],
      exchangeRate: 90000,
    });

    const after = snapshot(db);

    expect(drawerDelta(before, after, "Whish_App_USD")).toBeCloseTo(100, 5);
    // General: -100 (full payout, no netting) + 5 (fee) = -95
    expect(drawerDelta(before, after, "General_USD")).toBeCloseTo(-95, 5);
    assertInvariant(before, after, { commission: 5 });

    const legs = feeLegRows(db, fsId);
    expect(legs).toHaveLength(1);
    expect(legs[0].method).toBe("CASH");
    expect(legs[0].drawer_name).toBe("General");
    expect(legs[0].amount).toBeCloseTo(5, 5);
    expect(legs[0].note).toBe("WHISH_APP RECEIVE fee (customer-paid)");

    // Payout leg: the FULL amount, not amount - fee.
    const txnId = txnIdForFsRow(db, fsId);
    const payoutRow = db
      .prepare(
        `SELECT amount FROM payments WHERE transaction_id = ? AND drawer_name = 'General' AND amount < 0`,
      )
      .get(txnId) as { amount: number };
    expect(payoutRow.amount).toBeCloseTo(-100, 5);
  });

  it("(p2) WHISH_APP mode C, fee via WHISH wallet leg — Whish_App +100 (wallet) +5 (fee) = +105, General -100 (payout only)", () => {
    const before = snapshot(db);

    repo.createTransaction({
      provider: "WHISH_APP",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 5,
      whishFee: 5,
      cashoutMethod: "CASH",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
      feePayments: [{ method: "WHISH", currencyCode: "USD", amount: 5 }],
      exchangeRate: 90000,
    });

    const after = snapshot(db);

    // +100 wallet inflow, +5 fee leg (method WHISH -> Whish_App) = +105.
    expect(drawerDelta(before, after, "Whish_App_USD")).toBeCloseTo(105, 5);
    expect(drawerDelta(before, after, "General_USD")).toBeCloseTo(-100, 5);
    assertInvariant(before, after, { commission: 5 });
  });

  it("(p3) OMT_APP mode C, fee via OMT wallet leg — OMT_App +100 (wallet) +5 (fee) = +105, General -100", () => {
    const before = snapshot(db);

    repo.createTransaction({
      provider: "OMT_APP",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 5,
      omtFee: 5,
      cashoutMethod: "CASH",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
      feePayments: [{ method: "OMT", currencyCode: "USD", amount: 5 }],
      exchangeRate: 90000,
    });

    const after = snapshot(db);

    expect(drawerDelta(before, after, "OMT_App_USD")).toBeCloseTo(105, 5);
    expect(drawerDelta(before, after, "General_USD")).toBeCloseTo(-100, 5);
    assertInvariant(before, after, { commission: 5 });
  });

  it("(p4) WHISH_APP mode C in LBP — per-currency proof (no USD drawer moves)", () => {
    // Extra drawers not in the shared DRAWERS/snapshot list — read directly.
    const genLbpBefore = balance(db, "General", "LBP");
    const whishAppLbpBefore = balance(db, "Whish_App", "LBP");
    const genUsdBefore = balance(db, "General", "USD");

    repo.createTransaction({
      provider: "WHISH_APP",
      serviceType: "RECEIVE",
      amount: 9_000_000,
      currency: "LBP",
      commission: 450_000,
      whishFee: 450_000,
      cashoutMethod: "CASH",
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 9_000_000 }],
      feePayments: [{ method: "CASH", currencyCode: "LBP", amount: 450_000 }],
      exchangeRate: 90000,
    });

    expect(balance(db, "Whish_App", "LBP")).toBeCloseTo(
      whishAppLbpBefore + 9_000_000,
      2,
    );
    expect(balance(db, "General", "LBP")).toBeCloseTo(
      genLbpBefore - 9_000_000 + 450_000,
      2,
    );
    // No USD drawer touched by an LBP-denominated transaction.
    expect(balance(db, "General", "USD")).toBeCloseTo(genUsdBefore, 2);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // (q) reversal symmetry — create + void nets every drawer to 0 (rule 20)
  // ═══════════════════════════════════════════════════════════════════════
  it("(q) mode C create + void nets every drawer to 0 (WHISH_APP, fee via CASH)", () => {
    const before = snapshot(db);

    const { id: fsId } = repo.createTransaction({
      provider: "WHISH_APP",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 5,
      whishFee: 5,
      cashoutMethod: "CASH",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
      feePayments: [{ method: "CASH", currencyCode: "USD", amount: 5 }],
      exchangeRate: 90000,
    });

    const afterCreate = snapshot(db);
    expect(drawerDeltaSum(before, afterCreate)).not.toBeCloseTo(0, 5); // sanity: money actually moved

    const txnId = txnIdForFsRow(db, fsId);
    txnRepo.voidTransaction(txnId, 1);

    const afterVoid = snapshot(db);
    for (const [name, currency] of DRAWERS) {
      expect(drawerDelta(before, afterVoid, `${name}_${currency}`)).toBeCloseTo(
        0,
        5,
      );
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // (r) BINANCE mode C (BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §10.2) — the
  // Binance payload builder in `Recharge/index.tsx` (the previous blocker)
  // has landed, so BINANCE now reaches the same mode C as OMT_APP/WHISH_APP.
  // The ONE real difference from the app-wallet cases above: BINANCE's fee
  // source is `commission` (via `Math.abs(calculatedCommission)`), not
  // `omtFee`/`whishFee` — it has neither field — and its crypto leg is
  // ALWAYS denominated in USDT while the cash/fee side is ALWAYS USD
  // (`cashCurrency`), regardless of the `currency` field passed in. These
  // cases assert both currencies directly (no shared `assertInvariant` —
  // that helper sums same-currency USD drawers only; mixing in the raw USDT
  // leg would corrupt the sum across a currency boundary, which is exactly
  // the multi-currency case being proven here instead).
  // ═══════════════════════════════════════════════════════════════════════
  it("(r1) BINANCE mode C, fee via CASH — Binance +100 USDT, payout -100 General USD, fee +5 General USD, no netting", () => {
    const binanceUsdtBefore = balance(db, "Binance", "USDT");
    const generalUsdBefore = balance(db, "General", "USD");

    const { id: fsId } = repo.createTransaction({
      provider: "BINANCE",
      serviceType: "RECEIVE",
      amount: 100, // bare USDT inflow (mode C never folds the fee into amount)
      currency: "USDT",
      commission: 5, // BINANCE's fee source — no omtFee/whishFee field exists for it
      cashoutMethod: "CASH",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }], // FULL payout
      feePayments: [{ method: "CASH", currencyCode: "USD", amount: 5 }],
      exchangeRate: 90000,
    });

    // Crypto leg: +100 USDT into the Binance drawer — untouched by the fee.
    expect(balance(db, "Binance", "USDT")).toBeCloseTo(
      binanceUsdtBefore + 100,
      5,
    );
    // Cash side, USD only: -100 (full payout, no netting) + 5 (fee) = -95.
    expect(balance(db, "General", "USD")).toBeCloseTo(generalUsdBefore - 95, 5);

    const legs = feeLegRows(db, fsId);
    expect(legs).toHaveLength(1);
    expect(legs[0].method).toBe("CASH");
    expect(legs[0].drawer_name).toBe("General");
    expect(legs[0].currency_code).toBe("USD");
    expect(legs[0].amount).toBeCloseTo(5, 5);
    expect(legs[0].note).toBe("BINANCE RECEIVE fee (customer-paid)");

    // Payout leg: the FULL amount, not amount - fee, denominated in USD.
    const txnId = txnIdForFsRow(db, fsId);
    const payoutRow = db
      .prepare(
        `SELECT amount, currency_code FROM payments WHERE transaction_id = ? AND drawer_name = 'General' AND amount < 0`,
      )
      .get(txnId) as { amount: number; currency_code: string };
    expect(payoutRow.amount).toBeCloseTo(-100, 5);
    expect(payoutRow.currency_code).toBe("USD");

    // Crypto leg itself must be USDT, never conflated with the USD cash side.
    const cryptoRow = db
      .prepare(
        `SELECT currency_code, amount FROM payments WHERE transaction_id = ? AND drawer_name = 'Binance'`,
      )
      .get(txnId) as { currency_code: string; amount: number };
    expect(cryptoRow.currency_code).toBe("USDT");
    expect(cryptoRow.amount).toBeCloseTo(100, 5);
  });

  it("(r2) BINANCE mode C split fee CASH 2 + OMT wallet 3 — both drawers move, crypto leg untouched", () => {
    const binanceUsdtBefore = balance(db, "Binance", "USDT");
    const generalUsdBefore = balance(db, "General", "USD");
    const omtAppUsdBefore = balance(db, "OMT_App", "USD");

    repo.createTransaction({
      provider: "BINANCE",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USDT",
      commission: 5,
      cashoutMethod: "CASH",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
      feePayments: [
        { method: "CASH", currencyCode: "USD", amount: 2 },
        { method: "OMT", currencyCode: "USD", amount: 3 },
      ],
      exchangeRate: 90000,
    });

    expect(balance(db, "Binance", "USDT")).toBeCloseTo(
      binanceUsdtBefore + 100,
      5,
    );
    expect(balance(db, "OMT_App", "USD")).toBeCloseTo(omtAppUsdBefore + 3, 5);
    // General: +2 (CASH fee leg) - 100 (payout) = -98
    expect(balance(db, "General", "USD")).toBeCloseTo(generalUsdBefore - 98, 5);
  });

  it("(r3) BINANCE mode C fee charged to CUSTOMER_ACCOUNT — no drawer for the fee, debt_ledger 'Service Debt' +f", () => {
    const binanceUsdtBefore = balance(db, "Binance", "USDT");
    const generalUsdBefore = balance(db, "General", "USD");
    const debtBefore = debtLedgerSumUsd(db);

    const { id: fsId } = repo.createTransaction({
      provider: "BINANCE",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USDT",
      commission: 5,
      cashoutMethod: "CASH",
      clientName: "Binance Fee Customer",
      phoneNumber: "70222222",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
      feePayments: [
        { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 5 },
      ],
      exchangeRate: 90000,
    });

    expect(balance(db, "Binance", "USDT")).toBeCloseTo(
      binanceUsdtBefore + 100,
      5,
    );
    // General: only the payout (-100) — the fee never touches a drawer.
    expect(balance(db, "General", "USD")).toBeCloseTo(
      generalUsdBefore - 100,
      5,
    );
    expect(debtLedgerSumUsd(db) - debtBefore).toBeCloseTo(5, 5);

    const debtRow = db
      .prepare(
        `SELECT transaction_type, amount_usd FROM debt_ledger WHERE transaction_id = (
           SELECT id FROM transactions WHERE source_table = 'financial_services' AND source_id = ?
         )`,
      )
      .get(fsId) as { transaction_type: string; amount_usd: number };
    expect(debtRow.transaction_type).toBe("Service Debt");
    expect(debtRow.amount_usd).toBeCloseTo(5, 5);
  });

  it("(r4) BINANCE mode C with commission: 0 + feePayments throws (guard fee-source is calculatedCommission-aware, not resolvedProviderFee)", () => {
    const binanceUsdtBefore = balance(db, "Binance", "USDT");
    const generalUsdBefore = balance(db, "General", "USD");
    const fsCountBefore = rowCount(db, "financial_services");
    const txnCountBefore = rowCount(db, "transactions");

    expect(() =>
      repo.createTransaction({
        provider: "BINANCE",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USDT",
        commission: 0, // calculatedCommission = 0 — nothing for feePayments to collect
        cashoutMethod: "CASH",
        feePayments: [{ method: "CASH", currencyCode: "USD", amount: 5 }],
        exchangeRate: 90000,
      }),
    ).toThrow(
      /feePayments requires a fee-on-top RECEIVE with a non-zero omtFee\/whishFee/i,
    );

    expect(rowCount(db, "financial_services")).toBe(fsCountBefore);
    expect(rowCount(db, "transactions")).toBe(txnCountBefore);
    expect(balance(db, "Binance", "USDT")).toBeCloseTo(binanceUsdtBefore, 5);
    expect(balance(db, "General", "USD")).toBeCloseTo(generalUsdBefore, 5);
  });

  it("(r5) BINANCE mode C fee legs summing to 4 against a $5 fee hard-rejects — nothing written, neither drawer moves", () => {
    const binanceUsdtBefore = balance(db, "Binance", "USDT");
    const generalUsdBefore = balance(db, "General", "USD");
    const fsCountBefore = rowCount(db, "financial_services");
    const txnCountBefore = rowCount(db, "transactions");
    const paymentsCountBefore = rowCount(db, "payments");

    expect(() =>
      repo.createTransaction({
        provider: "BINANCE",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USDT",
        commission: 5,
        cashoutMethod: "CASH",
        // No `payments` leg deliberately: the payout side has nothing to
        // reconcile against (reconcileLegs no-ops on empty/absent inLegs —
        // moneyPosting.ts:234), so it is STRUCTURALLY incapable of throwing.
        // The ONLY reconcile this payload can trip is bookFeeCollectionLegs'
        // feePayments-vs-fee check. An adversarial revert of the
        // `isFeeCollectedSeparately` wiring (dropping `|| isBINANCE`) proved
        // the OLD version of this test — which passed a matching `payments:
        // [...100]` leg — still threw "do not reconcile" under the revert,
        // but via the unrelated payout-cashout reconcile (mismatched against
        // the reverted mode A/B payoutAmount of 95), not the fee-leg one;
        // both throw identical text, so the assertion below couldn't tell
        // them apart. Dropping `payments` removes that second, unrelated
        // throw path entirely (see final report for the revert transcript).
        feePayments: [{ method: "CASH", currencyCode: "USD", amount: 4 }],
        exchangeRate: 90000,
      }),
    ).toThrow(/BINANCE RECEIVE fee collection.*do not reconcile/i);

    expect(rowCount(db, "financial_services")).toBe(fsCountBefore);
    expect(rowCount(db, "transactions")).toBe(txnCountBefore);
    expect(rowCount(db, "payments")).toBe(paymentsCountBefore);
    expect(balance(db, "Binance", "USDT")).toBeCloseTo(binanceUsdtBefore, 5);
    expect(balance(db, "General", "USD")).toBeCloseTo(generalUsdBefore, 5);
  });

  it("(r6) BINANCE mode C create + void nets every drawer to 0 across BOTH currencies (USD cash + USDT crypto) — rule 20", () => {
    const binanceUsdtBefore = balance(db, "Binance", "USDT");
    const generalUsdBefore = balance(db, "General", "USD");

    const { id: fsId } = repo.createTransaction({
      provider: "BINANCE",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USDT",
      commission: 5,
      cashoutMethod: "CASH",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
      feePayments: [{ method: "CASH", currencyCode: "USD", amount: 5 }],
      exchangeRate: 90000,
    });

    // Sanity: money actually moved, on BOTH currencies.
    expect(balance(db, "Binance", "USDT")).not.toBeCloseTo(
      binanceUsdtBefore,
      5,
    );
    expect(balance(db, "General", "USD")).not.toBeCloseTo(generalUsdBefore, 5);

    const txnId = txnIdForFsRow(db, fsId);
    txnRepo.voidTransaction(txnId, 1);

    expect(balance(db, "Binance", "USDT")).toBeCloseTo(binanceUsdtBefore, 5);
    expect(balance(db, "General", "USD")).toBeCloseTo(generalUsdBefore, 5);
  });

  it("(r7) an unlisted provider (BOB) + feePayments hard-rejects with the same named-rejection shape", () => {
    expect(() =>
      repo.createTransaction({
        provider: "BOB",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USD",
        commission: 5,
        cashoutMethod: "CASH",
        feePayments: [{ method: "CASH", currencyCode: "USD", amount: 5 }],
        exchangeRate: 90000,
      }),
    ).toThrow(/feePayments is not yet supported for BOB/);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // (s) mode A/B regression — no feePayments, byte-identical to the existing
  // lira-101/lira-100 expectations in
  // FinancialServiceRepository.appWalletTransfer.test.ts (re-run green
  // alongside this file, not duplicated in full here — see final report).
  // ═══════════════════════════════════════════════════════════════════════
  it("(s) WHISH_APP RECEIVE with no feePayments still nets the fee out of the payout (mode A/B unchanged)", () => {
    const before = snapshot(db);

    repo.createTransaction({
      provider: "WHISH_APP",
      serviceType: "RECEIVE",
      amount: 101, // gross wallet inflow: 100 transfer + $1 fee on top
      currency: "USD",
      commission: 1,
      whishFee: 1,
      cashoutMethod: "CASH",
      exchangeRate: 90000,
      // No feePayments/no payments legs — legacy single-lump payout path.
    });

    const after = snapshot(db);

    expect(drawerDelta(before, after, "Whish_App_USD")).toBeCloseTo(101, 5);
    // Netted: -(101 - 1) = -100, same as the pre-Phase-D contract.
    expect(drawerDelta(before, after, "General_USD")).toBeCloseTo(-100, 5);
    assertInvariant(before, after, { commission: 1 });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // (t) fee-leg sum ≠ fee — hard-reject, nothing written
  // ═══════════════════════════════════════════════════════════════════════
  it("(t) WHISH_APP mode C fee legs summing to 4 against a $5 fee hard-rejects — nothing written", () => {
    const before = snapshot(db);
    const fsCountBefore = rowCount(db, "financial_services");
    const txnCountBefore = rowCount(db, "transactions");
    const paymentsCountBefore = rowCount(db, "payments");

    expect(() =>
      repo.createTransaction({
        provider: "WHISH_APP",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USD",
        commission: 5,
        whishFee: 5,
        cashoutMethod: "CASH",
        payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
        feePayments: [{ method: "CASH", currencyCode: "USD", amount: 4 }],
        exchangeRate: 90000,
      }),
    ).toThrow(/do not reconcile/i);

    const after = snapshot(db);
    expect(rowCount(db, "financial_services")).toBe(fsCountBefore);
    expect(rowCount(db, "transactions")).toBe(txnCountBefore);
    expect(rowCount(db, "payments")).toBe(paymentsCountBefore);
    expect(after.drawers).toEqual(before.drawers);
  });

  it("(t2) OMT_APP mode C with omtFee: 0 + feePayments throws (guard fee-source is provider-aware, not resolvedProviderFee)", () => {
    const before = snapshot(db);
    const fsCountBefore = rowCount(db, "financial_services");

    expect(() =>
      repo.createTransaction({
        provider: "OMT_APP",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USD",
        commission: 5,
        omtFee: 0,
        cashoutMethod: "CASH",
        feePayments: [{ method: "CASH", currencyCode: "USD", amount: 5 }],
        exchangeRate: 90000,
      }),
    ).toThrow(
      /feePayments requires a fee-on-top RECEIVE with a non-zero omtFee\/whishFee/i,
    );

    const after = snapshot(db);
    expect(rowCount(db, "financial_services")).toBe(fsCountBefore);
    expect(after.drawers).toEqual(before.drawers);
  });
});
