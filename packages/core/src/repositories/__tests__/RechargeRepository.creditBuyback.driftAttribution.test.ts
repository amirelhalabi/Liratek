/**
 * BUG REPRO — owner report #10 (2026-09-23, web app): "buy back 9$ from
 * customer, price 675,000LBP. in drawer i can see +18$ credits.. why not
 * 9$? why double what we actually bought?"
 *
 * Root cause (traced in source before this fix): `RechargeRepository
 * .processCreditBuyback` credited the shop's OWN carrier line with exactly
 * the credits bought (correct), then set the provider DRAWER to
 * `Σ(active line credits)` by posting the raw difference from the drawer's
 * CURRENT balance (`targetSum - currentDrawerBalance`) as ONE `payments`
 * row — labelled `"Credits received (buy-back): +${credits}"` regardless of
 * what that difference actually was. Whenever the drawer had ALREADY
 * drifted below the line sum (exactly what owner report #22's now-fixed gap
 * caused: a credit sale left the line's `credits` untouched while the
 * drawer was correctly debited), that pre-existing drift rode along inside
 * the customer's own buyback leg — a $9 buyback against $9 of un-recorded
 * prior drift posted an $18 leg under a "+9" note.
 *
 * Fix: the buyback leg now posts EXACTLY `credits`; any remaining gap
 * between the drawer and the line sum posts as its OWN, separately-labelled
 * `..._LINE_DRIFT` correction leg. The two legs together still move the
 * drawer by the same total as before (§0.1/§0.6's "drawer follows the line
 * sum" invariant is unchanged) — only the ATTRIBUTION changed.
 *
 * Harness (schema, `jest.mock("../../db/connection")`, `setDb`/`balance`/
 * `seedDrawer` helpers) copied verbatim from the sibling
 * `RechargeRepository.creditBuyback.test.ts` — same hand-rolled in-memory
 * schema, same mocked DB singleton every repo/service picks up.
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
import { resetTransactionRepository } from "../TransactionRepository";
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
      days_owed INTEGER NOT NULL DEFAULT 0,
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
      days_owed_delta INTEGER NOT NULL DEFAULT 0,
      previous_days_owed INTEGER NOT NULL DEFAULT 0,
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

    CREATE TABLE expenses (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id         INTEGER DEFAULT 1,
      description       TEXT,
      category          TEXT,
      expense_type      TEXT,
      amount_usd        DECIMAL(10, 2),
      amount_lbp        DECIMAL(15, 2),
      paid_by_method    TEXT DEFAULT 'CASH',
      status            TEXT NOT NULL DEFAULT 'active',
      expense_date      DATETIME DEFAULT CURRENT_TIMESTAMP,
      note              TEXT DEFAULT NULL,
      edited_by         TEXT DEFAULT NULL,
      edited_at         TEXT DEFAULT NULL,
      is_refunded       INTEGER DEFAULT 0,
      refunded_at       TEXT DEFAULT NULL,
      source_ref_table  TEXT DEFAULT NULL,
      source_ref_id     INTEGER DEFAULT NULL,
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
    );
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

function buybackPaymentLegs(
  db: Database.Database,
  txnId: number,
  drawerName: string,
): { method: string; amount: number; note: string }[] {
  return db
    .prepare(
      `SELECT method, amount, note FROM payments WHERE transaction_id = ? AND drawer_name = ? ORDER BY id`,
    )
    .all(txnId, drawerName) as {
    method: string;
    amount: number;
    note: string;
  }[];
}

describe("RechargeRepository.processCreditBuyback — the buyback leg is attributed exactly to the credits bought, not the drawer's whole gap from the line sum (owner report #10, 2026-09-23)", () => {
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

  it("owner's exact repro: a $9 buyback against $9 of PRE-EXISTING drift posts a +9 buyback leg and a SEPARATE +9 drift-correction leg — never one +18 leg", () => {
    // Simulate exactly what owner report #22's (now-fixed) gap used to
    // leave behind: the line sold 9 credits' worth but its OWN `credits`
    // column never moved (pre-#22-fix state), while the drawer WAS
    // correctly debited. Line = 50 (never decremented), drawer = 41
    // (50 - 9, correctly debited by the old sale).
    const line = lineRepo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 50,
    });
    seedDrawer(db, "MTC", "USD", 41);
    seedDrawer(db, "General", "USD", 500);

    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_BUYBACK",
      amount: 9, // credits bought back
      cost: 0,
      price: 6, // cash paid out (arbitrary — profit is not under test here)
      currency: "USD",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 6 }],
      userId: 1,
    });
    expect(result.success).toBe(true);
    const txnId = result.id!;

    // The line gained exactly the 9 credits bought.
    expect(lineRepo.getById(line.id)!.credits).toBeCloseTo(59, 6); // 50 + 9

    const legs = buybackPaymentLegs(db, txnId, "MTC");

    // THE BUG (pre-fix): this was ONE leg, amount 18 (`59 - 41`), still
    // labelled "+9". The fix splits it: leg[0] is the customer's own
    // buyback, attributed EXACTLY to what was bought.
    const buybackLeg = legs.find((l) => l.method === "MTC");
    expect(buybackLeg).toBeDefined();
    expect(buybackLeg!.amount).toBeCloseTo(9, 6);
    expect(buybackLeg!.note).toContain("+9");

    // The remaining gap (the pre-existing drift) posts as its OWN,
    // separately-labelled leg — never folded into the customer's amount.
    const driftLeg = legs.find((l) => l.method !== "MTC");
    expect(driftLeg).toBeDefined();
    expect(driftLeg!.amount).toBeCloseTo(9, 6); // 59 - 41 - 9
    expect(driftLeg!.note.toLowerCase()).toContain("drift");
    expect(driftLeg!.note).not.toContain("Credits received (buy-back)");

    // §0.1: the drawer still lands on the line sum — the two legs together
    // move the SAME total the single (buggy) leg used to.
    expect(balance(db, "MTC", "USD")).toBeCloseTo(59, 6);
    expect(balance(db, "MTC", "USD")).toBeCloseTo(
      lineRepo.getCarrierCreditsSum("mtc"),
      6,
    );
  });

  it("end-to-end: sell 9 credits, then buy the same 9 back — the buyback leg reads exactly 9, and the drawer ends back where it started (no drift introduced by a fixed #22 sale)", () => {
    const line = lineRepo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 50,
    });
    // VOUCHER (not CREDIT_TRANSFER) — no SMS transfer fee to reason about;
    // this test is about the buyback attribution, not the SMS-fee residual
    // gap documented in RechargeRepository.creditSaleLineDecrement.test.ts.
    seedDrawer(db, "MTC", "USD", 50); // starts in sync with the line
    seedDrawer(db, "General", "USD", 500);

    const sale = repo.processRecharge({
      provider: "MTC",
      type: "VOUCHER",
      amount: 9,
      cost: 7,
      price: 9,
      currency: "USD",
      paid_by_method: "CASH",
      userId: 1,
    });
    expect(sale.success).toBe(true);

    // #22's fix: both the line and the drawer moved together — no drift.
    expect(lineRepo.getById(line.id)!.credits).toBeCloseTo(41, 6); // 50 - 9
    expect(balance(db, "MTC", "USD")).toBeCloseTo(41, 6);

    const buyback = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_BUYBACK",
      amount: 9,
      cost: 0,
      price: 6,
      currency: "USD",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 6 }],
      userId: 1,
    });
    expect(buyback.success).toBe(true);
    const txnId = buyback.id!;

    const legs = buybackPaymentLegs(db, txnId, "MTC");
    // No drift left to correct — the buyback is the line's ONLY leg on the
    // provider drawer, attributed exactly to what was bought.
    expect(legs).toHaveLength(1);
    expect(legs[0]!.amount).toBeCloseTo(9, 6);
    expect(legs[0]!.note).toContain("+9");

    // Sold 9, bought 9 back — the line and the drawer both end exactly
    // where they started.
    expect(lineRepo.getById(line.id)!.credits).toBeCloseTo(50, 6);
    expect(balance(db, "MTC", "USD")).toBeCloseTo(50, 6);
  });
});
