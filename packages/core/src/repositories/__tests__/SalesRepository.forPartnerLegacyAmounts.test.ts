/**
 * SalesRepository — FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §3 slice 2
 * (the Sales decision).
 *
 * Every OTHER repo in this plan (Custom Services, Financial Services,
 * Recharge) has a separate legacy single-payment METHOD field
 * (`paid_by`/`paidByMethod`/`cashoutMethod`/`paid_by_method`) that the
 * FOR-partner counter-payment guard used to never inspect — a stale
 * "CUSTOMER_ACCOUNT" left over from before the operator ticked the partner
 * checkbox sailed through silently. Sales is different in kind:
 * `sale.payment_usd`/`sale.payment_lbp` are legacy AMOUNTS, not a method
 * code — "CUSTOMER_ACCOUNT" cannot appear there.
 *
 * THE QUESTION this file answers empirically: does a non-zero legacy
 * `payment_usd`/`payment_lbp` on a FOR-partner sale slip past
 * `assertNoCounterPayment` the same way the other repos' method fields did?
 *
 * THE ANSWER: no gap exists, and this file proves it against the CURRENT,
 * UNMODIFIED `SalesRepository.ts` (no source change accompanies this test —
 * see the comment at the `assertNoCounterPayment` call site,
 * ~SalesRepository.ts:809). `paymentLines` (the array that gets split into
 * `inLegs`/`outLegs` and fed to the guard) synthesizes a `"CASH"` leg from
 * `payment_usd`/`payment_lbp` whenever `sale.payments` is empty/absent —
 * this is EVERY case that reaches the FOR-partner branch with a legacy
 * amount actually in play (a non-empty `sale.payments` array takes
 * precedence and makes the legacy fields inert everywhere in this repo, not
 * just under FOR — pre-existing, partner-mode-independent behavior). So the
 * existing `inLegs.length > 0` check ALREADY catches a non-zero legacy
 * amount; there is nothing to wire into the guard's `legacyPaidBy` parameter
 * for Sales.
 */

import Database from "better-sqlite3";
import { SalesRepository } from "../SalesRepository.js";
import { resetTransactionRepository } from "../TransactionRepository.js";
import { resetPartnerRepository } from "../PartnerRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL
    );

    CREATE TABLE clients (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name       TEXT NOT NULL,
      phone_number    TEXT,
      whatsapp_opt_in INTEGER DEFAULT 0,
      tenant_id       INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at      TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE products (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      name           TEXT NOT NULL,
      cost_price_usd REAL NOT NULL DEFAULT 0,
      stock_quantity INTEGER NOT NULL DEFAULT 0,
      tenant_id      INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE sales (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id              INTEGER,
      total_amount_usd       REAL NOT NULL DEFAULT 0,
      discount_usd           REAL NOT NULL DEFAULT 0,
      final_amount_usd       REAL NOT NULL DEFAULT 0,
      paid_usd               REAL NOT NULL DEFAULT 0,
      paid_lbp               REAL NOT NULL DEFAULT 0,
      change_given_usd       REAL NOT NULL DEFAULT 0,
      change_given_lbp       REAL NOT NULL DEFAULT 0,
      exchange_rate_snapshot REAL,
      drawer_name            TEXT DEFAULT 'General',
      status                 TEXT NOT NULL DEFAULT 'completed',
      note                   TEXT,
      tenant_id              INTEGER NOT NULL DEFAULT 1,
      created_at             TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at             TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE sale_items (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id                 INTEGER NOT NULL,
      product_id              INTEGER,
      quantity                INTEGER NOT NULL DEFAULT 1,
      sold_price_usd          REAL NOT NULL DEFAULT 0,
      cost_price_snapshot_usd REAL NOT NULL DEFAULT 0,
      imei                    TEXT,
      is_refunded             INTEGER NOT NULL DEFAULT 0,
      refunded_quantity       INTEGER NOT NULL DEFAULT 0,
      tenant_id               INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE partners (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      name                TEXT NOT NULL UNIQUE,
      phone               TEXT,
      notes               TEXT,
      is_active           INTEGER NOT NULL DEFAULT 1,
      system_association  TEXT,
      tenant_id           INTEGER NOT NULL DEFAULT 1,
      created_at          TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at          TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE partner_ledger (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id        INTEGER NOT NULL REFERENCES partners(id),
      transaction_type  TEXT NOT NULL,
      reference_table   TEXT,
      reference_id      INTEGER,
      amount            REAL NOT NULL,
      currency          TEXT NOT NULL DEFAULT 'USD',
      direction         TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      notes             TEXT,
      user_id           INTEGER REFERENCES users(id),
      settlement_method TEXT,
      tenant_id         INTEGER NOT NULL DEFAULT 1,
      created_at        TEXT DEFAULT CURRENT_TIMESTAMP,
      covered_amount    REAL NOT NULL DEFAULT 0
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

    CREATE TABLE drawer_balances (
      tenant_id     INTEGER NOT NULL DEFAULT 1,
      drawer_name   TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance       REAL NOT NULL DEFAULT 0,
      updated_at    TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance, updated_at) VALUES (1, 'General', 'USD', 500, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance, updated_at) VALUES (1, 'General', 'LBP', 20000000, CURRENT_TIMESTAMP);

    CREATE TABLE debt_ledger (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd       REAL NOT NULL DEFAULT 0,
      amount_lbp       REAL NOT NULL DEFAULT 0,
      transaction_id   INTEGER,
      note             TEXT,
      due_date         TEXT,
      tenant_id        INTEGER NOT NULL DEFAULT 1,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare(`INSERT INTO users (id, username) VALUES (1, 'cashier')`).run();
  db.prepare(
    `INSERT INTO products (id, name, cost_price_usd, stock_quantity)
     VALUES (1, 'Charger', 5, 100)`,
  ).run();
  return db;
}

function seedPartner(db: Database.Database, name = "TestPartner"): number {
  return Number(
    db.prepare("INSERT INTO partners (name) VALUES (?)").run(name)
      .lastInsertRowid,
  );
}

function saleCount(db: Database.Database): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM sales`).get() as { n: number })
    .n;
}

function partnerLedgerRows(db: Database.Database, partnerId: number) {
  return db
    .prepare("SELECT * FROM partner_ledger WHERE partner_id = ? ORDER BY id")
    .all(partnerId) as Array<{ direction: string; amount: number }>;
}

describe("SalesRepository — §3 slice 2: the Sales decision (legacy payment_usd/payment_lbp AMOUNTS, not a method field)", () => {
  let db: Database.Database;
  let repo: SalesRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    resetPartnerRepository();
    repo = new SalesRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetPartnerRepository();
    resetTenantContext();
  });

  // rule 17 note: this is a LOCK-IN test, not a regression guard for a code
  // change — no source edit accompanies it (see SalesRepository.ts's comment
  // at the assertNoCounterPayment call site). It is run here against the
  // CURRENT, unmodified repository and observed to PASS, which is itself the
  // proof that no gap exists: a non-zero legacy `payment_usd` on a
  // FOR-partner sale (no `payments` array at all — the true legacy shape)
  // is already rejected by the existing `inLegs.length > 0` check, because
  // `paymentLines` synthesizes a CASH leg from `payment_usd`/`payment_lbp`
  // whenever `sale.payments` is empty/absent.
  it("rejects a non-zero legacy payment_usd on a FOR-partner sale — already caught by the existing inLegs check (no payments[] array at all)", () => {
    const partnerId = seedPartner(db);
    const before = saleCount(db);

    const result = repo.processSale(
      {
        client_id: null,
        partnerId,
        partnerMode: "FOR",
        items: [{ product_id: 1, quantity: 1, price: 100 }],
        total_amount: 100,
        discount: 0,
        final_amount: 100,
        // The true legacy shape: no `payments` array at all, just the old
        // single-total fields — exactly what a pre-split-payment caller (or
        // a stale value left over from before the operator ticked "For
        // Partner") would send.
        payment_usd: 40,
        payment_lbp: 0,
        exchange_rate: 90000,
      },
      1,
    );

    expect(result.success).toBe(false);
    expect(result.error ?? "").toMatch(/no counter payment/i);
    expect(saleCount(db)).toBe(before);
  });

  it("rejects a non-zero legacy payment_lbp on a FOR-partner sale too (both currencies covered)", () => {
    const partnerId = seedPartner(db);

    const result = repo.processSale(
      {
        client_id: null,
        partnerId,
        partnerMode: "FOR",
        items: [{ product_id: 1, quantity: 1, price: 100 }],
        total_amount: 100,
        discount: 0,
        final_amount: 100,
        payment_usd: 0,
        payment_lbp: 3_600_000,
        exchange_rate: 90000,
      },
      1,
    );

    expect(result.success).toBe(false);
    expect(result.error ?? "").toMatch(/no counter payment/i);
  });

  it("control: a legitimate FOR-partner sale (legacy amounts zeroed, no payments[]) still succeeds and books the full amount to partner_ledger", () => {
    const partnerId = seedPartner(db);
    const generalBefore = (
      db
        .prepare(
          `SELECT balance FROM drawer_balances WHERE drawer_name='General' AND currency_code='USD'`,
        )
        .get() as { balance: number }
    ).balance;

    const result = repo.processSale(
      {
        client_id: null,
        partnerId,
        partnerMode: "FOR",
        items: [{ product_id: 1, quantity: 1, price: 100 }],
        total_amount: 100,
        discount: 0,
        final_amount: 100,
        payment_usd: 0,
        payment_lbp: 0,
        payments: [],
        exchange_rate: 90000,
      },
      1,
    );

    expect(result.success).toBe(true);
    const generalAfter = (
      db
        .prepare(
          `SELECT balance FROM drawer_balances WHERE drawer_name='General' AND currency_code='USD'`,
        )
        .get() as { balance: number }
    ).balance;
    expect(generalAfter).toBe(generalBefore); // no walk-in cash

    const entries = partnerLedgerRows(db, partnerId);
    expect(entries).toHaveLength(1);
    expect(entries[0].direction).toBe("DEBIT");
    expect(entries[0].amount).toBeCloseTo(100, 2);
  });
});
