/**
 * LIRA-296 test helper — a real schema (`electron-app/create_db.sql`, the
 * same file every fresh desktop install runs) installed as the process test
 * database, plus small seeding helpers for warranty lines.
 *
 * Not a test file (lives outside `__tests__`), so jest never runs it alone.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf8",
);

/** A fresh in-memory database with the full schema, tenants 1 and 2, and
 *  user 1 (admin) / 2 (staff) in tenant 1, installed as `getDatabase()`. */
export function installWarrantyTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  db.exec(`
    INSERT OR IGNORE INTO tenants (id, name, slug, status) VALUES (2, 'Other', 'other', 'active');
    INSERT OR IGNORE INTO users (id, tenant_id, username, password_hash, role, is_active)
      VALUES (2, 1, 'staff', '', 'staff', 1);
  `);
  (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
  return db;
}

export function uninstallWarrantyTestDb(db: Database.Database): void {
  delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
  db.close();
}

export function addClient(
  db: Database.Database,
  c: { id: number; name: string; phone?: string | null; tenant?: number },
): void {
  db.prepare(
    `INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (?, ?, ?, ?)`,
  ).run(c.id, c.tenant ?? 1, c.name, c.phone ?? null);
}

export function addProduct(
  db: Database.Database,
  p: {
    id: number;
    name: string;
    barcode?: string | null;
    category?: string;
    categoryId?: number | null;
    warrantyMonths?: number | null;
    cost?: number;
    price?: number;
    stock?: number;
    tenant?: number;
  },
): void {
  db.prepare(
    `INSERT INTO products (id, tenant_id, barcode, name, item_type, category, category_id,
       cost_price_usd, selling_price_usd, stock_quantity, warranty_months)
     VALUES (?, ?, ?, ?, 'Product', ?, ?, ?, ?, ?, ?)`,
  ).run(
    p.id,
    p.tenant ?? 1,
    p.barcode ?? null,
    p.name,
    p.category ?? "General",
    p.categoryId ?? null,
    p.cost ?? 5,
    p.price ?? 10,
    p.stock ?? 10,
    p.warrantyMonths ?? null,
  );
}

/** A completed sale with its unified SALE transaction row (walk-in name and
 *  phone live on the transaction, rule 11). */
export function addSale(
  db: Database.Database,
  s: {
    id: number;
    clientId?: number | null;
    walkInName?: string | null;
    walkInPhone?: string | null;
    createdAt?: string;
    status?: string;
    tenant?: number;
  },
): void {
  const tenant = s.tenant ?? 1;
  const createdAt = s.createdAt ?? "2026-09-01 10:00:00";
  db.prepare(
    `INSERT INTO sales (id, tenant_id, client_id, total_amount_usd, final_amount_usd, status, created_at)
     VALUES (?, ?, ?, 10, 10, ?, ?)`,
  ).run(s.id, tenant, s.clientId ?? null, s.status ?? "completed", createdAt);
  db.prepare(
    `INSERT INTO transactions (tenant_id, type, source_table, source_id, user_id, amount_usd,
       client_id, client_name, client_phone, created_at)
     VALUES (?, 'SALE', 'sales', ?, 1, 10, ?, ?, ?, ?)`,
  ).run(
    tenant,
    s.id,
    s.clientId ?? null,
    s.walkInName ?? null,
    s.walkInPhone ?? null,
    createdAt,
  );
}

export function addLine(
  db: Database.Database,
  l: {
    id: number;
    saleId: number;
    productId: number;
    quantity?: number;
    refundedQuantity?: number;
    isRefunded?: boolean;
    warrantyUntil?: string | null;
    warrantyMonths?: number | null;
    imei?: string | null;
    tenant?: number;
  },
): void {
  db.prepare(
    `INSERT INTO sale_items (id, tenant_id, sale_id, product_id, quantity, sold_price_usd,
       cost_price_snapshot_usd, is_refunded, refunded_quantity, imei, warranty_until, warranty_months)
     VALUES (?, ?, ?, ?, ?, 10, 5, ?, ?, ?, ?, ?)`,
  ).run(
    l.id,
    l.tenant ?? 1,
    l.saleId,
    l.productId,
    l.quantity ?? 1,
    l.isRefunded ? 1 : 0,
    l.refundedQuantity ?? 0,
    l.imei ?? null,
    l.warrantyUntil === undefined ? "2026-12-01" : l.warrantyUntil,
    l.warrantyMonths ?? null,
  );
}

export function addUnit(
  db: Database.Database,
  u: {
    id: number;
    productId: number;
    imei: string;
    saleItemId?: number | null;
    status?: "IN_STOCK" | "SOLD";
    overrideUntil?: string | null;
    tenant?: number;
  },
): void {
  db.prepare(
    `INSERT INTO product_units (id, tenant_id, product_id, imei, status, sale_item_id, warranty_override_until)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    u.id,
    u.tenant ?? 1,
    u.productId,
    u.imei,
    u.status ?? "SOLD",
    u.saleItemId ?? null,
    u.overrideUntil ?? null,
  );
}
