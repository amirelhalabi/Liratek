/**
 * User Repository
 *
 * Handles all database operations for users.
 * Extends BaseRepository for standard CRUD operations.
 */

import { BaseRepository, type FindOptions } from "./BaseRepository.js";
import { getCurrentTenantId, runWithoutTenant } from "../db/tenantContext.js";
import { DatabaseError, EmailTakenInShopError } from "../utils/errors.js";

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

/**
 * "A shop's FIRST ADMIN", defined once (rule 14): the lowest-id ACTIVE user
 * with role 'admin' in the shop. Used by impersonation ("connect as" lands on
 * this account) and by migration v196's email backfill, which restates it in
 * SQL because migrations cannot import repositories — keep the two equal.
 * Bind: tenant_id.
 */
export const FIRST_ADMIN_WHERE =
  "tenant_id = ? AND role = 'admin' AND is_active = 1";
export const FIRST_ADMIN_ORDER = "ORDER BY id LIMIT 1";

/**
 * How an email is stored and compared, everywhere: trimmed + lowercased
 * (v196). Applied INSIDE the repository, not only in the zod schemas,
 * because provisioning and the backfill never pass through a schema — this
 * normalisation is what makes the plain `idx_users_tenant_email` unique index
 * case-insensitive in practice.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * True for SQLite's UNIQUE violation on `idx_users_tenant_email`, looking
 * through the `DatabaseError` wrapper `BaseRepository.execute` adds (the
 * driver error is its `details.cause`).
 */
function isEmailUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 4; depth++) {
    // Duck-typed, not `instanceof Error`: better-sqlite3's SqliteError can
    // come from another realm (one native module, many jest contexts).
    const raw = (current as { message?: unknown }).message;
    const message = typeof raw === "string" ? raw : "";
    if (
      /UNIQUE constraint failed: users\.tenant_id, users\.email/.test(message)
    ) {
      return true;
    }
    const details = (current as { details?: { cause?: unknown } }).details;
    current = details?.cause ?? (current as { cause?: unknown }).cause;
  }
  return false;
}

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

/** A user's account email (v196). `email_verified_at` is a UTC ISO instant,
 * or null while unverified. */
export interface UserEmailInfo {
  email: string | null;
  email_verified_at: string | null;
}

/**
 * "This email can sign in to that shop" (LIRA-287), defined once (rule 14):
 * an ACTIVE user (never a super admin) whose email is VERIFIED, in an
 * ACTIVE shop. It gates the www sign-in code (a code is only mailed to such
 * an email), builds the "your shops" list a valid code returns, and picks
 * the shops a www "Forgot password?" mails a reset link for. `u` is users,
 * `t` is tenants. Bind: the normalised email.
 */
const SIGNIN_ACCOUNT_FROM = `
  FROM users u
  JOIN tenants t ON t.id = u.tenant_id
 WHERE u.email = ?
   AND u.email_verified_at IS NOT NULL
   AND u.is_active = 1
   AND u.role <> 'super_admin'
   AND t.status = 'active'`;

/** One shop an email signs in to (see `SIGNIN_ACCOUNT_FROM`). */
export interface SigninAccount {
  tenant_id: number;
  slug: string;
  shop_name: string;
  user_id: number;
  username: string;
}

/** A user row plus its account email — returned by the by-email lookups. */
export type UserWithEmail = UserEntity & UserEmailInfo;

/** One row of `listEmails()`. */
export interface UserEmailRow extends UserEmailInfo {
  id: number;
}

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
  /** v196: optional account email, normalised here. Omitted = not written
   * (so a caller on a pre-v196 table shape is unaffected). */
  email?: string | null;
  /** v196: UTC ISO instant the email was proven, or null. */
  email_verified_at?: string | null;
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
   * Status of the tenant a user belongs to — the SINGLE place (rule 14) both
   * the login gate (`AuthService.login`) and session validation
   * (`AuthService.validateSession`) read tenant status from.
   *
   * Forces PLATFORM scope internally (`runWithoutTenant`), never trusting the
   * caller's ambient scope: `tenants` is a control-plane table, and once
   * `TENANT_DB_MODE=per-tenant` is set, each shop file keeps only a local
   * MIRROR row that nobody updates when a super admin suspends the shop on
   * the platform (`PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` § 12.2 — "the
   * platform row is the truth"). A caller reached from inside the shop's own
   * `runWithTenant(shopId)` scope (login runs there per B-D2; so does session
   * validation, per B-D1) must still land on the platform file, not the
   * shop's. In `shared` mode `runWithoutTenant()` still resolves to the one
   * shared file, so this is a no-op there — behaviour is unchanged.
   */
  getTenantStatus(
    tenantId: number,
  ): "active" | "suspended" | "archived" | null {
    return runWithoutTenant(() => {
      try {
        const query = `SELECT status FROM tenants /* tenant-exempt: control-plane status read, forced to platform scope regardless of the caller's ambient tenant */ WHERE id = ?`;
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
    });
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
      const query = `SELECT ${this.getColumns()} FROM ${this.tableName} /* tenant-exempt: control-plane cross-tenant lookup — target tenant is an explicit param */ WHERE ${FIRST_ADMIN_WHERE} ${FIRST_ADMIN_ORDER}`;
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

      // The email columns are written only when the caller supplies them,
      // so a caller (or test) on a pre-v196 table shape is unaffected.
      const withEmail = data.email !== undefined;
      const query = withEmail
        ? `INSERT INTO ${this.tableName} (username, password_hash, role, is_active, tenant_id, email, email_verified_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`
        : `INSERT INTO ${this.tableName} (username, password_hash, role, is_active, tenant_id)
                     VALUES (?, ?, ?, ?, ?)`;
      const params: (string | number | null)[] = [
        data.username,
        data.password_hash,
        data.role,
        data.is_active ?? 1,
        tenantId,
      ];
      if (withEmail) {
        const email = data.email ? normalizeEmail(data.email) : null;
        params.push(email, email ? (data.email_verified_at ?? null) : null);
      }

      const result = this.execute(query, ...params);
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
      if (isEmailUniqueViolation(error)) throw new EmailTakenInShopError();
      throw new DatabaseError("Failed to create user", { cause: error });
    }
  }

  // ---------------------------------------------------------------------------
  // Account email (v196, LIRA-279)
  //
  // Deliberately NOT part of getColumns(): the login and session paths, and
  // the many tests that hand-build a pre-v196 `users` table, keep working
  // untouched. `users` has no updated_at column, so none of these write one.
  // ---------------------------------------------------------------------------

  /**
   * Set (or clear, with null) a user's email in the CURRENT shop. The email
   * is normalised; `verifiedAt` is stored only alongside a non-null email.
   * Returns false when the id is not a user of the current shop. Throws
   * `EmailTakenInShopError` (code EMAIL_TAKEN_IN_SHOP) when another user in
   * the shop already has the address.
   */
  setEmail(
    userId: number,
    email: string | null,
    verifiedAt: string | null,
  ): boolean {
    const normalized = email ? normalizeEmail(email) : null;
    try {
      const result = this.execute(
        `UPDATE ${this.tableName} SET email = ?, email_verified_at = ? WHERE id = ? AND tenant_id = ?`,
        normalized,
        normalized ? verifiedAt : null,
        userId,
        getCurrentTenantId(),
      );
      return result.changes > 0;
    } catch (error) {
      if (isEmailUniqueViolation(error)) throw new EmailTakenInShopError();
      throw new DatabaseError("Failed to set user email", {
        cause: error,
        entityId: userId,
      });
    }
  }

  /**
   * Mark the user's email verified — but only if it is STILL `email` (the
   * address the verification link was sent to). A link for an address the
   * user has since changed verifies nothing. Current shop only.
   */
  markEmailVerified(
    userId: number,
    email: string,
    verifiedAt: string,
  ): boolean {
    try {
      const result = this.execute(
        `UPDATE ${this.tableName} SET email_verified_at = ? WHERE id = ? AND tenant_id = ? AND email = ?`,
        verifiedAt,
        userId,
        getCurrentTenantId(),
        normalizeEmail(email),
      );
      return result.changes > 0;
    } catch (error) {
      throw new DatabaseError("Failed to mark user email verified", {
        cause: error,
        entityId: userId,
      });
    }
  }

  /** A current-shop user's email, or null when no such user. */
  getEmail(userId: number): UserEmailInfo | null {
    try {
      return this.queryOne<UserEmailInfo>(
        `SELECT email, email_verified_at FROM ${this.tableName} WHERE id = ? AND tenant_id = ?`,
        userId,
        getCurrentTenantId(),
      );
    } catch (error) {
      throw new DatabaseError("Failed to load user email", {
        cause: error,
        entityId: userId,
      });
    }
  }

  /** Every current-shop user's email (active or not), for the Users list. */
  listEmails(): UserEmailRow[] {
    try {
      return this.query<UserEmailRow>(
        `SELECT id, email, email_verified_at FROM ${this.tableName} WHERE tenant_id = ? ORDER BY id`,
        getCurrentTenantId(),
      );
    } catch (error) {
      throw new DatabaseError("Failed to list user emails", { cause: error });
    }
  }

  /**
   * The ACTIVE user with this email in an explicit shop (forgot password,
   * invite duplicate check). The realm is passed by the caller — resolved
   * from the request host or a typed shop address before any tenant context
   * exists — like `findByUsernameInRealm`. Case-insensitive via
   * normalisation. Returns whether the email is verified; callers decide
   * whether an unverified address may receive mail.
   */
  findByEmailInTenant(email: string, tenantId: number): UserWithEmail | null {
    try {
      return this.queryOne<UserWithEmail>(
        `SELECT ${this.getColumns()}, email, email_verified_at FROM ${this.tableName} /* tenant-exempt: explicit realm supplied by caller */ WHERE tenant_id = ? AND email = ? AND is_active = 1`,
        tenantId,
        normalizeEmail(email),
      );
    } catch (error) {
      throw new DatabaseError("Failed to find user by email", {
        cause: error,
      });
    }
  }

  /**
   * Gives a CURRENT-shop user an email only if they have none (LIRA-287:
   * connecting Google makes Google's verified address the account email).
   * Never overwrites. Returns false — and changes nothing — when the user
   * already has an email, is not in this shop, or another user of the shop
   * holds the address (unique per shop).
   */
  setEmailIfAbsent(userId: number, email: string, verifiedAt: string): boolean {
    try {
      const result = this.execute(
        `UPDATE ${this.tableName} SET email = ?, email_verified_at = ? WHERE id = ? AND tenant_id = ? AND email IS NULL`,
        normalizeEmail(email),
        verifiedAt,
        userId,
        getCurrentTenantId(),
      );
      return result.changes > 0;
    } catch (error) {
      if (isEmailUniqueViolation(error)) return false;
      throw new DatabaseError("Failed to set user email", {
        cause: error,
        entityId: userId,
      });
    }
  }

  /**
   * Every shop this email signs in to (`SIGNIN_ACCOUNT_FROM`), by shop name.
   * Cross-tenant by design: the www sign-in has no shop yet. SHARED DB mode
   * only — in per-tenant mode each shop's users live in their own file, so a
   * platform-level email -> (shop, user) index is needed before that split
   * goes live (the same follow-up as `UserIdentityRepository
   * .findBySubjectAllTenants`).
   */
  findSigninAccountsByEmail(email: string): SigninAccount[] {
    try {
      return this.query<SigninAccount>(
        `SELECT t.id AS tenant_id, t.slug AS slug, t.name AS shop_name,
                u.id AS user_id, u.username AS username
           ${SIGNIN_ACCOUNT_FROM} /* tenant-exempt: www sign-in lists every shop an email signs in to, before any shop is chosen */
          ORDER BY t.name COLLATE NOCASE, t.id, u.username COLLATE NOCASE`,
        normalizeEmail(email),
      );
    } catch (error) {
      throw new DatabaseError("Failed to find shops by email", {
        cause: error,
      });
    }
  }

  /**
   * Update user details (excludes password).
   *
   * Deliberately NOT delegating to the generic `BaseRepository.update()`:
   * that unconditionally appends `updated_at = datetime('now')` to its SET
   * clause, and — same reason `softDeleteById`/`restore` below are already
   * overridden — the `users` table has no `updated_at` column, so the
   * generic path would throw "no such column: updated_at" the first time
   * this method is actually called (it was dead code with zero callers
   * until `AuthService.setUserRole` started using it). This mirrors
   * `softDeleteById`/`restore`'s fix shape: an explicit, tenant-scoped
   * UPDATE that never references `updated_at`.
   *
   * Tenant-scoped like every other write here: an `id` belonging to
   * another tenant matches zero rows and this returns `null`, the same
   * outcome as an `id` that does not exist at all.
   */
  updateUser(
    id: number,
    data: Omit<UpdateUserData, "password_hash">,
  ): SafeUser | null {
    const columns = Object.keys(data);
    if (columns.length === 0) return this.findByIdSafe(id);

    try {
      const setClause = columns.map((col) => `${col} = ?`).join(", ");
      const values = Object.values(data);
      const query = `UPDATE ${this.tableName} SET ${setClause} WHERE id = ? AND tenant_id = ?`;
      const result = this.execute(query, ...values, id, getCurrentTenantId());
      if (result.changes === 0) return null;
      return this.findByIdSafe(id);
    } catch (error) {
      throw new DatabaseError("Failed to update user", {
        cause: error,
        entityId: id,
      });
    }
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
