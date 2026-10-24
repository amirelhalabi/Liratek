/**
 * LIRA-339 T030/T033 — Transactions page Type filter: the Vouchers options
 * carry `paid_via_voucher`. Their tuple then ALSO returns rows paid with a
 * voucher — a transaction whose id is a voucher's `redeemed_transaction_id`,
 * or a session basket member whose session is a voucher's
 * `redeemed_session_id` — but never a row of another Vouchers option.
 * Every row also carries the `paid_via_voucher` flag.
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
    CREATE TABLE vouchers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, code TEXT,
      status TEXT, redeemed_transaction_id INTEGER, redeemed_session_id INTEGER
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

function addLedger(
  db: Database.Database,
  opts: {
    type: string;
    transactionId?: number;
    sessionId?: number;
    tenantId?: number;
  },
): void {
  db.prepare(
    `INSERT INTO debt_ledger (tenant_id, client_id, transaction_type, amount_usd, transaction_id, session_id)
     VALUES (?, 7, ?, 40, ?, ?)`,
  ).run(
    opts.tenantId ?? 1,
    opts.type,
    opts.transactionId ?? null,
    opts.sessionId ?? null,
  );
}

function addVoucher(
  db: Database.Database,
  opts: { transactionId?: number; sessionId?: number; tenantId?: number },
): void {
  db.prepare(
    `INSERT INTO vouchers (tenant_id, code, status, redeemed_transaction_id, redeemed_session_id)
     VALUES (?, 'GC', 'redeemed', ?, ?)`,
  ).run(opts.tenantId ?? 1, opts.transactionId ?? null, opts.sessionId ?? null);
}

function addSessionMember(
  db: Database.Database,
  sessionId: number,
  txnId: number,
): void {
  db.prepare(
    `INSERT INTO customer_session_transactions (tenant_id, session_id, unified_transaction_id, amount_usd)
     VALUES (1, ?, ?, 40)`,
  ).run(sessionId, txnId);
}

const VOUCHER_SALE = {
  type: "VOUCHER_SALE",
  paid_via_voucher: true,
} as TransactionTypeFilterInput;
const VOUCHER_CANCEL = {
  type: "VOUCHER_CANCEL",
  paid_via_voucher: true,
} as TransactionTypeFilterInput;

describe("TransactionRepository.getRecent — typeFilters paid_via_voucher", () => {
  let db: Database.Database;
  let repo: TransactionRepository;
  const rows = (typeFilters?: TransactionTypeFilterInput[], limit = 50) =>
    runWithTenant(1, () =>
      repo.getRecent(limit, typeFilters ? { typeFilters } : {}),
    );
  const recent = (typeFilters: TransactionTypeFilterInput[]): number[] =>
    rows(typeFilters).map((r) => r.id);

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

  it("T030: returns the voucher sale, a sale paid with a voucher and a voucher-paid basket member; not a cash sale", () => {
    const voucherSale = seedTxn(db, { type: "VOUCHER_SALE" });
    const redeemedSale = seedTxn(db, { type: "SALE" });
    addVoucher(db, { transactionId: redeemedSale });
    const member = seedTxn(db, { type: "RECHARGE" });
    addSessionMember(db, 77, member);
    addVoucher(db, { sessionId: 77 });
    const cashSale = seedTxn(db, {
      type: "SALE",
      legs: [{ method: "CASH", drawer: "General", amount: 40 }],
    });

    const ids = recent([VOUCHER_SALE]);
    expect(ids).toContain(voucherSale);
    expect(ids).toContain(redeemedSale);
    expect(ids).toContain(member);
    expect(ids).not.toContain(cashSale);
  });

  it("stamps paid_via_voucher true exactly on the linked rows", () => {
    const voucherSale = seedTxn(db, { type: "VOUCHER_SALE" });
    const redeemedSale = seedTxn(db, { type: "SALE" });
    addVoucher(db, { transactionId: redeemedSale });
    const member = seedTxn(db, { type: "RECHARGE" });
    addSessionMember(db, 77, member);
    addVoucher(db, { sessionId: 77 });
    const cashSale = seedTxn(db, { type: "SALE" });

    const byId = new Map(rows().map((r) => [r.id, r.paid_via_voucher]));
    expect(byId.get(redeemedSale)).toBe(true);
    expect(byId.get(member)).toBe(true);
    expect(byId.get(voucherSale)).toBe(false);
    expect(byId.get(cashSale)).toBe(false);
  });

  it("never adds another Vouchers option's own row through the voucher route", () => {
    const cancel = seedTxn(db, { type: "VOUCHER_CANCEL" });
    addVoucher(db, { transactionId: cancel });

    expect(recent([VOUCHER_SALE])).not.toContain(cancel);
    const cancelIds = recent([VOUCHER_CANCEL]);
    expect(cancelIds.filter((id) => id === cancel)).toHaveLength(1);
  });

  it("without paid_via_voucher the tuple is unchanged (control)", () => {
    const redeemedSale = seedTxn(db, { type: "SALE" });
    addVoucher(db, { transactionId: redeemedSale });

    expect(recent([{ type: "VOUCHER_SALE" }])).not.toContain(redeemedSale);
  });

  it("ignores another tenant's vouchers", () => {
    const sale = seedTxn(db, { type: "SALE" });
    addVoucher(db, { transactionId: sale, tenantId: 2 });

    expect(recent([VOUCHER_SALE])).not.toContain(sale);
  });

  it("T033: an on-account voucher sale also matches the Debts filter (intended, owner 2026-10-24)", () => {
    const onAccount = seedTxn(db, { type: "VOUCHER_SALE" });
    addLedger(db, { type: "Voucher Debt", transactionId: onAccount });

    expect(
      recent([
        { type: "ACCOUNT_ADJUSTMENT", paid_via_account: true } as TransactionTypeFilterInput,
      ]),
    ).toContain(onAccount);
    expect(recent([VOUCHER_SALE])).toContain(onAccount);
  });
});
