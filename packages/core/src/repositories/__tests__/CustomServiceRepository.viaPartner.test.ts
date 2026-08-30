/**
 * CustomServiceRepository — LIRA-154 "Via Partner" tests
 *
 * D4.1 (owner decision): "Via partner" is the MIRROR of the existing "For
 * Partner" flow. FOR = the partner uses OUR system (no counter payment, the
 * FULL price books to their tab — see CustomServiceRepository.forPartner.test.ts).
 * VIA = the partner PERFORMS the service: the walk-in customer still pays US,
 * now, through the completely unforked normal payment path (legs, drawers,
 * client propagation, kept change); the shop now owes the PARTNER the COST
 * (not the price), booked per currency component as a `THROUGH_CUSTOM_SERVICE`
 * partner_ledger CREDIT. Shop profit is unchanged (price - cost).
 *
 * Test-schema-trap enumeration (top-to-bottom read of
 * CustomServiceRepository.createService + CustomServiceRepository.deleteService,
 * including every helper/repository method they call unconditionally for the
 * paths these tests exercise — no product_id/voucher/CUSTOMER_ACCOUNT paths
 * are exercised, so `products`/voucher tables are intentionally omitted,
 * matching CustomServiceRepository.forPartner.test.ts's own enumeration,
 * which already proves this exact table set is sufficient for the full
 * createService -> deleteService(void) round trip on this repository):
 *   - custom_services   (INSERT by createService; UPDATE status='voided' by
 *                         deleteService; SELECT by _restoreCustomServiceStock,
 *                         a no-op here since product_id is never set)
 *   - partners           (getPartnerRepository().getById / seedPartner FK)
 *   - partner_ledger     (getPartnerRepository().addLedgerEntry; reversed by
 *                         TransactionRepository._reversePartnerLedger)
 *   - drawer_balances    (applyDrawerDelta / the legacy upsertBalance wrapper)
 *   - transactions       (getTransactionRepository().createTransaction;
 *                         voidTransaction's UPDATE + reversal INSERT)
 *   - payments           (insertPaymentRow; reversed by _reversePayments)
 *   - debt_ledger        (empty on purpose — TransactionRepository._cancelDebt
 *                         runs UNCONDITIONALLY on every void with no
 *                         existence check first, per the forPartner test's
 *                         own note; none of these scenarios book client debt)
 */

import Database from "better-sqlite3";
import { CustomServiceRepository } from "../CustomServiceRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

// ─── In-memory schema (identical to CustomServiceRepository.forPartner.test.ts) ──

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
      fulfilled_at TEXT
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
    -- with no existence check. None of these scenarios book client debt.
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
  `);

  return db;
}

// ─── Mock the connection module ────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seedPartner(db: Database.Database, name = "Repair Partner"): number {
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
  return rows
    .filter((r) => r.currency === currency)
    .reduce(
      (sum, r) => sum + (r.direction === "DEBIT" ? -r.amount : r.amount),
      0,
    );
  // NOTE: netByCurrency sums signed from the SHOP's own liability
  // perspective (CREDIT = we owe more, DEBIT = they owe more) purely so a
  // round-trip nets to 0 regardless of which side started it — the sign
  // convention itself is asserted directly in the CREDIT-booking tests below.
}

describe("CustomServiceRepository.createService() — via-partner (LIRA-154)", () => {
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

  it("books a partner CREDIT of the COST while the drawer receives the PRICE (USD, legacy no-legs path)", () => {
    const partnerId = seedPartner(db);

    const result = repo.createService(
      {
        description: "Screen repair via partner",
        cost_usd: 4,
        price_usd: 15,
        paid_by: "CASH",
        partnerId,
        partnerMode: "VIA",
      } as any,
      1,
    );

    expect(result.success).toBe(true);

    // The walk-in customer's price was collected for real, exactly like an
    // ordinary (non-partner) custom service.
    expect(balance(db, "General", "USD")).toBeCloseTo(15, 2);

    // Exactly one partner_ledger row: THROUGH_CUSTOM_SERVICE CREDIT for the
    // COST (4), never the price (15).
    const entries = partnerLedgerRows(db, partnerId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      transaction_type: "THROUGH_CUSTOM_SERVICE",
      direction: "CREDIT",
      currency: "USD",
      reference_table: "custom_services",
    });
    expect(entries[0].amount).toBeCloseTo(4, 2);

    const txn = db
      .prepare("SELECT * FROM transactions WHERE type = 'CUSTOM_SERVICE'")
      .get() as any;
    expect(txn.profit_usd).toBeCloseTo(11, 2); // price - cost, unchanged

    // partner_mode persisted AND exposed through getColumns()'s projection.
    const serviceId = (
      db.prepare("SELECT id FROM custom_services").get() as any
    ).id;
    expect(repo.getById(serviceId)?.partner_mode).toBe("VIA");
  });

  it("books BOTH currency components separately for a mixed USD+LBP price/cost", () => {
    const partnerId = seedPartner(db);

    repo.createService(
      {
        description: "Mixed via job",
        cost_usd: 1,
        cost_lbp: 300_000,
        price_usd: 5,
        price_lbp: 200_000,
        paid_by: "CASH",
        partnerId,
        partnerMode: "VIA",
      } as any,
      1,
    );

    expect(balance(db, "General", "USD")).toBeCloseTo(5, 2);
    expect(balance(db, "General", "LBP")).toBeCloseTo(200_000, 0);

    const entries = partnerLedgerRows(db, partnerId);
    expect(entries).toHaveLength(2);
    const usdEntry = entries.find((e) => e.currency === "USD")!;
    const lbpEntry = entries.find((e) => e.currency === "LBP")!;
    expect(usdEntry.amount).toBeCloseTo(1, 2); // cost, not price
    expect(lbpEntry.amount).toBeCloseTo(300_000, 0); // cost, not price
    expect(usdEntry.transaction_type).toBe("THROUGH_CUSTOM_SERVICE");
    expect(lbpEntry.transaction_type).toBe("THROUGH_CUSTOM_SERVICE");
    expect(usdEntry.direction).toBe("CREDIT");
    expect(lbpEntry.direction).toBe("CREDIT");
  });

  it("rejects a via-partner service with no partnerId", () => {
    const result = repo.createService(
      {
        description: "Missing partner via",
        price_usd: 10,
        partnerMode: "VIA",
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

  it("does not double-debit an OUT/change leg (rule 16)", () => {
    const partnerId = seedPartner(db);
    const usdBefore = balance(db, "General", "USD");
    const lbpBefore = balance(db, "General", "LBP");

    // Service priced at 900,000 LBP (cost 500,000 LBP, owed to the partner).
    // Customer hands $20 cash (~1.8M at 90k) and receives 900,000 LBP change.
    const result = repo.createService(
      {
        description: "Via job with change",
        cost_usd: 0,
        cost_lbp: 500_000,
        price_usd: 0,
        price_lbp: 900_000,
        partnerId,
        partnerMode: "VIA",
        payments: [
          { method: "CASH", currency_code: "USD", amount: 20 },
          {
            method: "CASH",
            currency_code: "LBP",
            amount: 900_000,
            direction: "OUT",
          },
        ],
      } as any,
      1,
    );

    expect(result.success).toBe(true);

    // A bug that iterated the OUT/change leg a SECOND time (e.g. a naive
    // second end-of-transaction loop) would leave LBP at -1,800,000 instead
    // of -900,000 — the shared leg loop must run exactly once.
    expect(balance(db, "General", "USD")).toBeCloseTo(usdBefore + 20, 2);
    expect(balance(db, "General", "LBP")).toBeCloseTo(lbpBefore - 900_000, 2);

    const payments = db
      .prepare(
        "SELECT method, currency_code, amount FROM payments ORDER BY id ASC",
      )
      .all() as Array<{
      method: string;
      currency_code: string;
      amount: number;
    }>;
    expect(payments).toHaveLength(2);
    expect(payments[0]).toMatchObject({ currency_code: "USD", amount: 20 });
    expect(payments[1]).toMatchObject({
      currency_code: "LBP",
      amount: -900_000,
    });

    // The partner still gets the COST credit (500,000 LBP), independent of
    // the leg loop above — this repository never iterates `data.payments`
    // for the partner-ledger booking, so there is no way for it to disturb
    // (or be disturbed by) the leg reconciliation.
    const entries = partnerLedgerRows(db, partnerId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      transaction_type: "THROUGH_CUSTOM_SERVICE",
      direction: "CREDIT",
      currency: "LBP",
    });
    expect(entries[0].amount).toBeCloseTo(500_000, 0);
  });

  it("create -> void nets partner_ledger AND every drawer to 0, per currency (rule 20)", () => {
    const partnerId = seedPartner(db);
    const usdBefore = balance(db, "General", "USD");
    const lbpBefore = balance(db, "General", "LBP");

    repo.createService(
      {
        description: "Void me (via partner)",
        cost_usd: 3,
        cost_lbp: 500_000,
        price_usd: 0,
        price_lbp: 900_000,
        partnerId,
        partnerMode: "VIA",
        payments: [
          { method: "CASH", currency_code: "USD", amount: 20 },
          {
            method: "CASH",
            currency_code: "LBP",
            amount: 900_000,
            direction: "OUT",
          },
        ],
      } as any,
      1,
    );

    const serviceId = (
      db.prepare("SELECT id FROM custom_services").get() as any
    ).id;

    // Sanity: the CREDIT rows exist pre-void (both currencies).
    const preVoidEntries = partnerLedgerRows(db, partnerId);
    expect(preVoidEntries).toHaveLength(2);

    const voidResult = repo.deleteService(serviceId);
    expect(voidResult.success).toBe(true);

    // Drawer: every leg (the $20 IN and the 900,000 LBP OUT/change) reversed
    // back to the pre-transaction baseline, in both currencies.
    expect(balance(db, "General", "USD")).toBeCloseTo(usdBefore, 2);
    expect(balance(db, "General", "LBP")).toBeCloseTo(lbpBefore, 2);

    // Partner ledger: `TransactionRepository._reversePartnerLedger` matches
    // by reference_table/reference_id (not transaction_type), so it finds
    // and reverses the THROUGH_CUSTOM_SERVICE rows with NO new reversal code
    // needed — proven here, not just asserted in a comment.
    const postVoidEntries = partnerLedgerRows(db, partnerId);
    expect(postVoidEntries).toHaveLength(4); // 2 original CREDIT + 2 reversal DEBIT
    expect(netByCurrency(postVoidEntries, "USD")).toBeCloseTo(0, 2);
    expect(netByCurrency(postVoidEntries, "LBP")).toBeCloseTo(0, 0);

    // Every reversal row is a DEBIT (the original CREDIT's opposite) and
    // still carries the THROUGH_CUSTOM_SERVICE type + the same reference.
    const reversalRows = postVoidEntries.filter((r) => r.direction === "DEBIT");
    expect(reversalRows).toHaveLength(2);
    for (const r of reversalRows) {
      expect(r.transaction_type).toBe("THROUGH_CUSTOM_SERVICE");
      expect(r.reference_table).toBe("custom_services");
      expect(r.reference_id).toBe(serviceId);
    }
  });

  it("FOR-partner behaviour is unchanged (regression guard)", () => {
    const partnerId = seedPartner(db, "For Partner Co");

    const result = repo.createService(
      {
        description: "Regression FOR check",
        cost_usd: 2,
        price_usd: 10,
        partnerId,
        partnerMode: "FOR",
      } as any,
      1,
    );

    expect(result.success).toBe(true);

    // §2 FINAL SPEC unchanged: no drawer movement at all under FOR.
    expect(balance(db, "General", "USD")).toBeCloseTo(0, 2);

    const entries = partnerLedgerRows(db, partnerId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      transaction_type: "FOR_CUSTOM_SERVICE",
      direction: "DEBIT",
      currency: "USD",
    });
    expect(entries[0].amount).toBeCloseTo(10, 2); // the PRICE, not the cost

    const serviceId = (
      db.prepare("SELECT id FROM custom_services").get() as any
    ).id;
    expect(repo.getById(serviceId)?.partner_mode).toBe("FOR");
  });
});
