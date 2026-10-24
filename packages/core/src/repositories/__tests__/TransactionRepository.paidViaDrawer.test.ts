/**
 * LIRA-323 — Transactions page Type filter: "paid through this wallet".
 *
 * A wallet filter option (OMT App Send/Recv/Top-up/Cash-Out, Whish App
 * Send/Recv/Bills/Top-up, Binance Send/Recv) carries `paid_via_drawer`. Its
 * tuple then ALSO returns rows of OTHER types whose VISIBLE payment detail
 * moved money through that drawer (a Maintenance job paid with OMT Wallet, a
 * refund paid out by OMT Wallet, a session basket paid by OMT Wallet) — but
 * never a row of one of that wallet's OWN filter options (those show only
 * through their own tuple). "Visible" is the exact payment-detail rule
 * (`isInternalLegJs` / `customerCashLegSql`): internal legs, zero legs and
 * non-USD/LBP legs never count.
 *
 * Real in-memory SQLite, no mocks — the query is what's under test.
 */
import Database from "better-sqlite3";
import { TransactionRepository } from "../TransactionRepository.js";
import { runWithTenant } from "../../db/tenantContext.js";
import type { TransactionTypeFilterInput } from "../../validators/transaction.js";

let clock = 0;
function nextTs(): string {
  clock += 1;
  return `2026-01-15 10:${String(Math.floor(clock / 60)).padStart(2, "0")}:${String(clock % 60).padStart(2, "0")}`;
}

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE vouchers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, code TEXT,
      status TEXT, redeemed_transaction_id INTEGER, redeemed_session_id INTEGER
    );
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, username TEXT NOT NULL);
    CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, full_name TEXT, phone_number TEXT);
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE', source_table TEXT NOT NULL, source_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL, amount_usd REAL NOT NULL DEFAULT 0, amount_lbp REAL NOT NULL DEFAULT 0,
      profit_usd REAL NOT NULL DEFAULT 0, profit_lbp REAL NOT NULL DEFAULT 0,
      extra_usd REAL NOT NULL DEFAULT 0, extra_lbp REAL NOT NULL DEFAULT 0,
      exchange_rate REAL, client_id INTEGER, client_name TEXT, client_phone TEXT,
      reverses_id INTEGER, summary TEXT, metadata_json TEXT, device_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, transaction_id INTEGER,
      session_id INTEGER, method TEXT NOT NULL, drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL, amount REAL NOT NULL, note TEXT, created_by INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE customer_session_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, session_id INTEGER NOT NULL,
      unified_transaction_id INTEGER, transaction_type TEXT, amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0, paid_exchange_rate REAL
    );
    CREATE TABLE sales (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, exchange_rate_snapshot REAL);
    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER, transaction_type TEXT,
      amount_usd REAL NOT NULL DEFAULT 0, amount_lbp REAL NOT NULL DEFAULT 0,
      transaction_id INTEGER, session_id INTEGER, note TEXT, created_by INTEGER,
      tenant_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL
    );
  `);
  return db;
}

type Leg = {
  method: string;
  drawer: string;
  amount: number;
  currency?: string;
  note?: string;
  tenantId?: number;
};

function seedTxn(
  db: Database.Database,
  opts: {
    type: string;
    tenantId?: number;
    metadata?: Record<string, unknown>;
    legs?: Leg[];
    reversesId?: number;
  },
): number {
  const tenantId = opts.tenantId ?? 1;
  const id = Number(
    db
      .prepare(
        `INSERT INTO transactions
           (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp,
            reverses_id, metadata_json, created_at)
         VALUES (?, ?, 'ACTIVE', 'x', 1, 1, 40, 0, ?, ?, ?)`,
      )
      .run(
        tenantId,
        opts.type,
        opts.reversesId ?? null,
        opts.metadata ? JSON.stringify(opts.metadata) : null,
        nextTs(),
      ).lastInsertRowid,
  );
  for (const leg of opts.legs ?? []) addLeg(db, { ...leg, transactionId: id });
  return id;
}

function addLeg(
  db: Database.Database,
  leg: Leg & { transactionId?: number; sessionId?: number },
): void {
  db.prepare(
    `INSERT INTO payments (tenant_id, transaction_id, session_id, method, drawer_name, currency_code, amount, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    leg.tenantId ?? 1,
    leg.transactionId ?? null,
    leg.sessionId ?? null,
    leg.method,
    leg.drawer,
    leg.currency ?? "USD",
    leg.amount,
    leg.note ?? null,
  );
}

// The FILTER_GROUPS tuples as the frontend sends them (paid_via_drawer set).
const OMT_SEND = {
  type: "FINANCIAL_SERVICE",
  provider: "OMT_APP",
  service_type: "SEND",
  paid_via_drawer: "OMT_App",
} as TransactionTypeFilterInput;
const WHISH_SEND = {
  type: "FINANCIAL_SERVICE",
  provider: "WHISH_APP",
  service_type: "SEND",
  has_item_key: false,
  paid_via_drawer: "Whish_App",
} as TransactionTypeFilterInput;
const BINANCE_SEND = {
  type: "FINANCIAL_SERVICE",
  provider: "BINANCE",
  service_type: "SEND",
  paid_via_drawer: "Binance",
} as TransactionTypeFilterInput;

const OMT_LEG: Leg = { method: "OMT", drawer: "OMT_App", amount: 30 };
const CASH_LEG: Leg = { method: "CASH", drawer: "General", amount: 10 };

describe("TransactionRepository.getRecent — typeFilters paid_via_drawer (LIRA-323)", () => {
  let db: Database.Database;
  let repo: TransactionRepository;
  const recent = (
    typeFilters: TransactionTypeFilterInput[],
    limit = 50,
  ): number[] =>
    runWithTenant(1, () => repo.getRecent(limit, { typeFilters })).map(
      (r) => r.id,
    );

  beforeEach(() => {
    clock = 0;
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    repo = new TransactionRepository();
    db.prepare(
      `INSERT INTO users (id, tenant_id, username) VALUES (1, 1, 'alice'), (2, 2, 'bob')`,
    ).run();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
  });

  it("adds a Maintenance job paid Cash $10 + OMT Wallet $30 under OMT App Send; a cash-only one stays out", () => {
    const ownSend = seedTxn(db, {
      type: "FINANCIAL_SERVICE",
      metadata: { provider: "OMT_APP", service_type: "SEND" },
    });
    const mixed = seedTxn(db, {
      type: "MAINTENANCE",
      legs: [CASH_LEG, OMT_LEG],
    });
    const cashOnly = seedTxn(db, { type: "MAINTENANCE", legs: [CASH_LEG] });

    const ids = recent([OMT_SEND]);
    expect(ids).toContain(ownSend);
    expect(ids).toContain(mixed);
    expect(ids).not.toContain(cashOnly);
  });

  it("without paid_via_drawer the tuple is unchanged (control)", () => {
    const mixed = seedTxn(db, {
      type: "MAINTENANCE",
      legs: [CASH_LEG, OMT_LEG],
    });
    const { paid_via_drawer: _omit, ...plain } = OMT_SEND as Record<
      string,
      unknown
    >;
    expect(recent([plain as TransactionTypeFilterInput])).not.toContain(mixed);
  });

  it("never adds a row of the wallet's OWN other options (Recv / Top-up / Cash-Out) under OMT App Send", () => {
    const recv = seedTxn(db, {
      type: "FINANCIAL_SERVICE",
      metadata: { provider: "OMT_APP", service_type: "RECEIVE" },
      legs: [{ ...OMT_LEG, amount: -30 }],
    });
    const topUp = seedTxn(db, {
      type: "RECHARGE_TOPUP",
      metadata: { provider: "OMT_APP" },
      legs: [OMT_LEG],
    });
    const cashOut = seedTxn(db, {
      type: "WALLET_CASHOUT",
      legs: [{ ...OMT_LEG, amount: -30 }],
    });
    const ids = recent([OMT_SEND]);
    expect(ids).not.toContain(recv);
    expect(ids).not.toContain(topUp);
    expect(ids).not.toContain(cashOut);
  });

  it("does not add a row whose only OMT_App legs are hidden from payment detail", () => {
    const internalMethod = seedTxn(db, {
      type: "SALE",
      legs: [{ method: "OMT_APP", drawer: "OMT_App", amount: 30 }],
    });
    const zero = seedTxn(db, {
      type: "SALE",
      legs: [{ ...OMT_LEG, amount: 0 }],
    });
    const cost = seedTxn(db, {
      type: "CUSTOM_SERVICE",
      legs: [{ ...OMT_LEG, amount: -5, note: "Cost: provider" }],
    });
    const ids = recent([OMT_SEND]);
    expect(ids).not.toContain(internalMethod);
    expect(ids).not.toContain(zero);
    expect(ids).not.toContain(cost);
  });

  it("adds a REFUND paid out by OMT Wallet (its own OUT leg counts)", () => {
    const original = seedTxn(db, { type: "SALE", legs: [CASH_LEG] });
    const refund = seedTxn(db, {
      type: "REFUND",
      reversesId: original,
      legs: [{ ...OMT_LEG, amount: -10 }],
    });
    const ids = recent([OMT_SEND]);
    expect(ids).toContain(refund);
    expect(ids).not.toContain(original);
  });

  it("adds a session member whose basket was paid by OMT Wallet (pooled leg, transaction_id NULL)", () => {
    const member = seedTxn(db, { type: "CUSTOM_SERVICE" });
    const outsider = seedTxn(db, { type: "CUSTOM_SERVICE" });
    db.prepare(
      `INSERT INTO customer_session_transactions (tenant_id, session_id, unified_transaction_id, transaction_type, amount_usd)
       VALUES (1, 77, ?, 'CUSTOM_SERVICE', 30)`,
    ).run(member);
    addLeg(db, { ...OMT_LEG, sessionId: 77 });
    const ids = recent([OMT_SEND]);
    expect(ids).toContain(member);
    expect(ids).not.toContain(outsider);
  });

  it("Whish App Send adds a custom service paid via Whish App, but not a Whish App Bills row", () => {
    const service = seedTxn(db, {
      type: "CUSTOM_SERVICE",
      legs: [{ method: "WHISH", drawer: "Whish_App", amount: 20 }],
    });
    const bill = seedTxn(db, {
      type: "FINANCIAL_SERVICE",
      metadata: { provider: "WHISH_APP", item_key: "BILL-1" },
      legs: [{ method: "WHISH", drawer: "Whish_App", amount: 20 }],
    });
    const omtPaid = seedTxn(db, { type: "SALE", legs: [OMT_LEG] });
    const ids = recent([WHISH_SEND]);
    expect(ids).toContain(service);
    expect(ids).not.toContain(bill);
    expect(ids).not.toContain(omtPaid);
  });

  it("Binance Send adds a sale paid by a USD Binance leg; a USDT-only leg is not visible so it stays out", () => {
    const usd = seedTxn(db, {
      type: "SALE",
      legs: [{ method: "BINANCE", drawer: "Binance", amount: 25 }],
    });
    const usdt = seedTxn(db, {
      type: "SALE",
      legs: [
        { method: "BINANCE", drawer: "Binance", amount: 25, currency: "USDT" },
      ],
    });
    const ids = recent([BINANCE_SEND]);
    expect(ids).toContain(usd);
    expect(ids).not.toContain(usdt);
  });

  it("never leaks another tenant's rows or legs", () => {
    const other = seedTxn(db, {
      tenantId: 2,
      type: "MAINTENANCE",
      legs: [{ ...OMT_LEG, tenantId: 2 }],
    });
    // A tenant-1 cash job with a stray tenant-2 OMT leg pointing at it.
    const mine = seedTxn(db, { type: "MAINTENANCE", legs: [CASH_LEG] });
    addLeg(db, { ...OMT_LEG, tenantId: 2, transactionId: mine });
    const ids = recent([OMT_SEND]);
    expect(ids).not.toContain(other);
    expect(ids).not.toContain(mine);
  });

  it("applies LIMIT after the drawer match (newer non-matching rows never crowd it out)", () => {
    const matches = [1, 2, 3, 4].map(() =>
      seedTxn(db, { type: "MAINTENANCE", legs: [OMT_LEG] }),
    );
    for (let i = 0; i < 10; i++) {
      seedTxn(db, { type: "SALE", legs: [CASH_LEG] });
    }
    expect(recent([OMT_SEND], 3)).toEqual(
      matches.slice(1).reverse(), // newest three, DESC
    );
  });
});
