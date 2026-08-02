/**
 * DrawerTopUpRepository.transferBetweenDrawers — Primary Cash Drawer plan
 * §8.6: a generic, reversible cash move between any two of the shop's own
 * drawers, General <-> the primary cash drawer (PCD, `OMT_System`/
 * `Whish_System`) being the pair the UI exposes.
 *
 * Renamed from ProviderFloatTopUp.test.ts, which tested the now-deleted v139
 * float model (`fundSystemDrawer` against `system_float_topups`,
 * `target_drawer CHECK (IN ('OMT_System','Whish_System'))`, General -> PCD
 * ONLY). Migration v140 rebuilt that table as `drawer_transfers`
 * (from_drawer/to_drawer, no CHECK) specifically so the PCD -> General
 * direction the old CHECK made structurally impossible becomes legal — see
 * case (d) below, which is the whole point of the rebuild.
 *
 * Both legs post via insertPaymentRow + applyDrawerDelta (never a raw
 * UPDATE), so the flow stays reversible via the generic void path — proven
 * in case (i) below. Profit is always 0 (a same-shop cash move, not revenue).
 */

import Database from "better-sqlite3";
import { DrawerTopUpRepository } from "../DrawerTopUpRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

// ─── In-memory schema ───────────────────────────────────────────────────────
//
// `drawer_transfers` mirrors migration v140
// (packages/core/src/db/migrations/index.ts `up()`) column-for-column, which
// in turn is byte-identical (same columns, same absence of a CHECK on
// from_drawer/to_drawer) to electron-app/create_db.sql's copy — verified by
// reading both directly for this task; they do NOT diverge, so there is no
// fresh-install-vs-migration-path finding to report here.

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE drawer_transfers (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_drawer TEXT NOT NULL,
      to_drawer TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_by INTEGER,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
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
      profit_usd REAL,
      profit_lbp REAL,
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
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id     INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Empty on purpose: _cancelDebt (run by every void/refund) queries this
    -- table unconditionally with no existence check.
    CREATE TABLE debt_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      transaction_type TEXT,
      amount_usd REAL,
      amount_lbp REAL,
      transaction_id INTEGER,
      note TEXT,
      created_by INTEGER,
      covered_usd REAL DEFAULT 0,
      covered_lbp REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      due_date DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 500);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 50_000_000);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_System', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_System', 'LBP', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Whish_System', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Whish_System', 'LBP', 0);
  `);

  return db;
}

jest.mock("../../db/connection", () => {
  let _db: Database.Database | null = null;
  return {
    getDatabase: () => {
      if (!_db) throw new Error("DB not initialized");
      return _db;
    },
    setDb: (db: Database.Database) => {
      _db = db;
    },
  };
});

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
  return row?.balance ?? 0;
}

function transferRowCount(db: Database.Database): number {
  return (
    db.prepare("SELECT COUNT(*) c FROM drawer_transfers").get() as {
      c: number;
    }
  ).c;
}

function transactionRowCount(db: Database.Database): number {
  return (
    db.prepare("SELECT COUNT(*) c FROM transactions").get() as { c: number }
  ).c;
}

function paymentRowCount(db: Database.Database): number {
  return (
    db.prepare("SELECT COUNT(*) c FROM payments").get() as { c: number }
  ).c;
}

describe("DrawerTopUpRepository.transferBetweenDrawers()", () => {
  let db: Database.Database;
  let repo: DrawerTopUpRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    repo = new DrawerTopUpRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  it("(a) General -> OMT_System, USD: General -100, OMT_System +100, sigma conserved, profit 0", () => {
    const id = repo.transferBetweenDrawers({
      fromDrawer: "General",
      toDrawer: "OMT_System",
      amountUsd: 100,
      amountLbp: 0,
      createdBy: 1,
    });

    expect(balance(db, "General", "USD")).toBeCloseTo(400, 2); // 500 - 100
    expect(balance(db, "OMT_System", "USD")).toBeCloseTo(100, 2); // 0 + 100
    // Sigma of drawer deltas is 0: -100 (General) + 100 (OMT_System) = 0, so
    // the total held across both drawers is unchanged (500).
    expect(
      balance(db, "General", "USD") + balance(db, "OMT_System", "USD"),
    ).toBeCloseTo(500, 2);

    const txn = db
      .prepare("SELECT * FROM transactions WHERE type = 'DRAWER_TRANSFER'")
      .get() as any;
    expect(txn).toBeDefined();
    expect(txn.source_table).toBe("drawer_transfers");
    expect(txn.source_id).toBe(id);
    expect(txn.amount_usd).toBeCloseTo(100, 2);
    expect(txn.amount_lbp).toBeCloseTo(0, 2);
    expect(txn.profit_usd).toBe(0);
    expect(txn.profit_lbp).toBe(0);

    const legs = db
      .prepare("SELECT * FROM payments WHERE transaction_id = ? ORDER BY id")
      .all(txn.id) as any[];
    expect(legs).toHaveLength(2);
    expect(legs[0].drawer_name).toBe("General");
    expect(legs[0].amount).toBeCloseTo(-100, 2);
    expect(legs[1].drawer_name).toBe("OMT_System");
    expect(legs[1].amount).toBeCloseTo(100, 2);
  });

  it("(b) General -> Whish_System, LBP only: LBP is not silently treated as USD", () => {
    const id = repo.transferBetweenDrawers({
      fromDrawer: "General",
      toDrawer: "Whish_System",
      amountUsd: 0,
      amountLbp: 9_000_000,
      createdBy: 1,
    });

    expect(balance(db, "General", "LBP")).toBeCloseTo(41_000_000, 0); // 50M - 9M
    expect(balance(db, "Whish_System", "LBP")).toBeCloseTo(9_000_000, 0);
    // USD legs must NOT be touched by an LBP-only transfer.
    expect(balance(db, "General", "USD")).toBeCloseTo(500, 2);
    expect(balance(db, "Whish_System", "USD")).toBeCloseTo(0, 2);

    const txn = db
      .prepare("SELECT * FROM transactions WHERE type = 'DRAWER_TRANSFER'")
      .get() as any;
    expect(txn.amount_usd).toBeCloseTo(0, 2);
    expect(txn.amount_lbp).toBeCloseTo(9_000_000, 0);

    const legs = db
      .prepare("SELECT * FROM payments WHERE transaction_id = ? ORDER BY id")
      .all(txn.id) as any[];
    expect(legs).toHaveLength(2);
    expect(legs.every((l) => l.currency_code === "LBP")).toBe(true);
    void id;
  });

  it("(c) both currencies move together in ONE transfer call", () => {
    repo.transferBetweenDrawers({
      fromDrawer: "General",
      toDrawer: "OMT_System",
      amountUsd: 200,
      amountLbp: 5_000_000,
      createdBy: 1,
    });

    expect(balance(db, "General", "USD")).toBeCloseTo(300, 2); // 500 - 200
    expect(balance(db, "General", "LBP")).toBeCloseTo(45_000_000, 0); // 50M - 5M
    expect(balance(db, "OMT_System", "USD")).toBeCloseTo(200, 2); // 0 + 200
    expect(balance(db, "OMT_System", "LBP")).toBeCloseTo(5_000_000, 0); // 0 + 5M

    // 4 legs: General USD -200, OMT_System USD +200, General LBP -5M, OMT_System LBP +5M.
    const txn = db
      .prepare("SELECT * FROM transactions WHERE type = 'DRAWER_TRANSFER'")
      .get() as any;
    const legs = db
      .prepare("SELECT * FROM payments WHERE transaction_id = ? ORDER BY id")
      .all(txn.id) as any[];
    expect(legs).toHaveLength(4);
    const usdLegs = legs.filter((l) => l.currency_code === "USD");
    const lbpLegs = legs.filter((l) => l.currency_code === "LBP");
    expect(usdLegs).toHaveLength(2);
    expect(lbpLegs).toHaveLength(2);
  });

  it("(d) PCD -> General — the direction the old target_drawer CHECK made impossible; this is the whole point of the v139->v140 rebuild", () => {
    // Step 1 (fund the PCD first, same numbers as case (c)):
    //   General USD 500 -> 300, LBP 50M -> 45M
    //   OMT_System USD 0 -> 200, LBP 0 -> 5M
    repo.transferBetweenDrawers({
      fromDrawer: "General",
      toDrawer: "OMT_System",
      amountUsd: 200,
      amountLbp: 5_000_000,
      createdBy: 1,
    });

    // Step 2 — THE new direction: OMT_System -> General. Under the deleted
    // v139 schema, `system_float_topups.target_drawer CHECK (IN
    // ('OMT_System','Whish_System'))` made `toDrawer: "General"` here
    // structurally illegal at the SQLite layer. v140 dropped the CHECK
    // specifically so this call succeeds.
    const id = repo.transferBetweenDrawers({
      fromDrawer: "OMT_System",
      toDrawer: "General",
      amountUsd: 80,
      amountLbp: 1_000_000,
      createdBy: 1,
    });

    // OMT_System: 200 - 80 = 120 USD; 5,000,000 - 1,000,000 = 4,000,000 LBP.
    expect(balance(db, "OMT_System", "USD")).toBeCloseTo(120, 2);
    expect(balance(db, "OMT_System", "LBP")).toBeCloseTo(4_000_000, 0);
    // General: 300 + 80 = 380 USD; 45,000,000 + 1,000,000 = 46,000,000 LBP.
    expect(balance(db, "General", "USD")).toBeCloseTo(380, 2);
    expect(balance(db, "General", "LBP")).toBeCloseTo(46_000_000, 0);

    // Conservation across both drawers, both currencies, after both transfers:
    // 380 + 120 = 500 USD; 46,000,000 + 4,000,000 = 50,000,000 LBP.
    expect(
      balance(db, "General", "USD") + balance(db, "OMT_System", "USD"),
    ).toBeCloseTo(500, 2);
    expect(
      balance(db, "General", "LBP") + balance(db, "OMT_System", "LBP"),
    ).toBeCloseTo(50_000_000, 0);

    const txn = db
      .prepare("SELECT * FROM transactions WHERE source_id = ?")
      .get(id) as any;
    expect(txn.type).toBe("DRAWER_TRANSFER");
    expect(txn.source_table).toBe("drawer_transfers");
    const metadata = JSON.parse(txn.metadata_json);
    expect(metadata.from_drawer).toBe("OMT_System");
    expect(metadata.to_drawer).toBe("General");
  });

  it("(e) OVERDRAW IS ALLOWED (owner decision 2026-08-01): the transfer posts and the source drawer goes negative", () => {
    // Reversal of the original no-overdraw guard. Every drawer in this system
    // can already go negative; blocking a money move the operator has ALREADY
    // made physically just puts the app out of step with the cash box. The
    // condition is surfaced in the transfer UI (which flags a negative drawer
    // and pre-fills the amount that clears it), never enforced here.
    repo.transferBetweenDrawers({
      fromDrawer: "General",
      toDrawer: "OMT_System",
      amountUsd: 5_000, // only 500 available
      amountLbp: 0,
      createdBy: 1,
    });

    // 500 - 5,000 = -4,500: negative, and that is the point.
    expect(balance(db, "General", "USD")).toBeCloseTo(-4_500, 2);
    expect(balance(db, "OMT_System", "USD")).toBeCloseTo(5_000, 2);
    // Money is still CONSERVED across the pair — an overdraw must not also
    // become a leak. -4,500 + 5,000 = 500, the pre-transfer total.
    expect(
      balance(db, "General", "USD") + balance(db, "OMT_System", "USD"),
    ).toBeCloseTo(500, 2);
    // And it is a real, reversible transfer, not a silent balance poke.
    expect(transferRowCount(db)).toBe(1);
    expect(transactionRowCount(db)).toBe(1);
    expect(paymentRowCount(db)).toBe(2);
  });

  it("(e2) overdrawing ONE currency does not disturb the other: per-currency balances stay independent", () => {
    repo.transferBetweenDrawers({
      fromDrawer: "General",
      toDrawer: "OMT_System",
      amountUsd: 50, // comfortably available (500)
      amountLbp: 900_000_000, // far more than the 50,000,000 available
      createdBy: 1,
    });

    // USD behaves normally; LBP goes negative. Neither currency's rounding or
    // sign leaks into the other — the drawer is a per-currency ledger.
    expect(balance(db, "General", "USD")).toBeCloseTo(450, 2);
    expect(balance(db, "General", "LBP")).toBeCloseTo(-850_000_000, 0);
    expect(balance(db, "OMT_System", "USD")).toBeCloseTo(50, 2);
    expect(balance(db, "OMT_System", "LBP")).toBeCloseTo(900_000_000, 0);
    // Conservation per currency.
    expect(
      balance(db, "General", "LBP") + balance(db, "OMT_System", "LBP"),
    ).toBeCloseTo(50_000_000, 0);
    expect(transactionRowCount(db)).toBe(1);
  });

  it("(f) SELF-TRANSFER is REJECTED: fromDrawer === toDrawer must not write a no-op row", () => {
    expect(() =>
      repo.transferBetweenDrawers({
        fromDrawer: "OMT_System",
        toDrawer: "OMT_System",
        amountUsd: 200,
        amountLbp: 0,
        createdBy: 1,
      }),
    ).toThrow(/cannot be the same drawer/i);

    // Balance must be untouched — 200 in, 200 out nets to the same number,
    // but that's exactly the bug: a real transfer that never happened.
    expect(balance(db, "OMT_System", "USD")).toBeCloseTo(0, 2);
    expect(transferRowCount(db)).toBe(0);
    expect(transactionRowCount(db)).toBe(0);
    expect(paymentRowCount(db)).toBe(0);
  });

  it("(g) today, transferBetweenDrawers accepts ANY drawer-name string, including a typo — NO enum restriction (plan open item 6c, unresolved)", () => {
    // Unlike the deleted v139 system_float_topups.target_drawer CHECK, and
    // unlike the Zod validator (createDrawerTransferSchema — plain
    // non-empty-string fields, no z.enum), the repository itself performs NO
    // drawer-name validation beyond "not the same as fromDrawer" and the
    // funds check below. A typo'd/invented drawer name is silently accepted
    // and creates a brand-new drawer_balances row for it — this is today's
    // ACTUAL behavior, asserted here (not a bug this test file is allowed to
    // "fix" — CLAUDE.md rule: no production changes in this pass), and it is
    // exactly the open question the plan flags under §6 item 6c.
    const id = repo.transferBetweenDrawers({
      fromDrawer: "General",
      toDrawer: "Omt_system", // wrong case, not a real drawer name
      amountUsd: 10,
      amountLbp: 0,
      createdBy: 1,
    });

    expect(balance(db, "General", "USD")).toBeCloseTo(490, 2); // 500 - 10
    // A brand-new drawer_balances row was created for the typo'd name —
    // distinct from the real "OMT_System" row, which stays untouched at 0.
    expect(balance(db, "Omt_system", "USD")).toBeCloseTo(10, 2);
    expect(balance(db, "OMT_System", "USD")).toBeCloseTo(0, 2);

    const txn = db
      .prepare("SELECT * FROM transactions WHERE source_id = ?")
      .get(id) as any;
    expect(txn.type).toBe("DRAWER_TRANSFER");
  });

  it("(h) a non-finite amount_usd (e.g. -Infinity from a caller bypassing Zod) is REJECTED before any row is written", () => {
    expect(() =>
      repo.transferBetweenDrawers({
        fromDrawer: "General",
        toDrawer: "OMT_System",
        amountUsd: -Infinity,
        amountLbp: 0,
        createdBy: 1,
      }),
    ).toThrow(/finite/i);

    expect(transferRowCount(db)).toBe(0);
    expect(transactionRowCount(db)).toBe(0);
    expect(paymentRowCount(db)).toBe(0);
    // The balance columns must not have been poisoned either.
    expect(balance(db, "General", "USD")).toBeCloseTo(500, 2);
    expect(balance(db, "OMT_System", "USD")).toBeCloseTo(0, 2);
  });

  it("(h2) a NaN amount is REJECTED before any row is written", () => {
    expect(() =>
      repo.transferBetweenDrawers({
        fromDrawer: "General",
        toDrawer: "OMT_System",
        amountUsd: NaN,
        amountLbp: 0,
        createdBy: 1,
      }),
    ).toThrow(/finite/i);

    expect(transactionRowCount(db)).toBe(0);
  });

  it("(h3) a negative amount is REJECTED before any row is written", () => {
    expect(() =>
      repo.transferBetweenDrawers({
        fromDrawer: "General",
        toDrawer: "OMT_System",
        amountUsd: -50,
        amountLbp: 0,
        createdBy: 1,
      }),
    ).toThrow(/must not be negative/i);

    expect(transactionRowCount(db)).toBe(0);
  });

  it("(h4) an all-zero transfer (both amounts 0) is REJECTED as a no-op row", () => {
    expect(() =>
      repo.transferBetweenDrawers({
        fromDrawer: "General",
        toDrawer: "OMT_System",
        amountUsd: 0,
        amountLbp: 0,
        createdBy: 1,
      }),
    ).toThrow(/at least one/i);

    expect(transferRowCount(db)).toBe(0);
    expect(transactionRowCount(db)).toBe(0);
  });

  it("(i) REVERSAL: void restores both drawers to their exact pre-transaction values, per currency (rule 20)", () => {
    repo.transferBetweenDrawers({
      fromDrawer: "General",
      toDrawer: "OMT_System",
      amountUsd: 100,
      amountLbp: 4_000_000,
      createdBy: 1,
    });

    expect(balance(db, "General", "USD")).toBeCloseTo(400, 2);
    expect(balance(db, "General", "LBP")).toBeCloseTo(46_000_000, 0);
    expect(balance(db, "OMT_System", "USD")).toBeCloseTo(100, 2);
    expect(balance(db, "OMT_System", "LBP")).toBeCloseTo(4_000_000, 0);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getTransactionRepository } = require("../TransactionRepository");
    const txnRepo = getTransactionRepository();
    const original = db
      .prepare("SELECT * FROM transactions WHERE type = 'DRAWER_TRANSFER'")
      .get() as any;

    txnRepo.voidTransaction(original.id, 1);

    // Back to the exact pre-transfer balances — net effect of create + void
    // is 0 on both drawers, both currencies (the invariant rule 20 asserts).
    expect(balance(db, "General", "USD")).toBeCloseTo(500, 2);
    expect(balance(db, "General", "LBP")).toBeCloseTo(50_000_000, 0);
    expect(balance(db, "OMT_System", "USD")).toBeCloseTo(0, 2);
    expect(balance(db, "OMT_System", "LBP")).toBeCloseTo(0, 0);

    const sourceRow = db
      .prepare("SELECT * FROM drawer_transfers WHERE id = ?")
      .get(original.source_id) as any;
    expect(sourceRow.is_refunded).toBe(1);

    // Reversing twice must not double-apply — the generic path guards
    // against re-voiding an already-voided transaction.
    expect(() => txnRepo.voidTransaction(original.id, 1)).toThrow();
    expect(balance(db, "General", "USD")).toBeCloseTo(500, 2);
    expect(balance(db, "OMT_System", "USD")).toBeCloseTo(0, 2);
  });
});
