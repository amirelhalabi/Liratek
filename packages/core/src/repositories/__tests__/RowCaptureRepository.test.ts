/**
 * LIRA-306 T022 — RowCaptureRepository (R4, FR-020): the rows an action
 * created, per table, from the `sqlite_sequence` difference read inside the
 * same transaction. Same code on the PC (recording) and the server (replay).
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initDatabase } from "../../db/connection";
import { initFixedTenantContext, resetTenantContext } from "../../db/tenantContext";
import { SalesRepository, resetSalesRepository } from "../SalesRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetStockBatchRepository } from "../StockBatchRepository";
import { RowCaptureRepository } from "../RowCaptureRepository";
import { MAP_EXCLUDED_TABLES, MANIFEST_KEY_TABLES } from "../../offline/tables";
import { OFFLINE_ID_TABLES } from "../../offline/idRange";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL = fs.readFileSync(path.join(REPO_ROOT, "electron-app/create_db.sql"), "utf-8");
let db: Database.Database;

beforeEach(() => {
  resetSalesRepository();
  resetTransactionRepository();
  resetStockBatchRepository();
  db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  initDatabase(db);
  initFixedTenantContext(1);
  (globalThis as { __LIRATEK_TEST_DB__?: Database.Database }).__LIRATEK_TEST_DB__ = db;
  db.prepare(
    `INSERT INTO products (id, tenant_id, name, item_type, category, cost_price_usd, selling_price_usd, stock_quantity)
     VALUES (33, 1, 'Cable', 'Product', 'General', 2, 5, 10)`,
  ).run();
});
afterEach(() => {
  delete (globalThis as { __LIRATEK_TEST_DB__?: Database.Database }).__LIRATEK_TEST_DB__;
  resetTenantContext();
  db.close();
});

const capture = new RowCaptureRepository();

function sell(): void {
  const res = new SalesRepository().processSale(
    {
      client_id: null,
      items: [{ product_id: 33, quantity: 2, price: 5 }],
      total_amount: 10,
      discount: 0,
      final_amount: 10,
      payment_usd: 10,
      payment_lbp: 0,
      payments: [{ method: "CASH", currency_code: "USD", amount: 10 }],
      exchange_rate: 89500,
      status: "completed",
      client_day: "2026-10-10",
    } as never,
    1,
  );
  expect(res.success).toBe(true);
}

describe("RowCaptureRepository", () => {
  it("returns the ids a POS sale created, per table, inside one transaction", () => {
    let created: Record<string, number[]> = {};
    db.transaction(() => {
      const before = capture.snapshotSequences();
      sell();
      created = capture.createdSince(before);
    })();
    const saleId = (db.prepare(`SELECT id FROM sales`).get() as { id: number }).id;
    expect(created.sales).toEqual([saleId]);
    expect(created.sale_items).toHaveLength(1);
    expect(created.transactions?.length).toBeGreaterThanOrEqual(1);
    expect(created.payments?.length).toBeGreaterThanOrEqual(1);
    for (const t of Object.keys(created)) expect(MAP_EXCLUDED_TABLES).not.toContain(t);
  });

  it("excludes rows inserted then deleted inside the window", () => {
    let created: Record<string, number[]> = {};
    db.transaction(() => {
      const before = capture.snapshotSequences();
      const id = Number(
        db.prepare(`INSERT INTO clients (tenant_id, full_name) VALUES (1, 'Temp')`).run().lastInsertRowid,
      );
      db.prepare(`INSERT INTO clients (tenant_id, full_name) VALUES (1, 'Kept')`).run();
      db.prepare(`DELETE FROM clients WHERE id = ?`).run(id);
      created = capture.createdSince(before);
    })();
    expect(created.clients).toHaveLength(1);
  });

  it("filters MAP_EXCLUDED_TABLES (audit log)", () => {
    let created: Record<string, number[]> = {};
    db.transaction(() => {
      const before = capture.snapshotSequences();
      db.prepare(
        `INSERT INTO audit_log (tenant_id, user_id, username, role, action, entity_type, entity_id, summary) VALUES (1, 1, 'admin', 'admin', 'x', 'y', '1', 's')`,
      ).run();
      created = capture.createdSince(before);
    })();
    expect(created.audit_log).toBeUndefined();
  });

  it("table lists: excluded names exist; manifest keys = id tables minus excluded", () => {
    for (const t of MAP_EXCLUDED_TABLES) {
      expect({ t, exists: new RegExp(`CREATE TABLE IF NOT EXISTS ${t} \\(`).test(CREATE_DB_SQL) }).toEqual({ t, exists: true });
    }
    expect(MAP_EXCLUDED_TABLES).toEqual(expect.arrayContaining(["audit_log", "sessions"]));
    expect([...MANIFEST_KEY_TABLES].sort()).toEqual(
      OFFLINE_ID_TABLES.filter((t) => !MAP_EXCLUDED_TABLES.includes(t)).sort(),
    );
    // basket tables ARE mapped (FR-020)
    for (const t of ["customer_sessions", "customer_session_transactions", "session_cart_items"]) {
      expect(MANIFEST_KEY_TABLES).toContain(t);
    }
  });
});
