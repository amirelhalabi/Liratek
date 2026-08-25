import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { DatabaseError } from "../utils/errors.js";

export interface ProductCategory {
  id: number;
  name: string;
  sort_order: number;
  is_active: number;
  /** LIRA-143 v157 (decision #9): products in a category with this flag ON
   *  require per-unit IMEI tracking (product_units). SQLite boolean. */
  tracks_imei_units: number;
  created_at: string;
}

const COLUMNS =
  "id, name, sort_order, is_active, tracks_imei_units, created_at";

/** Fields `update()` may change — at least one must be provided. `name`
 *  omitted/`undefined` leaves the existing name untouched; same for
 *  `tracksImeiUnits`. */
export interface CategoryUpdateOptions {
  name?: string;
  tracksImeiUnits?: boolean;
}

export class CategoryRepository {
  private db: Database.Database;

  constructor() {
    this.db = getDatabase();
  }

  getAll(): ProductCategory[] {
    return this.db
      .prepare(
        `SELECT ${COLUMNS} FROM product_categories WHERE is_active = 1 AND tenant_id = ? ORDER BY sort_order ASC, name ASC`,
      )
      .all(getCurrentTenantId()) as ProductCategory[];
  }

  create(name: string): { id: number } {
    const trimmed = name.trim();
    if (!trimmed) throw new DatabaseError("Category name is required");
    const tenantId = getCurrentTenantId();
    const result = this.db
      .prepare(
        `INSERT INTO product_categories (name, sort_order, tenant_id) VALUES (?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM product_categories WHERE tenant_id = ?), ?)`,
      )
      .run(trimmed, tenantId, tenantId);
    return { id: Number(result.lastInsertRowid) };
  }

  /**
   * Update a category's name and/or its `tracks_imei_units` flag (decision
   * #9 — the Settings toggle). Each field is set only when its option key is
   * provided (`undefined` leaves the existing value untouched — same
   * optional-patch convention as `ProductUnitRepository.markInStock`); at
   * least one of `name`/`tracksImeiUnits` must be given (enforced by the
   * shared Zod schema at the IPC/REST door, not re-checked here).
   */
  update(id: number, opts: CategoryUpdateOptions): boolean {
    const setClauses: string[] = [];
    const params: unknown[] = [];

    if (opts.name !== undefined) {
      const trimmed = opts.name.trim();
      if (!trimmed) throw new DatabaseError("Category name is required");
      setClauses.push("name = ?");
      params.push(trimmed);
    }
    if (opts.tracksImeiUnits !== undefined) {
      setClauses.push("tracks_imei_units = ?");
      params.push(opts.tracksImeiUnits ? 1 : 0);
    }
    if (setClauses.length === 0) {
      throw new DatabaseError(
        "update: at least one of name/tracksImeiUnits must be provided",
      );
    }

    params.push(id, getCurrentTenantId());
    const result = this.db
      .prepare(
        `UPDATE product_categories SET ${setClauses.join(", ")} WHERE id = ? AND tenant_id = ?`,
      )
      .run(...params);
    return result.changes > 0;
  }

  delete(id: number): boolean {
    const tenantId = getCurrentTenantId();
    // Nullify category_id on products first, then remove the category
    this.db
      .prepare(
        `UPDATE products SET category_id = NULL, category = 'General' WHERE category_id = ? AND tenant_id = ?`,
      )
      .run(id, tenantId);
    const result = this.db
      .prepare(`DELETE FROM product_categories WHERE id = ? AND tenant_id = ?`)
      .run(id, tenantId);
    return result.changes > 0;
  }

  /** Find category by name (case-insensitive), or create it if missing. Returns id. */
  getOrCreate(name: string): number {
    const trimmed = name.trim();
    if (!trimmed) throw new DatabaseError("Category name is required");
    const tenantId = getCurrentTenantId();
    const existing = this.db
      .prepare(
        `SELECT id FROM product_categories WHERE name = ? COLLATE NOCASE AND tenant_id = ?`,
      )
      .get(trimmed, tenantId) as { id: number } | undefined;
    if (existing) return existing.id;
    const result = this.db
      .prepare(
        `INSERT INTO product_categories (name, sort_order, tenant_id)
         VALUES (?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM product_categories WHERE tenant_id = ?), ?)`,
      )
      .run(trimmed, tenantId, tenantId);
    return Number(result.lastInsertRowid);
  }

  getNames(): string[] {
    const rows = this.db
      .prepare(
        `SELECT name FROM product_categories WHERE is_active = 1 AND tenant_id = ? ORDER BY sort_order ASC, name ASC`,
      )
      .all(getCurrentTenantId()) as { name: string }[];
    return rows.map((r) => r.name);
  }
}

let instance: CategoryRepository | null = null;
export function getCategoryRepository(): CategoryRepository {
  if (!instance) instance = new CategoryRepository();
  return instance;
}
