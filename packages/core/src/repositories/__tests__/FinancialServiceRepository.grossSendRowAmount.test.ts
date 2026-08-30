/**
 * FinancialServiceRepository — D1.1 "show the cash that crossed the counter"
 * (owner decision, 2026-08-29; ticket restates CLAUDE.md rules 13/14/16/17/19/20
 * and docs/FEATURE_GUIDE.md §7/§8/§8.1 — read before touching this file).
 *
 * Owner: a plain OMT/WHISH SEND's `transactions` row must carry the GROSS the
 * customer handed over — principal `x` + the provider's customer fee `f` —
 * not the bare transfer principal, "so the row, the drawer movement and the
 * supplier payable all carry ONE number instead of three."
 *
 * SCOPE (deliberate, see FinancialServiceRepository.ts's `unifiedAmount` doc
 * comment): SEND only. RECEIVE is NOT touched — the owner's "cash the
 * customer handed over" language describes a SEND; a RECEIVE customer
 * receives a payout and (fee-on-top only) hands over just the fee, not the
 * transfer. Case (d) below pins that boundary so a future change to RECEIVE
 * is a deliberate, reviewed decision, not silent drift.
 *
 * RULE 17 (prove failing-first): every `.amount_usd`/`.amount_lbp` assertion
 * below is traced, statically, against the PRE-FIX code (this task ran no
 * tests/builds per its own "do not run anything" instruction — the owner's
 * next full `yarn test` pass is the first actual execution of these
 * numbers). Pre-fix, `unifiedAmount` for a plain OMT/WHISH SEND was bare
 * `data.amount` — no fee added — while the SEND branch's own `totalCollected`
 * (the cash leg / drawer delta, UNTOUCHED by this fix) already included the
 * fee. So on the pre-fix code:
 *   case (a) fee-on-top:  data.amount=100 (row) vs totalCollected=105 (drawer)
 *   case (b) fee-included: data.amount=95  (row) vs totalCollected=100 (drawer)
 * Every `row === drawer` equality below — the whole point of this ticket —
 * would have failed on that code for exactly that reason (100≠105, 95≠100).
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

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

// ─── Mock DebtService (unused by these cases, but imported by the repo) ──────

jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: jest.fn() }),
  resetDebtService: jest.fn(),
}));

// ─── In-memory schema — copied verbatim from
//      FinancialServiceRepository.crossCurrencyTender.test.ts (a file that
//      already exercises this exact SEND/CASH code path end-to-end), per
//      the TEST-SCHEMA TRAP note: every table `createTransaction` prepares
//      against, enumerated once there, reused here rather than re-derived
//      by hand. ─────────────────────────────────────────────────────────

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
      commission_model INTEGER NOT NULL DEFAULT 0
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

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
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

    INSERT INTO drawer_balances VALUES (1, 'General',      'USD',  1000,      CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General',      'LBP',  100000000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_System',   'USD',  500,       CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Whish_System', 'USD',  500,       CURRENT_TIMESTAMP);
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

function lastTransaction(db: Database.Database): {
  summary: string;
  amount_usd: number;
  amount_lbp: number;
} {
  return db
    .prepare(
      `SELECT summary, amount_usd, amount_lbp FROM transactions ORDER BY id DESC LIMIT 1`,
    )
    .get() as { summary: string; amount_usd: number; amount_lbp: number };
}

describe("FinancialServiceRepository — D1.1 gross SEND row amount", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    repo = new FinancialServiceRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // (a) FEE ON TOP — ticket's worked example: customer hands 105, provider
  // moves 100 (x=100, f=5).
  // ═══════════════════════════════════════════════════════════════════════
  it("(a) OMT SEND, fee ON TOP: row = 105 = the PCD (drawer) delta — the equality this ticket exists to prove", () => {
    const pcdBefore = balance(db, "OMT_System", "USD");

    // Fee-on-top: `data.amount` IS the transfer principal x (nothing
    // pre-netted) — the frontend only pre-nets the fee-INCLUDED case (b).
    repo.createTransaction({
      provider: "OMT",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 0,
      omtFee: 5,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 105 }],
      exchangeRate: 90000,
    });

    const pcdDelta = balance(db, "OMT_System", "USD") - pcdBefore;
    const txn = lastTransaction(db);

    expect(pcdDelta).toBeCloseTo(105, 5);
    expect(txn.amount_usd).toBeCloseTo(105, 5);
    expect(txn.amount_lbp).toBe(0);
    // THE point of D1.1: the row and the actual cash movement agree.
    expect(txn.amount_usd).toBeCloseTo(pcdDelta, 5);
    // Split spelled out in the summary (item 2) — formatMoneyAmount for the
    // headline (moneyPosting.ts's shared stored-summary formatter, rule 14),
    // so this reads "$105", not the ticket's illustrative "105 USD" — a
    // deliberate, reported deviation (see this ticket's report).
    expect(txn.summary).toBe("OMT SEND: $105 (100 transfer + 5 fee)");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // (b) FEE INCLUDED — ticket's worked example: customer hands 100, the
  // transfer itself nets to 95 (x=100, f=5).
  // ═══════════════════════════════════════════════════════════════════════
  it("(b) OMT SEND, fee INCLUDED: row = 100 = the PCD (drawer) delta", () => {
    const pcdBefore = balance(db, "OMT_System", "USD");

    // Fee-included: the FRONTEND pre-nets before this repository ever sees
    // it (Services/index.tsx) — a $100 budget with a $5 fee arrives here as
    // amount=95, omtFee=5. `includingFees: true` is inert for the SEND
    // branch (its own `totalCollected` comment: "do NOT branch on
    // data.includingFees here") — included below only for payload realism.
    repo.createTransaction({
      provider: "OMT",
      serviceType: "SEND",
      amount: 95,
      currency: "USD",
      commission: 0,
      omtFee: 5,
      includingFees: true,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
      exchangeRate: 90000,
    });

    const pcdDelta = balance(db, "OMT_System", "USD") - pcdBefore;
    const txn = lastTransaction(db);

    expect(pcdDelta).toBeCloseTo(100, 5);
    expect(txn.amount_usd).toBeCloseTo(100, 5);
    expect(txn.amount_lbp).toBe(0);
    expect(txn.amount_usd).toBeCloseTo(pcdDelta, 5);
    expect(txn.summary).toBe("OMT SEND: $100 (95 transfer + 5 fee)");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // (c) WHISH / LBP — same formula, different provider + currency; exercises
  // formatMoneyAmount's LBP comma-grouping in the summary (rule 14 payoff:
  // a raw `${n} LBP` copy would have printed "105000 LBP", not "105,000").
  // ═══════════════════════════════════════════════════════════════════════
  it("(c) WHISH SEND (LBP), fee ON TOP: row = 105,000 = the PCD delta, comma-formatted summary", () => {
    // WHISH must be the PRIMARY system for its SEND to route through the
    // PCD/system-drawer flow at all (walk-ins on the secondary provider are
    // rejected — FEATURE_GUIDE §8) — seed shop_base_system=WHISH, same as
    // the sibling crossCurrencyTender.test.ts WHISH case.
    db.exec(
      `INSERT INTO system_settings (key_name, value) VALUES ('shop_base_system', 'WHISH')`,
    );
    const pcdBefore = balance(db, "Whish_System", "LBP");

    repo.createTransaction({
      provider: "WHISH",
      serviceType: "SEND",
      amount: 100000,
      currency: "LBP",
      commission: 0, // WHISH SEND commission is forced to 0 regardless
      whishFee: 5000,
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 105000 }],
      exchangeRate: 90000,
    });

    const pcdDelta = balance(db, "Whish_System", "LBP") - pcdBefore;
    const txn = lastTransaction(db);

    expect(pcdDelta).toBeCloseTo(105000, 2);
    expect(txn.amount_lbp).toBeCloseTo(105000, 2);
    expect(txn.amount_usd).toBe(0);
    expect(txn.amount_lbp).toBeCloseTo(pcdDelta, 2);
    expect(txn.summary).toBe(
      "WHISH SEND: 105,000 LBP (100,000 transfer + 5,000 fee)",
    );
  });

  // ═══════════════════════════════════════════════════════════════════════
  // (d) Zero fee — backward compatibility. No existing test in this suite
  // pins a nonzero-fee plain OMT/WHISH SEND row amount (verified by
  // inspection before writing this file — the only existing coverage,
  // crossCurrencyTender.test.ts's SEND/RECEIVE cases, both omit
  // omtFee/whishFee, i.e. fee=0), so THIS case is what proves this change
  // doesn't perturb the common zero-fee path those tests already cover.
  // ═══════════════════════════════════════════════════════════════════════
  it("(d) OMT SEND with no fee: row is unchanged (bare transfer, exactly the pre-fix behavior)", () => {
    repo.createTransaction({
      provider: "OMT",
      serviceType: "SEND",
      amount: 10,
      currency: "USD",
      commission: 0,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 10 }],
      exchangeRate: 90000,
    });

    const txn = lastTransaction(db);
    expect(txn.amount_usd).toBeCloseTo(10, 5);
    // No fee → no breakdown suffix; the plain pre-existing line survives.
    expect(txn.summary).toBe("OMT SEND: 10 USD");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // (e) RECEIVE is DELIBERATELY out of this ticket's scope — pinned here so
  // a future change to it is a reviewed decision, not silent drift. See
  // `unifiedAmount`'s doc comment in FinancialServiceRepository.ts and this
  // ticket's report for the reasoning (the owner's "cash the customer
  // handed over" language describes a SEND, not a RECEIVE).
  // ═══════════════════════════════════════════════════════════════════════
  it("(e) OMT RECEIVE with a fee: row stays the bare payout reference amount — UNCHANGED, not grossed/netted", () => {
    repo.createTransaction({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 0,
      omtFee: 5,
      cashoutMethod: "CASH",
      feePayments: [{ method: "CASH", currencyCode: "USD", amount: 5 }],
      exchangeRate: 90000,
    });

    const txn = lastTransaction(db);
    // Still the bare `data.amount` (100) — NOT netted to 95, NOT grossed to
    // anything else. If this ever changes, it must change here first.
    expect(txn.amount_usd).toBeCloseTo(100, 5);
  });
});
