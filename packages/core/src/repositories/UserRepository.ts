/**
 * User Repository
 *
 * Handles all database operations for users.
 * Extends BaseRepository for standard CRUD operations.
 */

import { BaseRepository, type FindOptions } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { DatabaseError } from "../utils/errors.js";

/**
 * How a username is matched, everywhere. Defined once (rule 14) because the
 * one thing that must never drift is this predicate against the collation of
 * `idx_users_tenant_username` / `idx_users_platform_username`.
 *
 * Migration v174 made those indexes `COLLATE NOCASE`, so 'admin' and 'Admin'
 * are one name. If a lookup here stayed case-SENSITIVE the pair would
 * disagree, and the failure is nasty: a user registered as 'Admin' types
 * 'admin', matches no row, and is told their password is wrong. Uniqueness
 * and lookup are two halves of one decision.
 *
 * COLLATE sits on the LEFT operand so it matches the indexed expression
 * exactly and the planner uses the index rather than scanning.
 *
 * Folds ASCII A-Z only — SQLite's NOCASE does not case-fold non-ASCII.
 */
const USERNAME_MATCH = "username COLLATE NOCASE = ?";

// =============================================================================
// Types
// =============================================================================

export interface UserEntity {
  id: number;
  username: string;
  password_hash: string;
  /** `super_admin` = platform realm (web control plane); always has `tenant_id` NULL. */
  role: "super_admin" | "admin" | "staff";
  is_active: number; // SQLite boolean (0 or 1)
  /** NULL only for the platform realm (`super_admin`); every tenant user carries its tenant. */
  tenant_id: number | null;
}

/** User without sensitive password hash */
export type SafeUser = Omit<UserEntity, "password_hash">;

export interface CreateUserData {
  username: string;
  password_hash: string;
  role: "super_admin" | "admin" | "staff";
  is_active?: number;
  /**
   * Tenant realm for the new user. When omitted, defaults to the current
   * tenant context (desktop/Electron callers run under the fixed tenant, web
   * callers under the request's `runWithTenant()` scope). Pass an explicit
   * `null` ONLY for platform-realm users (`super_admin` bootstrap).
   */
  tenant_id?: number | null;
}

export interface UpdateUserData {
  username?: string;
  password_hash?: string;
  role?: "admin" | "staff";
  is_active?: number;
}

// =============================================================================
// Repository
// =============================================================================

export class UserRepository extends BaseRepository<UserEntity> {
  constructor() {
    // Disable automatic softDelete (is_deleted check) since users table uses is_active
    // BaseRepository will still filter by is_active=1 automatically because the column exists
    super("users", { softDelete: false });
  }

  // Override getColumns() to use explicit columns instead of SELECT *
  protected getColumns(): string {
    return "id, username, password_hash, role, is_active, tenant_id";
  }

  // ---------------------------------------------------------------------------
  // User-Specific Queries
  // ---------------------------------------------------------------------------

  /**
   * Find a user by username (for login).
   *
   * Deliberately GLOBAL (not tenant-scoped): usernames are globally unique —
   * committed decision, see docs/plans/todo_plans/MULTI_TENANT_IMPLEMENTATION_PLAN.md §1.
   * Login has no tenant hint (no subdomain routing yet), so
   * `username → user → tenant_id` is how the tenant is resolved in the first
   * place.
   */
  findByUsername(username: string): UserEntity | null {
    try {
      const query = `SELECT ${this.getColumns()} FROM ${this.tableName} /* tenant-exempt: global username lookup — login happens before tenant context exists */ WHERE ${USERNAME_MATCH} AND is_active = 1`;
      return this.queryOne<UserEntity>(query, username);
    } catch (error) {
      throw new DatabaseError("Failed to find user by username", {
        cause: error,
      });
    }
  }

  /**
   * Find a user by id across ALL tenants (global).
   *
   * Auth-path only: session validation resolves the session's user BEFORE
   * any tenant context exists (the backend middleware establishes tenant
   * context only AFTER the session is validated), and platform users
   * (`super_admin`, `tenant_id` NULL) live outside every tenant, so the
   * tenant-scoped `findById` could never see them.
   */
  findByIdGlobal(id: number): UserEntity | null {
    try {
      const query = `SELECT ${this.getColumns()} FROM ${this.tableName} /* tenant-exempt: global user-by-id lookup for session validation — runs before tenant context exists; platform users have tenant_id NULL */ WHERE id = ?`;
      return this.queryOne<UserEntity>(query, id);
    } catch (error) {
      throw new DatabaseError("Failed to find user by id (global)", {
        cause: error,
        entityId: id,
      });
    }
  }

  /**
   * Status of the tenant a user belongs to (login gate — suspended tenants
   * cannot log in). `tenants` is a control-plane table (never tenant-scoped).
   */
  getTenantStatus(
    tenantId: number,
  ): "active" | "suspended" | "archived" | null {
    try {
      const query = `SELECT status FROM tenants WHERE id = ?`;
      const row = this.queryOne<{
        status: "active" | "suspended" | "archived";
      }>(query, tenantId);
      return row?.status ?? null;
    } catch (error) {
      throw new DatabaseError("Failed to load tenant status", {
        cause: error,
        entityId: tenantId,
      });
    }
  }

  /**
   * Find the first active tenant admin for an explicit tenant (impersonation
   * target lookup — plan §5/WP6: "connect as" always lands on the tenant's
   * own admin, never a staff account).
   *
   * Deliberately GLOBAL by construction (bound to the `tenantId` PARAMETER,
   * not `getCurrentTenantId()`): the only caller is the super-admin-only
   * impersonation route, which has no tenant context of its own — the whole
   * point is to reach INTO an arbitrary target tenant. Call from inside
   * `runWithoutTenant()` (control-plane cross-tenant lookup).
   */
  findFirstActiveAdminByTenant(tenantId: number): UserEntity | null {
    try {
      const query = `SELECT ${this.getColumns()} FROM ${this.tableName} /* tenant-exempt: control-plane cross-tenant lookup — target tenant is an explicit param */ WHERE tenant_id = ? AND role = 'admin' AND is_active = 1 ORDER BY id LIMIT 1`;
      return this.queryOne<UserEntity>(query, tenantId);
    } catch (error) {
      throw new DatabaseError("Failed to find first active tenant admin", {
        cause: error,
        entityId: tenantId,
      });
    }
  }

  /**
   * Whether an active platform super admin exists (startup bootstrap check).
   */
  hasActiveSuperAdmin(): boolean {
    try {
      const query = `SELECT 1 FROM ${this.tableName} /* tenant-exempt: super_admin realm lookup — platform users have tenant_id NULL, outside every tenant */ WHERE role = 'super_admin' AND is_active = 1 LIMIT 1`;
      return this.queryOne<{ 1: number }>(query) !== null;
    } catch (error) {
      throw new DatabaseError("Failed to check for super admin", {
        cause: error,
      });
    }
  }

  /**
   * Find a user by username including inactive users.
   *
   * Deliberately GLOBAL, same rationale as `findByUsername`: usernames are
   * globally unique (plan §1), so a "by username" lookup is definitionally
   * cross-tenant — there is at most one row anywhere in the DB with a given
   * username.
   */
  findByUsernameIncludingInactive(username: string): UserEntity | null {
    try {
      const query = `SELECT ${this.getColumns()} FROM ${this.tableName} /* tenant-exempt: username stays globally unique (plan §1) — a by-username lookup is inherently cross-tenant */ WHERE ${USERNAME_MATCH}`;
      return this.queryOne<UserEntity>(query, username);
    } catch (error) {
      throw new DatabaseError("Failed to find user by username", {
        cause: error,
      });
    }
  }

  /**
   * Check if username already exists.
   *
   * Deliberately GLOBAL: `users.username` carries a single global UNIQUE
   * constraint (not per-tenant — plan §1), so this check MUST search across
   * every tenant. Scoping it to the current tenant would let the app-level
   * check report "available" for a username already taken by another
   * tenant, and the subsequent INSERT would then fail on the (still global)
   * UNIQUE constraint instead of the clean `ConflictError` callers expect.
   */
  /**
   * Look a user up WITHIN one realm.
   *
   * Since v172 usernames are unique per tenant, not globally, so a bare
   * by-username lookup can match more than one row. A realm is a tenant id,
   * or null for the platform realm (super_admins, tenant_id NULL).
   *
   * Deliberately tenant-exempt in SQL: the realm is passed explicitly by the
   * caller (resolved from the request host at login, before any tenant
   * context exists), so this must not be re-filtered by ambient context.
   */
  findByUsernameInRealm(
    username: string,
    realm: number | null,
  ): UserEntity | null {
    try {
      const query =
        realm === null
          ? `SELECT ${this.getColumns()} FROM ${this.tableName} /* tenant-exempt: explicit realm (platform) supplied by caller */ WHERE ${USERNAME_MATCH} AND tenant_id IS NULL AND is_active = 1`
          : `SELECT ${this.getColumns()} FROM ${this.tableName} /* tenant-exempt: explicit realm supplied by caller */ WHERE ${USERNAME_MATCH} AND tenant_id = ? AND is_active = 1`;
      const params = realm === null ? [username] : [username, realm];
      return (
        (this.queryOne<UserEntity>(query, ...params) as UserEntity) ?? null
      );
    } catch (error) {
      throw new DatabaseError("Failed to find user by username in realm", {
        cause: error,
      });
    }
  }

  /**
   * How many ACTIVE users share this username across all realms.
   *
   * Used to detect ambiguity when no realm is known (host-based tenancy off):
   * one match can be authenticated safely, two cannot be told apart, and
   * guessing would let someone reach a tenant that is not theirs.
   */
  countByUsername(username: string): number {
    try {
      const row = this.queryOne<{ c: number }>(
        `SELECT COUNT(*) AS c FROM ${this.tableName} /* tenant-exempt: ambiguity detection is inherently cross-realm */ WHERE ${USERNAME_MATCH} AND is_active = 1`,
        username,
      );
      return row?.c ?? 0;
    } catch (error) {
      throw new DatabaseError("Failed to count users by username", {
        cause: error,
      });
    }
  }

  /**
   * The deployment's FIRST tenant — its incumbent shop.
   *
   * Needed to disambiguate a login when host-based tenancy is off: the lowest
   * tenant id is the one the deployment was seeded with, so it is the tenant
   * whose users were working before any other tenant existed. Deliberately
   * `MIN(id)` rather than a hardcoded 1 or the 'default' slug — neither is
   * guaranteed by the schema, whereas "created first" is exactly the property
   * that makes a tenant the incumbent.
   *
   * Returns null on an empty registry (nothing to anchor to).
   */
  getAnchorTenantId(): number | null {
    try {
      const row = this.queryOne<{ id: number | null }>(
        `SELECT MIN(id) AS id FROM tenants WHERE status = 'active'`,
      );
      return row?.id ?? null;
    } catch (error) {
      throw new DatabaseError("Failed to resolve the anchor tenant", {
        cause: error,
      });
    }
  }

  /**
   * Is this username taken WITHIN one realm?
   *
   * Replaces the global usernameExists for creation paths: since v172 the DB
   * enforces UNIQUE(tenant_id, username) plus a partial UNIQUE for the
   * platform realm, so a global check would reject a name that is perfectly
   * available in the caller's own tenant.
   */
  usernameExistsInRealm(
    username: string,
    realm: number | null,
    excludeId?: number,
  ): boolean {
    try {
      const realmClause =
        realm === null ? `tenant_id IS NULL` : `tenant_id = ?`;
      const excludeClause = excludeId !== undefined ? ` AND id != ?` : ``;
      const query = `SELECT 1 FROM ${this.tableName} /* tenant-exempt: explicit realm supplied by caller */ WHERE ${USERNAME_MATCH} AND ${realmClause}${excludeClause}`;
      const params: (string | number)[] = [username];
      if (realm !== null) params.push(realm);
      if (excludeId !== undefined) params.push(excludeId);
      // queryOne returns R | null (BaseRepository), never undefined -- an
      // undefined comparison here would have been true for every username.
      return this.queryOne(query, ...params) !== null;
    } catch (error) {
      throw new DatabaseError("Failed to check username in realm", {
        cause: error,
      });
    }
  }
  usernameExists(username: string, excludeId?: number): boolean {
    try {
      const query = excludeId
        ? `SELECT 1 FROM ${this.tableName} /* tenant-exempt: username stays globally unique (plan §1) — this check must search every tenant or a same-username collision across tenants would pass here and only fail later at the DB's global UNIQUE constraint */ WHERE ${USERNAME_MATCH} AND id != ?`
        : `SELECT 1 FROM ${this.tableName} /* tenant-exempt: username stays globally unique (plan §1) — this check must search every tenant or a same-username collision across tenants would pass here and only fail later at the DB's global UNIQUE constraint */ WHERE ${USERNAME_MATCH}`;

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
      const tenantId = getCurrentTenantId();

      let query = `SELECT id, username, role, is_active
                   FROM ${this.tableName} WHERE is_active = 1 AND tenant_id = ?`;

      query += ` ORDER BY ${orderBy} ${orderDirection}`;

      if (limit !== undefined) {
        query += ` LIMIT ? OFFSET ?`;
        return this.query<SafeUser>(query, tenantId, limit, offset);
      }

      return this.query<SafeUser>(query, tenantId);
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
      const tenantId = getCurrentTenantId();

      let query = `SELECT id, username, role, is_active
                   FROM ${this.tableName} WHERE tenant_id = ?`;

      query += ` ORDER BY ${orderBy} ${orderDirection}`;

      if (limit !== undefined) {
        query += ` LIMIT ? OFFSET ?`;
        return this.query<SafeUser>(query, tenantId, limit, offset);
      }

      return this.query<SafeUser>(query, tenantId);
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
                     FROM ${this.tableName} WHERE id = ? AND is_active = 1 AND tenant_id = ?`;
      return this.queryOne<SafeUser>(query, id, getCurrentTenantId());
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
  countByRole(role: "admin" | "staff"): number {
    try {
      const query = `SELECT COUNT(*) as count FROM ${this.tableName} WHERE role = ? AND is_active = 1 AND tenant_id = ?`;
      const result = this.queryOne<{ count: number }>(
        query,
        role,
        getCurrentTenantId(),
      );
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
      const query = `UPDATE ${this.tableName} SET password_hash = ? WHERE id = ? AND tenant_id = ?`;
      const result = this.execute(
        query,
        passwordHash,
        id,
        getCurrentTenantId(),
      );
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
   *
   * `tenant_id` comes from the explicit param when provided (control-plane
   * callers: super-admin bootstrap passes `null`), otherwise from the current
   * tenant context (desktop/Electron and normal web callers).
   */
  createUser(data: CreateUserData): UserEntity {
    try {
      const tenantId =
        data.tenant_id !== undefined ? data.tenant_id : getCurrentTenantId();

      const query = `INSERT INTO ${this.tableName} (username, password_hash, role, is_active, tenant_id)
                     VALUES (?, ?, ?, ?, ?)`;

      const result = this.execute(
        query,
        data.username,
        data.password_hash,
        data.role,
        data.is_active ?? 1,
        tenantId,
      );
      const insertedId = result.lastInsertRowid as number;

      // Global fetch by the fresh rowid: a platform-realm user (tenant_id
      // NULL) is invisible to the tenant-scoped findById by design.
      const created = this.findByIdGlobal(insertedId);
      if (!created) {
        throw new DatabaseError("Created user row could not be reloaded", {
          entityId: insertedId,
        });
      }
      return created;
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
      const query = `UPDATE ${this.tableName} SET is_active = 0 WHERE id = ? AND tenant_id = ?`;
      const result = this.execute(query, id, getCurrentTenantId());
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
      const query = `UPDATE ${this.tableName} SET is_active = 1 WHERE id = ? AND tenant_id = ?`;
      const result = this.execute(query, id, getCurrentTenantId());
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
