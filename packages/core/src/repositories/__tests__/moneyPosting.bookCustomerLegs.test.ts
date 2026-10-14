/**
 * LIRA-321 T003 — `bookCustomerLegs`: the ONE writer for "the customer's
 * lines on the money-in side of a payout screen → drawers + client debt".
 *
 * Rules (research.md R4):
 *  - never more than expected (no overpay);
 *  - a shortfall is accepted only when covered by CUSTOMER_ACCOUNT lines
 *    (client required) or a forgiven amount within the shortfall cap
 *    ($5 / 450,000 LBP);
 *  - non-account lines post a positive payment row + drawer delta;
 *  - account lines book ONE debt row per currency (USD/LBP) of `debtType`;
 *    a line in another currency is owed as its USD equivalent at `rate`
 *    (usd = amount × rate); USDT counts 1:1 as USD.
 * Every refusal happens before the first write.
 */

import Database from "better-sqlite3";
import {
  bookCustomerLegs,
  type BookCustomerLegsInput,
  type ReconciliationLeg,
} from "../moneyPosting";

const TXN = 77;
const TENANT = 1;

function createDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
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
      tenant_id INTEGER,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd DECIMAL(10, 2),
      amount_lbp DECIMAL(15, 2),
      transaction_id INTEGER,
      due_date TEXT,
      note TEXT,
      created_by INTEGER,
      tenant_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL
    );
  `);
  return db;
}

const DRAWERS: Record<string, string> = {
  CASH: "General",
  WHISH: "Whish_App",
  OMT: "OMT_App",
  BINANCE: "Binance",
};

function leg(
  method: string,
  currencyCode: string,
  amount: number,
): ReconciliationLeg {
  return { method, currencyCode, amount };
}

function input(
  over: Partial<BookCustomerLegsInput> & Pick<BookCustomerLegsInput, "legs">,
): BookCustomerLegsInput {
  return {
    expected: { amount: 100, currency: "USD" },
    rate: 90000,
    debtType: "Service Debt",
    clientId: 5,
    transactionId: TXN,
    drawerFor: (l) => DRAWERS[l.method] ?? "General",
    tenantId: TENANT,
    createdBy: 3,
    ...over,
  };
}

function rows(db: Database.Database, table: string): Record<string, unknown>[] {
  // Table names are test constants, never user input.
  return db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() as Record<
    string,
    unknown
  >[];
}

function balance(db: Database.Database, drawer: string, cur: string): number {
  const r = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE tenant_id = ? AND drawer_name = ? AND currency_code = ?`,
    )
    .get(TENANT, drawer, cur) as { balance: number } | undefined;
  return r?.balance ?? 0;
}

function expectNothingWritten(db: Database.Database): void {
  expect(rows(db, "payments")).toHaveLength(0);
  expect(rows(db, "drawer_balances")).toHaveLength(0);
  expect(rows(db, "debt_ledger")).toHaveLength(0);
}

describe("bookCustomerLegs (LIRA-321)", () => {
  it("(a) exact cash cover: one positive payment row, no debt", () => {
    const db = createDb();
    const res = bookCustomerLegs(db, input({ legs: [leg("CASH", "USD", 100)] }));
    expect(res).toEqual({ paid: 100, owed: { usd: 0, lbp: 0 }, forgiven: 0 });
    const pays = rows(db, "payments");
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({
      transaction_id: TXN,
      method: "CASH",
      drawer_name: "General",
      currency_code: "USD",
      amount: 100,
      tenant_id: TENANT,
      created_by: 3,
    });
    expect(balance(db, "General", "USD")).toBe(100);
    expect(rows(db, "debt_ledger")).toHaveLength(0);
  });

  it("(b) short with a CUSTOMER_ACCOUNT leg books one debt row of the given type and currency, linked by transaction_id", () => {
    const db = createDb();
    const res = bookCustomerLegs(
      db,
      input({
        expected: { amount: 89_500_000, currency: "LBP" },
        legs: [
          leg("CASH", "LBP", 87_600_000),
          leg("CUSTOMER_ACCOUNT", "LBP", 1_900_000),
        ],
      }),
    );
    expect(res).toEqual({
      paid: 87_600_000,
      owed: { usd: 0, lbp: 1_900_000 },
      forgiven: 0,
    });
    const debts = rows(db, "debt_ledger");
    expect(debts).toHaveLength(1);
    expect(debts[0]).toMatchObject({
      client_id: 5,
      transaction_type: "Service Debt",
      amount_lbp: 1_900_000,
      transaction_id: TXN,
      tenant_id: TENANT,
    });
    expect(debts[0].amount_usd ?? 0).toBe(0);
    expect(balance(db, "General", "LBP")).toBe(87_600_000);
    // The account line itself moves no drawer and writes no payment row.
    expect(rows(db, "payments")).toHaveLength(1);
  });

  it("(c) short with no account leg and no forgive throws, writing nothing", () => {
    const db = createDb();
    expect(() =>
      bookCustomerLegs(db, input({ legs: [leg("CASH", "USD", 90)] })),
    ).toThrow(/less than the total/);
    expectNothingWritten(db);
  });

  it("(d) a forgive within the cap is accepted and returned as forgiven", () => {
    const db = createDb();
    const res = bookCustomerLegs(
      db,
      input({ legs: [leg("CASH", "USD", 95)], waived: 5 }),
    );
    expect(res).toEqual({ paid: 95, owed: { usd: 0, lbp: 0 }, forgiven: 5 });
    expect(balance(db, "General", "USD")).toBe(95);

    const db2 = createDb();
    const res2 = bookCustomerLegs(
      db2,
      input({
        expected: { amount: 9_000_000, currency: "LBP" },
        legs: [leg("CASH", "LBP", 8_550_000)],
        waived: 450_000,
      }),
    );
    expect(res2.forgiven).toBe(450_000);
  });

  it("(e) a forgive above the cap throws, writing nothing", () => {
    const db = createDb();
    expect(() =>
      bookCustomerLegs(db, input({ legs: [leg("CASH", "USD", 94)], waived: 6 })),
    ).toThrow(/forgive/i);
    expectNothingWritten(db);

    const db2 = createDb();
    expect(() =>
      bookCustomerLegs(
        db2,
        input({
          expected: { amount: 9_000_000, currency: "LBP" },
          legs: [leg("CASH", "LBP", 8_500_000)],
          waived: 500_000,
        }),
      ),
    ).toThrow(/forgive/i);
    expectNothingWritten(db2);
  });

  it("(e2) forgiving more than the actual shortfall throws", () => {
    const db = createDb();
    expect(() =>
      bookCustomerLegs(db, input({ legs: [leg("CASH", "USD", 98)], waived: 4 })),
    ).toThrow(/more than what is missing/);
    expectNothingWritten(db);
  });

  it("(f) legs summing to more than expected throw (no overpay), writing nothing", () => {
    const db = createDb();
    expect(() =>
      bookCustomerLegs(
        db,
        input({ legs: [leg("CASH", "USD", 80), leg("WHISH", "USD", 30)] }),
      ),
    ).toThrow(/more than the total/);
    expectNothingWritten(db);

    // Mixed USD/LBP over by more than the epsilon is refused too.
    const db2 = createDb();
    expect(() =>
      bookCustomerLegs(
        db2,
        input({ legs: [leg("CASH", "USD", 99), leg("CASH", "LBP", 180_000)] }),
      ),
    ).toThrow(/more than the total/);
    expectNothingWritten(db2);
  });

  it("(g) an account leg with no clientId throws, writing nothing", () => {
    const db = createDb();
    expect(() =>
      bookCustomerLegs(
        db,
        input({
          clientId: null,
          legs: [leg("CASH", "USD", 60), leg("CUSTOMER_ACCOUNT", "USD", 40)],
        }),
      ),
    ).toThrow(/client/i);
    expectNothingWritten(db);
  });

  it("(h) a EUR account leg books its USD equivalent at rate (usd = amount × rate)", () => {
    const db = createDb();
    // Exchange-style: expected 100 EUR, 1 EUR = 1.1 USD.
    const res = bookCustomerLegs(
      db,
      input({
        expected: { amount: 100, currency: "EUR" },
        rate: 1.1,
        legs: [leg("CASH", "EUR", 90), leg("CUSTOMER_ACCOUNT", "EUR", 10)],
      }),
    );
    expect(res.paid).toBe(90);
    expect(res.owed.usd).toBeCloseTo(11, 6);
    expect(res.owed.lbp).toBe(0);
    const debts = rows(db, "debt_ledger");
    expect(debts).toHaveLength(1);
    expect(Number(debts[0].amount_usd)).toBeCloseTo(11, 6);
    // The cash line stays in EUR in the EUR drawer.
    expect(balance(db, "General", "EUR")).toBe(90);
  });

  it("(i) USDT counts 1:1 as USD for the comparison and for the debt", () => {
    const db = createDb();
    // Binance: 100 USDT transfer + $2 fee = 102 expected in USD.
    const res = bookCustomerLegs(
      db,
      input({
        expected: { amount: 102, currency: "USD" },
        legs: [
          leg("BINANCE", "USDT", 80),
          leg("CASH", "USD", 2),
          leg("CUSTOMER_ACCOUNT", "USDT", 20),
        ],
      }),
    );
    expect(res).toEqual({ paid: 82, owed: { usd: 20, lbp: 0 }, forgiven: 0 });
    // The Binance line posts in USDT to the Binance drawer (never converted).
    expect(balance(db, "Binance", "USDT")).toBe(80);
    expect(balance(db, "Binance", "USD")).toBe(0);
    const debts = rows(db, "debt_ledger");
    expect(debts).toHaveLength(1);
    expect(debts[0].amount_usd).toBe(20);

    // A USDT-denominated expected total accepts a forgive within the USD cap.
    const db2 = createDb();
    const res2 = bookCustomerLegs(
      db2,
      input({
        expected: { amount: 100, currency: "USDT" },
        legs: [leg("BINANCE", "USDT", 97)],
        waived: 3,
      }),
    );
    expect(res2.forgiven).toBe(3);
  });

  it("(j) each non-account leg posts a positive payment row to drawerFor(leg) and moves that drawer by the same amount", () => {
    const db = createDb();
    // Whish App $100 + $5 fee: Whish $90 + Cash $5 + OMT 450,000 LBP + Account $5.
    const res = bookCustomerLegs(
      db,
      input({
        expected: { amount: 105, currency: "USD" },
        legs: [
          leg("WHISH", "USD", 90),
          leg("CASH", "USD", 5),
          leg("OMT", "LBP", 450_000),
          leg("CUSTOMER_ACCOUNT", "USD", 5),
        ],
      }),
    );
    expect(res.paid).toBeCloseTo(100, 6);
    expect(res.owed).toEqual({ usd: 5, lbp: 0 });
    const pays = rows(db, "payments");
    expect(
      pays.map((p) => [p.method, p.drawer_name, p.currency_code, p.amount]),
    ).toEqual([
      ["WHISH", "Whish_App", "USD", 90],
      ["CASH", "General", "USD", 5],
      ["OMT", "OMT_App", "LBP", 450_000],
    ]);
    expect(balance(db, "Whish_App", "USD")).toBe(90);
    expect(balance(db, "General", "USD")).toBe(5);
    expect(balance(db, "OMT_App", "LBP")).toBe(450_000);
  });

  it("(k) a non-account leg that moves no drawer (GIFT_CARD) throws, writing nothing", () => {
    const db = createDb();
    expect(() =>
      bookCustomerLegs(
        db,
        input({ legs: [leg("CASH", "USD", 50), leg("GIFT_CARD", "USD", 50)] }),
      ),
    ).toThrow(/GIFT_CARD/);
    expectNothingWritten(db);
  });

  it("(l) books one debt row per currency when account lines are in both USD and LBP", () => {
    const db = createDb();
    bookCustomerLegs(
      db,
      input({
        legs: [
          leg("CASH", "USD", 80),
          leg("CUSTOMER_ACCOUNT", "USD", 10),
          leg("CUSTOMER_ACCOUNT", "USD", 5),
          leg("CUSTOMER_ACCOUNT", "LBP", 450_000),
        ],
      }),
    );
    const debts = rows(db, "debt_ledger");
    expect(debts).toHaveLength(2);
    const usdRow = debts.find((d) => Number(d.amount_usd) > 0);
    const lbpRow = debts.find((d) => Number(d.amount_lbp) > 0);
    expect(usdRow?.amount_usd).toBe(15);
    expect(lbpRow?.amount_lbp).toBe(450_000);
  });

  it("(m) refuses an OUT (change) leg and a mix of two non-USD currencies, writing nothing", () => {
    const db = createDb();
    expect(() =>
      bookCustomerLegs(
        db,
        input({
          legs: [
            leg("CASH", "USD", 100),
            { method: "CASH", currencyCode: "USD", amount: 5, direction: "OUT" },
          ],
        }),
      ),
    ).toThrow(/change/i);
    expectNothingWritten(db);

    const db2 = createDb();
    expect(() =>
      bookCustomerLegs(
        db2,
        input({
          expected: { amount: 100, currency: "EUR" },
          rate: 1.1,
          legs: [leg("CASH", "EUR", 50), leg("CASH", "LBP", 1_000_000)],
        }),
      ),
    ).toThrow(/currenc/i);
    expectNothingWritten(db2);
  });
});
