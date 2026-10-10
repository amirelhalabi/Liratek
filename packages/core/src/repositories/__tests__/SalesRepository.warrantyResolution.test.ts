/**
 * LIRA-296 (T020, user story 3) — the warranty length a sale line gets:
 *
 *   line edit at the till ?? product's own length ?? category default ?? none
 *
 * stamped on the line as `warranty_months` (the length actually used) and
 * `warranty_until` (sale day + length, completed lines only), with
 * `warranty_set_by` = the actor ONLY when the till edit differs from the
 * resolved default. Changing a product's or category's length later never
 * changes an already-sold line.
 *
 * Rule 27 (U1): the warranty starts on the SHOP's day. The client sends
 * `client_day` with the sale; without it the request's own day
 * (`clientDay()`, the X-Client-Day header on web) is the fallback — never
 * the server's UTC date.
 *
 * Real production schema (create_db.sql + migrations); nothing is mocked.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initDatabase } from "../../db/connection";
import { runMigrations } from "../../db/migrations/index";
import {
  initFixedTenantContext,
  resetTenantContext,
  runWithTenant,
} from "../../db/tenantContext";
import {
  SalesRepository,
  resetSalesRepository,
  type SaleRequest,
} from "../SalesRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetStockBatchRepository } from "../StockBatchRepository";
import { resetProductUnitRepository } from "../ProductUnitRepository";
import { resetDebtRepository } from "../DebtRepository";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");
const ACTOR = 2;

function buildDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(db);
  runMigrations(db);
  db.exec(
    `INSERT OR IGNORE INTO users (id, tenant_id, username, password_hash, role, is_active) VALUES (2, 1, 'cashier', '', 'staff', 1)`,
  );
  return db;
}

function resetAll(): void {
  resetSalesRepository();
  resetTransactionRepository();
  resetStockBatchRepository();
  resetProductUnitRepository();
  resetDebtRepository();
}

type Line = {
  warranty_until: string | null;
  warranty_months: number | null;
  warranty_set_by: number | null;
};

describe("LIRA-296 — warranty length resolution at sale time", () => {
  let db: Database.Database;
  let repo: SalesRepository;
  let accessoriesId: number;

  const setCategoryMonths = (months: number | null) =>
    db
      .prepare(`UPDATE product_categories SET warranty_months = ? WHERE id = ?`)
      .run(months, accessoriesId);

  const addProduct = (own: number | null, inCategory = true): number =>
    Number(
      db
        .prepare(
          `INSERT INTO products (tenant_id, name, item_type, category, category_id,
             cost_price_usd, selling_price_usd, stock_quantity, warranty_months)
           VALUES (1, ?, 'Product', ?, ?, 4, 10, 50, ?)`,
        )
        .run(
          `P-${Math.random()}`,
          inCategory ? "Accessories" : "General",
          inCategory ? accessoriesId : null,
          own,
        ).lastInsertRowid,
    );

  const sell = (
    productId: number,
    extra: Partial<SaleRequest> = {},
    item: Partial<SaleRequest["items"][number]> = {},
  ): number => {
    const result = repo.processSale(
      {
        client_id: null,
        items: [{ product_id: productId, quantity: 1, price: 10, ...item }],
        total_amount: 10,
        discount: 0,
        final_amount: 10,
        payment_usd: 10,
        payment_lbp: 0,
        payments: [{ method: "CASH", currency_code: "USD", amount: 10 }],
        exchange_rate: 89500,
        status: "completed",
        client_day: "2026-10-10",
        ...extra,
      },
      ACTOR,
    );
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    return result.id!;
  };

  const lineOf = (saleId: number): Line =>
    db
      .prepare(
        `SELECT warranty_until, warranty_months, warranty_set_by FROM sale_items WHERE sale_id = ?`,
      )
      .get(saleId) as Line;

  beforeEach(() => {
    resetAll();
    db = buildDb();
    initFixedTenantContext(1);
    repo = new SalesRepository();
    accessoriesId = (
      db
        .prepare(
          `SELECT id FROM product_categories WHERE tenant_id = 1 AND name = 'Accessories'`,
        )
        .get() as { id: number }
    ).id;
  });

  afterEach(() => {
    resetTenantContext();
    resetAll();
    db.close();
  });

  it("a category default applies to a product with no length of its own", () => {
    setCategoryMonths(1);
    expect(lineOf(sell(addProduct(null)))).toEqual({
      warranty_until: "2026-11-10",
      warranty_months: 1,
      warranty_set_by: null,
    });
  });

  it("finds the category by name when the product has no category id", () => {
    setCategoryMonths(2);
    const id = Number(
      db
        .prepare(
          `INSERT INTO products (tenant_id, name, item_type, category, category_id, cost_price_usd, selling_price_usd, stock_quantity)
           VALUES (1, 'Legacy cable', 'Product', 'accessories', NULL, 4, 10, 5)`,
        )
        .run().lastInsertRowid,
    );
    expect(lineOf(sell(id)).warranty_months).toBe(2);
  });

  it("the product's own length wins over the category default", () => {
    setCategoryMonths(1);
    expect(lineOf(sell(addProduct(3)))).toEqual({
      warranty_until: "2027-01-10",
      warranty_months: 3,
      warranty_set_by: null,
    });
  });

  it("a length edited at the till wins over both, and records who changed it", () => {
    setCategoryMonths(1);
    expect(lineOf(sell(addProduct(3), {}, { warranty_months: 6 }))).toEqual({
      warranty_until: "2027-04-10",
      warranty_months: 6,
      warranty_set_by: ACTOR,
    });
  });

  it("an edit equal to the default is not recorded as a change", () => {
    setCategoryMonths(1);
    expect(
      lineOf(sell(addProduct(3), {}, { warranty_months: 3 })).warranty_set_by,
    ).toBeNull();
  });

  it("an edit to 0 months removes the warranty, recorded", () => {
    expect(lineOf(sell(addProduct(12), {}, { warranty_months: 0 }))).toEqual({
      warranty_until: null,
      warranty_months: 0,
      warranty_set_by: ACTOR,
    });
  });

  it("NULL everywhere means no warranty", () => {
    expect(lineOf(sell(addProduct(null, false)))).toEqual({
      warranty_until: null,
      warranty_months: null,
      warranty_set_by: null,
    });
  });

  it("a draft gets no stamp", () => {
    setCategoryMonths(1);
    const result = repo.processSale(
      {
        client_id: null,
        items: [{ product_id: addProduct(3), quantity: 1, price: 10 }],
        total_amount: 10,
        discount: 0,
        final_amount: 10,
        payment_usd: 0,
        payment_lbp: 0,
        exchange_rate: 89500,
        status: "draft",
        client_day: "2026-10-10",
      },
      ACTOR,
    );
    expect(lineOf(result.id!)).toEqual({
      warranty_until: null,
      warranty_months: null,
      warranty_set_by: null,
    });
  });

  it("changing the product or category later never changes a sold line", () => {
    setCategoryMonths(1);
    const productId = addProduct(null);
    const saleId = sell(productId);
    setCategoryMonths(24);
    db.prepare(`UPDATE products SET warranty_months = 12 WHERE id = ?`).run(
      productId,
    );
    expect(lineOf(saleId)).toEqual({
      warranty_until: "2026-11-10",
      warranty_months: 1,
      warranty_set_by: null,
    });
  });

  describe("rule 27 — the warranty starts on the shop's day", () => {
    // 00:30 in Beirut on 2026-01-31 is still 2026-01-30 21:30 UTC: the
    // server's UTC date would start the clock a day early.
    it("uses the client_day sent with the sale", () => {
      expect(
        lineOf(sell(addProduct(1), { client_day: "2026-01-31" })).warranty_until,
      ).toBe("2026-02-28");
    });

    it("without client_day, falls back to the request's own day, not the server's", () => {
      const productId = addProduct(1);
      const saleId = runWithTenant(
        1,
        () => sell(productId, { client_day: undefined }),
        { clientDay: "2026-03-05" },
      );
      expect(lineOf(saleId).warranty_until).toBe("2026-04-05");
    });
  });
});
