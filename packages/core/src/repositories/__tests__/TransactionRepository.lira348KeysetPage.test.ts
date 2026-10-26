/**
 * LIRA-348 — the Transactions table opens on today, 50 at a time, and loads
 * more as the operator scrolls. `getRecent` therefore takes:
 *   - `day_from` / `day_to`: the OPERATOR's days (rule 27 — a 00:30 Beirut
 *     row is stored as 21:30 UTC the day before and must still be "today"),
 *   - `before`: the last row the client already has (keyset on
 *     `created_at DESC, id DESC` — never OFFSET), so paging through rows that
 *     share one `created_at` second neither repeats nor skips a row.
 *
 * Real in-memory SQLite, no mocks — the query is what's under test.
 * Written before the repository change (rule 17).
 */
import Database from "better-sqlite3";
import { TransactionRepository } from "../TransactionRepository.js";
import { runWithTenant } from "../../db/tenantContext.js";

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

function seed(db: Database.Database, createdAt: string, tenantId = 1): number {
  return Number(
    db
      .prepare(
        `INSERT INTO transactions
           (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, created_at)
         VALUES (?, 'EXPENSE', 'ACTIVE', 'expenses', 1, 1, 5, 0, ?)`,
      )
      .run(tenantId, createdAt).lastInsertRowid,
  );
}

describe("TransactionRepository.getRecent — LIRA-348 day range + keyset paging", () => {
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

  const BEIRUT = { clientTzOffsetMinutes: 180 };

  it("today (Beirut +180) includes a 00:30 Beirut row stored as 21:30 UTC the day before", () => {
    const at0030 = seed(db, "2026-10-25 21:30:00"); // 00:30 Beirut, 26 Oct
    const at2300 = seed(db, "2026-10-25 20:00:00"); // 23:00 Beirut, 25 Oct
    const at1000 = seed(db, "2026-10-26 07:00:00"); // 10:00 Beirut, 26 Oct

    const day = (d: string) =>
      runWithTenant(
        1,
        () => repo.getRecent(50, { day_from: d, day_to: d }).map((r) => r.id),
        BEIRUT,
      );

    expect(day("2026-10-26")).toEqual([at1000, at0030]);
    expect(day("2026-10-25")).toEqual([at2300]);
  });

  it("an open-ended range keeps every row on or after day_from", () => {
    seed(db, "2026-10-24 07:00:00");
    const a = seed(db, "2026-10-25 20:00:00"); // 25 Oct Beirut
    const b = seed(db, "2026-10-26 07:00:00");
    const ids = runWithTenant(
      1,
      () => repo.getRecent(50, { day_from: "2026-10-25" }).map((r) => r.id),
      BEIRUT,
    );
    expect(ids).toEqual([b, a]);
  });

  it("pages through same-second rows with no duplicate and no gap", () => {
    // Seven rows, five of them in ONE second, ids interleaved with the
    // second so id order and time order disagree for some rows.
    const seconds = [
      "2026-10-26 07:00:05",
      "2026-10-26 07:00:01",
      "2026-10-26 07:00:01",
      "2026-10-26 07:00:01",
      "2026-10-26 07:00:09",
      "2026-10-26 07:00:01",
      "2026-10-26 07:00:01",
    ];
    for (const s of seconds) seed(db, s);

    const all = runWithTenant(1, () => repo.getRecent(100).map((r) => r.id));

    const paged: number[] = [];
    let before: { created_at: string; id: number } | undefined;
    for (let guard = 0; guard < 20; guard++) {
      const page = runWithTenant(1, () =>
        repo.getRecent(2, before ? { before } : {}),
      );
      paged.push(...page.map((r) => r.id));
      if (page.length < 2) break;
      const last = page[page.length - 1];
      before = { created_at: last.created_at as string, id: last.id };
    }

    expect(paged).toEqual(all);
    expect(new Set(paged).size).toBe(seconds.length);
  });

  it("the cursor composes with the day range and stays inside the tenant", () => {
    seed(db, "2026-10-26 07:00:00", 2); // another shop, same second
    const ids = [
      seed(db, "2026-10-26 07:00:00"),
      seed(db, "2026-10-26 07:00:00"),
      seed(db, "2026-10-26 07:00:00"),
    ];
    const first = runWithTenant(
      1,
      () => repo.getRecent(2, { day_from: "2026-10-26", day_to: "2026-10-26" }),
      BEIRUT,
    );
    const last = first[first.length - 1];
    const second = runWithTenant(
      1,
      () =>
        repo.getRecent(2, {
          day_from: "2026-10-26",
          day_to: "2026-10-26",
          before: { created_at: last.created_at as string, id: last.id },
        }),
      BEIRUT,
    );
    expect([...first, ...second].map((r) => r.id)).toEqual([...ids].reverse());
  });
});
