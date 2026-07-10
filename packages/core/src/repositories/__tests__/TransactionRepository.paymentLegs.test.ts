/**
 * LIRA-064 — TransactionRepository.getRecent() structured payment legs.
 *
 * Verifies that getRecent() attaches a structured `payments` array (in/out
 * legs joined from the payments table) to each row, WITHOUT modifying the
 * stored `summary` text. This is the data contract future LIRA-067 consumes.
 */

import Database from "better-sqlite3";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      username  TEXT NOT NULL,
      tenant_id INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE clients (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT,
      tenant_id INTEGER NOT NULL DEFAULT 1
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
      tenant_id     INTEGER NOT NULL DEFAULT 1,
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
      tenant_id      INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE customer_session_transactions (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id             INTEGER,
      transaction_type       TEXT,
      transaction_id         INTEGER,
      unified_transaction_id INTEGER,
      tenant_id              INTEGER NOT NULL DEFAULT 1,
      created_at             TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.prepare(`INSERT INTO users (id, username) VALUES (1, 'cashier')`).run();

  return db;
}

function insertTxn(
  db: Database.Database,
  opts: {
    id: number;
    type?: string;
    summary?: string;
    createdAt?: string;
    status?: string;
  },
): void {
  db.prepare(
    `INSERT INTO transactions (id, type, status, user_id, summary, created_at)
     VALUES (?, ?, ?, 1, ?, ?)`,
  ).run(
    opts.id,
    opts.type ?? "SALE",
    opts.status ?? "ACTIVE",
    opts.summary ?? null,
    opts.createdAt ?? `2026-06-17 10:0${opts.id}:00`,
  );
}

function insertPayment(
  db: Database.Database,
  txnId: number,
  method: string,
  currency: string,
  amount: number,
): void {
  db.prepare(
    `INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount)
     VALUES (?, ?, 'General', ?, ?)`,
  ).run(txnId, method, currency, amount);
}

/** Full-control leg insert — used to exercise internal-leg filtering. */
function insertLeg(
  db: Database.Database,
  txnId: number,
  opts: {
    method: string;
    currency: string;
    amount: number;
    drawer?: string;
    note?: string;
  },
): void {
  db.prepare(
    `INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount, note)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    txnId,
    opts.method,
    opts.drawer ?? "General",
    opts.currency,
    opts.amount,
    opts.note ?? null,
  );
}

describe("TransactionRepository.getRecent — structured payment legs (LIRA-064)", () => {
  let db: Database.Database;
  let repo: TransactionRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    repo = new TransactionRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetTenantContext();
  });

  it("attaches in/out legs with currency + method per row", () => {
    insertTxn(db, { id: 1, summary: "Sale #1" });
    // Customer paid $50 cash (in) + 100,000 LBP cash (in), got 20,000 LBP change (out)
    insertPayment(db, 1, "CASH", "USD", 50);
    insertPayment(db, 1, "CASH", "LBP", 100_000);
    insertPayment(db, 1, "CASH", "LBP", -20_000);

    const rows = repo.getRecent(10);
    const row = rows.find((r) => r.id === 1);

    expect(row).toBeTruthy();
    expect(row!.payments).toHaveLength(3);

    const inLegs = row!.payments.filter((p) => p.direction === "in");
    const outLegs = row!.payments.filter((p) => p.direction === "out");
    expect(inLegs).toHaveLength(2);
    expect(outLegs).toHaveLength(1);

    const usdIn = inLegs.find((p) => p.currency_code === "USD");
    expect(usdIn).toMatchObject({
      direction: "in",
      amount: 50,
      signed_amount: 50,
      currency_code: "USD",
      method: "CASH",
    });

    const lbpOut = outLegs[0];
    expect(lbpOut).toMatchObject({
      direction: "out",
      amount: 20_000,
      signed_amount: -20_000,
      currency_code: "LBP",
    });
  });

  it("does NOT modify the stored summary text", () => {
    insertTxn(db, { id: 1, summary: "Plain summary" });
    insertPayment(db, 1, "CASH", "USD", 30);

    const rows = repo.getRecent(10);
    const row = rows.find((r) => r.id === 1);

    expect(row!.summary).toBe("Plain summary");
    expect(row!.summary).not.toMatch(/in:|out:/);
  });

  it("returns an empty array for transactions with no payments", () => {
    insertTxn(db, { id: 1, type: "CLIENT_CREATED", summary: "No payment" });

    const rows = repo.getRecent(10);
    const row = rows.find((r) => r.id === 1);

    expect(row!.payments).toEqual([]);
  });

  it("groups legs by their own transaction across multiple rows", () => {
    insertTxn(db, { id: 1, summary: "First" });
    insertTxn(db, { id: 2, summary: "Second" });
    insertPayment(db, 1, "CASH", "USD", 10);
    insertPayment(db, 2, "WHISH", "USD", 99);

    const rows = repo.getRecent(10);
    const r1 = rows.find((r) => r.id === 1)!;
    const r2 = rows.find((r) => r.id === 2)!;

    expect(r1.payments).toHaveLength(1);
    expect(r1.payments[0]).toMatchObject({ method: "CASH", amount: 10 });
    expect(r2.payments).toHaveLength(1);
    expect(r2.payments[0]).toMatchObject({ method: "WHISH", amount: 99 });
  });

  // ── Internal-leg filtering (customer cash only) ────────────────────────────

  it("Binance SEND: shows only customer cash (in $100 / out 180k LBP), not the USDT crypto leg", () => {
    insertTxn(db, {
      id: 1,
      type: "FINANCIAL_SERVICE",
      summary: "BINANCE SEND: 98 USDT",
    });
    // Customer pays $100 cash; shop sends 98 USDT (internal crypto leg) and
    // returns 180,000 LBP change.
    insertLeg(db, 1, {
      method: "CASH",
      currency: "USD",
      amount: 100,
      note: "Binance SEND payment",
    });
    insertLeg(db, 1, {
      method: "BINANCE",
      currency: "USDT",
      amount: -98,
      drawer: "Binance",
      note: "Crypto sent to customer",
    });
    insertLeg(db, 1, {
      method: "CASH",
      currency: "LBP",
      amount: -180_000,
      note: "Change returned",
    });
    insertLeg(db, 1, {
      method: "COMMISSION",
      currency: "USD",
      amount: 0,
      drawer: "Binance",
      note: "Commission (Binance fee: $2)",
    });

    const row = repo.getRecent(10).find((r) => r.id === 1)!;

    expect(row.payments).toHaveLength(2);
    const inLeg = row.payments.find((p) => p.direction === "in")!;
    const outLeg = row.payments.find((p) => p.direction === "out")!;
    expect(inLeg).toMatchObject({
      amount: 100,
      currency_code: "USD",
      method: "CASH",
    });
    expect(outLeg).toMatchObject({
      amount: 180_000,
      currency_code: "LBP",
      method: "CASH",
    });
    // The USDT crypto leg and the zero-delta commission row are NOT surfaced.
    expect(row.payments.some((p) => p.currency_code === "USDT")).toBe(false);
    expect(row.payments.some((p) => p.method === "COMMISSION")).toBe(false);
  });

  it("filters out cost-flow, system-reserve, and fee/transfer internal legs", () => {
    insertTxn(db, { id: 1, type: "FINANCIAL_SERVICE", summary: "OMT/Katsh" });
    // Customer cash in (kept):
    insertLeg(db, 1, {
      method: "CASH",
      currency: "USD",
      amount: 60,
      note: "payment",
    });
    // Internal legs (all filtered):
    insertLeg(db, 1, {
      method: "Katsh",
      currency: "USD",
      amount: -48,
      drawer: "Katsh",
      note: "Cost: Katsh",
    });
    insertLeg(db, 1, {
      method: "OMT",
      currency: "USD",
      amount: 100,
      drawer: "OMT_System",
      note: "OMT system debt",
    });
    insertLeg(db, 1, {
      method: "PM_FEE",
      currency: "USD",
      amount: 0.5,
      note: "Payment method fee (1%)",
    });
    insertLeg(db, 1, {
      method: "TRANSFER",
      currency: "USD",
      amount: 100,
      drawer: "OMT_System",
      note: "transfer",
    });
    insertLeg(db, 1, {
      method: "CREDIT_RETURN",
      currency: "USD",
      amount: 3,
      drawer: "MTC",
      note: "Returned credits: 3 USD",
    });

    const row = repo.getRecent(10).find((r) => r.id === 1)!;

    expect(row.payments).toHaveLength(1);
    expect(row.payments[0]).toMatchObject({
      direction: "in",
      amount: 60,
      method: "CASH",
    });
  });

  it("OMT SEND: hides the RESERVE settlement leg — the row shows customer cash IN only (C2)", () => {
    insertTxn(db, {
      id: 1,
      type: "FINANCIAL_SERVICE",
      summary: "OMT SEND: $37",
    });
    // Customer cash in (kept):
    insertLeg(db, 1, { method: "CASH", currency: "USD", amount: 37 });
    // Internal settlement legs (both filtered): General reserve + system debt.
    // Pre-C2 the RESERVE leg leaked into the row as a bogus "out: $37".
    insertLeg(db, 1, {
      method: "RESERVE",
      currency: "USD",
      amount: -37,
      note: "Cash reserve for settlement",
    });
    insertLeg(db, 1, {
      method: "OMT",
      currency: "USD",
      amount: 37,
      drawer: "OMT_System",
      note: "OMT system debt",
    });

    const row = repo.getRecent(10).find((r) => r.id === 1)!;

    expect(row.payments).toHaveLength(1);
    expect(row.payments[0]).toMatchObject({
      direction: "in",
      amount: 37,
      method: "CASH",
    });
  });

  it("MTC CREDIT_TRANSFER: hides telecom stock + SMS legs, keeps cash in/out", () => {
    insertTxn(db, {
      id: 1,
      type: "RECHARGE",
      summary: "Recharge: MTC CREDIT_TRANSFER 600,000 LBP",
    });
    // Customer pays $10 cash, gets 300,000 LBP change. The credits ($6) and SMS
    // cost ($0.32) leave the MTC provider-stock drawer (internal, not cash out).
    insertLeg(db, 1, {
      method: "CASH",
      currency: "USD",
      amount: 10,
      note: "MTC credit",
    });
    insertLeg(db, 1, {
      method: "MTC",
      currency: "USD",
      amount: -6,
      drawer: "MTC",
      note: "Telecom balance sent",
    });
    insertLeg(db, 1, {
      method: "SMS_COST",
      currency: "USD",
      amount: -0.32,
      drawer: "MTC",
      note: "SMS cost: 2 × $0.16",
    });
    insertLeg(db, 1, {
      method: "CASH",
      currency: "LBP",
      amount: -300_000,
      note: "Change returned",
    });

    const row = repo.getRecent(10).find((r) => r.id === 1)!;

    expect(row.payments).toHaveLength(2);
    const inLeg = row.payments.find((p) => p.direction === "in")!;
    const outLeg = row.payments.find((p) => p.direction === "out")!;
    expect(inLeg).toMatchObject({
      amount: 10,
      currency_code: "USD",
      method: "CASH",
    });
    expect(outLeg).toMatchObject({
      amount: 300_000,
      currency_code: "LBP",
      method: "CASH",
    });
    // No MTC stock leg ($6) or SMS cost ($0.32) leaks into the customer summary.
    expect(row.payments.some((p) => p.method === "MTC")).toBe(false);
    expect(row.payments.some((p) => p.method === "SMS_COST")).toBe(false);
  });

  it("keeps a legitimate customer wallet payment (WHISH → Whish_App)", () => {
    insertTxn(db, {
      id: 1,
      type: "FINANCIAL_SERVICE",
      summary: "paid by Whish",
    });
    // A customer paying via the WHISH method hits the Whish_App wallet drawer —
    // this IS customer cash and must NOT be confused with a Whish_System leg.
    insertLeg(db, 1, {
      method: "WHISH",
      currency: "USD",
      amount: 25,
      drawer: "Whish_App",
      note: "payment",
    });

    const row = repo.getRecent(10).find((r) => r.id === 1)!;
    expect(row.payments).toHaveLength(1);
    expect(row.payments[0]).toMatchObject({
      direction: "in",
      amount: 25,
      method: "WHISH",
    });
  });
});

describe("TransactionRepository.getCashFlowByDate — D1 currency in/out report", () => {
  let db: Database.Database;
  let repo: TransactionRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    repo = new TransactionRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetTenantContext();
  });

  const rowFor = (
    rows: ReturnType<TransactionRepository["getCashFlowByDate"]>,
    date: string,
    currency: string,
  ) => rows.find((r) => r.date === date && r.currency_code === currency);

  it("aggregates customer cash in/out per date and currency", () => {
    insertTxn(db, { id: 1, createdAt: "2024-03-05 10:00:00" });
    insertPayment(db, 1, "CASH", "USD", 100);
    insertPayment(db, 1, "CASH", "USD", -20); // change back
    insertPayment(db, 1, "CASH", "LBP", 1_500_000);
    insertTxn(db, { id: 2, createdAt: "2024-03-06 09:00:00" });
    insertPayment(db, 2, "CASH", "USD", 40);

    const rows = repo.getCashFlowByDate("2024-03-01", "2024-03-31");

    expect(rowFor(rows, "2024-03-05", "USD")).toMatchObject({
      total_in: 100,
      total_out: 20,
    });
    expect(rowFor(rows, "2024-03-05", "LBP")).toMatchObject({
      total_in: 1_500_000,
      total_out: 0,
    });
    expect(rowFor(rows, "2024-03-06", "USD")).toMatchObject({
      total_in: 40,
      total_out: 0,
    });
  });

  it("excludes internal legs — same rule as the in/out column (rule 14 mirror)", () => {
    insertTxn(db, { id: 1, createdAt: "2024-03-05 10:00:00" });
    insertPayment(db, 1, "CASH", "USD", 60); // the only customer leg
    insertLeg(db, 1, { method: "RESERVE", currency: "USD", amount: -60 });
    insertLeg(db, 1, {
      method: "OMT",
      currency: "USD",
      amount: 60,
      drawer: "OMT_System",
    });
    insertLeg(db, 1, {
      method: "Katsh",
      currency: "USD",
      amount: -48,
      drawer: "Katsh",
      note: "Cost: Katsh",
    });
    insertLeg(db, 1, { method: "BINANCE", currency: "USDT", amount: -20 });
    insertLeg(db, 1, { method: "PM_FEE", currency: "USD", amount: 0.5 });

    const rows = repo.getCashFlowByDate("2024-03-01", "2024-03-31");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      date: "2024-03-05",
      currency_code: "USD",
      total_in: 60,
      total_out: 0,
    });
  });

  it("buckets by created_at — which carries the backdated business date", () => {
    // createTransaction COALESCEs the caller's transaction_time INTO
    // created_at, so a backdated entry's created_at IS its business date.
    insertTxn(db, { id: 1, createdAt: "2024-04-01 12:00:00" });
    insertPayment(db, 1, "CASH", "USD", 30);

    const rows = repo.getCashFlowByDate("2024-04-01", "2024-04-01");
    expect(rows).toHaveLength(1);
    expect(rows[0].total_in).toBe(30);
  });

  it("excludes VOIDED transactions", () => {
    insertTxn(db, { id: 1, createdAt: "2024-03-05 10:00:00", status: "VOIDED" });
    insertPayment(db, 1, "CASH", "USD", 500);

    expect(repo.getCashFlowByDate("2024-03-01", "2024-03-31")).toHaveLength(0);
  });
});
