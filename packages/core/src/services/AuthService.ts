/**
 * Authentication Service
 *
 * Business logic layer for authentication operations.
 * Uses UserRepository for data access and crypto utils for password handling.
 *
 * This service encapsulates:
 * - Login/logout logic
 * - Password verification and hashing
 * - Session management coordination
 * - Activity logging
 */

import { UserRepository, getUserRepository } from "../repositories/index.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import {
  SessionRepository,
  getSessionRepository,
} from "../repositories/index.js";
import type {
  SafeUser,
  UserEntity,
  CreateUserData,
  CreateSessionData,
} from "../repositories/index.js";
// Imported directly from the concrete file, not the barrel: SafeSession is
// new (SESSION_RESILIENCE_AND_DEVICES_PLAN.md Part 2) and repositories/index.js
// is outside this change's file ownership. Type-only, so it costs nothing at
// runtime either way.
import type { SafeSession } from "../repositories/SessionRepository.js";
import {
  validatePasswordComplexity,
  hashPassword,
  verifyPassword,
} from "../utils/crypto.js";
import {
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  ConflictError,
  BusinessRuleError,
} from "../utils/errors.js";

// =============================================================================
// Types
// =============================================================================

export interface LoginResult {
  success: boolean;
  user?: SafeUser;
  token?: string; // Session token
  error?: string;
}

export interface LoginOptions {
  /**
   * Which realm to authenticate against: a tenant id, or null for the
   * platform realm (super_admins). Supplied by the caller from the request
   * host once subdomain tenancy is enabled.
   *
   * Omit it when the host says nothing about the realm; login then infers
   * one -- see resolveWithoutRealm, because since v172 two tenants can
   * share a username.
   */
  realm?: number | null;
  rememberMe?: boolean;
  deviceType?: "electron" | "web" | "mobile";
  deviceInfo?: string;
  ipAddress?: string;
}

export interface CreateUserResult {
  success: boolean;
  user?: SafeUser;
  error?: string;
}

export interface ChangePasswordResult {
  success: boolean;
  error?: string;
}

// =============================================================================
// Auth Service Class
// =============================================================================

export class AuthService {
  private userRepo: UserRepository;
  private sessionRepo: SessionRepository;

  constructor(userRepo?: UserRepository, sessionRepo?: SessionRepository) {
    this.userRepo = userRepo ?? getUserRepository();
    this.sessionRepo = sessionRepo ?? getSessionRepository();
  }

  // ---------------------------------------------------------------------------
  // Authentication
  // ---------------------------------------------------------------------------

  /**
   * Authenticate a user with username and password
   * Creates a session in the database upon successful login
   */
  async login(
    username: string,
    password: string,
    options: LoginOptions = {},
  ): Promise<LoginResult> {
    try {
      // Realm-scoped lookup. Since v172 usernames are unique per TENANT, so
      // a bare by-username lookup can match more than one row.
      //
      // options.realm is supplied by the caller when the request host resolves
      // to a tenant (or to the platform realm). When it is undefined,
      // host-based tenancy is off and the realm has to be inferred.
      const user =
        options.realm !== undefined
          ? this.userRepo.findByUsernameInRealm(username, options.realm)
          : this.resolveWithoutRealm(username);
      if (!user) {
        return { success: false, error: "Invalid username or password" };
      }

      const isValid = verifyPassword(password, user.password_hash);
      if (!isValid) {
        return { success: false, error: "Invalid username or password" };
      }

      // Tenant realm gate: users of a suspended/archived tenant cannot log
      // in. Platform users (super_admin, tenant_id NULL) skip the check.
      // Desktop is unaffected: its users all belong to tenant 1 ('Default'),
      // seeded 'active' by migration v123 / create_db.sql.
      if (user.tenant_id != null) {
        const tenantStatus = this.userRepo.getTenantStatus(user.tenant_id);
        if (tenantStatus !== "active") {
          return {
            success: false,
            error: "Account suspended — contact support",
          };
        }
      }

      // Create session in database (tenant_id denormalized from the user —
      // login runs before any tenant context exists)
      const sessionData: CreateSessionData = {
        user_id: user.id,
        device_type: options.deviceType || "unknown",
        device_info: options.deviceInfo,
        ip_address: options.ipAddress,
        remember_me: options.rememberMe || false,
        tenant_id: user.tenant_id ?? null,
      };

      const session = this.sessionRepo.createSession(sessionData);

      // Create safe user object (without password)
      const { password_hash, ...safeUser } = user;

      return {
        success: true,
        user: safeUser as SafeUser,
        token: session.token,
      };
    } catch (error) {
      return { success: false, error: "Authentication failed" };
    }
  }

  /**
   * Resolve a login when the request tells us nothing about the realm.
   *
   * Host-based tenancy is off (no `APP_BASE_DOMAIN`), so every tenant shares
   * one hostname and the username alone has to identify the account. Since
   * v172 that can be ambiguous: two shops may both own 'admin'.
   *
   * Order of preference, and why:
   *   1. Unambiguous name -> the single match. The common case, and the only
   *      one that existed before per-tenant usernames.
   *   2. The PLATFORM realm (`tenant_id IS NULL`) -> super admins. They
   *      operate the deployment; locking the operator out is the worst
   *      outcome available.
   *   3. The deployment's FIRST tenant -> the incumbent shop, whose staff
   *      were logging in before any other tenant existed.
   *
   * This deliberately REPLACED an earlier "refuse when ambiguous" rule, which
   * looked safer and was not: with a public `/api/auth/signup`, anyone holding
   * the invite code could register a shop whose admin is named 'admin' and
   * thereby lock the incumbent out of their own login — an availability attack
   * through a public endpoint. Preferring the incumbent leaks nothing, because
   * the password check still runs against whichever row comes back: a newcomer
   * who picks a taken username simply fails to authenticate. The cost is that
   * such a newcomer cannot log in on the shared hostname at all, which is
   * honest — their subdomain does not exist until `APP_BASE_DOMAIN` and
   * wildcard DNS are configured, and once they are, `options.realm` is always
   * supplied and none of this runs.
   */
  private resolveWithoutRealm(username: string): UserEntity | null {
    if (this.userRepo.countByUsername(username) <= 1) {
      return this.userRepo.findByUsername(username);
    }

    const platformUser = this.userRepo.findByUsernameInRealm(username, null);
    if (platformUser) {
      return platformUser;
    }

    const anchor = this.userRepo.getAnchorTenantId();
    return anchor === null
      ? null
      : this.userRepo.findByUsernameInRealm(username, anchor);
  }

  /**
   * Validate a session token
   * Returns the user if session is valid, null otherwise
   *
   * This whole path runs BEFORE tenant context exists (the backend middleware
   * derives the request's tenant context FROM this validation), so every
   * lookup here is deliberately global: session by token, activity refresh on
   * the already-validated row, user by id. Suspended-tenant sessions are
   * rejected inside sessionRepo.validateSession (tenant-status join).
   *
   * DELIBERATELY NO try/catch here (SESSION_RESILIENCE_AND_DEVICES_PLAN.md
   * Part 1). `null` means exactly one thing to every caller: THIS SESSION IS
   * INVALID, and `authenticateJWT` turns that into a 401 that signs the user
   * out. Every genuinely-invalid case below already returns `null` as a
   * VALUE (no session row, expired, suspended tenant — all inside
   * sessionRepo.validateSession; deactivated/deleted user, below) — none of
   * them need a catch. A THROWN error (SQLITE_BUSY, disk I/O, any
   * DatabaseError from the repository calls below) is a different fact — "I
   * could not check" — and must propagate so the HTTP layer can answer 503
   * (retry, keep the session) instead of lying "your session expired" to
   * whoever is mid-sale on a transient blip. Swallowing it back into `null`
   * here would silently reintroduce that bug.
   *
   * Do NOT reintroduce a blanket catch that returns null on any throw — that
   * reads as "fail open" from the caller's perspective in the sense that it
   * hides a real infrastructure failure behind the SAME signal as a genuine
   * expiry, which is the whole defect this fixes. It is not a security hole
   * either way (both outcomes deny the request), but it destroys the
   * distinction the 401/503 split exists to preserve.
   */
  async validateSession(token: string): Promise<SafeUser | null> {
    const session = this.sessionRepo.validateSession(token);

    if (!session) {
      return null;
    }

    // Update activity timestamp (on the validated row — no tenant-scoped
    // re-fetch)
    this.sessionRepo.touchActivity(session);

    // Get user (global: super admins have tenant_id NULL and would be
    // invisible to the tenant-scoped findById)
    const user = this.userRepo.findByIdGlobal(session.user_id);

    if (!user || user.is_active !== 1) {
      // User no longer exists or is inactive
      this.sessionRepo.deleteByToken(token);
      return null;
    }

    const { password_hash, ...safeUser } = user;
    return safeUser as SafeUser;
  }

  /**
   * Logout a user by deleting their session
   */
  async logout(token: string): Promise<boolean> {
    try {
      return this.sessionRepo.deleteByToken(token);
    } catch (error) {
      return false;
    }
  }

  /**
   * Logout user from all devices
   */
  async logoutAll(userId: number): Promise<number> {
    try {
      return this.sessionRepo.deleteByUserId(userId);
    } catch (error) {
      return 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Signed-in devices (SESSION_RESILIENCE_AND_DEVICES_PLAN.md Part 2)
  //
  // Own-sessions-only for v1 (scope decision in the plan): every method here
  // takes the CALLER's own `userId`, resolved server-side from the caller's
  // validated session/JWT — never accept a `userId` argument sourced from
  // request input for these three.
  //
  // No try/catch: these read/write real device state, so a repository throw
  // (SQLITE_BUSY, disk I/O) must reach the caller as a failure, not silently
  // report "0 sessions" / "revoked" when nothing happened — the same
  // reasoning that removed the swallow from validateSession above.
  // ---------------------------------------------------------------------------

  /**
   * List the caller's own active sessions in the client-safe shape (no
   * `token`, ever — see `SessionRepository.toSafeSession`). `currentToken`
   * is the token behind the request making this call, so `is_current` can be
   * computed server-side; the client has no token for any session but its
   * own and so could never compute it itself.
   */
  async listUserSessions(
    userId: number,
    currentToken: string,
  ): Promise<SafeSession[]> {
    return this.sessionRepo
      .findActiveByUserId(userId)
      .map((session) => this.sessionRepo.toSafeSession(session, currentToken));
  }

  /**
   * Revoke one of the caller's own sessions by id ("Revoke" on a device
   * row). Delegates the id+user_id+tenant_id scoping entirely to
   * `SessionRepository.deleteByIdForUser` — an id belonging to another user
   * or another tenant simply does not match the WHERE clause and this
   * returns `false`, the same outcome as an id that never existed.
   */
  async revokeUserSession(id: number, userId: number): Promise<boolean> {
    return this.sessionRepo.deleteByIdForUser(id, userId);
  }

  /**
   * "Sign out everywhere else": revoke every one of the caller's active
   * sessions EXCEPT the one making this call. Built from `findActiveByUserId`
   * + per-row `deleteByIdForUser` rather than a bulk "delete all, re-create
   * mine" — the caller's own row is never touched, so its `expires_at`/
   * `last_activity_at` survive untouched and the caller is never at risk of
   * revoking itself through a race with its own logout.
   */
  async revokeOtherSessions(
    userId: number,
    currentToken: string,
  ): Promise<number> {
    const sessions = this.sessionRepo.findActiveByUserId(userId);
    let revoked = 0;
    for (const session of sessions) {
      if (session.token === currentToken) {
        continue; // never revoke the session making this call
      }
      if (this.sessionRepo.deleteByIdForUser(session.id, userId)) {
        revoked++;
      }
    }
    return revoked;
  }

  // ---------------------------------------------------------------------------
  // User Management
  // ---------------------------------------------------------------------------

  /**
   * Create a new user (admin only operation)
   *
   * `tenant_id` is optional: when omitted the repository defaults it to the
   * current tenant context (desktop fixed tenant / web request scope). This
   * method only mints tenant-realm roles — platform users (super_admin) are
   * created exclusively by the backend startup bootstrap, never through here.
   */
  async createUser(
    data: {
      username: string;
      password: string;
      role: "admin" | "staff";
      tenant_id?: number | null;
    },
    actorRole: string,
  ): Promise<CreateUserResult> {
    // Authorization check
    if (actorRole !== "admin") {
      throw new AuthorizationError("Only administrators can create users");
    }

    // Validate username
    if (!data.username?.trim()) {
      throw new ValidationError("Username is required");
    }
    if (data.username.length < 3) {
      throw new ValidationError("Username must be at least 3 characters");
    }

    // Validate password
    const passwordValidation = validatePasswordComplexity(data.password);
    if (!passwordValidation.valid) {
      throw new ValidationError(passwordValidation.errors.join(", "));
    }

    // Duplicate check scoped to the realm the user will belong to. A global
    // check here would reject a name that is perfectly free in this tenant --
    // exactly the bad signup experience v172 exists to fix. The DB indexes
    // (UNIQUE(tenant_id, username) + the partial platform one) are the real
    // guarantee; this only produces a better error than a raw constraint
    // failure.
    // Resolve the realm best-effort. getCurrentTenantId() is fail-closed and
    // THROWS with no ambient context, so calling it unguarded turned every
    // context-free createUser into an error -- a regression, since the old
    // global check never needed context. When the realm cannot be determined
    // the pre-check is skipped and the DB indexes do the enforcing; they are
    // the real guarantee either way, and this check only exists to produce a
    // clearer error than a raw constraint failure.
    let realm: number | null | undefined = data.tenant_id;
    if (realm === undefined) {
      try {
        realm = getCurrentTenantId();
      } catch {
        realm = undefined;
      }
    }
    if (
      realm !== undefined &&
      this.userRepo.usernameExistsInRealm(data.username.trim(), realm)
    ) {
      throw new ConflictError("Username already exists");
    }

    // Hash password and create user
    const passwordHash = await hashPassword(data.password);
    const createData: CreateUserData = {
      username: data.username.trim(),
      password_hash: passwordHash,
      role: data.role,
      is_active: 1,
      ...(data.tenant_id !== undefined ? { tenant_id: data.tenant_id } : {}),
    };

    const user = this.userRepo.createUser(createData);
    const safeUser = this.userRepo.findByIdSafe(user.id);
    if (!safeUser) {
      return { success: false, error: "Failed to load created user profile" };
    }

    return { success: true, user: safeUser };
  }

  /**
   * Change a user's password
   */
  async changePassword(
    userId: number,
    currentPassword: string,
    newPassword: string,
  ): Promise<ChangePasswordResult> {
    // Find user with password hash
    const user = this.userRepo.findById(userId);
    if (!user) {
      throw new AuthenticationError("User not found");
    }

    // Verify current password
    const isValid = verifyPassword(currentPassword, user.password_hash);
    if (!isValid) {
      throw new AuthenticationError("Current password is incorrect");
    }

    // Validate new password
    const passwordValidation = validatePasswordComplexity(newPassword);
    if (!passwordValidation.valid) {
      throw new ValidationError(passwordValidation.errors.join(", "));
    }

    // Hash and update password
    const newHash = await hashPassword(newPassword);
    const updated = this.userRepo.updatePassword(userId, newHash);

    if (!updated) {
      throw new BusinessRuleError("Failed to update password");
    }

    return { success: true };
  }

  /**
   * Reset a user's password (admin operation)
   */
  async resetPassword(
    userId: number,
    newPassword: string,
    actorRole: string,
  ): Promise<ChangePasswordResult> {
    // Authorization check
    if (actorRole !== "admin") {
      throw new AuthorizationError("Only administrators can reset passwords");
    }

    // Find user
    const user = this.userRepo.findById(userId);
    if (!user) {
      throw new AuthenticationError("User not found");
    }

    // Validate new password
    const passwordValidation = validatePasswordComplexity(newPassword);
    if (!passwordValidation.valid) {
      throw new ValidationError(passwordValidation.errors.join(", "));
    }

    // Hash and update password
    const newHash = await hashPassword(newPassword);
    const updated = this.userRepo.updatePassword(userId, newHash);

    if (!updated) {
      throw new BusinessRuleError("Failed to reset password");
    }

    return { success: true };
  }

  /**
   * Deactivate a user (soft delete)
   */
  deactivateUser(userId: number, actorId: number, actorRole: string): boolean {
    // Authorization check
    if (actorRole !== "admin") {
      throw new AuthorizationError("Only administrators can deactivate users");
    }

    // Cannot deactivate yourself
    if (userId === actorId) {
      throw new BusinessRuleError("Cannot deactivate your own account");
    }

    // Check if this is the last admin
    const user = this.userRepo.findById(userId);
    if (user?.role === "admin" && this.userRepo.countActiveAdmins() <= 1) {
      throw new BusinessRuleError("Cannot deactivate the last administrator");
    }

    return this.userRepo.softDeleteById(userId);
  }

  /**
   * Reactivate a user
   */
  reactivateUser(userId: number, actorRole: string): boolean {
    // Authorization check
    if (actorRole !== "admin") {
      throw new AuthorizationError("Only administrators can reactivate users");
    }

    return this.userRepo.restore(userId);
  }

  // ---------------------------------------------------------------------------
  // Query Methods
  // ---------------------------------------------------------------------------

  /**
   * Get all active users (safe version without passwords)
   */
  getAllUsers(): SafeUser[] {
    return this.userRepo.findAllSafe();
  }

  /**
   * Get all users including inactive (admin only)
   */
  getAllUsersIncludingInactive(actorRole: string): SafeUser[] {
    if (actorRole !== "admin") {
      throw new AuthorizationError(
        "Only administrators can view inactive users",
      );
    }
    return this.userRepo.findAllIncludingInactive();
  }

  /**
   * Get a user by ID (safe version)
   */
  getUserById(id: number): SafeUser | null {
    return this.userRepo.findByIdSafe(id);
  }

  /**
   * Validate if a user can perform an action based on role
   */
  canPerformAction(userRole: string, requiredRole: "admin" | "staff"): boolean {
    if (requiredRole === "admin") {
      return userRole === "admin";
    }
    // Staff actions can be performed by both admin and staff
    return userRole === "admin" || userRole === "staff";
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let authServiceInstance: AuthService | null = null;

export function getAuthService(): AuthService {
  if (!authServiceInstance) {
    authServiceInstance = new AuthService();
  }
  return authServiceInstance;
}

/** Reset the singleton (for testing) */
export function resetAuthService(): void {
  authServiceInstance = null;
}
