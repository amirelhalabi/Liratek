import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";
import { DatabaseError } from "../utils/errors.js";

export interface ProductSupplier {
  id: number;
  name: string;
  sort_order: number;
  is_active: number;
  created_at: string;
}

export interface ProductSupplierWithCount extends ProductSupplier {
  product_count: number;
}

const COLUMNS = "id, name, sort_order, is_active, created_at";

export class ProductSupplierRepository {
  private db: Database.Database;

  constructor() {
    this.db = getDatabase();
  }

  getAll(): ProductSupplier[] {
    return this.db
      .prepare(
        `SELECT ${COLUMNS} FROM product_suppliers WHERE is_active = 1 ORDER BY sort_order ASC, name ASC`,
      )
      .all() as ProductSupplier[];
  }

  /** Get all suppliers with a count of products referencing each one. */
  getAllWithProductCount(): ProductSupplierWithCount[] {
    return this.db
      .prepare(
        `SELECT ps.id, ps.name, ps.sort_order, ps.is_active, ps.created_at,
                COUNT(p.id) AS product_count
         FROM product_suppliers ps
         LEFT JOIN products p ON LOWER(p.supplier) = LOWER(ps.name) AND p.is_active = 1
         WHERE ps.is_active = 1
         GROUP BY ps.id
         ORDER BY ps.sort_order ASC, ps.name ASC`,
      )
      .all() as ProductSupplierWithCount[];
  }

  create(name: string): { id: number } {
    const trimmed = name.trim();
    if (!trimmed) throw new DatabaseError("Supplier name is required");
    const result = this.db
      .prepare(
        `INSERT INTO product_suppliers (name, sort_order) VALUES (?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM product_suppliers))`,
      )
      .run(trimmed);
    return { id: Number(result.lastInsertRowid) };
  }

  update(id: number, name: string): boolean {
    const trimmed = name.trim();
    if (!trimmed) throw new DatabaseError("Supplier name is required");
    const result = this.db
      .prepare(`UPDATE product_suppliers SET name = ? WHERE id = ?`)
      .run(trimmed, id);
    return result.changes > 0;
  }

  delete(id: number): boolean {
    // Look up the supplier name so we can clear matching products
    const row = this.db
      .prepare(`SELECT name FROM product_suppliers WHERE id = ?`)
      .get(id) as { name: string } | undefined;

    if (row) {
      // Clear supplier text on products that reference this supplier (case-insensitive)
      this.db
        .prepare(
          `UPDATE products SET supplier = NULL WHERE LOWER(supplier) = LOWER(?)`,
        )
        .run(row.name);
    }

    const result = this.db
      .prepare(`DELETE FROM product_suppliers WHERE id = ?`)
      .run(id);
    return result.changes > 0;
  }

  /** Find supplier by name (case-insensitive), or create it if missing. Returns id. */
  getOrCreate(name: string): number {
    const trimmed = name.trim();
    if (!trimmed) throw new DatabaseError("Supplier name is required");
    const existing = this.db
      .prepare(`SELECT id FROM product_suppliers WHERE name = ? COLLATE NOCASE`)
      .get(trimmed) as { id: number } | undefined;
    if (existing) return existing.id;
    const result = this.db
      .prepare(
        `INSERT INTO product_suppliers (name, sort_order)
         VALUES (?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM product_suppliers))`,
      )
      .run(trimmed);
    return Number(result.lastInsertRowid);
  }

  getNames(): string[] {
    const rows = this.db
      .prepare(
        `SELECT name FROM product_suppliers WHERE is_active = 1 ORDER BY sort_order ASC, name ASC`,
      )
      .all() as { name: string }[];
    return rows.map((r) => r.name);
  }
}

let instance: ProductSupplierRepository | null = null;
export function getProductSupplierRepository(): ProductSupplierRepository {
  if (!instance) instance = new ProductSupplierRepository();
  return instance;
}
