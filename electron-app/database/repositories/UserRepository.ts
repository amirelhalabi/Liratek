/**
 * User Repository
 *
 * Handles all database operations for users.
 * Extends BaseRepository for standard CRUD operations.
 */

import { BaseRepository, type FindOptions } from "./BaseRepository.js";
import { DatabaseError } from "../../utils/errors.js";

// =============================================================================
// Types
// =============================================================================

export interface UserEntity {
  id: number;
  username: string;
  password_hash: string;
  role: "admin" | "cashier" | "staff";
  is_active: number; // SQLite boolean (0 or 1)
}

/** User without sensitive password hash */
export type SafeUser = Omit<UserEntity, "password_hash">;

export interface CreateUserData {
  username: string;
  password_hash: string;
  role: "admin" | "cashier";
  is_active?: number;
}

export interface UpdateUserData {
  username?: string;
  password_hash?: string;
  role?: "admin" | "cashier";
  is_active?: number;
}

// =============================================================================
// Repository
// =============================================================================

export class UserRepository extends BaseRepository<UserEntity> {
  constructor() {
    super("users", { softDelete: true });
  }

  // ---------------------------------------------------------------------------
  // User-Specific Queries
  // ---------------------------------------------------------------------------

  /**
   * Find a user by username (for login)
   */
  findByUsername(username: string): UserEntity | null {
    try {
      const query = `SELECT * FROM ${this.tableName} WHERE username = ? AND is_active = 1`;
      return this.queryOne<UserEntity>(query, username);
    } catch (error) {
      throw new DatabaseError("Failed to find user by username", {
        cause: error,
      });
    }
  }

  /**
   * Find a user by username including inactive users
   */
  findByUsernameIncludingInactive(username: string): UserEntity | null {
    try {
      const query = `SELECT * FROM ${this.tableName} WHERE username = ?`;
      return this.queryOne<UserEntity>(query, username);
    } catch (error) {
      throw new DatabaseError("Failed to find user by username", {
        cause: error,
      });
    }
  }

  /**
   * Check if username already exists
   */
  usernameExists(username: string, excludeId?: number): boolean {
    try {
      const query = excludeId
        ? `SELECT 1 FROM ${this.tableName} WHERE username = ? AND id != ?`
        : `SELECT 1 FROM ${this.tableName} WHERE username = ?`;

      const params = excludeId ? [username, excludeId] : [username];
      return this.queryOne<{ 1: number }>(query, ...params) !== null;
    } catch (error) {
      throw new DatabaseError("Failed to check username existence", {
        cause: error,
      });
    }
  }

  /**
   * Get all users without password hash (safe for API responses)
   */
  findAllSafe(options: FindOptions = {}): SafeUser[] {
    try {
      const {
        limit,
        offset = 0,
        orderBy = "id",
        orderDirection = "DESC",
      } = options;

      let query = `SELECT id, username, role, is_active 
                   FROM ${this.tableName} WHERE is_active = 1`;

      query += ` ORDER BY ${orderBy} ${orderDirection}`;

      if (limit !== undefined) {
        query += ` LIMIT ? OFFSET ?`;
        return this.query<SafeUser>(query, limit, offset);
      }

      return this.query<SafeUser>(query);
    } catch (error) {
      throw new DatabaseError("Failed to find all users", { cause: error });
    }
  }

  /**
   * Get all users including inactive, without password hash
   */
  findAllIncludingInactive(options: FindOptions = {}): SafeUser[] {
    try {
      const {
        limit,
        offset = 0,
        orderBy = "id",
        orderDirection = "DESC",
      } = options;

      let query = `SELECT id, username, role, is_active 
                   FROM ${this.tableName}`;

      query += ` ORDER BY ${orderBy} ${orderDirection}`;

      if (limit !== undefined) {
        query += ` LIMIT ? OFFSET ?`;
        return this.query<SafeUser>(query, limit, offset);
      }

      return this.query<SafeUser>(query);
    } catch (error) {
      throw new DatabaseError("Failed to find all users", { cause: error });
    }
  }

  /**
   * Get user by ID without password hash (safe for API responses)
   */
  findByIdSafe(id: number): SafeUser | null {
    try {
      const query = `SELECT id, username, role, is_active 
                     FROM ${this.tableName} WHERE id = ? AND is_active = 1`;
      return this.queryOne<SafeUser>(query, id);
    } catch (error) {
      throw new DatabaseError("Failed to find user by id", {
        cause: error,
        entityId: id,
      });
    }
  }

  /**
   * Count users by role
   */
  countByRole(role: "admin" | "cashier"): number {
    try {
      const query = `SELECT COUNT(*) as count FROM ${this.tableName} WHERE role = ? AND is_active = 1`;
      const result = this.queryOne<{ count: number }>(query, role);
      return result?.count ?? 0;
    } catch (error) {
      throw new DatabaseError("Failed to count users by role", {
        cause: error,
      });
    }
  }

  /**
   * Get the count of active admins (for preventing last admin deletion)
   */
  countActiveAdmins(): number {
    return this.countByRole("admin");
  }

  /**
   * Update user's password hash
   */
  updatePassword(id: number, passwordHash: string): boolean {
    try {
      const query = `UPDATE ${this.tableName} SET password_hash = ? WHERE id = ?`;
      const result = this.execute(query, passwordHash, id);
      return result.changes > 0;
    } catch (error) {
      throw new DatabaseError("Failed to update password", {
        cause: error,
        entityId: id,
      });
    }
  }

  /**
   * Create a new user
   */
  createUser(data: CreateUserData): UserEntity {
    try {
      const query = `INSERT INTO ${this.tableName} (username, password_hash, role, is_active) 
                     VALUES (?, ?, ?, ?)`;

      const result = this.execute(
        query,
        data.username,
        data.password_hash,
        data.role,
        data.is_active ?? 1,
      );
      const insertedId = result.lastInsertRowid as number;

      return this.findByIdOrFail(insertedId);
    } catch (error) {
      throw new DatabaseError("Failed to create user", { cause: error });
    }
  }

  /**
   * Update user details (excludes password)
   */
  updateUser(
    id: number,
    data: Omit<UpdateUserData, "password_hash">,
  ): SafeUser | null {
    const updated = this.update(id, data);
    if (!updated) return null;
    return this.findByIdSafe(id);
  }

  /**
   * Override soft delete - users table doesn't have updated_at column
   */
  override softDeleteById(id: number): boolean {
    try {
      const query = `UPDATE ${this.tableName} SET is_active = 0 WHERE id = ?`;
      const result = this.execute(query, id);
      return result.changes > 0;
    } catch (error) {
      throw new DatabaseError("Failed to deactivate user", {
        cause: error,
        entityId: id,
      });
    }
  }

  /**
   * Override restore - users table doesn't have updated_at column
   */
  override restore(id: number): boolean {
    try {
      const query = `UPDATE ${this.tableName} SET is_active = 1 WHERE id = ?`;
      const result = this.execute(query, id);
      return result.changes > 0;
    } catch (error) {
      throw new DatabaseError("Failed to reactivate user", {
        cause: error,
        entityId: id,
      });
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let userRepositoryInstance: UserRepository | null = null;

export function getUserRepository(): UserRepository {
  if (!userRepositoryInstance) {
    userRepositoryInstance = new UserRepository();
  }
  return userRepositoryInstance;
}

/** Reset the singleton (for testing) */
export function resetUserRepository(): void {
  userRepositoryInstance = null;
}
