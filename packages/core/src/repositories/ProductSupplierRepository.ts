import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { DatabaseError } from "../utils/errors.js";

export interface ProductSupplier {
  id: number;
  name: string;
  sort_order: number;
  is_active: number;
  supplier_id: number | null;
  created_at: string;
}

export interface ProductSupplierWithCount extends ProductSupplier {
  product_count: number;
}

export interface ProductSupplierItem {
  product_id: number;
  name: string;
  quantity: number;
  cost: number;
  total: number;
  created_at: string;
}

const COLUMNS = "id, name, sort_order, is_active, supplier_id, created_at";

export class ProductSupplierRepository {
  private db: Database.Database;

  constructor() {
    this.db = getDatabase();
  }

  getAll(): ProductSupplier[] {
    return this.db
      .prepare(
        `SELECT ${COLUMNS} FROM product_suppliers WHERE is_active = 1 AND tenant_id = ? ORDER BY sort_order ASC, name ASC`,
      )
      .all(getCurrentTenantId()) as ProductSupplier[];
  }

  /** Get all suppliers with a count of products referencing each one. */
  getAllWithProductCount(): ProductSupplierWithCount[] {
    const tenantId = getCurrentTenantId();
    return this.db
      .prepare(
        `SELECT ps.id, ps.name, ps.sort_order, ps.is_active, ps.supplier_id, ps.created_at,
                COUNT(p.id) AS product_count
         FROM product_suppliers ps
         LEFT JOIN products p ON LOWER(p.supplier) = LOWER(ps.name) AND p.is_active = 1 AND p.tenant_id = ps.tenant_id
         WHERE ps.is_active = 1 AND ps.tenant_id = ?
         GROUP BY ps.id
         ORDER BY ps.sort_order ASC, ps.name ASC`,
      )
      .all(tenantId) as ProductSupplierWithCount[];
  }

  /**
   * Returns inventory items from this supplier for the detail panel.
   * Joined via product_suppliers name (case-insensitive) to products.
   */
  getProductItems(supplierId: number): ProductSupplierItem[] {
    const tenantId = getCurrentTenantId();
    return this.db
      .prepare(
        `SELECT p.id as product_id, p.name, p.stock_quantity as quantity,
                p.cost_price_usd as cost,
                ROUND(p.stock_quantity * p.cost_price_usd, 2) as total,
                p.created_at
         FROM product_suppliers ps
         JOIN products p ON LOWER(p.supplier) = LOWER(ps.name) AND p.is_active = 1 AND p.tenant_id = ps.tenant_id
         WHERE ps.supplier_id = ? AND ps.tenant_id = ?
         ORDER BY p.name ASC`,
      )
      .all(supplierId, tenantId) as ProductSupplierItem[];
  }

  /** Find a product_suppliers row by linked supplier_id. */
  findByLinkedSupplierId(supplierId: number): ProductSupplier | undefined {
    return this.db
      .prepare(
        `SELECT ${COLUMNS} FROM product_suppliers WHERE supplier_id = ? AND tenant_id = ? LIMIT 1`,
      )
      .get(supplierId, getCurrentTenantId()) as ProductSupplier | undefined;
  }

  create(name: string): { id: number; supplier_id: number } {
    const trimmed = name.trim();
    if (!trimmed) throw new DatabaseError("Supplier name is required");
    const tenantId = getCurrentTenantId();

    return this.db.transaction(() => {
      const supplierId = this._findOrCreateLinkedSupplier(trimmed);
      const result = this.db
        .prepare(
          `INSERT INTO product_suppliers (name, sort_order, supplier_id, tenant_id)
           VALUES (?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM product_suppliers WHERE tenant_id = ?), ?, ?)`,
        )
        .run(trimmed, tenantId, supplierId, tenantId);
      return { id: Number(result.lastInsertRowid), supplier_id: supplierId };
    })();
  }

  update(id: number, name: string): boolean {
    const trimmed = name.trim();
    if (!trimmed) throw new DatabaseError("Supplier name is required");
    const tenantId = getCurrentTenantId();

    return this.db.transaction(() => {
      const existing = this.db
        .prepare(
          `SELECT supplier_id FROM product_suppliers WHERE id = ? AND tenant_id = ?`,
        )
        .get(id, tenantId) as { supplier_id: number | null } | undefined;

      // Keep or create linked supplier row with updated name
      if (existing?.supplier_id) {
        this.db
          .prepare(`UPDATE suppliers SET name = ? WHERE id = ? AND tenant_id = ?`)
          .run(trimmed, existing.supplier_id, tenantId);
      }

      const result = this.db
        .prepare(
          `UPDATE product_suppliers SET name = ? WHERE id = ? AND tenant_id = ?`,
        )
        .run(trimmed, id, tenantId);
      return result.changes > 0;
    })();
  }

  delete(id: number): boolean {
    const tenantId = getCurrentTenantId();
    const row = this.db
      .prepare(`SELECT name FROM product_suppliers WHERE id = ? AND tenant_id = ?`)
      .get(id, tenantId) as { name: string } | undefined;

    if (row) {
      this.db
        .prepare(
          `UPDATE products SET supplier = NULL WHERE LOWER(supplier) = LOWER(?) AND tenant_id = ?`,
        )
        .run(row.name, tenantId);
    }

    const result = this.db
      .prepare(`DELETE FROM product_suppliers WHERE id = ? AND tenant_id = ?`)
      .run(id, tenantId);
    return result.changes > 0;
  }

  /** Find supplier by name (case-insensitive), or create it if missing. Returns id. */
  getOrCreate(name: string): number {
    const trimmed = name.trim();
    if (!trimmed) throw new DatabaseError("Supplier name is required");
    const tenantId = getCurrentTenantId();

    return this.db.transaction(() => {
      const existing = this.db
        .prepare(
          `SELECT id FROM product_suppliers WHERE name = ? COLLATE NOCASE AND tenant_id = ?`,
        )
        .get(trimmed, tenantId) as { id: number } | undefined;
      if (existing) return existing.id;

      const supplierId = this._findOrCreateLinkedSupplier(trimmed);
      const result = this.db
        .prepare(
          `INSERT INTO product_suppliers (name, sort_order, supplier_id, tenant_id)
           VALUES (?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM product_suppliers WHERE tenant_id = ?), ?, ?)`,
        )
        .run(trimmed, tenantId, supplierId, tenantId);
      return Number(result.lastInsertRowid);
    })();
  }

  getNames(): string[] {
    const rows = this.db
      .prepare(
        `SELECT name FROM product_suppliers WHERE is_active = 1 AND tenant_id = ? ORDER BY sort_order ASC, name ASC`,
      )
      .all(getCurrentTenantId()) as { name: string }[];
    return rows.map((r) => r.name);
  }

  /** Find or create a suppliers row (is_system=0) for the given product supplier name. */
  private _findOrCreateLinkedSupplier(name: string): number {
    const tenantId = getCurrentTenantId();
    const existing = this.db
      .prepare(
        `SELECT id FROM suppliers WHERE name = ? COLLATE NOCASE AND is_system = 0 AND tenant_id = ? LIMIT 1`,
      )
      .get(name, tenantId) as { id: number } | undefined;
    if (existing) return existing.id;

    const result = this.db
      .prepare(
        `INSERT INTO suppliers (name, is_active, is_system, created_at, tenant_id)
         VALUES (?, 1, 0, CURRENT_TIMESTAMP, ?)`,
      )
      .run(name, tenantId);
    return Number(result.lastInsertRowid);
  }
}

let instance: ProductSupplierRepository | null = null;
export function getProductSupplierRepository(): ProductSupplierRepository {
  if (!instance) instance = new ProductSupplierRepository();
  return instance;
}

export function resetProductSupplierRepository(): void {
  instance = null;
}
