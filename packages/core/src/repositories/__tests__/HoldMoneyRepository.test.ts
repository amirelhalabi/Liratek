/**
 * LIRA-060 — HoldMoneyRepository.
 *
 * Verifies the money invariants for holding cash on behalf of a client:
 *  - Holding credits the General drawer (USD + LBP) and writes a HOLD_MONEY
 *    transaction with in-legs and zero profit.
 *  - Collecting debits the General drawer back to baseline, writes a
 *    HOLD_MONEY_COLLECT transaction with out-legs, and flips status.
 *  - Double-collect is rejected; validation guards (no amount / no name) hold.
 */

import Database from "better-sqlite3";
import {
  HoldMoneyRepository,
  resetHoldMoneyRepository,
} from "../HoldMoneyRepository.js";
import { resetTransactionRepository } from "../TransactionRepository.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL
    );

    CREATE TABLE transactions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      type          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table  TEXT,
      source_id     INTEGER,
      user_id       INTEGER,
      amount_usd    REAL NOT NULL DEFAULT 0,
      amount_lbp    REAL NOT NULL DEFAULT 0,
      profit_usd    REAL NOT NULL DEFAULT 0,
      profit_lbp    REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id     INTEGER,
      client_name   TEXT,
      client_phone  TEXT,
      reverses_id   INTEGER,
      summary       TEXT,
      metadata_json TEXT,
      device_id     TEXT,
      tenant_id     INTEGER DEFAULT 1,
      created_at    TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id     INTEGER,
      method         TEXT NOT NULL,
      drawer_name    TEXT NOT NULL,
      currency_code  TEXT NOT NULL,
      amount         REAL NOT NULL,
      note           TEXT,
      created_by     INTEGER,
      tenant_id      INTEGER DEFAULT 1,
      created_at     TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      drawer_name   TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance       REAL NOT NULL DEFAULT 0,
      tenant_id     INTEGER DEFAULT 1,
      updated_at    TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    CREATE TABLE hold_money (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      client_name  TEXT NOT NULL,
      phone_number TEXT,
      usd_amount   REAL NOT NULL DEFAULT 0,
      lbp_amount   REAL NOT NULL DEFAULT 0,
      status       TEXT NOT NULL DEFAULT 'held',
      notes        TEXT,
      created_by   INTEGER,
      collected_by INTEGER,
      collected_at TEXT,
      tenant_id    INTEGER DEFAULT 1,
      created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at   TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE custom_services (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      description  TEXT NOT NULL,
      cost_usd     REAL NOT NULL DEFAULT 0,
      cost_lbp     REAL NOT NULL DEFAULT 0,
      price_usd    REAL NOT NULL DEFAULT 0,
      price_lbp    REAL NOT NULL DEFAULT 0,
      profit_usd   REAL NOT NULL DEFAULT 0,
      profit_lbp   REAL NOT NULL DEFAULT 0,
      paid_by      TEXT,
      status       TEXT,
      client_id    INTEGER,
      client_name  TEXT,
      phone_number TEXT,
      note         TEXT,
      category     TEXT,
      created_by   INTEGER,
      tenant_id    INTEGER DEFAULT 1,
      created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
      edited_by    TEXT,
      edited_at    TEXT
    );
  `);

  db.prepare(`INSERT INTO users (id, username) VALUES (1, 'cashier')`).run();
  // Seed General drawer with a non-zero baseline to prove deltas, not absolutes.
  db.prepare(
    `INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 100), ('General', 'LBP', 500000)`,
  ).run();

  return db;
}

function drawer(db: Database.Database, currency: string): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = 'General' AND currency_code = ?`,
    )
    .get(currency) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

describe("HoldMoneyRepository (LIRA-060)", () => {
  let db: Database.Database;
  let repo: HoldMoneyRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    resetHoldMoneyRepository();
    resetTransactionRepository();
    repo = new HoldMoneyRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetHoldMoneyRepository();
    resetTransactionRepository();
  });

  it("holding credits the General drawer (USD + LBP) and records a held row", () => {
    const usdBefore = drawer(db, "USD");
    const lbpBefore = drawer(db, "LBP");

    const res = repo.createHold(
      {
        client_name: "Sami",
        phone_number: "03 123 456",
        usd_amount: 40,
        lbp_amount: 200000,
      },
      1,
    );
    expect(res.success).toBe(true);
    expect(res.id).toBeGreaterThan(0);

    expect(drawer(db, "USD")).toBe(usdBefore + 40);
    expect(drawer(db, "LBP")).toBe(lbpBefore + 200000);

    const hold = repo.getById(res.id!);
    expect(hold?.status).toBe("held");
    expect(hold?.client_name).toBe("Sami");
    expect(hold?.phone_number).toBe("03 123 456");

    const txn = db
      .prepare(
        `SELECT type, amount_usd, amount_lbp, profit_usd, profit_lbp, client_name, client_phone FROM transactions WHERE source_table = 'hold_money' AND source_id = ?`,
      )
      .get(res.id) as {
      type: string;
      amount_usd: number;
      amount_lbp: number;
      profit_usd: number;
      profit_lbp: number;
      client_name: string | null;
      client_phone: string | null;
    };
    expect(txn.type).toBe("HOLD_MONEY");
    expect(txn.amount_usd).toBe(40);
    expect(txn.amount_lbp).toBe(200000);
    expect(txn.profit_usd).toBe(0);
    expect(txn.profit_lbp).toBe(0);
    // Customer surfaces in the Transactions viewer (rule 11) — not "—"
    expect(txn.client_name).toBe("Sami");
    expect(txn.client_phone).toBe("03 123 456");

    // Cash-in legs are positive (General +)
    const legs = db
      .prepare(
        `SELECT currency_code, amount FROM payments WHERE drawer_name = 'General' ORDER BY currency_code`,
      )
      .all() as Array<{ currency_code: string; amount: number }>;
    expect(legs).toEqual([
      { currency_code: "LBP", amount: 200000 },
      { currency_code: "USD", amount: 40 },
    ]);
  });

  it("collecting debits the General drawer back to baseline and flips status", () => {
    const usdBefore = drawer(db, "USD");
    const lbpBefore = drawer(db, "LBP");

    const held = repo.createHold(
      { client_name: "Lara", usd_amount: 25, lbp_amount: 0 },
      1,
    );
    expect(drawer(db, "USD")).toBe(usdBefore + 25);

    const collect = repo.collectHold(held.id!, 1);
    expect(collect.success).toBe(true);

    // Net effect of hold + collect = zero (back to baseline)
    expect(drawer(db, "USD")).toBe(usdBefore);
    expect(drawer(db, "LBP")).toBe(lbpBefore);

    const hold = repo.getById(held.id!);
    expect(hold?.status).toBe("collected");
    expect(hold?.collected_by).toBe(1);
    expect(hold?.collected_at).toBeTruthy();

    const collectTxn = db
      .prepare(
        `SELECT type FROM transactions WHERE source_table = 'hold_money' AND source_id = ? AND type = 'HOLD_MONEY_COLLECT'`,
      )
      .get(held.id) as { type: string } | undefined;
    expect(collectTxn?.type).toBe("HOLD_MONEY_COLLECT");

    // Out-leg is negative
    const outLeg = db
      .prepare(
        `SELECT amount FROM payments WHERE transaction_id = (SELECT id FROM transactions WHERE type = 'HOLD_MONEY_COLLECT' LIMIT 1)`,
      )
      .get() as { amount: number };
    expect(outLeg.amount).toBe(-25);

    // A single Service History row is recorded on collect, linked to the hold:
    // real client column, hold_money category, note referencing the hold id,
    // amounts derived from the hold (no revenue: cost/price/profit all 0).
    const svc = db
      .prepare(
        `SELECT description, category, client_name, note, cost_usd, price_usd, profit_usd, status
         FROM custom_services WHERE category = 'hold_money'`,
      )
      .all() as Array<{
      description: string;
      category: string;
      client_name: string;
      note: string;
      cost_usd: number;
      price_usd: number;
      profit_usd: number;
      status: string;
    }>;
    expect(svc).toHaveLength(1);
    expect(svc[0]!.client_name).toBe("Lara");
    expect(svc[0]!.note).toBe(`Hold #${held.id}`);
    expect(svc[0]!.description).toContain("Lara");
    expect(svc[0]!.description).toContain("$25.00");
    expect(svc[0]!.cost_usd).toBe(0);
    expect(svc[0]!.price_usd).toBe(0);
    expect(svc[0]!.profit_usd).toBe(0);
    expect(svc[0]!.status).toBe("completed");
  });

  it("rejects collecting an already-collected hold (no double drawer hit)", () => {
    const held = repo.createHold({ client_name: "Joe", usd_amount: 10 }, 1);
    expect(repo.collectHold(held.id!, 1).success).toBe(true);

    const usdAfterFirst = drawer(db, "USD");
    const second = repo.collectHold(held.id!, 1);
    expect(second.success).toBe(false);
    expect(second.error).toMatch(/already been collected/i);
    expect(drawer(db, "USD")).toBe(usdAfterFirst);
  });

  it("active holds excludes collected ones", () => {
    const a = repo.createHold({ client_name: "A", usd_amount: 5 }, 1);
    repo.createHold({ client_name: "B", lbp_amount: 100000 }, 1);
    repo.collectHold(a.id!, 1);

    const active = repo.getActiveHolds();
    expect(active).toHaveLength(1);
    expect(active[0]!.client_name).toBe("B");
  });

  it("requires at least one amount and a client name", () => {
    expect(repo.createHold({ client_name: "X" }, 1).success).toBe(false);
    expect(
      repo.createHold({ client_name: "", usd_amount: 10 }, 1).success,
    ).toBe(false);
    // No transactions or balance changes leaked from the rejected attempts
    const txnCount = db
      .prepare(`SELECT COUNT(*) as c FROM transactions`)
      .get() as { c: number };
    expect(txnCount.c).toBe(0);
  });

  it("rejects non-finite amounts (Infinity/NaN) without touching the drawer", () => {
    const usdBefore = drawer(db, "USD");

    const inf = repo.createHold(
      { client_name: "Bad", usd_amount: Infinity },
      1,
    );
    expect(inf.success).toBe(false);
    expect(inf.error).toMatch(/finite/i);

    const nan = repo.createHold({ client_name: "Bad", lbp_amount: NaN }, 1);
    expect(nan.success).toBe(false);

    // Drawer untouched and still finite; no rows written
    expect(drawer(db, "USD")).toBe(usdBefore);
    expect(Number.isFinite(drawer(db, "USD"))).toBe(true);
    const txnCount = db
      .prepare(`SELECT COUNT(*) as c FROM transactions`)
      .get() as { c: number };
    expect(txnCount.c).toBe(0);
  });
});
