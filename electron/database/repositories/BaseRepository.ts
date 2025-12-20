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

import type Database from 'better-sqlite3';
import { getDatabase } from '../../db';
import { DatabaseError, NotFoundError } from '../../utils/errors';

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
  orderDirection?: 'ASC' | 'DESC';
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

  constructor(tableName: string, options?: { softDelete?: boolean }) {
    this.tableName = tableName;
    this.softDelete = options?.softDelete ?? false;
  }

  /**
   * Get database instance
   */
  protected get db(): Database.Database {
    return getDatabase();
  }

  // ---------------------------------------------------------------------------
  // Core CRUD Operations
  // ---------------------------------------------------------------------------

  /**
   * Find an entity by ID
   */
  findById(id: number): T | null {
    try {
      const query = this.softDelete
        ? `SELECT * FROM ${this.tableName} WHERE id = ? AND is_active = 1`
        : `SELECT * FROM ${this.tableName} WHERE id = ?`;
      
      return this.db.prepare(query).get(id) as T | undefined ?? null;
    } catch (error) {
      throw new DatabaseError(`Failed to find ${this.tableName} by id`, { cause: error, entityId: id });
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
      const { limit, offset = 0, orderBy = 'id', orderDirection = 'DESC' } = options;
      
      let query = this.softDelete
        ? `SELECT * FROM ${this.tableName} WHERE is_active = 1`
        : `SELECT * FROM ${this.tableName}`;
      
      query += ` ORDER BY ${orderBy} ${orderDirection}`;
      
      if (limit !== undefined) {
        query += ` LIMIT ? OFFSET ?`;
        return this.db.prepare(query).all(limit, offset) as T[];
      }
      
      return this.db.prepare(query).all() as T[];
    } catch (error) {
      throw new DatabaseError(`Failed to find all ${this.tableName}`, { cause: error });
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
      const query = this.softDelete
        ? `SELECT COUNT(*) as count FROM ${this.tableName} WHERE is_active = 1`
        : `SELECT COUNT(*) as count FROM ${this.tableName}`;
      
      const result = this.db.prepare(query).get() as { count: number };
      return result.count;
    } catch (error) {
      throw new DatabaseError(`Failed to count ${this.tableName}`, { cause: error });
    }
  }

  /**
   * Check if an entity exists by ID
   */
  exists(id: number): boolean {
    try {
      const query = this.softDelete
        ? `SELECT 1 FROM ${this.tableName} WHERE id = ? AND is_active = 1`
        : `SELECT 1 FROM ${this.tableName} WHERE id = ?`;
      
      return this.db.prepare(query).get(id) !== undefined;
    } catch (error) {
      throw new DatabaseError(`Failed to check existence in ${this.tableName}`, { cause: error, entityId: id });
    }
  }

  /**
   * Create a new entity
   */
  create(data: Omit<T, 'id' | 'created_at' | 'updated_at'>): T {
    try {
      const columns = Object.keys(data);
      const placeholders = columns.map(() => '?').join(', ');
      const values = Object.values(data);
      
      const query = `INSERT INTO ${this.tableName} (${columns.join(', ')}, created_at) VALUES (${placeholders}, datetime('now'))`;
      
      const result = this.db.prepare(query).run(...values);
      const insertedId = result.lastInsertRowid as number;
      
      return this.findByIdOrFail(insertedId);
    } catch (error) {
      throw new DatabaseError(`Failed to create ${this.tableName}`, { cause: error });
    }
  }

  /**
   * Update an entity by ID
   */
  update(id: number, data: Partial<Omit<T, 'id' | 'created_at'>>, options: UpdateOptions = {}): T | null {
    try {
      const columns = Object.keys(data);
      if (columns.length === 0) {
        return this.findById(id);
      }
      
      const setClause = columns.map(col => `${col} = ?`).join(', ');
      const values = Object.values(data);
      
      const query = `UPDATE ${this.tableName} SET ${setClause}, updated_at = datetime('now') WHERE id = ?`;
      
      const result = this.db.prepare(query).run(...values, id);
      
      if (result.changes === 0 && options.throwOnNotFound) {
        throw new NotFoundError(this.tableName, id);
      }
      
      return this.findById(id);
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      throw new DatabaseError(`Failed to update ${this.tableName}`, { cause: error, entityId: id });
    }
  }

  /**
   * Delete an entity by ID (hard delete)
   */
  delete(id: number, options: UpdateOptions = {}): boolean {
    try {
      const query = `DELETE FROM ${this.tableName} WHERE id = ?`;
      const result = this.db.prepare(query).run(id);
      
      if (result.changes === 0 && options.throwOnNotFound) {
        throw new NotFoundError(this.tableName, id);
      }
      
      return result.changes > 0;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      throw new DatabaseError(`Failed to delete ${this.tableName}`, { cause: error, entityId: id });
    }
  }

  /**
   * Soft delete an entity by ID (sets is_active = 0)
   */
  softDeleteById(id: number, options: UpdateOptions = {}): boolean {
    try {
      const query = `UPDATE ${this.tableName} SET is_active = 0, updated_at = datetime('now') WHERE id = ?`;
      const result = this.db.prepare(query).run(id);
      
      if (result.changes === 0 && options.throwOnNotFound) {
        throw new NotFoundError(this.tableName, id);
      }
      
      return result.changes > 0;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      throw new DatabaseError(`Failed to soft delete ${this.tableName}`, { cause: error, entityId: id });
    }
  }

  /**
   * Restore a soft-deleted entity
   */
  restore(id: number, options: UpdateOptions = {}): boolean {
    try {
      const query = `UPDATE ${this.tableName} SET is_active = 1, updated_at = datetime('now') WHERE id = ?`;
      const result = this.db.prepare(query).run(id);
      
      if (result.changes === 0 && options.throwOnNotFound) {
        throw new NotFoundError(this.tableName, id);
      }
      
      return result.changes > 0;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      throw new DatabaseError(`Failed to restore ${this.tableName}`, { cause: error, entityId: id });
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
   * Execute a raw query (use with caution)
   */
  protected query<R>(sql: string, ...params: unknown[]): R[] {
    try {
      return this.db.prepare(sql).all(...params) as R[];
    } catch (error) {
      throw new DatabaseError('Query execution failed', { cause: error });
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
      console.error('[BaseRepository] Query failed:', sql, params, error);
      throw new DatabaseError('Query execution failed', { cause: error });
    }
  }

  /**
   * Execute a raw statement (INSERT/UPDATE/DELETE)
   */
  protected execute(sql: string, ...params: unknown[]): Database.RunResult {
    try {
      return this.db.prepare(sql).run(...params);
    } catch (error) {
      throw new DatabaseError('Statement execution failed', { cause: error });
    }
  }
}
