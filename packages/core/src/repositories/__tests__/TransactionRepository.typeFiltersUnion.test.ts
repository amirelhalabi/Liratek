/**
 * TransactionRepository.getRecent — multi-select Type filter (`typeFilters`)
 * union semantics.
 *
 * The Transactions page's Type filter moved from single-select to
 * multi-select. Selecting "Whish App Send" + "Katsh Bills" must return the
 * UNION of both tuples via SQL — not just the first tuple, and not every
 * FINANCIAL_SERVICE row regardless of provider/service_type/item_key. This
 * proves the repository builds `(tupleA) OR (tupleB)`, ANDed with tenant
 * scoping and every other filter, against a REAL in-memory SQLite DB (no
 * mocks — the query itself is what's under test).
 *
 * Rule 17 (CLAUDE.md): "ORs two tuples together and excludes a third,
 * unselected combination" below was run against a deliberately reverted
 * getRecent() that only ever applied `filters.typeFilters[0]` (dropping
 * every tuple past the first instead of OR-ing the whole array) and was
 * observed to FAIL — the "Katsh Bills" row never came back, collapsing the
 * union to a single-tuple filter — before the revert was undone. See the
 * task notes for the exact failure output.
 */
import Database from "better-sqlite3";
import { TransactionRepository } from "../TransactionRepository.js";
import { runWithTenant } from "../../db/tenantContext.js";

const D = "2026-01-15 10:00:00";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      username  TEXT NOT NULL
    );

    CREATE TABLE clients (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id    INTEGER,
      full_name    TEXT,
      phone_number TEXT
    );

    CREATE TABLE transactions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id     INTEGER,
      type          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table  TEXT NOT NULL,
      source_id     INTEGER NOT NULL,
      user_id       INTEGER NOT NULL,
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
      created_at    TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id      INTEGER,
      transaction_id INTEGER,
      session_id     INTEGER,
      method         TEXT NOT NULL,
      drawer_name    TEXT NOT NULL,
      currency_code  TEXT NOT NULL,
      amount         REAL NOT NULL,
      note           TEXT,
      created_by     INTEGER,
      created_at     TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Only needs to exist for getRecent()'s LEFT JOIN — no rows required.
    CREATE TABLE customer_session_transactions (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id              INTEGER,
      session_id             INTEGER NOT NULL,
      unified_transaction_id INTEGER
    );

    -- Only needs to exist for _attachPaymentLegs()'s CUSTOMER_ACCOUNT leg
    -- reconstruction — no rows required for these tests.
    CREATE TABLE debt_ledger (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER,
      transaction_type TEXT,
      amount_usd       REAL NOT NULL DEFAULT 0,
      amount_lbp       REAL NOT NULL DEFAULT 0,
      transaction_id   INTEGER,
      session_id       INTEGER,
      note             TEXT,
      created_by       INTEGER,
      tenant_id        INTEGER,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
      is_refunded      INTEGER DEFAULT 0,
      refunded_at      TEXT DEFAULT NULL
    );
  `);
  return db;
}

function seedTxn(
  db: Database.Database,
  opts: {
    tenantId: number;
    type: string;
    sourceId: number;
    metadata?: Record<string, unknown>;
  },
): number {
  const result = db
    .prepare(
      `INSERT INTO transactions
         (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, metadata_json, created_at)
       VALUES (?, ?, 'ACTIVE', 'financial_services', ?, 1, 10, 0, ?, ?)`,
    )
    .run(
      opts.tenantId,
      opts.type,
      opts.sourceId,
      opts.metadata ? JSON.stringify(opts.metadata) : null,
      D,
    );
  return Number(result.lastInsertRowid);
}

describe("TransactionRepository.getRecent — typeFilters union (multi-select Type filter)", () => {
  let db: Database.Database;
  let repo: TransactionRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    repo = new TransactionRepository();

    db.prepare(
      `INSERT INTO users (id, tenant_id, username) VALUES (1, 1, 'alice')`,
    ).run();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
  });

  it("ORs two tuples together and excludes a third, unselected combination", () => {
    // "Whish App Send" — type + provider + service_type, no item_key.
    const whishSendId = seedTxn(db, {
      tenantId: 1,
      type: "FINANCIAL_SERVICE",
      sourceId: 1,
      metadata: { provider: "WHISH_APP", service_type: "SEND" },
    });
    // "Katsh Bills" — type + provider + has_item_key, no service_type.
    const katshBillId = seedTxn(db, {
      tenantId: 1,
      type: "FINANCIAL_SERVICE",
      sourceId: 2,
      metadata: { provider: "Katsh", item_key: "BILL-1" },
    });
    // Same TYPE as row A but a different provider/service_type — must NOT
    // match "Whish App Send" (the SQL predicate compares the whole tuple,
    // not just `type`).
    const whishRecvId = seedTxn(db, {
      tenantId: 1,
      type: "FINANCIAL_SERVICE",
      sourceId: 3,
      metadata: { provider: "WHISH_APP", service_type: "RECEIVE" },
    });
    // A different TYPE entirely — proves the OR-group doesn't degrade into
    // "any FINANCIAL_SERVICE row" or "any row at all".
    const saleId = seedTxn(db, { tenantId: 1, type: "SALE", sourceId: 4 });

    const rows = runWithTenant(1, () =>
      repo.getRecent(50, {
        typeFilters: [
          {
            type: "FINANCIAL_SERVICE",
            provider: "WHISH_APP",
            service_type: "SEND",
            has_item_key: false,
          },
          {
            type: "FINANCIAL_SERVICE",
            provider: "Katsh",
            has_item_key: true,
          },
        ],
      }),
    );

    const ids = rows.map((r) => r.id).sort((a, b) => a - b);
    expect(ids).toEqual([whishSendId, katshBillId].sort((a, b) => a - b));
    expect(ids).not.toContain(whishRecvId);
    expect(ids).not.toContain(saleId);
  });

  it("an empty typeFilters array behaves like no type restriction at all", () => {
    seedTxn(db, { tenantId: 1, type: "SALE", sourceId: 1 });
    seedTxn(db, { tenantId: 1, type: "EXPENSE", sourceId: 2 });

    const rows = runWithTenant(1, () => repo.getRecent(50, { typeFilters: [] }));
    expect(rows).toHaveLength(2);
  });

  it("the OR-group still ANDs with excludeTypes and tenant scoping", () => {
    const mtcId = seedTxn(db, {
      tenantId: 1,
      type: "RECHARGE",
      sourceId: 1,
      metadata: { provider: "MTC" },
    });
    const saleId = seedTxn(db, { tenantId: 1, type: "SALE", sourceId: 2 });
    // Different tenant, same matching tuple — must never leak in.
    db.prepare(
      `INSERT INTO users (id, tenant_id, username) VALUES (2, 2, 'bob')`,
    ).run();
    seedTxn(db, {
      tenantId: 2,
      type: "RECHARGE",
      sourceId: 1,
      metadata: { provider: "MTC" },
    });

    const rows = runWithTenant(1, () =>
      repo.getRecent(50, {
        typeFilters: [{ type: "RECHARGE", provider: "MTC" }, { type: "SALE" }],
        // excludeTypes ANDs against the WHOLE OR-group — SALE matched the
        // typeFilters union above but must still be excluded here.
        excludeTypes: ["SALE"],
      }),
    );

    expect(rows.map((r) => r.id)).toEqual([mtcId]);
    expect(rows.map((r) => r.id)).not.toContain(saleId);
  });

  it("the singular type/provider/service_type fields still work unchanged when typeFilters is absent", () => {
    const keepId = seedTxn(db, {
      tenantId: 1,
      type: "FINANCIAL_SERVICE",
      sourceId: 1,
      metadata: { provider: "OMT" },
    });
    seedTxn(db, {
      tenantId: 1,
      type: "FINANCIAL_SERVICE",
      sourceId: 2,
      metadata: { provider: "WHISH" },
    });

    const rows = runWithTenant(1, () =>
      repo.getRecent(50, { type: "FINANCIAL_SERVICE", provider: "OMT" }),
    );
    expect(rows.map((r) => r.id)).toEqual([keepId]);
  });
});
