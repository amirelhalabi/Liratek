/**
 * FinancialServiceRepository — S2 hard-reject leg reconciliation, wired in
 * (Payment-Legs Integrity plan, Wave 7 / Phase 2)
 *
 * `reconcileLegs` (repositories/moneyPosting.ts) is unit-tested standalone in
 * moneyPosting.test.ts. This file proves the WIRING: a mismatched leg set is
 * rejected atomically (no transaction row, no drawer movement, no payment
 * row survives — `db.transaction(...)`'s automatic rollback on throw), for
 * each branch S2 targets:
 *   - wallet-transfer SEND (Binance / OMT_APP / WHISH_APP)
 *   - legacy OMT/WHISH SEND (system-drawer reserve flow)
 *   - OMT/WHISH RECEIVE CASH cashout (split-currency payout)
 *   - cost/price checkout flow carrier `checkoutTotal` (iPick / Katsh /
 *     WHISH_APP / OMT_APP catalog carts — Wave 8, owner decision 2026-07-18)
 *
 * Per rule 17, each "rejects" case is paired with a "same numbers, but this
 * one reconciles" positive case proving the check isn't just always-throw.
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
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

jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: jest.fn() }),
  resetDebtService: jest.fn(),
}));

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

    INSERT INTO drawer_balances VALUES (1, 'General',      'USD',  1000,      CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General',      'LBP',  100000000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_App',      'USD',  500,       CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Whish_App',    'USD',  500,       CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Binance',      'USDT', 500,       CURRENT_TIMESTAMP);
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

function counts(db: Database.Database): {
  transactions: number;
  financialServices: number;
  payments: number;
  debtLedger: number;
} {
  const one = (table: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  return {
    transactions: one("transactions"),
    financialServices: one("financial_services"),
    payments: one("payments"),
    debtLedger: one("debt_ledger"),
  };
}

describe("FinancialServiceRepository — S2 leg reconciliation wiring", () => {
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
  // Wallet-transfer SEND (Binance / OMT_APP / WHISH_APP)
  //
  // Wave 9 update (PAYMENT_LEGS_INTEGRITY_PLAN, lira-108 fix): this branch no
  // longer GUESSES the customer-owed total as `amount + fee` — that guess was
  // wrong for a SEND whose fee is carved OUT of the entered amount instead of
  // added on top (see the "lira-108 raw payload" describe block below). The
  // three tests here now supply `checkoutTotal` explicitly (the same value
  // the removed guess used to compute) so they keep exercising the
  // reject/reconcile paths through the NEW contract instead of the deleted
  // one — a caller with no `checkoutTotal` at all now skips the check
  // entirely (see "no checkoutTotal" below).
  // ═══════════════════════════════════════════════════════════════════════
  describe("wallet-transfer SEND", () => {
    it("REJECTS a single LBP leg that is short of the checkout total (the exact bug class this plan kills)", () => {
      // $10 owed (no fee); customer's LBP leg is only worth ~$5 at the
      // stamped rate — this is precisely the "gated legs" shape (a form
      // dropping amount+currency) the pre-Wave-6/7 code silently accepted.
      const before = counts(db);
      const genLbpBefore = balance(db, "General", "LBP");
      const appBefore = balance(db, "Whish_App", "USD");

      expect(() =>
        repo.createTransaction({
          provider: "WHISH_APP",
          serviceType: "SEND",
          amount: 10,
          currency: "USD",
          commission: 0,
          payments: [{ method: "CASH", currencyCode: "LBP", amount: 450000 }],
          checkoutTotal: { usd: 10, lbp: 0 },
          exchangeRate: 90000,
        }),
      ).toThrow(/do not reconcile/);

      // Atomic: nothing persisted, no drawer moved.
      expect(counts(db)).toEqual(before);
      expect(balance(db, "General", "LBP")).toBe(genLbpBefore);
      expect(balance(db, "Whish_App", "USD")).toBe(appBefore);
    });

    it("control: the SAME transfer with the CORRECT leg amount reconciles and persists", () => {
      const before = counts(db);
      repo.createTransaction({
        provider: "WHISH_APP",
        serviceType: "SEND",
        amount: 10,
        currency: "USD",
        commission: 0,
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 900000 }],
        checkoutTotal: { usd: 10, lbp: 0 },
        exchangeRate: 90000,
      });
      const after = counts(db);
      expect(after.transactions).toBe(before.transactions + 1);
      expect(after.payments).toBeGreaterThan(before.payments);
      expect(balance(db, "General", "LBP")).toBe(
        100000000 - 0 + 900000, // seeded 100,000,000 + this leg
      );
    });

    it("REJECTS a Binance SEND whose legs are missing the fee", () => {
      const before = counts(db);
      expect(() =>
        repo.createTransaction({
          provider: "BINANCE",
          serviceType: "SEND",
          amount: 100,
          currency: "USDT",
          commission: 2,
          payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }], // missing the $2 fee
          checkoutTotal: { usd: 102, lbp: 0 },
          exchangeRate: 90000,
        }),
      ).toThrow(/do not reconcile/);
      expect(counts(db)).toEqual(before);
      expect(balance(db, "Binance", "USDT")).toBe(500);
    });

    it("no checkoutTotal at all: the legs are NOT checked (no amount+fee guess) — legacy/scripted callers unaffected", () => {
      // Same shape as the very first REJECTS case (a $10 owed SEND with only
      // a ~$5-equivalent LBP leg) but WITHOUT checkoutTotal. Pre-lira-108 the
      // repository's own amount+fee guess would still catch this; post-fix
      // there is no guess at all — the caller must supply the real total, or
      // the check no-ops, exactly like every other reconcileLegs site.
      const before = counts(db);
      expect(() =>
        repo.createTransaction({
          provider: "WHISH_APP",
          serviceType: "SEND",
          amount: 10,
          currency: "USD",
          commission: 0,
          payments: [{ method: "CASH", currencyCode: "LBP", amount: 450000 }],
          exchangeRate: 90000,
        }),
      ).not.toThrow();
      expect(counts(db).transactions).toBe(before.transactions + 1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // lira-108 raw payload (rule 17 proof): OMT App SEND where the fee is
  // carved OUT of the entered amount, not added on top. The pre-fix branch
  // guessed `expected = amount + fee` and hard-rejected this exact,
  // legitimate payload (from the app log): "expected $139.31 ... got IN
  // $142.31, OUT $0.00, kept $5.00 = $137.31, diff $-2.00". No `checkoutTotal`
  // is supplied (this is a raw scripted/e2e caller, like lira-108's IPC
  // test) — the fix is to skip the check entirely rather than guess, per the
  // "wallet-transfer SEND" describe block above.
  // ═══════════════════════════════════════════════════════════════════════
  describe("lira-108 — OMT App SEND, fee carved out of amount (no checkoutTotal)", () => {
    it("does not reject the exact lira-108 payload; the transaction persists", () => {
      const before = counts(db);
      expect(() =>
        repo.createTransaction({
          provider: "OMT_APP",
          serviceType: "SEND",
          amount: 137.31,
          currency: "USD",
          commission: 2,
          paidByMethod: "CASH",
          payments: [
            {
              method: "CASH",
              currencyCode: "USD",
              amount: 142.31,
              direction: "IN",
            },
          ],
          kept_change_usd: 5,
          kept_change_lbp: 0,
          exchangeRate: 90000,
        }),
      ).not.toThrow();
      expect(counts(db).transactions).toBe(before.transactions + 1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // lira-095 tender-rate divergence (rule 17 proof): the cost/price checkout
  // branch's `checkoutTotal` reconciliation (Wave 8) already existed before
  // this fix — the bug is which RATE it converts at. MultiPaymentInput
  // converts the customer's tender at whatever rate the form passed it
  // (KatchForm passes the BUY rate — owner decision 2026-07-06), while this
  // branch fell back to `exchangeRate` (the stamped, SELL-side rate for
  // money-in) whenever the caller didn't send one — which KatchForm never
  // did. A real buy/sell spread pushes the mismatch past the $0.05 epsilon
  // even though the till's own math nets to exactly zero. `tender_exchange_rate`
  // lets the caller say "reconcile at the rate I actually used".
  // ═══════════════════════════════════════════════════════════════════════
  describe("lira-095 — tender_exchange_rate reconciles at the till's own rate", () => {
    it("REJECTS at the stamped (sell) rate when the till used a different (buy) rate for change", () => {
      // Katsh bill: 313,000 LBP owed. Customer tenders $5 USD; the till
      // computed change at the BUY rate (89,000): $5 x 89,000 = 445,000,
      // change = 445,000 - 313,000 = 132,000 LBP. Reconciling at the
      // STAMPED sell rate (90,000) instead: inUsd=5, outUsd=132000/90000=
      // 1.4667, expected=313000/90000=3.4778, got=3.5333 — diff ≈ $0.0556,
      // just over the $0.05 epsilon (the exact lira-095 failure mode).
      const before = counts(db);
      expect(() =>
        repo.createTransaction({
          provider: "Katsh",
          serviceType: "SEND",
          amount: 313000,
          cost: 313000,
          price: 313000,
          currency: "LBP",
          commission: 0,
          payments: [
            { method: "CASH", currencyCode: "USD", amount: 5, direction: "IN" },
            {
              method: "CASH",
              currencyCode: "LBP",
              amount: 132000,
              direction: "OUT",
            },
          ],
          checkoutTotal: { usd: 0, lbp: 313000 },
          exchangeRate: 90000, // stamped sell rate — pre-fix, the ONLY rate available
        }),
      ).toThrow(/do not reconcile/);
      expect(counts(db)).toEqual(before);
    });

    it("FIXED: reconciles when tender_exchange_rate (the till's own buy-rate conversion) is supplied", () => {
      const before = counts(db);
      repo.createTransaction({
        provider: "Katsh",
        serviceType: "SEND",
        amount: 313000,
        cost: 313000,
        price: 313000,
        currency: "LBP",
        commission: 0,
        payments: [
          { method: "CASH", currencyCode: "USD", amount: 5, direction: "IN" },
          {
            method: "CASH",
            currencyCode: "LBP",
            amount: 132000,
            direction: "OUT",
          },
        ],
        checkoutTotal: { usd: 0, lbp: 313000 },
        exchangeRate: 90000, // stamped sell rate — still recorded on the txn
        tender_exchange_rate: 89000, // the till's own buy-rate conversion
      });
      expect(counts(db).transactions).toBe(before.transactions + 1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Legacy OMT/WHISH SEND (system-drawer reserve flow)
  // ═══════════════════════════════════════════════════════════════════════
  describe("legacy OMT SEND (system-drawer reserve)", () => {
    it("REJECTS legs that undershoot the transfer total", () => {
      const before = counts(db);
      const genUsdBefore = balance(db, "General", "USD");
      const systemBefore = balance(db, "OMT_System", "USD");

      expect(() =>
        repo.createTransaction({
          provider: "OMT",
          serviceType: "SEND",
          amount: 10,
          currency: "USD",
          commission: 0,
          payments: [{ method: "CASH", currencyCode: "USD", amount: 3 }], // owes $10
          exchangeRate: 90000,
        }),
      ).toThrow(/do not reconcile/);

      expect(counts(db)).toEqual(before);
      expect(balance(db, "General", "USD")).toBe(genUsdBefore);
      expect(balance(db, "OMT_System", "USD")).toBe(systemBefore);
    });

    it("control: the correct total reconciles and books the reserve transfer", () => {
      const before = counts(db);
      repo.createTransaction({
        provider: "OMT",
        serviceType: "SEND",
        amount: 10,
        currency: "USD",
        commission: 0,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 10 }],
        exchangeRate: 90000,
      });
      expect(counts(db).transactions).toBe(before.transactions + 1);
      expect(balance(db, "OMT_System", "USD")).toBe(500 + 10);
    });

    it("a CUSTOMER_ACCOUNT leg covering the remainder reconciles (S2 owner decision: account legs count as IN)", () => {
      db.prepare(
        `INSERT INTO clients (id, full_name, phone_number) VALUES (1, 'Test Client', '71000000')`,
      ).run();
      const before = counts(db);
      repo.createTransaction({
        provider: "OMT",
        serviceType: "SEND",
        amount: 10,
        currency: "USD",
        commission: 0,
        clientId: 1,
        payments: [
          { method: "CASH", currencyCode: "USD", amount: 6 },
          { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 4 },
        ],
        exchangeRate: 90000,
      });
      expect(counts(db).transactions).toBe(before.transactions + 1);
      const debt = db
        .prepare(`SELECT amount_usd FROM debt_ledger ORDER BY id DESC LIMIT 1`)
        .get() as { amount_usd: number } | undefined;
      expect(debt?.amount_usd).toBeCloseTo(4, 2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // OMT/WHISH RECEIVE CASH cashout (split-currency payout, the C1 bug family)
  // ═══════════════════════════════════════════════════════════════════════
  describe("OMT RECEIVE CASH cashout", () => {
    it("REJECTS a split payout that overshoots the transfer amount", () => {
      const before = counts(db);
      const genUsdBefore = balance(db, "General", "USD");
      const genLbpBefore = balance(db, "General", "LBP");

      expect(() =>
        repo.createTransaction({
          provider: "OMT",
          serviceType: "RECEIVE",
          amount: 100,
          currency: "USD",
          commission: 0,
          cashoutMethod: "CASH",
          payments: [
            { method: "CASH", currencyCode: "USD", amount: 50 },
            { method: "CASH", currencyCode: "LBP", amount: 9000000 }, // 50 + 100 = 150, not 100
          ],
          exchangeRate: 90000,
        }),
      ).toThrow(/do not reconcile/);

      expect(counts(db)).toEqual(before);
      expect(balance(db, "General", "USD")).toBe(genUsdBefore);
      expect(balance(db, "General", "LBP")).toBe(genLbpBefore);
    });

    it("control: the correct split payout (190 USD + 540,000 LBP = $196) reconciles", () => {
      const before = counts(db);
      repo.createTransaction({
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 196,
        currency: "USD",
        commission: 0,
        cashoutMethod: "CASH",
        payments: [
          { method: "CASH", currencyCode: "USD", amount: 190 },
          { method: "CASH", currencyCode: "LBP", amount: 540000 },
        ],
        exchangeRate: 90000,
      });
      expect(counts(db).transactions).toBe(before.transactions + 1);
      expect(balance(db, "General", "USD")).toBe(1000 - 190);
      expect(balance(db, "General", "LBP")).toBe(100000000 - 540000);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // No legs / deferPayment — the check must not fire
  // ═══════════════════════════════════════════════════════════════════════
  describe("bypass paths", () => {
    it("no legs at all: the single-payment fallback is never checked", () => {
      expect(() =>
        repo.createTransaction({
          provider: "WHISH_APP",
          serviceType: "SEND",
          amount: 10,
          currency: "USD",
          commission: 0,
          paidByMethod: "CASH",
          exchangeRate: 90000,
        }),
      ).not.toThrow();
    });

    it("deferPayment: mismatched legs are still ignored — the session basket owns the customer-cash side", () => {
      // A wildly wrong leg would fail reconciliation on a normal call, but
      // deferPayment must skip the check entirely (per plan: "deferPayment
      // session items skip customer-leg processing entirely").
      expect(() =>
        repo.createTransaction({
          provider: "WHISH_APP",
          serviceType: "SEND",
          amount: 10,
          currency: "USD",
          commission: 0,
          deferPayment: true,
          payments: [{ method: "CASH", currencyCode: "USD", amount: 0.01 }],
          exchangeRate: 90000,
        }),
      ).not.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Cost/price checkout flow (KatchForm bills / FinancialForm catalog carts)
  // — carrier `checkoutTotal` reconciliation (Wave 8, owner decision
  // 2026-07-18, docs/plans/todo_plans/PAYMENT_LEGS_INTEGRITY_PLAN.md).
  //
  // Unlike every branch above, the "required total" here is NOT this
  // transaction's own `price` — a multi-unit cart books ALL of its legs
  // against exactly ONE carrier transaction, while every sibling unit
  // submits `deferPayment: true` and carries no legs at all (see
  // docs/plans/todo_plans/CARRIER_LEGS_VOID_ASYMMETRY.md). Reconciling the
  // carrier's legs against its own `price` would hard-reject every
  // legitimate multi-unit checkout, so the caller instead supplies
  // `checkoutTotal` — the full cart total — and the repository reconciles
  // against THAT.
  // ═══════════════════════════════════════════════════════════════════════
  describe("cost/price checkout flow — carrier checkoutTotal (Wave 8)", () => {
    it("REJECTS a carrier whose legs cover only its OWN price, not the full cart total", () => {
      // Two-unit Katsh cart: each unit sells for 900,000 LBP (cost 800,000).
      // The carrier attaches legs worth its own price (900,000) instead of
      // the cart's full total (1,800,000) — exactly the shape a stale
      // frontend build (or a bug) would produce.
      const before = counts(db);
      const katshBefore = balance(db, "Katsh", "LBP");
      const genBefore = balance(db, "General", "LBP");

      expect(() =>
        repo.createTransaction({
          provider: "Katsh",
          serviceType: "SEND",
          amount: 900000,
          cost: 800000,
          price: 900000,
          currency: "LBP",
          commission: 100000,
          payments: [{ method: "CASH", currencyCode: "LBP", amount: 900000 }],
          checkoutTotal: { usd: 0, lbp: 1800000 },
          exchangeRate: 90000,
        }),
      ).toThrow(/do not reconcile/);

      // Atomic: nothing persisted at all, no drawer moved (rule 17 / S2).
      expect(counts(db)).toEqual(before);
      expect(balance(db, "Katsh", "LBP")).toBe(katshBefore);
      expect(balance(db, "General", "LBP")).toBe(genBefore);
    });

    it("control: the carrier's legs covering the FULL cart total reconcile, and the deferPayment sibling adds only its own cost", () => {
      const before = counts(db);

      // Carrier: first unit, carries the full cart's legs.
      repo.createTransaction({
        provider: "Katsh",
        serviceType: "SEND",
        amount: 900000,
        cost: 800000,
        price: 900000,
        currency: "LBP",
        commission: 100000,
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 1800000 }],
        checkoutTotal: { usd: 0, lbp: 1800000 },
        exchangeRate: 90000,
      });

      // Sibling: second unit, deferPayment — cost outflow only, no legs.
      repo.createTransaction({
        provider: "Katsh",
        serviceType: "SEND",
        amount: 900000,
        cost: 800000,
        price: 900000,
        currency: "LBP",
        commission: 100000,
        deferPayment: true,
        exchangeRate: 90000,
      });

      const after = counts(db);
      expect(after.transactions).toBe(before.transactions + 2);
      expect(after.financialServices).toBe(before.financialServices + 2);

      // Katsh drawer debited TWICE (once per unit's own cost) — 2 x 800,000.
      expect(balance(db, "Katsh", "LBP")).toBe(-1600000);
      // General drawer credited ONCE with the full cart total, not per-unit
      // (the sibling never touches the customer-cash side at all).
      expect(balance(db, "General", "LBP")).toBe(100000000 + 1800000);
    });

    it("legs present WITHOUT checkoutTotal: unchecked legacy behavior is unaffected", () => {
      // Same shape as the REJECT case above (legs cover only 900,000 of an
      // implicit 1,800,000 cart) but `checkoutTotal` is omitted entirely —
      // exactly what every pre-Wave-8 caller (existing e2e specs, scripted
      // callers) sends. Must succeed unchanged — proves the new check is
      // strictly additive (rule 17: zero assertion changes to pre-wave-7
      // tests).
      expect(() =>
        repo.createTransaction({
          provider: "Katsh",
          serviceType: "SEND",
          amount: 900000,
          cost: 800000,
          price: 900000,
          currency: "LBP",
          commission: 100000,
          payments: [{ method: "CASH", currencyCode: "LBP", amount: 900000 }],
          exchangeRate: 90000,
        }),
      ).not.toThrow();
    });

    it("REJECTS a carrier whose OUT (change) legs overshoot the checkoutTotal", () => {
      const before = counts(db);
      expect(() =>
        repo.createTransaction({
          provider: "Katsh",
          serviceType: "SEND",
          amount: 900000,
          cost: 800000,
          price: 900000,
          currency: "LBP",
          commission: 100000,
          payments: [
            { method: "CASH", currencyCode: "LBP", amount: 2000000 },
            {
              method: "CASH",
              currencyCode: "LBP",
              amount: 300000, // too much change — 2,000,000 - 300,000 = 1,700,000 ≠ 1,800,000
              direction: "OUT",
            },
          ],
          checkoutTotal: { usd: 0, lbp: 1800000 },
          exchangeRate: 90000,
        }),
      ).toThrow(/do not reconcile/);
      expect(counts(db)).toEqual(before);
    });

    it("control: kept-change + OUT change leg net correctly against checkoutTotal", () => {
      // Customer hands over 2,000,000 LBP for an 1,800,000 LBP cart; the shop
      // returns 150,000 LBP in change and keeps 50,000 LBP as profit —
      // 2,000,000 − 150,000 − 50,000 = 1,800,000.
      const before = counts(db);
      repo.createTransaction({
        provider: "Katsh",
        serviceType: "SEND",
        amount: 900000,
        cost: 800000,
        price: 900000,
        currency: "LBP",
        commission: 100000,
        payments: [
          { method: "CASH", currencyCode: "LBP", amount: 2000000 },
          {
            method: "CASH",
            currencyCode: "LBP",
            amount: 150000,
            direction: "OUT",
          },
        ],
        kept_change_lbp: 50000,
        checkoutTotal: { usd: 0, lbp: 1800000 },
        exchangeRate: 90000,
      });
      expect(counts(db).transactions).toBe(before.transactions + 1);
      // General drawer: +2,000,000 (cash in) - 150,000 (change out).
      expect(balance(db, "General", "LBP")).toBe(100000000 + 2000000 - 150000);
    });
  });
});
