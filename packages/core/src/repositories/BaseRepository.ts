/**
 * Base Repository Pattern Implementation
 *
 * Provides a type-safe foundation for all database operations.
 * All entity-specific repositories should extend this class.
 *
 * Features:
 * - Generic CRUD operations
 * - Type-safe queries with better-sqlite3
 * - Transaction support
 * - Soft delete support
 * - Audit logging hooks
 */

import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";
import { getCurrentTenantId, isTenantBypass } from "../db/tenantContext.js";
import { DatabaseError, NotFoundError } from "../utils/errors.js";
import { dbLogger } from "../utils/logger.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Base entity interface - all database entities must have at minimum an id
 * created_at and updated_at are optional since not all tables have them
 */
export interface BaseEntity {
  id: number;
  created_at?: string;
  updated_at?: string;
}

/**
 * Options for find operations
 */
export interface FindOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDirection?: "ASC" | "DESC";
}

/**
 * Options for update operations
 */
export interface UpdateOptions {
  /** If true, throws NotFoundError when no rows affected */
  throwOnNotFound?: boolean;
}

/**
 * Result of a paginated query
 */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

// =============================================================================
// Base Repository Class
// =============================================================================

export abstract class BaseRepository<T extends BaseEntity> {
  protected readonly tableName: string;
  protected readonly softDelete: boolean;
  /**
   * Whether the generic CRUD methods on this repository (findById, findAll,
   * create, update, delete, count, exists, softDeleteById, restore) should
   * carry a `tenant_id` predicate. Defaults to true — every tenant-owned
   * table gets it for free. Set to `false` in the constructor for repos
   * whose table is NOT tenant-owned (e.g. `schema_migrations`, `sync_queue`,
   * `sync_errors` — control-plane/global tables). See
   * docs/plans/MULTI_TENANT_IMPLEMENTATION_PLAN.md §6.
   */
  protected readonly tenantScoped: boolean;

  constructor(
    tableName: string,
    options?: { softDelete?: boolean; tenantScoped?: boolean },
  ) {
    this.tableName = tableName;
    this.softDelete = options?.softDelete ?? false;
    this.tenantScoped = options?.tenantScoped ?? true;
  }

  /**
   * True when this repository's generic CRUD methods should inject a
   * `tenant_id` predicate for the current call. False when either the repo
   * opted out (`tenantScoped: false`) or the current async scope is an
   * explicit `runWithoutTenant()` bypass (control-plane reads). Callers
   * always guard on this BEFORE calling `getCurrentTenantId()`, so a
   * bypassed control-plane repo never trips the fail-closed throw.
   */
  private get tenantScopeActive(): boolean {
    return this.tenantScoped && !isTenantBypass();
  }

  /**
   * Get database instance
   */
  protected get db(): Database.Database {
    return getDatabase();
  }

  /**
   * Get columns to select. Must be overridden in child classes to use explicit columns.
   * This prevents SELECT * anti-pattern and ensures column-level control.
   */
  protected abstract getColumns(): string;

  /**
   * Internal helper to build WHERE clause for soft delete and active status
   */
  protected getBaseWhere(prefix: "WHERE" | "AND" = "WHERE"): string {
    let clauses = [];

    if (this.softDelete) {
      clauses.push("is_deleted = 0");
    }

    // Safely check for is_active column
    if (this.hasColumn("is_active")) {
      clauses.push("is_active = 1");
    }

    if (clauses.length === 0) return "";
    return `${prefix} ${clauses.join(" AND ")}`;
  }

  // ---------------------------------------------------------------------------
  // Core CRUD Operations
  // ---------------------------------------------------------------------------

  /**
   * Find an entity by ID
   */
  findById(id: number): T | null {
    try {
      const where = this.getBaseWhere("AND");
      const tenantActive = this.tenantScopeActive;
      const tenantClause = tenantActive ? " AND tenant_id = ?" : "";
      const query = `SELECT ${this.getColumns()} FROM ${this.tableName} WHERE id = ? ${where}${tenantClause}`;
      const params: unknown[] = tenantActive
        ? [id, getCurrentTenantId()]
        : [id];

      return (this.db.prepare(query).get(...params) as T | undefined) ?? null;
    } catch (error) {
      throw new DatabaseError(`Failed to find ${this.tableName} by id`, {
        cause: error,
        entityId: id,
      });
    }
  }

  /**
   * Find an entity by ID, throwing if not found
   */
  findByIdOrFail(id: number): T {
    const entity = this.findById(id);
    if (!entity) {
      throw new NotFoundError(this.tableName, id);
    }
    return entity;
  }

  /**
   * Find all entities with optional pagination
   */
  findAll(options: FindOptions = {}): T[] {
    try {
      const {
        limit,
        offset = 0,
        orderBy = "id",
        orderDirection = "DESC",
      } = options;

      const where = this.getBaseWhere("WHERE");
      const tenantActive = this.tenantScopeActive;
      const tenantParams: unknown[] = [];
      let query = `SELECT ${this.getColumns()} FROM ${this.tableName} ${where}`;

      if (tenantActive) {
        query += where ? " AND tenant_id = ?" : " WHERE tenant_id = ?";
        tenantParams.push(getCurrentTenantId());
      }

      query += ` ORDER BY ${orderBy} ${orderDirection}`;

      if (limit !== undefined) {
        query += ` LIMIT ? OFFSET ?`;
        return this.db
          .prepare(query)
          .all(...tenantParams, limit, offset) as T[];
      }

      return this.db.prepare(query).all(...tenantParams) as T[];
    } catch (error) {
      throw new DatabaseError(`Failed to find all ${this.tableName}`, {
        cause: error,
      });
    }
  }

  /**
   * Find all entities with pagination info
   */
  findAllPaginated(options: FindOptions = {}): PaginatedResult<T> {
    const { limit = 20, offset = 0 } = options;

    const data = this.findAll({ ...options, limit, offset });
    const total = this.count();

    return {
      data,
      total,
      limit,
      offset,
      hasMore: offset + data.length < total,
    };
  }

  /**
   * Count all entities
   */
  count(): number {
    try {
      const where = this.getBaseWhere("WHERE");
      const tenantActive = this.tenantScopeActive;
      const tenantParams: unknown[] = [];
      let query = `SELECT COUNT(*) as count FROM ${this.tableName} ${where}`;

      if (tenantActive) {
        query += where ? " AND tenant_id = ?" : " WHERE tenant_id = ?";
        tenantParams.push(getCurrentTenantId());
      }

      const result = this.db.prepare(query).get(...tenantParams) as {
        count: number;
      };
      return result.count;
    } catch (error) {
      throw new DatabaseError(`Failed to count ${this.tableName}`, {
        cause: error,
      });
    }
  }

  /**
   * Check if an entity exists by ID
   */
  exists(id: number): boolean {
    try {
      const where = this.getBaseWhere("AND");
      const tenantActive = this.tenantScopeActive;
      const tenantClause = tenantActive ? " AND tenant_id = ?" : "";
      const query = `SELECT 1 FROM ${this.tableName} WHERE id = ? ${where}${tenantClause}`;
      const params: unknown[] = tenantActive
        ? [id, getCurrentTenantId()]
        : [id];

      return this.db.prepare(query).get(...params) !== undefined;
    } catch (error) {
      throw new DatabaseError(
        `Failed to check existence in ${this.tableName}`,
        { cause: error, entityId: id },
      );
    }
  }

  /**
   * Create a new entity
   */
  create(data: Omit<T, "id" | "created_at" | "updated_at">): T {
    try {
      const columns = Object.keys(data);
      const values = Object.values(data);
      const tenantActive = this.tenantScopeActive && !columns.includes("tenant_id");

      const allColumns = tenantActive ? [...columns, "tenant_id"] : columns;
      const allValues = tenantActive
        ? [...values, getCurrentTenantId()]
        : values;
      const placeholders = allColumns.map(() => "?").join(", ");

      const query = `INSERT INTO ${this.tableName} (${allColumns.join(", ")}, created_at) VALUES (${placeholders}, datetime('now'))`;

      const result = this.db.prepare(query).run(...allValues);
      const insertedId = result.lastInsertRowid as number;

      return this.findByIdOrFail(insertedId);
    } catch (error) {
      throw new DatabaseError(`Failed to create ${this.tableName}`, {
        cause: error,
      });
    }
  }

  /**
   * Update an entity by ID
   */
  update(
    id: number,
    data: Partial<Omit<T, "id" | "created_at">>,
    options: UpdateOptions = {},
  ): T | null {
    try {
      const columns = Object.keys(data);
      if (columns.length === 0) {
        return this.findById(id);
      }

      const setClause = columns.map((col) => `${col} = ?`).join(", ");
      const values = Object.values(data);
      const tenantActive = this.tenantScopeActive;
      const tenantClause = tenantActive ? " AND tenant_id = ?" : "";

      const query = `UPDATE ${this.tableName} SET ${setClause}, updated_at = datetime('now') WHERE id = ?${tenantClause}`;
      const params = tenantActive
        ? [...values, id, getCurrentTenantId()]
        : [...values, id];

      const result = this.db.prepare(query).run(...params);

      if (result.changes === 0 && options.throwOnNotFound) {
        throw new NotFoundError(this.tableName, id);
      }

      return this.findById(id);
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      throw new DatabaseError(`Failed to update ${this.tableName}`, {
        cause: error,
        entityId: id,
      });
    }
  }

  /**
   * Delete an entity by ID (hard delete)
   */
  delete(id: number, options: UpdateOptions = {}): boolean {
    try {
      const tenantActive = this.tenantScopeActive;
      const tenantClause = tenantActive ? " AND tenant_id = ?" : "";
      const query = `DELETE FROM ${this.tableName} WHERE id = ?${tenantClause}`;
      const params = tenantActive ? [id, getCurrentTenantId()] : [id];
      const result = this.db.prepare(query).run(...params);

      if (result.changes === 0 && options.throwOnNotFound) {
        throw new NotFoundError(this.tableName, id);
      }

      return result.changes > 0;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      throw new DatabaseError(`Failed to delete ${this.tableName}`, {
        cause: error,
        entityId: id,
      });
    }
  }

  /**
   * Soft delete an entity by ID (sets is_deleted = 1)
   */
  softDeleteById(id: number, options: UpdateOptions = {}): boolean {
    try {
      // Check if updated_at exists in this table
      const hasUpdatedAt = this.hasColumn("updated_at");
      const tenantActive = this.tenantScopeActive;
      const tenantClause = tenantActive ? " AND tenant_id = ?" : "";

      const query = hasUpdatedAt
        ? `UPDATE ${this.tableName} SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?${tenantClause}`
        : `UPDATE ${this.tableName} SET is_deleted = 1 WHERE id = ?${tenantClause}`;
      const params = tenantActive ? [id, getCurrentTenantId()] : [id];

      const result = this.db.prepare(query).run(...params);

      if (result.changes === 0 && options.throwOnNotFound) {
        throw new NotFoundError(this.tableName, id);
      }

      return result.changes > 0;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      const originalMessage =
        error instanceof Error ? error.message : String(error);
      throw new DatabaseError(
        `Failed to soft delete ${this.tableName}: ${originalMessage}`,
        {
          cause: error,
          entityId: id,
        },
      );
    }
  }

  /**
   * Restore a soft-deleted entity (sets is_deleted = 0)
   */
  restore(id: number, options: UpdateOptions = {}): boolean {
    try {
      // Check if updated_at exists in this table
      const hasUpdatedAt = this.hasColumn("updated_at");
      const tenantActive = this.tenantScopeActive;
      const tenantClause = tenantActive ? " AND tenant_id = ?" : "";

      const query = hasUpdatedAt
        ? `UPDATE ${this.tableName} SET is_deleted = 0, updated_at = datetime('now') WHERE id = ?${tenantClause}`
        : `UPDATE ${this.tableName} SET is_deleted = 0 WHERE id = ?${tenantClause}`;
      const params = tenantActive ? [id, getCurrentTenantId()] : [id];

      const result = this.db.prepare(query).run(...params);

      if (result.changes === 0 && options.throwOnNotFound) {
        throw new NotFoundError(this.tableName, id);
      }

      return result.changes > 0;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      throw new DatabaseError(`Failed to restore ${this.tableName}`, {
        cause: error,
        entityId: id,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Transaction Support
  // ---------------------------------------------------------------------------

  /**
   * Execute a function within a transaction
   */
  transaction<R>(fn: () => R): R {
    return this.db.transaction(fn)();
  }

  // ---------------------------------------------------------------------------
  // Utility Methods
  // ---------------------------------------------------------------------------

  /**
   * Check if a column exists in the current table
   */
  protected hasColumn(columnName: string): boolean {
    try {
      const info = this.db
        .prepare(`PRAGMA table_info(${this.tableName})`)
        .all() as any[];
      return info.some((col) => col.name === columnName);
    } catch {
      return false;
    }
  }

  /**
   * Execute a raw query (use with caution)
   */
  protected query<R>(sql: string, ...params: unknown[]): R[] {
    try {
      return this.db.prepare(sql).all(...params) as R[];
    } catch (error) {
      throw new DatabaseError("Query execution failed", { cause: error });
    }
  }

  /**
   * Execute a raw query that returns a single row
   */
  protected queryOne<R>(sql: string, ...params: unknown[]): R | null {
    try {
      const db = this.db;
      const stmt = db.prepare(sql);
      const result = stmt.get(...params);
      return (result as R | undefined) ?? null;
    } catch (error) {
      dbLogger.error(
        { error, sql: sql.substring(0, 200), paramCount: params.length },
        "Query failed",
      );
      throw new DatabaseError("Query execution failed", { cause: error });
    }
  }

  /**
   * Execute a raw statement (INSERT/UPDATE/DELETE)
   */
  protected execute(sql: string, ...params: unknown[]): Database.RunResult {
    try {
      return this.db.prepare(sql).run(...params);
    } catch (error) {
      throw new DatabaseError("Statement execution failed", { cause: error });
    }
  }
}
