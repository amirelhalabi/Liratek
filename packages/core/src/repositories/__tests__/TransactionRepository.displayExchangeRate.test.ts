/**
 * Owner decision 2026-10-07 — the Transactions table's "@ rate" shows the
 * rate the customer actually PAID at. For a session-basket member that is
 * the basket's checkout rate (`customer_session_transactions
 * .paid_exchange_rate`, or `sales.exchange_rate_snapshot` for a SALE) — the
 * SAME preference order the session-item refund already uses to default its
 * rate (`TransactionRepository.refundSessionItem`, "checkoutRate"). A row
 * outside any basket keeps its own `transactions.exchange_rate`.
 *
 * `getRecent` exposes it as `display_exchange_rate`; the stored
 * `exchange_rate` is untouched (amountSort and every other reader keep it).
 *
 * Real production schema (create_db.sql + migrations).
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initDatabase } from "../../db/connection";
import { runMigrations } from "../../db/migrations/index";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");

const CART_RATE = 89_500; // stamped on the item when it was added to the cart
const PAID_RATE = 87_000; // the rate the basket was actually checked out at

function buildDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(db);
  runMigrations(db);
  return db;
}

describe("TransactionRepository.getRecent — display_exchange_rate", () => {
  let db: Database.Database;

  beforeEach(() => {
    resetTransactionRepository();
    db = buildDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    resetTransactionRepository();
  });

  function newSession(): number {
    return Number(
      db
        .prepare(
          `INSERT INTO customer_sessions (tenant_id, customer_name, started_by) VALUES (1, 'Walk-in', 'admin')`,
        )
        .run().lastInsertRowid,
    );
  }

  function link(
    sessionId: number,
    txnId: number,
    type: string,
    paidRate: number | null,
  ): void {
    db.prepare(
      `INSERT INTO customer_session_transactions
         (tenant_id, session_id, transaction_type, transaction_id, unified_transaction_id, paid_exchange_rate)
       VALUES (1, ?, ?, ?, ?, ?)`,
    ).run(sessionId, type, txnId, txnId, paidRate);
  }

  function rowFor(id: number): {
    exchange_rate: number | null;
    display_exchange_rate?: number | null;
  } {
    const row = getTransactionRepository()
      .getRecent(100)
      .find((r) => r.id === id);
    if (!row) throw new Error(`row ${id} not returned by getRecent`);
    return row as unknown as {
      exchange_rate: number | null;
      display_exchange_rate?: number | null;
    };
  }

  it("a session member shows the basket's paid rate, not its cart-time stamp", () => {
    const txnId = getTransactionRepository().createTransaction({
      type: "RECHARGE",
      source_table: "recharges",
      source_id: 1,
      user_id: 1,
      amount_usd: 10,
      amount_lbp: 0,
      metadata_json: {},
      exchange_rate: CART_RATE,
      summary: "Recharge in a basket",
    });
    link(newSession(), txnId, "recharge", PAID_RATE);

    const row = rowFor(txnId);
    expect(row.display_exchange_rate).toBe(PAID_RATE);
    // The stored stamp is not rewritten.
    expect(row.exchange_rate).toBe(CART_RATE);
  });

  it("a session SALE shows the sale's checkout snapshot", () => {
    const saleId = Number(
      db
        .prepare(
          `INSERT INTO sales (tenant_id, exchange_rate_snapshot) VALUES (1, ?)`,
        )
        .run(PAID_RATE).lastInsertRowid,
    );
    const txnId = getTransactionRepository().createTransaction({
      type: "SALE",
      source_table: "sales",
      source_id: saleId,
      user_id: 1,
      amount_usd: 20,
      amount_lbp: 0,
      metadata_json: {},
      exchange_rate: CART_RATE,
      summary: "Sale in a basket",
    });
    link(newSession(), txnId, "sale", null);

    expect(rowFor(txnId).display_exchange_rate).toBe(PAID_RATE);
  });

  it("a session member with no paid rate recorded falls back to its own stamp", () => {
    const txnId = getTransactionRepository().createTransaction({
      type: "RECHARGE",
      source_table: "recharges",
      source_id: 2,
      user_id: 1,
      amount_usd: 10,
      amount_lbp: 0,
      metadata_json: {},
      exchange_rate: CART_RATE,
      summary: "Pre-v186 basket member",
    });
    link(newSession(), txnId, "recharge", null);

    expect(rowFor(txnId).display_exchange_rate).toBe(CART_RATE);
  });

  it("a row outside any basket shows its own stamp", () => {
    const txnId = getTransactionRepository().createTransaction({
      type: "EXPENSE",
      source_table: "expenses",
      source_id: 1,
      user_id: 1,
      amount_usd: -5,
      amount_lbp: 0,
      metadata_json: {},
      exchange_rate: PAID_RATE,
      summary: "Standalone expense",
    });

    expect(rowFor(txnId).display_exchange_rate).toBe(PAID_RATE);
  });
});
