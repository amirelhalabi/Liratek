/**
 * DebtRepository — Service-Debt provider routing & cash-out default legs
 * (mixed-balance audit, 2026-07-05)
 *
 * Two money bugs, both proven to FAIL on the pre-fix code (CLAUDE.md rule 17):
 *
 * 1. PROVIDER ROUTING WAS KEYED TO "ANY SERVICE DEBT ROW EVER". Original
 *    'Service Debt' ledger rows keep their positive amounts forever
 *    (repayments are separate negative rows), so the routing lookup matched a
 *    long-settled OMT/WHISH service debt and moved EVERY later repayment —
 *    including one settling an unrelated debt — from the payment drawer into
 *    OMT_System/Whish_System, for the FULL leg amount. After the fix the
 *    routed amount is capped at the OUTSTANDING service debt (per-provider
 *    total minus what earlier repayments already routed), and LBP-denominated
 *    service debts route too (the old amount_usd > 0 filter skipped them).
 *
 * 2. THE DEFAULT CASH-OUT PAYOUT LEG WAS USD-ONLY. cashOutCredit with no
 *    payments[] built a single CASH USD leg from amount_usd — an LBP-only
 *    cash-out reduced the credit ledger but debited NO drawer (till
 *    overstated by the payout). The default now emits per-currency CASH legs.
 */

import Database from "better-sqlite3";
import { DebtRepository } from "../DebtRepository";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";

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

const RATE = 90_000;

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL);
    INSERT INTO users (id, username) VALUES (1, 'admin');

    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO clients (id, full_name) VALUES (7, 'Routing Client');

    CREATE TABLE financial_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      service_type TEXT DEFAULT 'SEND',
      amount REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      refunded_at DATETIME,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
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
    INSERT INTO drawer_balances (drawer_name, currency_code, balance, updated_at) VALUES ('General', 'USD', 500, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance, updated_at) VALUES ('General', 'LBP', 20000000, CURRENT_TIMESTAMP);

    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      transaction_id INTEGER,
      note TEXT,
      due_date TEXT,
      created_by INTEGER,
      edited_by TEXT,
      edited_at DATETIME,
      session_id INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      final_amount_usd REAL NOT NULL DEFAULT 0,
      paid_usd REAL NOT NULL DEFAULT 0,
      paid_lbp REAL DEFAULT 0,
      exchange_rate_snapshot REAL DEFAULT 0,
      status TEXT DEFAULT 'completed',
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE exchange_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_code TEXT NOT NULL DEFAULT 'USD',
      to_code TEXT NOT NULL,
      market_rate REAL NOT NULL,
      buy_rate REAL NOT NULL,
      sell_rate REAL NOT NULL,
      is_stronger INTEGER NOT NULL DEFAULT 1,
      tenant_id INTEGER DEFAULT 1
    );
    INSERT INTO exchange_rates (to_code, market_rate, buy_rate, sell_rate, is_stronger)
    VALUES ('LBP', ${RATE}, ${RATE}, ${RATE}, 1);
  `);
  return db;
}

function drawerBalance(
  db: Database.Database,
  drawer: string,
  currency: string,
): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`,
    )
    .get(drawer, currency) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

function systemDrawerLegs(db: Database.Database, drawer: string) {
  return db
    .prepare(
      `SELECT method, currency_code, amount FROM payments WHERE drawer_name = ? ORDER BY id ASC`,
    )
    .all(drawer) as Array<{
    method: string;
    currency_code: string;
    amount: number;
  }>;
}

/** Seed an OMT/WHISH 'Service Debt' ledger row wired the way the app does:
 *  financial_services row → FINANCIAL_SERVICE transaction → debt_ledger row
 *  whose transaction_id points at the unified transaction. */
function seedServiceDebt(
  db: Database.Database,
  clientId: number,
  provider: "OMT" | "WHISH",
  amountUsd: number,
  amountLbp = 0,
): number {
  const fs = db
    .prepare(`INSERT INTO financial_services (provider, amount) VALUES (?, ?)`)
    .run(provider, amountUsd || amountLbp);
  const txn = db
    .prepare(
      `INSERT INTO transactions (type, source_table, source_id, user_id, amount_usd, amount_lbp, client_id)
       VALUES ('FINANCIAL_SERVICE', 'financial_services', ?, 1, ?, ?, ?)`,
    )
    .run(fs.lastInsertRowid, amountUsd, amountLbp, clientId);
  db.prepare(
    `INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, transaction_id, created_by)
     VALUES (?, 'Service Debt', ?, ?, ?, 1)`,
  ).run(clientId, amountUsd, amountLbp, txn.lastInsertRowid);
  return Number(txn.lastInsertRowid);
}

describe("DebtRepository — Service-Debt provider routing (outstanding-capped)", () => {
  let db: Database.Database;
  let repo: DebtRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    resetTransactionRepository();
    repo = new DebtRepository();
  });

  afterEach(() => {
    db.close();
    resetTransactionRepository();
  });

  it("a repayment of an UNRELATED debt does not route into the provider drawer once the service debt is settled", () => {
    // Old USD service debt, fully settled by a first repayment.
    seedServiceDebt(db, 7, "OMT", 50);
    repo.addRepayment({
      client_id: 7,
      amount_usd: 50,
      amount_lbp: 0,
      created_by: 1,
    });
    expect(drawerBalance(db, "OMT_System", "USD")).toBeCloseTo(50, 2);

    // Later, an unrelated LBP debt (e.g. a sale) …
    db.prepare(
      `INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, created_by)
       VALUES (7, 'Sale Debt', 0, 900000, 1)`,
    ).run();

    const generalLbpBefore = drawerBalance(db, "General", "LBP");

    // … repaid in LBP. Pre-fix: the stale Service Debt row matched
    // (amount_usd > 0 forever) and the FULL 900,000 LBP moved into
    // OMT_System. Post-fix: outstanding service debt is 0 → no routing.
    repo.addRepayment({
      client_id: 7,
      amount_usd: 0,
      amount_lbp: 900_000,
      created_by: 1,
    });

    expect(drawerBalance(db, "OMT_System", "LBP")).toBeCloseTo(0, 2);
    expect(drawerBalance(db, "OMT_System", "USD")).toBeCloseTo(50, 2);
    expect(drawerBalance(db, "General", "LBP")).toBeCloseTo(
      generalLbpBefore + 900_000,
      2,
    );
    const lbpIntoOmt = systemDrawerLegs(db, "OMT_System").filter(
      (l) => l.currency_code === "LBP",
    );
    expect(lbpIntoOmt).toEqual([]);
  });

  it("routes only the OUTSTANDING service-debt share of a larger repayment leg", () => {
    // $30 OMT service debt + $70 sale debt, repaid in one $100 leg.
    seedServiceDebt(db, 7, "OMT", 30);
    db.prepare(
      `INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, created_by)
       VALUES (7, 'Sale Debt', 70, 1)`,
    ).run();

    const generalUsdBefore = drawerBalance(db, "General", "USD");

    repo.addRepayment({
      client_id: 7,
      amount_usd: 100,
      amount_lbp: 0,
      created_by: 1,
    });

    // Pre-fix: the full $100 moved into OMT_System (General net 0).
    expect(drawerBalance(db, "OMT_System", "USD")).toBeCloseTo(30, 2);
    expect(drawerBalance(db, "General", "USD")).toBeCloseTo(
      generalUsdBefore + 70,
      2,
    );
  });

  it("routes an LBP-denominated service debt (the old amount_usd filter skipped it)", () => {
    seedServiceDebt(db, 7, "WHISH", 0, 1_800_000);

    repo.addRepayment({
      client_id: 7,
      amount_usd: 0,
      amount_lbp: 1_800_000,
      created_by: 1,
    });

    expect(drawerBalance(db, "Whish_System", "LBP")).toBeCloseTo(1_800_000, 2);
  });

  it("caps routing at the NET kept when an overpayment is handed back as change", () => {
    // $100 OMT service debt, settled by a $130 cash IN with $30 change out
    // (net kept $100). Pre-fix (cap = gross leg): routes min($130, $100
    // outstanding) = $100 but only $100 net was kept, and with a LARGER debt
    // the gross-leg cap would over-route. Here the net cap keeps it honest.
    seedServiceDebt(db, 7, "OMT", 150); // outstanding exceeds the net kept
    const generalBefore = drawerBalance(db, "General", "USD");

    repo.addRepayment({
      client_id: 7,
      amount_usd: 100, // net reduction
      amount_lbp: 0,
      created_by: 1,
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 130 },
        { method: "CASH", currencyCode: "USD", amount: 30, direction: "OUT" },
      ],
    });

    // Routes only the $100 net kept (not the $130 gross leg): General nets to
    // 0 (+130 in, −100 reserve, −30 change), provider gets exactly $100.
    expect(drawerBalance(db, "OMT_System", "USD")).toBeCloseTo(100, 2);
    expect(drawerBalance(db, "General", "USD")).toBeCloseTo(generalBefore, 2);
  });

  it("decrements the per-leg cap across a split repayment (multi-leg)", () => {
    // $60 OMT service debt, paid by two USD legs ($40 + $50 = $90 gross). The
    // first leg routes $40, the second routes only the remaining $20; the
    // $70 non-service surplus stays in General.
    seedServiceDebt(db, 7, "OMT", 60);
    const generalBefore = drawerBalance(db, "General", "USD");

    repo.addRepayment({
      client_id: 7,
      amount_usd: 90,
      amount_lbp: 0,
      created_by: 1,
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 40 },
        { method: "CASH", currencyCode: "USD", amount: 50 },
      ],
    });

    expect(drawerBalance(db, "OMT_System", "USD")).toBeCloseTo(60, 2);
    expect(drawerBalance(db, "General", "USD")).toBeCloseTo(
      generalBefore + 30,
      2,
    );
  });

  it("keeps routing strictly per-currency: an LBP leg does NOT settle a USD service debt", () => {
    // USD-only OMT service debt. Repaid in LBP. Per-currency routing: the LBP
    // leg has no USD outstanding to match and OMT has no LBP debt, so nothing
    // routes — the LBP stays in General (the cross-currency conversion that
    // reopened settled debts on rate moves is gone).
    seedServiceDebt(db, 7, "OMT", 50);
    const generalLbpBefore = drawerBalance(db, "General", "LBP");

    repo.addRepayment({
      client_id: 7,
      amount_usd: 0,
      amount_lbp: 900_000,
      created_by: 1,
    });

    expect(drawerBalance(db, "OMT_System", "LBP")).toBeCloseTo(0, 2);
    expect(drawerBalance(db, "General", "LBP")).toBeCloseTo(
      generalLbpBefore + 900_000,
      2,
    );
  });

  it("a REFUNDED service debt does not route a later repayment into the provider drawer (pre-fix: over-routed)", () => {
    // $50 OMT service debt on account, then refunded from the Transactions
    // table. The refund leaves the original FINANCIAL_SERVICE txn ACTIVE and
    // books a 'Refund Reversal' −$50 against the same transaction_id — the
    // outstanding computation must net the pair to 0, or the client's next
    // (unrelated) repayment silently moves cash into OMT_System.
    const txnId = seedServiceDebt(db, 7, "OMT", 50);
    new TransactionRepository().refundTransaction(txnId, 1);

    // Unrelated sale debt, repaid in USD.
    db.prepare(
      `INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, created_by)
       VALUES (7, 'Sale Debt', 50, 1)`,
    ).run();
    const generalBefore = drawerBalance(db, "General", "USD");

    repo.addRepayment({
      client_id: 7,
      amount_usd: 50,
      amount_lbp: 0,
      created_by: 1,
    });

    expect(drawerBalance(db, "OMT_System", "USD")).toBeCloseTo(0, 2);
    expect(drawerBalance(db, "General", "USD")).toBeCloseTo(
      generalBefore + 50,
      2,
    );
  });

  it("does not count routing from a VOIDED repayment toward already-routed", () => {
    // A prior repayment routed $50 into OMT_System, then was VOIDED. Its
    // routing is conceptually reversed, so a fresh repayment of the same
    // $50 outstanding debt must still route. Simulate the voided prior
    // repayment directly (status VOIDED on the transaction).
    seedServiceDebt(db, 7, "OMT", 50);
    const voided = db
      .prepare(
        `INSERT INTO transactions (type, status, source_table, source_id, user_id, amount_usd, client_id)
         VALUES ('DEBT_REPAYMENT', 'VOIDED', 'debt_ledger', 999, 1, 50, 7)`,
      )
      .run();
    db.prepare(
      `INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount, created_by)
       VALUES (?, 'OMT', 'OMT_System', 'USD', 50, 1)`,
    ).run(voided.lastInsertRowid);

    repo.addRepayment({
      client_id: 7,
      amount_usd: 50,
      amount_lbp: 0,
      created_by: 1,
    });

    // The active repayment routes the full $50 (the voided routing is ignored
    // by the status = 'ACTIVE' filter). If voided rows counted, outstanding
    // would read 0 and nothing would route.
    const activeRouted = db
      .prepare(
        `SELECT COALESCE(SUM(p.amount), 0) AS s
         FROM payments p JOIN transactions t ON t.id = p.transaction_id
         WHERE t.status = 'ACTIVE' AND p.drawer_name = 'OMT_System' AND p.amount > 0`,
      )
      .get() as { s: number };
    expect(activeRouted.s).toBeCloseTo(50, 2);
  });
});

describe("DebtRepository — cashOutCredit default payout legs", () => {
  let db: Database.Database;
  let repo: DebtRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    resetTransactionRepository();
    repo = new DebtRepository();
  });

  afterEach(() => {
    db.close();
    resetTransactionRepository();
  });

  it("LBP-only cash out without explicit legs debits the LBP till (pre-fix: ledger moved, NO drawer debit)", () => {
    repo.addCredit({
      clientId: 7,
      amountUsd: 0,
      amountLbp: 500_000,
      note: "seed",
      createdBy: "1",
    });
    const lbpBefore = drawerBalance(db, "General", "LBP");

    repo.cashOutCredit({
      client_id: 7,
      amount_usd: 0,
      amount_lbp: 500_000,
      created_by: 1,
    });

    expect(drawerBalance(db, "General", "LBP")).toBeCloseTo(
      lbpBefore - 500_000,
      2,
    );
    const payout = db
      .prepare(
        `SELECT method, currency_code, amount FROM payments WHERE drawer_name = 'General' AND currency_code = 'LBP' ORDER BY id DESC LIMIT 1`,
      )
      .get() as { method: string; currency_code: string; amount: number };
    expect(payout).toMatchObject({
      method: "CASH",
      currency_code: "LBP",
      amount: -500_000,
    });
  });

  it("mixed cash out without explicit legs debits BOTH currencies", () => {
    repo.addCredit({
      clientId: 7,
      amountUsd: 20,
      amountLbp: 300_000,
      note: "seed",
      createdBy: "1",
    });
    const usdBefore = drawerBalance(db, "General", "USD");
    const lbpBefore = drawerBalance(db, "General", "LBP");

    repo.cashOutCredit({
      client_id: 7,
      amount_usd: 20,
      amount_lbp: 300_000,
      created_by: 1,
    });

    expect(drawerBalance(db, "General", "USD")).toBeCloseTo(usdBefore - 20, 2);
    expect(drawerBalance(db, "General", "LBP")).toBeCloseTo(
      lbpBefore - 300_000,
      2,
    );
  });

  it("USD-only default leg behaviour is unchanged", () => {
    repo.addCredit({
      clientId: 7,
      amountUsd: 20,
      amountLbp: 0,
      note: "seed",
      createdBy: "1",
    });
    const usdBefore = drawerBalance(db, "General", "USD");

    repo.cashOutCredit({
      client_id: 7,
      amount_usd: 20,
      amount_lbp: 0,
      created_by: 1,
    });

    expect(drawerBalance(db, "General", "USD")).toBeCloseTo(usdBefore - 20, 2);
  });
});
