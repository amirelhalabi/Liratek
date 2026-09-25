/**
 * NOT RUN — proven at the end-of-batch gate.
 *
 * CustomServiceRepository — OWNER_NOTES_REMAINING_BUILD.md #16 "Pay out"
 * tests (Route A, migration v185, Syria transfer OUT).
 *
 * "Pay out" is NOT a third partner mode — it is `partner_mode: 'VIA'` with
 * `direction: 'OUT'` instead of the default 'IN'. Owner example: $100
 * arrives via the partner, the customer/recipient gets $97 cash, $3 is
 * profit (commission), same day.
 *   - price_usd/price_lbp = what the PARTNER now owes the shop (booked as a
 *     THROUGH_CUSTOM_SERVICE partner_ledger DEBIT — "partner owes us").
 *   - cost_usd/cost_lbp = what physically leaves the General drawer to the
 *     recipient, CASH only (owner: "Syria never touches the Whish system
 *     drawer").
 *   - profit_usd/profit_lbp stays price − cost (unchanged formula).
 *
 * Mirrors CustomServiceRepository.viaPartner.test.ts's in-memory schema and
 * mocking pattern verbatim (same table set is sufficient for this
 * createService -> deleteService(void) round trip), plus the `direction`
 * column migration v185 adds to `custom_services`.
 */

import Database from "better-sqlite3";
import { CustomServiceRepository } from "../CustomServiceRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE custom_services (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      cost_usd REAL NOT NULL DEFAULT 0,
      cost_lbp REAL NOT NULL DEFAULT 0,
      price_usd REAL NOT NULL DEFAULT 0,
      price_lbp REAL NOT NULL DEFAULT 0,
      profit_usd REAL,
      profit_lbp REAL,
      paid_by TEXT NOT NULL DEFAULT 'CASH',
      status TEXT NOT NULL DEFAULT 'completed',
      client_id INTEGER,
      client_name TEXT,
      phone_number TEXT,
      note TEXT,
      category TEXT,
      created_by INTEGER,
      edited_by TEXT,
      edited_at DATETIME,
      is_refunded INTEGER DEFAULT 0,
      refunded_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      product_id INTEGER,
      partner_mode TEXT,
      fulfillment_status TEXT,
      fulfilled_at TEXT,
      direction TEXT NOT NULL DEFAULT 'IN'
    );

    CREATE TABLE partners (
      tenant_id INTEGER DEFAULT 1,
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      name               TEXT NOT NULL UNIQUE,
      phone              TEXT,
      notes              TEXT,
      is_active          INTEGER NOT NULL DEFAULT 1,
      system_association TEXT,
      created_at         TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at         TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE partner_ledger (
      tenant_id INTEGER DEFAULT 1,
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id        INTEGER NOT NULL REFERENCES partners(id),
      transaction_type  TEXT,
      reference_table   TEXT,
      reference_id      INTEGER,
      amount            REAL NOT NULL,
      currency          TEXT NOT NULL DEFAULT 'USD',
      direction         TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      covered_amount    REAL NOT NULL DEFAULT 0,
      notes             TEXT,
      user_id           INTEGER,
      settlement_method TEXT,
      created_at        TEXT DEFAULT CURRENT_TIMESTAMP
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

    -- Empty on purpose: _cancelDebt (run by every void/refund, via
    -- deleteService -> voidTransaction) queries this table unconditionally
    -- with no existence check. The payout branch never books client debt.
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
    , refunded_at TEXT DEFAULT NULL);

    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 0);
    -- A payout must never touch the Whish system drawer (owner decision) —
    -- seeded so a bug routing there would show up as a non-zero balance
    -- instead of a missing-row false negative.
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Whish_System', 'USD', 0);
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

function seedPartner(db: Database.Database, name = "Syria Partner"): number {
  const res = db
    .prepare("INSERT INTO partners (name, is_active) VALUES (?, 1)")
    .run(name);
  return Number(res.lastInsertRowid);
}

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

function partnerLedgerRows(db: Database.Database, partnerId: number) {
  return db
    .prepare(
      "SELECT transaction_type, direction, amount, currency, reference_table, reference_id FROM partner_ledger WHERE partner_id = ? ORDER BY id ASC",
    )
    .all(partnerId) as Array<{
    transaction_type: string | null;
    direction: "DEBIT" | "CREDIT";
    amount: number;
    currency: string;
    reference_table: string | null;
    reference_id: number | null;
  }>;
}

function netByCurrency(
  rows: Array<{
    direction: "DEBIT" | "CREDIT";
    amount: number;
    currency: string;
  }>,
  currency: string,
): number {
  // Net from the shop's own receivable perspective: DEBIT = partner owes us
  // more, CREDIT = less — a create+reverse pair must net to 0 regardless of
  // which direction started it.
  return rows
    .filter((r) => r.currency === currency)
    .reduce(
      (sum, r) => sum + (r.direction === "DEBIT" ? r.amount : -r.amount),
      0,
    );
}

describe("CustomServiceRepository.createService() — payout (OWNER_NOTES_REMAINING_BUILD.md #16)", () => {
  let db: Database.Database;
  let repo: CustomServiceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    repo = new CustomServiceRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  it("owner example: $100 arrives, customer gets $97, $3 profit — booked same day", () => {
    const partnerId = seedPartner(db);

    const result = repo.createService(
      {
        description: "Syria transfer payout",
        price_usd: 100,
        cost_usd: 97,
        partnerId,
        partnerMode: "VIA",
        direction: "OUT",
      } as any,
      1,
    );

    expect(result.success).toBe(true);

    // The recipient's cash left the General drawer, CASH method, exactly
    // $97 — never the $100 face amount.
    expect(balance(db, "General", "USD")).toBeCloseTo(-97, 2);
    // Owner: "Syria never touches the Whish system drawer."
    expect(balance(db, "Whish_System", "USD")).toBeCloseTo(0, 2);

    const payments = db
      .prepare(
        "SELECT method, drawer_name, currency_code, amount FROM payments",
      )
      .all() as Array<{
      method: string;
      drawer_name: string;
      currency_code: string;
      amount: number;
    }>;
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      method: "CASH",
      drawer_name: "General",
      currency_code: "USD",
      amount: -97,
    });

    // Partner ledger: ONE THROUGH_CUSTOM_SERVICE DEBIT for the full $100
    // that "arrived" — never the $97 payout.
    const entries = partnerLedgerRows(db, partnerId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      transaction_type: "THROUGH_CUSTOM_SERVICE",
      direction: "DEBIT",
      currency: "USD",
      reference_table: "custom_services",
    });
    expect(entries[0].amount).toBeCloseTo(100, 2);

    // Commission ($3) is profit, stamped on create — same day, no deferral.
    const txn = db
      .prepare("SELECT * FROM transactions WHERE type = 'CUSTOM_SERVICE'")
      .get() as any;
    expect(txn.profit_usd).toBeCloseTo(3, 2);
    // The unified row's face amount is what physically moved (the payout),
    // matching every other payout type's convention (e.g. the recharge
    // buy-back stamps amount_usd from its own payout, not the credits
    // gained).
    expect(txn.amount_usd).toBeCloseTo(97, 2);

    const serviceId = (
      db.prepare("SELECT id FROM custom_services").get() as any
    ).id;
    const entity = repo.getById(serviceId);
    expect(entity?.direction).toBe("OUT");
    expect(entity?.partner_mode).toBe("VIA");
  });

  it("splits USD+LBP independently, mirroring the IN flow's own per-currency booking", () => {
    const partnerId = seedPartner(db);

    repo.createService(
      {
        description: "Mixed payout",
        price_usd: 20,
        price_lbp: 1_000_000,
        cost_usd: 18,
        cost_lbp: 950_000,
        partnerId,
        partnerMode: "VIA",
        direction: "OUT",
      } as any,
      1,
    );

    expect(balance(db, "General", "USD")).toBeCloseTo(-18, 2);
    expect(balance(db, "General", "LBP")).toBeCloseTo(-950_000, 0);

    const entries = partnerLedgerRows(db, partnerId);
    expect(entries).toHaveLength(2);
    const usdEntry = entries.find((e) => e.currency === "USD")!;
    const lbpEntry = entries.find((e) => e.currency === "LBP")!;
    expect(usdEntry.amount).toBeCloseTo(20, 2); // price (arrived), not cost
    expect(lbpEntry.amount).toBeCloseTo(1_000_000, 0);
    expect(usdEntry.direction).toBe("DEBIT");
    expect(lbpEntry.direction).toBe("DEBIT");
  });

  it("rejects direction 'OUT' without partnerMode 'VIA' — repository-level defense in depth (I2)", () => {
    // The Zod refine already rejects this shape at the edge on both
    // transports; this proves the repository ALSO refuses it independently
    // (a raw repository call, or an older schema, must not silently fall
    // through to the ordinary IN flow while `custom_services.direction`
    // still ends up "OUT" — issue I2a's contradictory row).
    const result = repo.createService(
      {
        description: "No partner mode payout",
        price_usd: 100,
        cost_usd: 97,
        direction: "OUT",
      } as any,
      1,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/only valid for a Via-Partner/);
    expect(
      (db.prepare("SELECT COUNT(*) c FROM custom_services").get() as any).c,
    ).toBe(0);
  });

  it("rejects direction 'OUT' under partnerMode 'FOR' — repository-level defense in depth (I2)", () => {
    const partnerId = seedPartner(db);
    const result = repo.createService(
      {
        description: "FOR-mode payout",
        price_usd: 100,
        cost_usd: 97,
        partnerId,
        partnerMode: "FOR",
        direction: "OUT",
      } as any,
      1,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/only valid for a Via-Partner/);
  });

  it("ignores kept_change on a payout — no tender to make change from (I5)", () => {
    const partnerId = seedPartner(db);

    repo.createService(
      {
        description: "Payout with stale kept_change",
        price_usd: 100,
        cost_usd: 97,
        kept_change_usd: 5,
        partnerId,
        partnerMode: "VIA",
        direction: "OUT",
      } as any,
      1,
    );

    const txn = db
      .prepare("SELECT * FROM transactions WHERE type = 'CUSTOM_SERVICE'")
      .get() as any;
    // Commission stays exactly price - cost ($3) — the stale $5 kept_change
    // must not inflate it to $8.
    expect(txn.profit_usd).toBeCloseTo(3, 2);
  });

  it("passes transaction_time through as the partner ledger row's created_at (I5)", () => {
    const partnerId = seedPartner(db);
    const backdated = "2026-01-15T10:00:00.000Z";

    repo.createService(
      {
        description: "Backdated payout",
        price_usd: 100,
        cost_usd: 97,
        partnerId,
        partnerMode: "VIA",
        direction: "OUT",
        transaction_time: backdated,
      } as any,
      1,
    );

    const row = db
      .prepare(
        "SELECT created_at FROM partner_ledger WHERE partner_id = ?",
      )
      .get(partnerId) as { created_at: string };
    expect(row.created_at).toBe(backdated);
  });

  it("rejects a payout with no partnerId", () => {
    const result = repo.createService(
      {
        description: "Missing partner payout",
        price_usd: 100,
        cost_usd: 97,
        partnerMode: "VIA",
        direction: "OUT",
      } as any,
      1,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/partnerId is required/);
    expect(
      (db.prepare("SELECT COUNT(*) c FROM custom_services").get() as any).c,
    ).toBe(0);
    expect(
      (db.prepare("SELECT COUNT(*) c FROM partner_ledger").get() as any).c,
    ).toBe(0);
  });

  it("rejects a payout carrying a stale payments[] leg (fix-round I3 — reject, don't ignore)", () => {
    // Defense in depth, same shape as the isForPartner branch's own
    // assertNoCounterPayment call: a payout never takes a counter leg from
    // data.payments — a leftover leg from before the operator toggled "Pay
    // out" on must be REJECTED, not silently dropped while the correct
    // synthetic CASH/General leg posts underneath it.
    const partnerId = seedPartner(db);

    const result = repo.createService(
      {
        description: "Stale leg payout",
        price_usd: 50,
        cost_usd: 48,
        payments: [{ method: "WHISH", currency_code: "USD", amount: 48 }],
        partnerId,
        partnerMode: "VIA",
        direction: "OUT",
      } as any,
      1,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no counter payment/i);
    expect(
      (db.prepare("SELECT COUNT(*) c FROM custom_services").get() as any).c,
    ).toBe(0);
    expect(
      (db.prepare("SELECT COUNT(*) c FROM payments").get() as any).c,
    ).toBe(0);
  });

  it("rejects a payout carrying a stale non-CASH paid_by (fix-round I3 — reject, don't ignore)", () => {
    const partnerId = seedPartner(db);

    const result = repo.createService(
      {
        description: "Stale paid_by payout",
        price_usd: 50,
        cost_usd: 48,
        paid_by: "WHISH",
        partnerId,
        partnerMode: "VIA",
        direction: "OUT",
      } as any,
      1,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no counter payment/i);
  });

  it("posts CASH/General from a clean payout submission (paid_by defaults to CASH, no legs)", () => {
    const partnerId = seedPartner(db);

    const result = repo.createService(
      {
        description: "Clean payout",
        price_usd: 50,
        cost_usd: 48,
        partnerId,
        partnerMode: "VIA",
        direction: "OUT",
      } as any,
      1,
    );

    expect(result.success).toBe(true);
    const payments = db
      .prepare("SELECT method, drawer_name FROM payments")
      .all() as Array<{ method: string; drawer_name: string }>;
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ method: "CASH", drawer_name: "General" });
  });

  it("create -> void nets partner_ledger AND the drawer to 0, per currency (rule 20)", () => {
    const partnerId = seedPartner(db);
    const usdBefore = balance(db, "General", "USD");

    repo.createService(
      {
        description: "Void me (payout)",
        price_usd: 100,
        cost_usd: 97,
        partnerId,
        partnerMode: "VIA",
        direction: "OUT",
      } as any,
      1,
    );

    const serviceId = (
      db.prepare("SELECT id FROM custom_services").get() as any
    ).id;

    const preVoidEntries = partnerLedgerRows(db, partnerId);
    expect(preVoidEntries).toHaveLength(1);
    expect(preVoidEntries[0].direction).toBe("DEBIT");

    const voidResult = repo.deleteService(serviceId);
    expect(voidResult.success).toBe(true);

    // Drawer: the $97 payout leg reversed back to the pre-transaction
    // baseline.
    expect(balance(db, "General", "USD")).toBeCloseTo(usdBefore, 2);

    // Partner ledger: the generic `_reversePartnerLedger` (type-agnostic,
    // matched by reference_table/reference_id) finds and reverses the
    // THROUGH_CUSTOM_SERVICE DEBIT with a CREDIT — no new reversal code
    // needed, proven here rather than just asserted in a comment.
    const postVoidEntries = partnerLedgerRows(db, partnerId);
    expect(postVoidEntries).toHaveLength(2); // 1 original DEBIT + 1 reversal CREDIT
    expect(netByCurrency(postVoidEntries, "USD")).toBeCloseTo(0, 2);

    const reversalRows = postVoidEntries.filter(
      (r) => r.direction === "CREDIT",
    );
    expect(reversalRows).toHaveLength(1);
    expect(reversalRows[0]).toMatchObject({
      transaction_type: "THROUGH_CUSTOM_SERVICE",
      reference_table: "custom_services",
      reference_id: serviceId,
    });
  });

  it("ordinary Via-Partner IN behaviour is unchanged (regression guard)", () => {
    const partnerId = seedPartner(db);

    const result = repo.createService(
      {
        description: "Regression IN check",
        cost_usd: 4,
        price_usd: 15,
        paid_by: "CASH",
        partnerId,
        partnerMode: "VIA",
        // direction omitted — defaults to "IN" via the Zod schema in
        // production; this test passes it explicitly since it bypasses Zod
        // (`as any`, matching CustomServiceRepository.viaPartner.test.ts's
        // own convention).
        direction: "IN",
      } as any,
      1,
    );

    expect(result.success).toBe(true);
    expect(balance(db, "General", "USD")).toBeCloseTo(15, 2);

    const entries = partnerLedgerRows(db, partnerId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      transaction_type: "THROUGH_CUSTOM_SERVICE",
      direction: "CREDIT",
      currency: "USD",
    });
    expect(entries[0].amount).toBeCloseTo(4, 2); // cost, not price

    const txn = db
      .prepare("SELECT * FROM transactions WHERE type = 'CUSTOM_SERVICE'")
      .get() as any;
    expect(txn.profit_usd).toBeCloseTo(11, 2);
    expect(txn.amount_usd).toBeCloseTo(15, 2); // price, not cost — unchanged
  });
});
