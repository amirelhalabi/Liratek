import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { DatabaseError } from "../utils/errors.js";
import type {
  SerialLabel,
  SerialRequiredMode,
} from "../utils/serialLabel.js";

export interface ProductCategory {
  id: number;
  name: string;
  sort_order: number;
  is_active: number;
  /** LIRA-143 v157 (decision #9): products in a category with this flag ON
   *  require per-unit IMEI tracking (product_units). SQLite boolean. */
  tracks_imei_units: number;
  /** LIRA-296 v205: the category's default warranty in months (0–60);
   *  NULL = none. A product without its own length uses it at sale time. */
  warranty_months: number | null;
  /** LIRA-296 v207: what the unit's serial is called ('IMEI' | 'Serial'). */
  serial_label: SerialLabel;
  /** LIRA-296 v207: a sale of a tracked item without its unit is refused
   *  (BLOCK) or allowed with a warning (WARN). */
  serial_required: SerialRequiredMode;
  created_at: string;
}

const BASE_COLUMNS =
  "id, name, sort_order, is_active, tracks_imei_units, warranty_months";
/** v207 columns, or their pre-v207 meaning on an older/hand-built schema. */
const SERIAL_COLUMNS =
  "serial_label, serial_required";
const SERIAL_FALLBACK =
  "CASE WHEN tracks_imei_units = 1 THEN 'IMEI' ELSE 'Serial' END AS serial_label, 'BLOCK' AS serial_required";

/** Fields `update()` may change — at least one must be provided. `name`
 *  omitted/`undefined` leaves the existing name untouched; same for
 *  `tracksImeiUnits`. */
export interface CategoryUpdateOptions {
  name?: string | undefined;
  tracksImeiUnits?: boolean | undefined;
  /** LIRA-296: `null` clears the default; `undefined` leaves it alone. */
  warrantyMonths?: number | null | undefined;
  /** LIRA-296 P3 (v207). `undefined` leaves it alone. */
  serialLabel?: SerialLabel | undefined;
  serialRequired?: SerialRequiredMode | undefined;
}

export class CategoryRepository {
  /**
   * Explicit override for tests only. The default (`undefined`) resolves
   * `getDatabase()` live on every access via the `db` getter below — never
   * captured once at construction time. A process-wide singleton built while
   * one tenant's connection was current must keep following whichever
   * connection is current on each call, not freeze on its first one (Phase A,
   * `PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` § 11.2).
   */
  private readonly _db?: Database.Database;

  constructor(db?: Database.Database) {
    this._db = db;
  }

  private get db(): Database.Database {
    return this._db ?? getDatabase();
  }

  /** Does this database have the v207 serial columns? Not cached: the
   *  repository follows whichever connection is current (see `db`). */
  private hasSerialColumns(): boolean {
    return (
      this.db.prepare(`PRAGMA table_info(product_categories)`).all() as {
        name: string;
      }[]
    ).some((c) => c.name === "serial_required");
  }

  getAll(): ProductCategory[] {
    const serial = this.hasSerialColumns() ? SERIAL_COLUMNS : SERIAL_FALLBACK;
    return this.db
      .prepare(
        `SELECT ${BASE_COLUMNS}, ${serial}, created_at FROM product_categories WHERE is_active = 1 AND tenant_id = ? ORDER BY sort_order ASC, name ASC`,
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
    if (opts.warrantyMonths !== undefined) {
      setClauses.push("warranty_months = ?");
      params.push(opts.warrantyMonths);
    }
    if (opts.serialLabel !== undefined) {
      setClauses.push("serial_label = ?");
      params.push(opts.serialLabel);
    }
    if (opts.serialRequired !== undefined) {
      setClauses.push("serial_required = ?");
      params.push(opts.serialRequired);
    }
    if (setClauses.length === 0) {
      throw new DatabaseError(
        "update: at least one of name/tracksImeiUnits/warrantyMonths/serialLabel/serialRequired must be provided",
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

/** Reset the singleton (for testing) */
export function resetCategoryRepository(): void {
  instance = null;
}
