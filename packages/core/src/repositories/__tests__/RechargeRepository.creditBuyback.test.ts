/**
 * RechargeRepository.processCreditBuyback — CARRIER_LINES_VALIDITY_PLAN.md
 * Phase 6 (D7/D8): the reverse-direction telecom flow — a customer hands
 * the shop MTC/Alfa credits, the shop pays cash out.
 *
 * Covers the plan's §4 "6" testing row: split-payout per-currency debit via
 * the extracted `postPayoutLegs`, create+void nets to 0 across drawer/line/
 * payments/debt, zero legs rejected, a CUSTOMER_ACCOUNT leg with no client
 * rejected, the same profit a retired `topUpFromCustomer` test asserted for
 * identical input, and the §0.1 drawer-follows-line-sum invariant (including
 * when the drawer had already drifted from the line beforehand — §0.6: this
 * is a NEW path, so it does not get the grandfather exemption).
 */
import Database from "better-sqlite3";
import {
  RechargeRepository,
  resetRechargeRepository,
} from "../RechargeRepository";
import {
  CarrierLineRepository,
  resetCarrierLineRepository,
} from "../CarrierLineRepository";
import { resetCarrierLineMovementRepository } from "../CarrierLineMovementRepository";
import { resetCarrierLineService } from "../../services/CarrierLineService";
import { resetDebtService } from "../../services/DebtService";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

// ─── Mock DB connection (shared by every repo/service singleton) ────────────

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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { setDb } = require("../../db/connection");

const FUTURE_EXPIRY = "2099-01-01";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE recharges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      carrier TEXT NOT NULL,
      recharge_type TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      default_price_to_client REAL,
      currency_code TEXT NOT NULL DEFAULT 'USD',
      paid_by TEXT,
      phone_number TEXT,
      client_id INTEGER,
      client_name TEXT,
      note TEXT,
      created_by INTEGER DEFAULT 1,
      edited_by TEXT,
      edited_at DATETIME,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE carrier_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      carrier TEXT NOT NULL CHECK(carrier IN ('alfa','mtc')),
      phone_number TEXT NOT NULL,
      label TEXT,
      credits REAL NOT NULL DEFAULT 0,
      validity_expires_at TEXT,
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_primary INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_carrier_lines_one_primary_per_carrier
      ON carrier_lines(tenant_id, carrier)
      WHERE is_primary = 1;

    CREATE TABLE carrier_line_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      carrier_line_id INTEGER NOT NULL,
      transaction_id INTEGER,
      credits_delta REAL NOT NULL DEFAULT 0,
      validity_days_delta INTEGER NOT NULL DEFAULT 0,
      previous_validity_expires_at TEXT,
      reason TEXT NOT NULL,
      is_reversed INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT,
      source_id INTEGER,
      user_id INTEGER,
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
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
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

    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      transaction_id INTEGER,
      session_id INTEGER,
      note TEXT,
      due_date TEXT,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);
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
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`,
    )
    .get(drawer, currency) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

function seedDrawer(
  db: Database.Database,
  drawer: string,
  currency: string,
  amount: number,
): void {
  db.prepare(
    `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, ?, ?, ?)
     ON CONFLICT(tenant_id, drawer_name, currency_code) DO UPDATE SET balance = excluded.balance`,
  ).run(drawer, currency, amount);
}

function seedClient(db: Database.Database, name = "Walk-in"): number {
  const res = db
    .prepare(`INSERT INTO clients (full_name) VALUES (?)`)
    .run(name);
  return Number(res.lastInsertRowid);
}

describe("RechargeRepository.processCreditBuyback()", () => {
  let db: Database.Database;
  let repo: RechargeRepository;
  let lineRepo: CarrierLineRepository;

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetRechargeRepository();
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
    resetCarrierLineService();
    resetDebtService();
    resetTransactionRepository();
    repo = new RechargeRepository();
    lineRepo = new CarrierLineRepository();
  });

  afterEach(() => {
    db.close();
    resetTenantContext();
    resetRechargeRepository();
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
    resetCarrierLineService();
    resetDebtService();
    resetTransactionRepository();
  });

  it("happy path: single CASH leg — credits gain on the line+drawer, cash pays out of General, profit = credits - cash", () => {
    const line = lineRepo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 20,
      validity_expires_at: FUTURE_EXPIRY,
    });
    seedDrawer(db, "MTC", "USD", 20); // starts in sync with the line
    seedDrawer(db, "General", "USD", 500);

    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_BUYBACK",
      amount: 10, // credits gained
      cost: 0,
      price: 9, // cash paid out
      currency: "USD",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 9 }],
      userId: 1,
    });

    expect(result.success).toBe(true);

    // Line credits +10; validity untouched (D9).
    const afterLine = lineRepo.getById(line.id)!;
    expect(afterLine.credits).toBeCloseTo(30, 2);
    expect(afterLine.validity_expires_at).toBe(FUTURE_EXPIRY);

    // Provider drawer follows the (single-line) sum: 20 -> 30.
    expect(balance(db, "MTC", "USD")).toBeCloseTo(30, 2);
    expect(balance(db, "MTC", "USD")).toBeCloseTo(
      lineRepo.getCarrierCreditsSum("mtc"),
      6,
    );

    // Cash paid out of General.
    expect(balance(db, "General", "USD")).toBeCloseTo(491, 2);

    const txn = db
      .prepare(
        `SELECT * FROM transactions WHERE type = 'TELECOM_CREDIT_BUYBACK'`,
      )
      .get() as any;
    expect(txn).toBeDefined();
    expect(txn.amount_usd).toBeCloseTo(9, 2);
    expect(txn.profit_usd).toBeCloseTo(1, 2); // 10 - 9
    expect(txn.profit_lbp).toBeCloseTo(0, 2);

    const recharge = db
      .prepare(`SELECT * FROM recharges WHERE recharge_type = 'CREDIT_BUYBACK'`)
      .get() as any;
    expect(recharge.amount).toBeCloseTo(10, 2);
    expect(recharge.price).toBeCloseTo(9, 2);

    const movement = db
      .prepare(`SELECT * FROM carrier_line_movements WHERE carrier_line_id = ?`)
      .get(line.id) as any;
    expect(movement.reason).toBe("CREDIT_BUYBACK");
    expect(movement.credits_delta).toBeCloseTo(10, 2);
    expect(movement.validity_days_delta).toBe(0);
  });

  it("split-currency payout: each leg debits its own drawer independently (lira-074's rule, reused via postPayoutLegs)", () => {
    lineRepo.createLine({ carrier: "mtc", phone_number: "03111111" });
    seedDrawer(db, "General", "USD", 500);
    seedDrawer(db, "General", "LBP", 100_000_000);

    // 12 credits gained, $10 USD-equivalent paid out as $5 + 447,500 LBP
    // (447,500 / 89,500 fallback sell rate = exactly $5).
    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_BUYBACK",
      amount: 12,
      cost: 0,
      price: 10,
      currency: "USD",
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 5 },
        { method: "CASH", currencyCode: "LBP", amount: 447_500 },
      ],
      userId: 1,
    });

    expect(result.success).toBe(true);
    expect(balance(db, "General", "USD")).toBeCloseTo(495, 2);
    expect(balance(db, "General", "LBP")).toBeCloseTo(100_000_000 - 447_500, 2);

    const txn = db
      .prepare(
        `SELECT * FROM transactions WHERE type = 'TELECOM_CREDIT_BUYBACK'`,
      )
      .get() as any;
    expect(txn.profit_usd).toBeCloseTo(2, 2); // 12 - 10
  });

  it("a CUSTOMER_ACCOUNT payout leg credits the client's account instead of a drawer", () => {
    lineRepo.createLine({ carrier: "mtc", phone_number: "03111111" });
    seedDrawer(db, "General", "USD", 500);
    const clientId = seedClient(db);

    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_BUYBACK",
      amount: 10,
      cost: 0,
      price: 10,
      currency: "USD",
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 5 },
        { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 5 },
      ],
      clientId,
      userId: 1,
    });

    expect(result.success).toBe(true);
    // Only the CASH leg touched General — the account leg does not.
    expect(balance(db, "General", "USD")).toBeCloseTo(495, 2);

    const creditRow = db
      .prepare(
        `SELECT * FROM debt_ledger WHERE client_id = ? AND transaction_type = 'CREDIT_DEPOSIT'`,
      )
      .get(clientId) as any;
    expect(creditRow).toBeDefined();
    expect(creditRow.amount_usd).toBeCloseTo(-5, 2); // addCredit's sign convention
  });

  it("a CUSTOMER_ACCOUNT payout leg with NO client is rejected — and nothing is written", () => {
    lineRepo.createLine({ carrier: "mtc", phone_number: "03111111" });
    seedDrawer(db, "General", "USD", 500);

    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_BUYBACK",
      amount: 10,
      cost: 0,
      price: 10,
      currency: "USD",
      payments: [
        { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 10 },
      ],
      userId: 1,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/client is required/i);

    expect(
      (db.prepare(`SELECT COUNT(*) c FROM recharges`).get() as any).c,
    ).toBe(0);
    expect(
      (db.prepare(`SELECT COUNT(*) c FROM transactions`).get() as any).c,
    ).toBe(0);
    expect(lineRepo.getCarrierCreditsSum("mtc")).toBeCloseTo(0, 2);
  });

  it("an empty payments[] is hard-rejected before any write", () => {
    lineRepo.createLine({ carrier: "mtc", phone_number: "03111111" });

    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_BUYBACK",
      amount: 10,
      cost: 0,
      price: 10,
      currency: "USD",
      payments: [],
      userId: 1,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/payment legs are required/i);
    expect(
      (db.prepare(`SELECT COUNT(*) c FROM recharges`).get() as any).c,
    ).toBe(0);
  });

  it("rejects a phone number that does not match the shop's own line (backend re-validation)", () => {
    lineRepo.createLine({ carrier: "mtc", phone_number: "03111111" });
    seedDrawer(db, "General", "USD", 500);

    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_BUYBACK",
      amount: 10,
      cost: 0,
      price: 10,
      currency: "USD",
      phoneNumber: "70999999",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 10 }],
      userId: 1,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/does not match/i);
    expect(lineRepo.getCarrierCreditsSum("mtc")).toBeCloseTo(0, 2);
  });

  it("accepts a phone number in any of the equivalent formats normalizeLebanesePhone recognizes", () => {
    lineRepo.createLine({ carrier: "mtc", phone_number: "03111111" });
    seedDrawer(db, "General", "USD", 500);

    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_BUYBACK",
      amount: 10,
      cost: 0,
      price: 10,
      currency: "USD",
      phoneNumber: "+96103111111",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 10 }],
      userId: 1,
    });

    expect(result.success).toBe(true);
  });

  it("rejects when the carrier has no active line to buy back into", () => {
    seedDrawer(db, "General", "USD", 500);

    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_BUYBACK",
      amount: 10,
      cost: 0,
      price: 10,
      currency: "USD",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 10 }],
      userId: 1,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no active mtc line/i);
  });

  it("LBP cash path matches the profit figure the retired topUpFromCustomer arm's own (deleted) test asserted for identical input", () => {
    lineRepo.createLine({ carrier: "mtc", phone_number: "03111111" });
    seedDrawer(db, "General", "LBP", 10_000_000);

    // Same numbers as the deleted RechargeRepository.topup.test.ts case:
    // $10 of credits bought for 850,500 LBP cash, fallback sell rate 89,500.
    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_BUYBACK",
      amount: 10,
      cost: 0,
      price: 850_500,
      currency: "LBP",
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 850_500 }],
      userId: 1,
    });

    expect(result.success).toBe(true);
    const txn = db
      .prepare(
        `SELECT * FROM transactions WHERE type = 'TELECOM_CREDIT_BUYBACK'`,
      )
      .get() as any;
    expect(txn.profit_usd).toBeCloseTo(10 - 850_500 / 89_500, 4);
    expect(txn.profit_lbp).toBeCloseTo(0, 2);
  });

  it("§0.1/§0.6: the drawer converges to the line sum even when it had already drifted beforehand (a NEW path gets no grandfather exemption)", () => {
    const line = lineRepo.createLine({
      carrier: "alfa",
      phone_number: "70123456",
      credits: 5,
    });
    seedDrawer(db, "Alfa", "USD", 100); // deliberately NOT in sync with the line (5)
    seedDrawer(db, "General", "USD", 500);

    const result = repo.processRecharge({
      provider: "Alfa",
      type: "CREDIT_BUYBACK",
      amount: 3,
      cost: 0,
      price: 2,
      currency: "USD",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 2 }],
      userId: 1,
    });

    expect(result.success).toBe(true);
    expect(lineRepo.getById(line.id)!.credits).toBeCloseTo(8, 2); // 5 + 3
    // The drawer is SET to the sum (8), not just bumped by +3 from its
    // drifted 100 (which would have left it at 103).
    expect(balance(db, "Alfa", "USD")).toBeCloseTo(8, 2);
    expect(balance(db, "Alfa", "USD")).toBeCloseTo(
      lineRepo.getCarrierCreditsSum("alfa"),
      6,
    );
  });

  // ── Money-leak guard (review finding #1) ──────────────────────────────
  //
  // GIFT_CARD is a real, active payment method with `affects_drawer = 0` in
  // the seed — neither CUSTOMER_ACCOUNT nor drawer-affecting. Before the fix,
  // `postPayoutLegs`'s per-leg loop did `if (!isDrawerAffectingMethod(...))
  // continue;` for any leg that wasn't CUSTOMER_ACCOUNT, silently skipping a
  // GIFT_CARD leg. `reconcileLegs` sums legs by amount only (never by
  // method), so a GIFT_CARD leg covering the FULL payout still reconciles —
  // the carrier line gets credited with real credits while the "payout"
  // leg moves no drawer and credits no debt: the shop gains free credits for
  // a payout that never paid anything out. Rule 17: this test was run
  // against the pre-fix `continue` and observed to let the leak through
  // (recharge committed, line credited, MTC/General drawers unchanged, no
  // throw) before the fix made it hard-reject instead.
  it("a GIFT_CARD payout leg is hard-rejected — the line is never credited for a payout that pays nothing out (money-leak guard)", () => {
    const line = lineRepo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 20,
    });
    seedDrawer(db, "MTC", "USD", 20);
    seedDrawer(db, "General", "USD", 500);

    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_BUYBACK",
      amount: 10, // credits the leak would have gained for free
      cost: 0,
      price: 10,
      currency: "USD",
      payments: [{ method: "GIFT_CARD", currencyCode: "USD", amount: 10 }],
      userId: 1,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not a valid payout method/i);

    // Nothing partially persisted: the line keeps its original 20 credits,
    // neither drawer moved, and no recharge/transaction row was written.
    expect(lineRepo.getById(line.id)!.credits).toBeCloseTo(20, 2);
    expect(balance(db, "MTC", "USD")).toBeCloseTo(20, 2);
    expect(balance(db, "General", "USD")).toBeCloseTo(500, 2);
    expect(
      (db.prepare(`SELECT COUNT(*) c FROM recharges`).get() as any).c,
    ).toBe(0);
    expect(
      (db.prepare(`SELECT COUNT(*) c FROM transactions`).get() as any).c,
    ).toBe(0);
  });

  it("create + void nets every ledger back to 0: provider drawer, cash drawer, carrier line credits, and account credit", () => {
    const line = lineRepo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 20,
      validity_expires_at: FUTURE_EXPIRY,
    });
    seedDrawer(db, "MTC", "USD", 20);
    seedDrawer(db, "General", "USD", 500);
    const clientId = seedClient(db);

    const beforeGeneral = balance(db, "General", "USD");
    const beforeMtc = balance(db, "MTC", "USD");
    const beforeLineCredits = lineRepo.getById(line.id)!.credits;

    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_BUYBACK",
      amount: 10,
      cost: 0,
      price: 10,
      currency: "USD",
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 5 },
        { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 5 },
      ],
      clientId,
      userId: 1,
    });
    expect(result.success).toBe(true);
    const txnId = result.id!;

    // Confirm it actually moved everything before voiding.
    expect(balance(db, "General", "USD")).not.toBeCloseTo(beforeGeneral, 2);
    expect(balance(db, "MTC", "USD")).not.toBeCloseTo(beforeMtc, 2);
    expect(lineRepo.getById(line.id)!.credits).not.toBeCloseTo(
      beforeLineCredits,
      2,
    );

    getTransactionRepository().voidTransaction(txnId, 1);

    // Every ledger nets EXACTLY back to its pre-transaction baseline.
    expect(balance(db, "General", "USD")).toBeCloseTo(beforeGeneral, 2);
    expect(balance(db, "MTC", "USD")).toBeCloseTo(beforeMtc, 2);
    expect(lineRepo.getById(line.id)!.credits).toBeCloseTo(
      beforeLineCredits,
      2,
    );
    const creditRows = db
      .prepare(
        `SELECT COALESCE(SUM(amount_usd), 0) s FROM debt_ledger WHERE client_id = ?`,
      )
      .get(clientId) as { s: number };
    expect(creditRows.s).toBeCloseTo(0, 2); // the CREDIT_DEPOSIT and its reversal cancel out

    const movement = db
      .prepare(`SELECT * FROM carrier_line_movements WHERE carrier_line_id = ?`)
      .get(line.id) as any;
    expect(movement.is_reversed).toBe(1);
  });
});
