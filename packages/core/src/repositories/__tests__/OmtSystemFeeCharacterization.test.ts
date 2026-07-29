/**
 * OMT/WHISH SYSTEM SEND/RECEIVE — FLOAT-MODEL GUARD (rewritten from a
 * diagnostic characterization into a real guard, per the owner's confirmed
 * domain model, 2026-07-29):
 *
 *   "I can put money into OMT at setup, and I can also not pre-fund. A SEND
 *    spends my balance down, a RECEIVE gives me credit I can immediately
 *    use for future sends — I don't have to wait for OMT to pay me or
 *    settle. OMT tracks what each of us owes and we settle periodically,
 *    but I can spend a received amount normally."
 *
 * Therefore OMT_System/Whish_System is a SPENDABLE FLOAT (SEND draws it
 * down, RECEIVE fills it up, may go negative), and the periodic settlement
 * with the provider covers ONLY the fee split (f − c), never the
 * principal — the principal already moved through the float.
 *
 * Notation: x = principal, f = customer-facing fee, c = the shop's
 * commission (its cut of f; c ≤ f).
 *
 * Target drawer table (owner-specified):
 *   SEND,    fee on top   : payment +(x+f)   system −x        Σ +f
 *   SEND,    fee included : payment +x       system −(x−f)    Σ +f
 *   RECEIVE, fee on top   : payment +f, payout −x   system +x  Σ +f
 *   RECEIVE, fee included : payout −(x−f)           system +x  Σ +f
 *
 * The invariant every case below asserts:
 *   Σ(drawer deltas) − Δ(supplier_ledger owed) = c + kept_change
 * (extended to include the debt_ledger receivable for the
 * CUSTOMER_ACCOUNT-funded SEND case, where the "payment" leg is a
 * receivable instead of a drawer credit — see assertInvariant's
 * `debtDeltaUsd` param.)
 *
 * FAILING-FIRST (rule 17): every case here was run against the pre-fix
 * repository (RESERVE/TRANSFER cash-reserve model, gross-amount supplier
 * ledger, no RECEIVE fee) and FAILED with the old (broken) numbers quoted
 * in each case's comment, then passed after the fix — see the task's final
 * report for both captured outputs.
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { resetSupplierRepository } from "../SupplierRepository";
import { resetTransactionRepository } from "../TransactionRepository";

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

// ─── Mock DebtService (only used by CUSTOMER_ACCOUNT cashout — unused here) ──

jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: jest.fn() }),
  resetDebtService: jest.fn(),
}));

// ─── In-memory schema — every table the SYSTEM path touches ──────────────────

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
      partner_mode TEXT CHECK(partner_mode IN ('THROUGH', 'FOR'))
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
    -- every call below passes an explicit exchangeRate (getUsdLbpSellRate,
    -- the only reader, is short-circuited by the ?? operator).
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
  const row = db
    .prepare(`SELECT COUNT(*) as c FROM ${table}`)
    .get() as { c: number };
  return row.c;
}

// Drawers snapshotted for every case (union of everything the map says the
// system path can touch: General, the *_System reserve drawer, and the
// app-wallet drawers a split payout/payment can also hit).
const DRAWERS: Array<[string, string]> = [
  ["General", "USD"],
  ["OMT_System", "USD"],
  ["OMT_App", "USD"],
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

/**
 * The owner's invariant: Σ(drawer deltas) − Δ(supplier_ledger owed) =
 * c + kept_change. `debtDeltaUsd` extends Σ to include the debt_ledger
 * receivable for CUSTOMER_ACCOUNT-funded legs, where the "payment" leg is a
 * receivable instead of a drawer credit (no drawer moves at all, so the
 * bare drawer-delta sum alone would be missing the customer's side of the
 * transaction entirely).
 */
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

describe("OMT SYSTEM float-model GUARD (SEND/RECEIVE sign flip + fee-only supplier ledger)", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetSupplierRepository();
    resetTransactionRepository();
    repo = new FinancialServiceRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    resetSupplierRepository();
    resetTransactionRepository();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CASE 1 — RECEIVE, fee ON TOP, single CASH leg (x=100, f=5, c=1)
  // Pre-fix: General -105.10 (=-(x+commission)), OMT_System +105.10 — the
  // "decreasing x+fees from BOTH drawers" bug the owner reported, plus no
  // fee leg at all (RECEIVE had no fee field).
  // ═══════════════════════════════════════════════════════════════════════
  it("CASE 1 — RECEIVE fee-on-top, single leg (x=100, f=5, c=1)", () => {
    const before = snapshot(db);

    repo.createTransaction({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 1,
      omtFee: 5,
      cashoutMethod: "CASH",
      exchangeRate: 90000,
    });

    const after = snapshot(db);

    // Fee leg (+f) and payout (-x) both hit General for a CASH cashout.
    expect(drawerDelta(before, after, "General_USD")).toBeCloseTo(-95, 5); // +5 (fee) - 100 (payout)
    expect(drawerDelta(before, after, "OMT_System_USD")).toBeCloseTo(100, 5); // +x (bare principal)
    expect(after.supplierUsd - before.supplierUsd).toBeCloseTo(4, 5); // f - c = 5 - 1
    assertInvariant(before, after, { commission: 1 });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CASE 2 — RECEIVE, fee INCLUDED, single CASH leg (x=100, f=5, c=1).
  // Pre-fix: includingFees was NEVER read for RECEIVE at all (no field
  // existed) — this whole mode is NEW.
  // ═══════════════════════════════════════════════════════════════════════
  it("CASE 2 — RECEIVE fee-included, single leg (x=100, f=5, c=1)", () => {
    const before = snapshot(db);

    repo.createTransaction({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 1,
      omtFee: 5,
      includingFees: true,
      cashoutMethod: "CASH",
      exchangeRate: 90000,
    });

    const after = snapshot(db);

    // No separate fee leg — the payout is netted: -(x-f) = -95.
    expect(drawerDelta(before, after, "General_USD")).toBeCloseTo(-95, 5);
    expect(drawerDelta(before, after, "OMT_System_USD")).toBeCloseTo(100, 5); // +x, unaffected by fee mode
    expect(after.supplierUsd - before.supplierUsd).toBeCloseTo(4, 5); // f - c
    assertInvariant(before, after, { commission: 1 });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CASE 3 — SEND, fee ON TOP, single CASH leg (x=100, f=5, c=1).
  // Pre-fix: General net 0 (the RESERVE row zeroed the customer's cash back
  // out), OMT_System +105 (gross reserve, wrong sign for a float).
  // ═══════════════════════════════════════════════════════════════════════
  it("CASE 3 — SEND fee-on-top, single leg (x=100, f=5, c=1)", () => {
    const before = snapshot(db);

    repo.createTransaction({
      provider: "OMT",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 1,
      omtFee: 5,
      paidByMethod: "CASH",
      includingFees: false,
      exchangeRate: 90000,
    });

    const after = snapshot(db);

    expect(drawerDelta(before, after, "General_USD")).toBeCloseTo(105, 5); // +(x+f) — cash STAYS
    expect(drawerDelta(before, after, "OMT_System_USD")).toBeCloseTo(-100, 5); // -x
    expect(after.supplierUsd - before.supplierUsd).toBeCloseTo(4, 5); // f - c
    assertInvariant(before, after, { commission: 1 });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CASE 4 — SEND, fee INCLUDED, single CASH leg (x=100, f=5, c=1). Same
  // inputs as CASE 3 except includingFees — isolates whether the flag
  // changes anything (pre-fix: it did NOT — identical numbers to CASE 3).
  // ═══════════════════════════════════════════════════════════════════════
  it("CASE 4 — SEND fee-included, single leg (x=100, f=5, c=1)", () => {
    const before = snapshot(db);

    repo.createTransaction({
      provider: "OMT",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 1,
      omtFee: 5,
      paidByMethod: "CASH",
      includingFees: true,
      exchangeRate: 90000,
    });

    const after = snapshot(db);

    expect(drawerDelta(before, after, "General_USD")).toBeCloseTo(100, 5); // +x (gross, nothing added)
    expect(drawerDelta(before, after, "OMT_System_USD")).toBeCloseTo(-95, 5); // -(x-f)
    expect(after.supplierUsd - before.supplierUsd).toBeCloseTo(4, 5); // f - c
    assertInvariant(before, after, { commission: 1 });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CASE 5 — RECEIVE, fee = 0, SPLIT payout: CASH 60 + OMT wallet 40
  // (x=100, c=1). Isolates split-leg payout behavior from the fee.
  // ═══════════════════════════════════════════════════════════════════════
  it("CASE 5 — RECEIVE fee=0, SPLIT payout: CASH 60 + OMT wallet 40 (x=100, c=1)", () => {
    const before = snapshot(db);

    repo.createTransaction({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 1,
      cashoutMethod: "CASH",
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 60 },
        { method: "OMT", currencyCode: "USD", amount: 40 },
      ],
      exchangeRate: 90000,
    });

    const after = snapshot(db);

    expect(drawerDelta(before, after, "General_USD")).toBeCloseTo(-60, 5);
    expect(drawerDelta(before, after, "OMT_App_USD")).toBeCloseTo(-40, 5);
    expect(drawerDelta(before, after, "OMT_System_USD")).toBeCloseTo(100, 5); // +x
    expect(after.supplierUsd - before.supplierUsd).toBeCloseTo(-1, 5); // f(0) - c(1)
    assertInvariant(before, after, { commission: 1 });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CASE 6 — SEND, fee ON TOP, SPLIT payment: CASH 60 + OMT wallet 45
  // (sum = 105 = totalCustomerPays; x=100, f=5, c=1). THE double-count case:
  // pre-fix, isPaidByNonCash (any-leg-non-cash) skipped the cash leg's
  // reserve while the system drawer still credited the FULL gross,
  // producing General +60 (never reserved) AND OMT_System +105 (unreduced)
  // — a genuine extra +60 nowhere accounted for.
  // ═══════════════════════════════════════════════════════════════════════
  it("CASE 6 — SEND fee-on-top, SPLIT payment: CASH 60 + OMT wallet 45 (x=100, f=5, c=1)", () => {
    const before = snapshot(db);

    repo.createTransaction({
      provider: "OMT",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 1,
      omtFee: 5,
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 60 },
        { method: "OMT", currencyCode: "USD", amount: 45 },
      ],
      exchangeRate: 90000,
    });

    const after = snapshot(db);

    expect(drawerDelta(before, after, "General_USD")).toBeCloseTo(60, 5);
    expect(drawerDelta(before, after, "OMT_App_USD")).toBeCloseTo(45, 5);
    expect(drawerDelta(before, after, "OMT_System_USD")).toBeCloseTo(-100, 5); // -x, NOT -100+leftover
    expect(after.supplierUsd - before.supplierUsd).toBeCloseTo(4, 5); // f - c
    assertInvariant(before, after, { commission: 1 });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CASE 7 — CUSTOMER_ACCOUNT-funded SEND (x=100, f=5, c=1). Orchestrator
  // default: the float draws down IMMEDIATELY — no gate on funding. Pre-fix:
  // systemDrawerCredit was forced to 0 for a single on-account payment (the
  // float never moved even though the transfer physically happened).
  // ═══════════════════════════════════════════════════════════════════════
  it("CASE 7 — SEND CUSTOMER_ACCOUNT-funded, float draws immediately (x=100, f=5, c=1)", () => {
    const before = snapshot(db);

    repo.createTransaction({
      provider: "OMT",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 1,
      omtFee: 5,
      paidByMethod: "CUSTOMER_ACCOUNT",
      clientName: "Test Client",
      phoneNumber: "70000000",
      includingFees: false,
      exchangeRate: 90000,
    });

    const after = snapshot(db);

    // No drawer moves for the customer's side — it's a receivable, not cash.
    expect(drawerDelta(before, after, "General_USD")).toBeCloseTo(0, 5);
    // The float still draws down by the full principal, immediately.
    expect(drawerDelta(before, after, "OMT_System_USD")).toBeCloseTo(-100, 5);
    // debt_ledger carries the full customer-owed total (x + f = 105).
    expect(after.debtUsd - before.debtUsd).toBeCloseTo(105, 5);
    expect(after.supplierUsd - before.supplierUsd).toBeCloseTo(4, 5); // f - c

    // Extended invariant: the debt receivable stands in for the missing
    // drawer credit (no drawer moved for the customer's payment at all).
    assertInvariant(before, after, {
      commission: 1,
      debtDeltaUsd: after.debtUsd - before.debtUsd,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CASE 8 — REJECTED: walk-in transaction on the SECONDARY provider
  // (WHISH, when shop_base_system = OMT) with no partnerId. Pre-fix: this
  // silently skipped the supplier-ledger entry (skipSecondarySupplierLedger)
  // and booked NOTHING anywhere — the obligation vanished into no ledger at
  // all. Orchestrator default: reject outright.
  // ═══════════════════════════════════════════════════════════════════════
  it("CASE 8 — REJECTED: walk-in WHISH SEND with no partnerId writes nothing", () => {
    const before = snapshot(db);
    const fsCountBefore = rowCount(db, "financial_services");
    const txnCountBefore = rowCount(db, "transactions");
    const paymentsCountBefore = rowCount(db, "payments");

    expect(() =>
      repo.createTransaction({
        provider: "WHISH",
        serviceType: "SEND",
        amount: 50,
        currency: "USD",
        commission: 0,
        paidByMethod: "CASH",
        exchangeRate: 90000,
      }),
    ).toThrow(/secondary system/i);

    const after = snapshot(db);
    expect(rowCount(db, "financial_services")).toBe(fsCountBefore);
    expect(rowCount(db, "transactions")).toBe(txnCountBefore);
    expect(rowCount(db, "payments")).toBe(paymentsCountBefore);
    expect(after.drawers).toEqual(before.drawers);
  });

  it("CASE 8b — REJECTED: walk-in WHISH RECEIVE with no partnerId writes nothing (symmetric)", () => {
    const before = snapshot(db);
    const fsCountBefore = rowCount(db, "financial_services");

    expect(() =>
      repo.createTransaction({
        provider: "WHISH",
        serviceType: "RECEIVE",
        amount: 50,
        currency: "USD",
        commission: 0,
        cashoutMethod: "CASH",
        exchangeRate: 90000,
      }),
    ).toThrow(/secondary system/i);

    const after = snapshot(db);
    expect(rowCount(db, "financial_services")).toBe(fsCountBefore);
    expect(after.drawers).toEqual(before.drawers);
  });

  it("does NOT reject a THROUGH-partner WHISH SEND (partnerId set)", () => {
    db.prepare(`INSERT INTO partners (name) VALUES ('Test Partner')`).run();

    expect(() =>
      repo.createTransaction({
        provider: "WHISH",
        serviceType: "SEND",
        amount: 50,
        currency: "USD",
        commission: 0,
        partnerId: 1,
        exchangeRate: 90000,
      }),
    ).not.toThrow();
  });
});
