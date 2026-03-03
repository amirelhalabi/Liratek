import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";
import { DatabaseError } from "../utils/errors.js";

export interface ProductCategory {
  id: number;
  name: string;
  sort_order: number;
  is_active: number;
  created_at: string;
}

const COLUMNS = "id, name, sort_order, is_active, created_at";

export class CategoryRepository {
  private db: Database.Database;

  constructor() {
    this.db = getDatabase();
  }

  getAll(): ProductCategory[] {
    return this.db
      .prepare(
        `SELECT ${COLUMNS} FROM product_categories WHERE is_active = 1 ORDER BY sort_order ASC, name ASC`,
      )
      .all() as ProductCategory[];
  }

  create(name: string): { id: number } {
    const trimmed = name.trim();
    if (!trimmed) throw new DatabaseError("Category name is required");
    const result = this.db
      .prepare(
        `INSERT INTO product_categories (name, sort_order) VALUES (?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM product_categories))`,
      )
      .run(trimmed);
    return { id: Number(result.lastInsertRowid) };
  }

  update(id: number, name: string): boolean {
    const trimmed = name.trim();
    if (!trimmed) throw new DatabaseError("Category name is required");
    const result = this.db
      .prepare(`UPDATE product_categories SET name = ? WHERE id = ?`)
      .run(trimmed, id);
    return result.changes > 0;
  }

  delete(id: number): boolean {
    // Hard delete — CASCADE will delete all products in this category
    const result = this.db
      .prepare(`DELETE FROM product_categories WHERE id = ?`)
      .run(id);
    return result.changes > 0;
  }

  /** Find category by name (case-insensitive), or create it if missing. Returns id. */
  getOrCreate(name: string): number {
    const trimmed = name.trim();
    if (!trimmed) throw new DatabaseError("Category name is required");
    const existing = this.db
      .prepare(
        `SELECT id FROM product_categories WHERE name = ? COLLATE NOCASE`,
      )
      .get(trimmed) as { id: number } | undefined;
    if (existing) return existing.id;
    const result = this.db
      .prepare(
        `INSERT INTO product_categories (name, sort_order)
         VALUES (?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM product_categories))`,
      )
      .run(trimmed);
    return Number(result.lastInsertRowid);
  }

  getNames(): string[] {
    const rows = this.db
      .prepare(
        `SELECT name FROM product_categories WHERE is_active = 1 ORDER BY sort_order ASC, name ASC`,
      )
      .all() as { name: string }[];
    return rows.map((r) => r.name);
  }
}

let instance: CategoryRepository | null = null;
export function getCategoryRepository(): CategoryRepository {
  if (!instance) instance = new CategoryRepository();
  return instance;
}
