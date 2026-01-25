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
export declare abstract class BaseRepository<T extends BaseEntity> {
    protected readonly tableName: string;
    protected readonly softDelete: boolean;
    constructor(tableName: string, options?: {
        softDelete?: boolean;
    });
    /**
     * Get database instance
     */
    protected get db(): Database.Database;
    /**
     * Find an entity by ID
     */
    findById(id: number): T | null;
    /**
     * Find an entity by ID, throwing if not found
     */
    findByIdOrFail(id: number): T;
    /**
     * Find all entities with optional pagination
     */
    findAll(options?: FindOptions): T[];
    /**
     * Find all entities with pagination info
     */
    findAllPaginated(options?: FindOptions): PaginatedResult<T>;
    /**
     * Count all entities
     */
    count(): number;
    /**
     * Check if an entity exists by ID
     */
    exists(id: number): boolean;
    /**
     * Create a new entity
     */
    create(data: Omit<T, "id" | "created_at" | "updated_at">): T;
    /**
     * Update an entity by ID
     */
    update(id: number, data: Partial<Omit<T, "id" | "created_at">>, options?: UpdateOptions): T | null;
    /**
     * Delete an entity by ID (hard delete)
     */
    delete(id: number, options?: UpdateOptions): boolean;
    /**
     * Soft delete an entity by ID (sets is_active = 0)
     */
    softDeleteById(id: number, options?: UpdateOptions): boolean;
    /**
     * Restore a soft-deleted entity
     */
    restore(id: number, options?: UpdateOptions): boolean;
    /**
     * Execute a function within a transaction
     */
    transaction<R>(fn: () => R): R;
    /**
     * Execute a raw query (use with caution)
     */
    protected query<R>(sql: string, ...params: unknown[]): R[];
    /**
     * Execute a raw query that returns a single row
     */
    protected queryOne<R>(sql: string, ...params: unknown[]): R | null;
    /**
     * Execute a raw statement (INSERT/UPDATE/DELETE)
     */
    protected execute(sql: string, ...params: unknown[]): Database.RunResult;
}
