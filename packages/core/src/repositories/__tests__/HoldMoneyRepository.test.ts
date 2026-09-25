/**
 * NOT RUN — proven at the end-of-batch gate (owner process rule for this
 * batch: implement first, verify once at the end). Every `it` below is NEW
 * or changed for LIRA-214 (migration v183); rule 17's failing-first proof is
 * structural here rather than a manual revert-and-watch cycle — the
 * pre-v183 repository has no `hold_money_pickups` table, no
 * `collectHold({id,...})` object-payload signature and no per-leg posting,
 * so every partial-pickup/void/leg test in the new describe block below
 * would fail immediately (missing table / wrong argument shape) against
 * that code, not merely assert something already true. A manual
 * reintroduce-and-watch pass is still owed at the end-of-batch gate.
 *
 * LIRA-060 / LIRA-214 — HoldMoneyRepository.
 *
 * Verifies the money invariants for holding cash on behalf of a client:
 *  - Holding posts its payment legs (rule 16 — one shared pass, IN legs plus
 *    any change-back OUT leg) instead of always hardcoding a single CASH
 *    leg to General, and writes a HOLD_MONEY transaction with zero profit.
 *  - Collecting posts a payout leg-per-leg (LIRA-214, migration v183) for
 *    part OR all of the hold's remaining balance, writes a
 *    HOLD_MONEY_COLLECT transaction, records a `hold_money_pickups` row,
 *    and flips status to 'collected' only once nothing remains.
 *  - Voiding one pickup (the rule-20 reversal owner) re-credits every
 *    drawer that pickup's legs debited and reopens the hold if needed.
 *  - Double-collect-when-empty, over-collect, validation guards (no amount /
 *    no name) and non-finite amounts are all still rejected.
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

    CREATE TABLE clients (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL
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
      client_id    INTEGER,
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

    -- migration v183 (LIRA-214) — the partial-pickup balance model.
    CREATE TABLE hold_money_pickups (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id      INTEGER DEFAULT 1,
      hold_money_id  INTEGER NOT NULL,
      transaction_id INTEGER,
      usd_amount     REAL NOT NULL DEFAULT 0,
      lbp_amount     REAL NOT NULL DEFAULT 0,
      is_voided      INTEGER NOT NULL DEFAULT 0,
      voided_by      INTEGER,
      voided_at      TEXT,
      created_by     INTEGER,
      created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at     TEXT DEFAULT CURRENT_TIMESTAMP
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
  db.prepare(`INSERT INTO clients (id, full_name) VALUES (7, 'Sami')`).run();
  // Seed General drawer with a non-zero baseline to prove deltas, not absolutes.
  db.prepare(
    `INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 100), ('General', 'LBP', 500000)`,
  ).run();

  return db;
}

function drawerBal(
  db: Database.Database,
  drawerName: string,
  currency: string,
): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`,
    )
    .get(drawerName, currency) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

function drawer(db: Database.Database, currency: string): number {
  return drawerBal(db, "General", currency);
}

describe("HoldMoneyRepository (LIRA-060 / LIRA-214)", () => {
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

  it("holding with no payments[] falls back to a single CASH leg (backward compatible)", () => {
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
    expect(hold?.remaining_usd).toBe(40);
    expect(hold?.remaining_lbp).toBe(200000);

    const txn = db
      .prepare(
        `SELECT type, amount_usd, amount_lbp, profit_usd, profit_lbp, client_name, client_phone, summary FROM transactions WHERE source_table = 'hold_money' AND source_id = ?`,
      )
      .get(res.id) as {
      type: string;
      amount_usd: number;
      amount_lbp: number;
      profit_usd: number;
      profit_lbp: number;
      client_name: string | null;
      client_phone: string | null;
      summary: string;
    };
    expect(txn.type).toBe("HOLD_MONEY");
    expect(txn.amount_usd).toBe(40);
    expect(txn.amount_lbp).toBe(200000);
    expect(txn.profit_usd).toBe(0);
    expect(txn.profit_lbp).toBe(0);
    expect(txn.client_name).toBe("Sami");
    expect(txn.client_phone).toBe("03 123 456");
    expect(txn.summary.startsWith("Hold Money: Sami")).toBe(true);

    const legs = db
      .prepare(
        `SELECT currency_code, amount, method FROM payments WHERE drawer_name = 'General' ORDER BY currency_code`,
      )
      .all() as Array<{ currency_code: string; amount: number; method: string }>;
    expect(legs).toEqual([
      { currency_code: "LBP", amount: 200000, method: "CASH" },
      { currency_code: "USD", amount: 40, method: "CASH" },
    ]);
  });

  it("rule 11 — propagates client_id to the HOLD_MONEY transaction", () => {
    const res = repo.createHold(
      { client_name: "Sami", client_id: 7, usd_amount: 10 },
      1,
    );
    expect(res.success).toBe(true);

    const hold = repo.getById(res.id!);
    expect(hold?.client_id).toBe(7);

    const txn = db
      .prepare(`SELECT client_id FROM transactions WHERE source_id = ?`)
      .get(res.id) as { client_id: number };
    expect(txn.client_id).toBe(7);
  });

  it("rule 16 — posts split/cross-currency legs plus change (OUT) in one pass", () => {
    const usdBefore = drawer(db, "USD");
    const lbpBefore = drawer(db, "LBP");

    // Hold $40. Customer hands $50 cash, gets $10 back.
    const res = repo.createHold(
      {
        client_name: "Nadia",
        usd_amount: 40,
        payments: [
          { method: "CASH", currency_code: "USD", amount: 50 },
          {
            method: "CASH",
            currency_code: "USD",
            amount: 10,
            direction: "OUT",
          },
        ],
      },
      1,
    );
    expect(res.success).toBe(true);

    // Net drawer effect is the held amount, not the full tender.
    expect(drawer(db, "USD")).toBe(usdBefore + 40);
    expect(drawer(db, "LBP")).toBe(lbpBefore);

    const legs = db
      .prepare(
        `SELECT amount, note FROM payments WHERE currency_code = 'USD' ORDER BY id`,
      )
      .all() as Array<{ amount: number; note: string }>;
    expect(legs).toEqual([
      { amount: 50, note: expect.stringContaining("Hold Money") },
      { amount: -10, note: "Change returned" },
    ]);
  });

  it("posts a wallet leg to its own drawer, not General", () => {
    const res = repo.createHold(
      {
        client_name: "Wael",
        usd_amount: 30,
        payments: [{ method: "OMT", currency_code: "USD", amount: 30 }],
      },
      1,
    );
    expect(res.success).toBe(true);
    // FALLBACK_DRAWER_MAP (utils/payments.ts): OMT -> "OMT_App".
    expect(drawerBal(db, "OMT_App", "USD")).toBe(30);
    expect(drawer(db, "USD")).toBe(100); // General untouched
  });

  it("rejects mismatched payment legs (reconcileLegs hard-reject) before writing anything", () => {
    const before = drawer(db, "USD");
    const res = repo.createHold(
      {
        client_name: "Bad",
        usd_amount: 40,
        payments: [{ method: "CASH", currency_code: "USD", amount: 10 }], // way short
      },
      1,
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/reconcile/i);
    expect(drawer(db, "USD")).toBe(before);
    const txnCount = db
      .prepare(`SELECT COUNT(*) as c FROM transactions`)
      .get() as { c: number };
    expect(txnCount.c).toBe(0);
    // The hold row itself must not be left behind either — the whole
    // db.transaction() (insert + txn + legs) rolls back together.
    const holdCount = db
      .prepare(`SELECT COUNT(*) as c FROM hold_money`)
      .get() as { c: number };
    expect(holdCount.c).toBe(0);
  });

  it("collecting the full remaining balance debits the drawer back to baseline and flips status", () => {
    const usdBefore = drawer(db, "USD");

    const held = repo.createHold(
      { client_name: "Lara", usd_amount: 25, lbp_amount: 0 },
      1,
    );
    expect(drawer(db, "USD")).toBe(usdBefore + 25);

    const collect = repo.collectHold({ id: held.id! }, 1);
    expect(collect.success).toBe(true);

    // Net effect of hold + collect = zero (back to baseline)
    expect(drawer(db, "USD")).toBe(usdBefore);

    const hold = repo.getById(held.id!);
    expect(hold?.status).toBe("collected");
    expect(hold?.collected_by).toBe(1);
    expect(hold?.collected_at).toBeTruthy();
    expect(hold?.remaining_usd).toBe(0);

    const outLeg = db
      .prepare(
        `SELECT amount FROM payments WHERE transaction_id = (SELECT id FROM transactions WHERE type = 'HOLD_MONEY_COLLECT' LIMIT 1)`,
      )
      .get() as { amount: number };
    expect(outLeg.amount).toBe(-25);

    const svc = db
      .prepare(
        `SELECT description, category, client_name, note, cost_usd, price_usd, profit_usd, status, paid_by
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
      paid_by: string;
    }>;
    expect(svc).toHaveLength(1);
    expect(svc[0]!.client_name).toBe("Lara");
    expect(svc[0]!.note).toBe(`Hold #${held.id} pickup #1`);
    expect(svc[0]!.description).toContain("Lara");
    expect(svc[0]!.cost_usd).toBe(0);
    expect(svc[0]!.price_usd).toBe(0);
    expect(svc[0]!.profit_usd).toBe(0);
    expect(svc[0]!.status).toBe("completed");
    // Scout finding fixed: paid_by is derived from the real (fallback CASH)
    // legs, not hardcoded.
    expect(svc[0]!.paid_by).toBe("CASH");
  });

  it("LIRA-214 — a partial pickup leaves the hold 'held' with the correct remaining balance", () => {
    const usdBefore = drawer(db, "USD");
    const held = repo.createHold({ client_name: "Omar", usd_amount: 100 }, 1);

    const first = repo.collectHold({ id: held.id!, usd_amount: 60 }, 1);
    expect(first.success).toBe(true);

    let hold = repo.getById(held.id!);
    expect(hold?.status).toBe("held");
    expect(hold?.remaining_usd).toBe(40);
    expect(drawer(db, "USD")).toBe(usdBefore + 40); // 100 in, 60 out

    const second = repo.collectHold({ id: held.id! }, 1); // omitted = full remaining (40)
    expect(second.success).toBe(true);

    hold = repo.getById(held.id!);
    expect(hold?.status).toBe("collected");
    expect(hold?.remaining_usd).toBe(0);
    expect(drawer(db, "USD")).toBe(usdBefore); // back to baseline

    const pickups = repo.getPickups(held.id!);
    expect(pickups).toHaveLength(2);
    expect(pickups.map((p) => p.usd_amount).sort((a, b) => a - b)).toEqual([
      40, 60,
    ]);
  });

  it("rejects collecting more than what remains", () => {
    const held = repo.createHold({ client_name: "Rana", usd_amount: 20 }, 1);
    const res = repo.collectHold({ id: held.id!, usd_amount: 25 }, 1);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/only \$20\.00 remains/i);
  });

  it("rejects collecting an already-fully-collected hold", () => {
    const held = repo.createHold({ client_name: "Joe", usd_amount: 10 }, 1);
    expect(repo.collectHold({ id: held.id! }, 1).success).toBe(true);

    const usdAfterFirst = drawer(db, "USD");
    const second = repo.collectHold({ id: held.id! }, 1);
    expect(second.success).toBe(false);
    expect(second.error).toMatch(/already been (fully )?collected/i);
    expect(drawer(db, "USD")).toBe(usdAfterFirst);
  });

  it("LIRA-214 rule 20 — voiding a pickup re-credits the drawer and reopens the hold", () => {
    const usdBefore = drawer(db, "USD");
    const held = repo.createHold({ client_name: "Dana", usd_amount: 50 }, 1);
    const collect = repo.collectHold({ id: held.id! }, 1);
    expect(collect.success).toBe(true);

    let hold = repo.getById(held.id!);
    expect(hold?.status).toBe("collected");
    expect(drawer(db, "USD")).toBe(usdBefore); // back to baseline after full collect

    const pickups = repo.getPickups(held.id!);
    expect(pickups).toHaveLength(1);

    const voidRes = repo.voidPickup(pickups[0]!.id, 1);
    expect(voidRes.success).toBe(true);

    // Create + collect + void nets to exactly the original hold amount held
    // in the drawer (rule 20/17 net-to-zero-per-leg proof).
    expect(drawer(db, "USD")).toBe(usdBefore + 50);

    hold = repo.getById(held.id!);
    expect(hold?.status).toBe("held"); // reopened
    expect(hold?.remaining_usd).toBe(50);

    const voidedPickup = repo.getPickups(held.id!)[0]!;
    expect(voidedPickup.is_voided).toBe(1);
    expect(voidedPickup.voided_by).toBe(1);

    const voidTxn = db
      .prepare(
        `SELECT type, reverses_id, amount_usd FROM transactions WHERE type = 'HOLD_MONEY_COLLECT_VOID'`,
      )
      .get() as { type: string; reverses_id: number; amount_usd: number };
    expect(voidTxn.amount_usd).toBe(50);
    expect(voidTxn.reverses_id).toBeGreaterThan(0);

    // Second void of the same pickup is rejected (no double-credit).
    const secondVoid = repo.voidPickup(pickups[0]!.id, 1);
    expect(secondVoid.success).toBe(false);
    expect(drawer(db, "USD")).toBe(usdBefore + 50); // unchanged
  });

  it("voiding a partial pickup only restores that pickup's own legs", () => {
    const usdBefore = drawer(db, "USD");
    const held = repo.createHold({ client_name: "Fadi", usd_amount: 100 }, 1);
    repo.collectHold({ id: held.id!, usd_amount: 60 }, 1);
    expect(drawer(db, "USD")).toBe(usdBefore + 40);

    const pickups = repo.getPickups(held.id!);
    const voidRes = repo.voidPickup(pickups[0]!.id, 1);
    expect(voidRes.success).toBe(true);
    expect(drawer(db, "USD")).toBe(usdBefore + 100);

    const hold = repo.getById(held.id!);
    expect(hold?.status).toBe("held");
    expect(hold?.remaining_usd).toBe(100);
  });

  it("active holds excludes fully-collected ones", () => {
    const a = repo.createHold({ client_name: "A", usd_amount: 5 }, 1);
    repo.createHold({ client_name: "B", lbp_amount: 100000 }, 1);
    repo.collectHold({ id: a.id! }, 1);

    const active = repo.getActiveHolds();
    expect(active).toHaveLength(1);
    expect(active[0]!.client_name).toBe("B");
  });

  it("requires at least one amount and a client name", () => {
    expect(repo.createHold({ client_name: "X" }, 1).success).toBe(false);
    expect(
      repo.createHold({ client_name: "", usd_amount: 10 }, 1).success,
    ).toBe(false);
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

    expect(drawer(db, "USD")).toBe(usdBefore);
    expect(Number.isFinite(drawer(db, "USD"))).toBe(true);
    const txnCount = db
      .prepare(`SELECT COUNT(*) as c FROM transactions`)
      .get() as { c: number };
    expect(txnCount.c).toBe(0);
  });
});
