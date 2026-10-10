/**
 * Rule 27 follow-up to LIRA-298 — a BACKDATED sale's warranty starts on the
 * SHOP's day of its `transaction_time`, not that instant's UTC day.
 *
 * `transaction_time` is an ISO UTC instant. 01:00 in Beirut on 2026-07-15 is
 * 2026-07-14 22:00 UTC, so `transaction_time.slice(0, 10)` started the clock
 * a day early. The POS also sends TODAY's `client_day` with a backdated sale,
 * so `client_day` must not win over the backdated instant either.
 *
 * Web: the shop's day comes from the request's client tz offset
 * (`clientTzOffsetMinutes`, X-Client-Tz-Offset). Desktop (no offset): the
 * machine's own zone — the shop's PC.
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
import { localDay } from "../../utils/localDate";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");
const ACTOR = 2;

/** 01:00 Beirut (UTC+3, summer) on 2026-07-15 = 22:00 UTC on 2026-07-14. */
const BACKDATED_0100_BEIRUT = "2026-07-14T22:00:00.000Z";

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

describe("rule 27 — a backdated sale's warranty starts on the shop's day", () => {
  let db: Database.Database;
  let repo: SalesRepository;

  const addProduct = (months: number): number =>
    Number(
      db
        .prepare(
          `INSERT INTO products (tenant_id, name, item_type, category, cost_price_usd,
             selling_price_usd, stock_quantity, warranty_months)
           VALUES (1, ?, 'Product', 'General', 4, 10, 50, ?)`,
        )
        .run(`P-${Math.random()}`, months).lastInsertRowid,
    );

  const sellBackdated = (
    productId: number,
    extra: Partial<SaleRequest> = {},
  ) => {
    const result = repo.processSale(
      {
        client_id: null,
        items: [{ product_id: productId, quantity: 1, price: 10 }],
        total_amount: 10,
        discount: 0,
        final_amount: 10,
        payment_usd: 10,
        payment_lbp: 0,
        payments: [{ method: "CASH", currency_code: "USD", amount: 10 }],
        exchange_rate: 89500,
        status: "completed",
        transaction_time: BACKDATED_0100_BEIRUT,
        // The POS sends TODAY's day even for a backdated sale.
        client_day: "2026-10-10",
        ...extra,
      },
      ACTOR,
    );
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    return result.id!;
  };

  const warrantyUntilOf = (saleId: number): string | null =>
    (
      db
        .prepare(`SELECT warranty_until FROM sale_items WHERE sale_id = ?`)
        .get(saleId) as { warranty_until: string | null }
    ).warranty_until;

  beforeEach(() => {
    resetAll();
    db = buildDb();
    initFixedTenantContext(1);
    repo = new SalesRepository();
  });

  afterEach(() => {
    resetTenantContext();
    resetAll();
    db.close();
  });

  it("web: uses the request's client tz offset (Beirut +180), whatever the server's zone", () => {
    const productId = addProduct(1);
    const saleId = runWithTenant(1, () => sellBackdated(productId), {
      clientDay: "2026-10-10",
      clientTzOffsetMinutes: 180,
    });
    expect(warrantyUntilOf(saleId)).toBe("2026-08-15");
  });

  it("web: a UTC browser (offset 0) keeps the UTC day", () => {
    const productId = addProduct(1);
    const saleId = runWithTenant(1, () => sellBackdated(productId), {
      clientTzOffsetMinutes: 0,
    });
    expect(warrantyUntilOf(saleId)).toBe("2026-08-14");
  });

  it("desktop (no client offset): the machine's own day of the instant", () => {
    const saleId = sellBackdated(addProduct(1));
    // Under core's pinned TZ=Asia/Beirut this is 2026-07-15 -> 2026-08-15.
    const shopDay = localDay(new Date(BACKDATED_0100_BEIRUT));
    const expected = `2026-08-${shopDay.slice(8, 10)}`;
    expect(shopDay.slice(0, 7)).toBe("2026-07");
    expect(warrantyUntilOf(saleId)).toBe(expected);
  });
});
