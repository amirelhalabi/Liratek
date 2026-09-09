/**
 * Session Repository
 *
 * Handles all database operations for user sessions.
 * Supports both Electron and Web authentication with unified session management.
 */

import { BaseRepository } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { DatabaseError } from "../utils/errors.js";
import crypto from "crypto";

// =============================================================================
// Types
// =============================================================================

export interface SessionEntity {
  id: number;
  user_id: number;
  token: string;
  /** `impersonation` = super-admin "connect as" session (plan §5/WP6) —
   * a REAL, revocable DB session, same as any other device type. */
  device_type: "electron" | "web" | "mobile" | "unknown" | "impersonation";
  device_info: string | null;
  ip_address: string | null;
  remember_me: number; // SQLite boolean (0 or 1)
  created_at: string; // ISO datetime string
  last_activity_at: string; // ISO datetime string
  expires_at: string; // ISO datetime string
  /** Denormalized from the user at login. NULL only for platform-realm (super_admin) sessions. */
  tenant_id: number | null;
}

export interface CreateSessionData {
  user_id: number;
  device_type?: "electron" | "web" | "mobile" | "unknown" | "impersonation";
  device_info?: string;
  ip_address?: string;
  remember_me?: boolean;
  /** The user's tenant realm; NULL only for platform-realm (super_admin) sessions. */
  tenant_id?: number | null;
}

export interface UpdateSessionData {
  last_activity_at?: string;
  expires_at?: string;
}

const MINUTES = 60 * 1000;
const HOURS = 60 * MINUTES;
const DAYS = 24 * HOURS;

/**
 * How long a session survives WITHOUT activity. Both windows SLIDE: every
 * authenticated request pushes `expires_at` forward (see `touchActivity`), so
 * these are idle timeouts, not deadlines from login.
 *
 * SHORT was 30 minutes, which is wrong for a point-of-sale terminal. A quiet
 * hour on a weekday afternoon is normal trade, not an abandoned till, and it
 * logged the cashier out mid-shift. Eight hours covers a shift with its quiet
 * stretches while still ending the session overnight, so an unattended
 * terminal is not left signed in until morning.
 *
 * LONG was a HARD 24-hour cap that did not slide at all: a shop actively
 * ringing up a sale was signed out at the 24-hour mark for no reason it could
 * observe. It is now a sliding week, which is what "keep me signed in" is
 * understood to mean, and it matches JWT_EXPIRES_IN (7d) so the token and the
 * session it points at stop disagreeing about when the user is done.
 *
 * Revocation does not depend on either number: every request validates the DB
 * session row, so logout and a suspended tenant still take effect instantly.
 */
export const SESSION_DURATION = {
  SHORT: 8 * HOURS,
  LONG: 7 * DAYS,
};

// =============================================================================
// Repository
// =============================================================================

export class SessionRepository extends BaseRepository<SessionEntity> {
  constructor() {
    super("sessions");
  }

  // Override getColumns() to use explicit columns instead of SELECT *
  protected getColumns(): string {
    return "id, user_id, token, device_type, device_info, ip_address, remember_me, created_at, last_activity_at, expires_at, tenant_id";
  }

  // ---------------------------------------------------------------------------
  // Token Generation
  // ---------------------------------------------------------------------------

  /**
   * Generate a cryptographically secure random token (64 characters)
   */
  private generateToken(): string {
    return crypto.randomBytes(32).toString("hex");
  }

  /**
   * The idle window for a session, in ms. The ONLY place that maps
   * remember-me to a duration — mint and every slide share it, so the two can
   * never drift.
   */
  private idleWindowMs(rememberMe: boolean): number {
    return rememberMe ? SESSION_DURATION.LONG : SESSION_DURATION.SHORT;
  }

  /**
   * Calculate expiration date based on remember_me flag
   */
  private calculateExpiresAt(rememberMe: boolean): string {
    const expiresAt = new Date(Date.now() + this.idleWindowMs(rememberMe));
    return expiresAt.toISOString();
  }

  // ---------------------------------------------------------------------------
  // Session Management
  // ---------------------------------------------------------------------------

  /**
   * Create a new session for a user
   *
   * Runs during login, i.e. BEFORE any tenant context exists — `tenant_id`
   * is therefore written from the explicit param (denormalized from the
   * just-authenticated user), never from `getCurrentTenantId()`.
   */
  createSession(data: CreateSessionData): SessionEntity {
    try {
      const token = this.generateToken();
      const rememberMe = data.remember_me ? 1 : 0;
      const expiresAt = this.calculateExpiresAt(data.remember_me || false);
      const now = new Date().toISOString();

      const query = `
        INSERT INTO ${this.tableName}
        (user_id, token, device_type, device_info, ip_address, remember_me, tenant_id, created_at, last_activity_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const result = this.execute(
        query,
        data.user_id,
        token,
        data.device_type || "unknown",
        data.device_info || null,
        data.ip_address || null,
        rememberMe,
        data.tenant_id ?? null,
        now,
        now,
        expiresAt,
      );

      const insertedId = result.lastInsertRowid as number;

      // Global fetch by the fresh rowid — the tenant-scoped findByIdOrFail
      // would throw here (no tenant context during login) and could never
      // see platform-realm sessions (tenant_id NULL) anyway.
      const created = this.queryOne<SessionEntity>(
        `SELECT ${this.getColumns()} FROM ${this.tableName} /* tenant-exempt: fetch of the just-created session row during login — runs before tenant context exists */ WHERE id = ?`,
        insertedId,
      );
      if (!created) {
        throw new DatabaseError("Created session row could not be reloaded", {
          entityId: insertedId,
        });
      }
      return created;
    } catch (error) {
      throw new DatabaseError("Failed to create session", { cause: error });
    }
  }

  /**
   * Find session by token.
   *
   * Unlike `validateSession` (the auth-critical, pre-tenant-context lookup),
   * this helper is for callers that already run inside an established
   * tenant scope, so it is tenant-scoped like any other session read.
   */
  findByToken(token: string): SessionEntity | null {
    try {
      const query = `SELECT ${this.getColumns()} FROM ${this.tableName} WHERE token = ? AND tenant_id = ?`;
      return this.queryOne<SessionEntity>(query, token, getCurrentTenantId());
    } catch (error) {
      throw new DatabaseError("Failed to find session by token", {
        cause: error,
      });
    }
  }

  /**
   * Validate session by token (checks expiration AND tenant status)
   * Returns session (including its tenant_id) if valid; null if expired,
   * not found, or belonging to a suspended/archived tenant.
   *
   * Runs BEFORE tenant context exists (the middleware establishes context
   * from this very validation), so the lookup is global by the random
   * 64-char token. The tenant gate is folded into the same query via a
   * LEFT JOIN on the control-plane `tenants` table: a suspended tenant's
   * existing sessions stop working immediately, not just at next login.
   * Platform-realm sessions (tenant_id NULL) skip the tenant gate.
   */
  validateSession(token: string): SessionEntity | null {
    try {
      const query = `
        SELECT s.id, s.user_id, s.token, s.device_type, s.device_info, s.ip_address,
               s.remember_me, s.created_at, s.last_activity_at, s.expires_at, s.tenant_id,
               t.status AS tenant_status
        /* tenant-exempt: session token is globally unique; tenant enforcement happens at JWT/middleware layer */
        FROM ${this.tableName} s
        LEFT JOIN tenants t ON t.id = s.tenant_id
        WHERE s.token = ?
      `;
      const row = this.queryOne<
        SessionEntity & {
          tenant_status: "active" | "suspended" | "archived" | null;
        }
      >(query, token);
      if (!row) {
        return null;
      }

      const { tenant_status, ...session } = row;

      // Suspended/archived tenant: reject WITHOUT deleting — the session may
      // become valid again if the tenant is re-activated before it expires.
      if (session.tenant_id !== null && tenant_status !== "active") {
        return null;
      }

      const now = new Date();
      const expiresAt = new Date(session.expires_at);

      // Check if session is expired
      if (now > expiresAt) {
        // Delete expired session (token-keyed: global, like the lookup)
        this.deleteByToken(token);
        return null;
      }

      // No second inactivity check here on purpose. `touchActivity` now slides
      // `expires_at` for BOTH kinds of session, so that column already IS the
      // idle deadline; re-deriving it from `last_activity_at` was the same rule
      // written twice, and the two could only ever drift apart.

      return session;
    } catch (error) {
      throw new DatabaseError("Failed to validate session", { cause: error });
    }
  }

  /**
   * Refresh last-activity (and, for short sessions, the sliding expiry) on an
   * ALREADY-VALIDATED session row. Takes the full entity — not an id — so the
   * auth path (which runs before tenant context exists) never needs a
   * tenant-scoped re-fetch.
   */
  touchActivity(session: SessionEntity): boolean {
    try {
      const now = new Date();
      const nowISO = now.toISOString();

      // Slides for BOTH kinds. Previously only the short session slid, so a
      // remember-me session was a hard 24h cutoff that fired on an actively
      // used till. Whoever is still working is still signed in.
      const newExpiresAt = new Date(
        now.getTime() + this.idleWindowMs(session.remember_me === 1),
      ).toISOString();

      const query = `
        UPDATE ${this.tableName}
        /* tenant-exempt: activity refresh keyed by the validated session's globally-unique id — runs during auth before tenant context exists */
        SET last_activity_at = ?, expires_at = ?
        WHERE id = ?
      `;

      const result = this.execute(query, nowISO, newExpiresAt, session.id);
      return result.changes > 0;
    } catch (error) {
      throw new DatabaseError("Failed to touch session activity", {
        cause: error,
        entityId: session.id,
      });
    }
  }

  /**
   * Update session's last activity timestamp
   * Also extends expires_at for short sessions based on new activity
   */
  updateActivity(sessionId: number): boolean {
    try {
      const session = this.findById(sessionId);
      if (!session) {
        return false;
      }

      const now = new Date();
      const nowISO = now.toISOString();

      // Same sliding rule as touchActivity — both kinds extend on activity.
      const newExpiresAt = new Date(
        now.getTime() + this.idleWindowMs(session.remember_me === 1),
      ).toISOString();

      const query = `
        UPDATE ${this.tableName}
        SET last_activity_at = ?, expires_at = ?
        WHERE id = ? AND tenant_id = ?
      `;

      const result = this.execute(
        query,
        nowISO,
        newExpiresAt,
        sessionId,
        getCurrentTenantId(),
      );
      return result.changes > 0;
    } catch (error) {
      throw new DatabaseError("Failed to update session activity", {
        cause: error,
        entityId: sessionId,
      });
    }
  }

  /**
   * Update session's last activity by token
   */
  updateActivityByToken(token: string): boolean {
    try {
      const session = this.findByToken(token);
      if (!session) {
        return false;
      }

      return this.updateActivity(session.id);
    } catch (error) {
      throw new DatabaseError("Failed to update session activity by token", {
        cause: error,
      });
    }
  }

  /**
   * Get all sessions for a user
   */
  findByUserId(userId: number): SessionEntity[] {
    try {
      const query = `
        SELECT ${this.getColumns()} FROM ${this.tableName}
        WHERE user_id = ? AND tenant_id = ?
        ORDER BY last_activity_at DESC
      `;
      return this.query<SessionEntity>(query, userId, getCurrentTenantId());
    } catch (error) {
      throw new DatabaseError("Failed to find sessions by user ID", {
        cause: error,
      });
    }
  }

  /**
   * Get all active (non-expired) sessions for a user
   */
  findActiveByUserId(userId: number): SessionEntity[] {
    try {
      const now = new Date().toISOString();
      const query = `
        SELECT ${this.getColumns()} FROM ${this.tableName}
        WHERE user_id = ? AND expires_at > ? AND tenant_id = ?
        ORDER BY last_activity_at DESC
      `;
      return this.query<SessionEntity>(
        query,
        userId,
        now,
        getCurrentTenantId(),
      );
    } catch (error) {
      throw new DatabaseError("Failed to find active sessions by user ID", {
        cause: error,
      });
    }
  }

  /**
   * Delete all sessions for a user (logout from all devices)
   */
  deleteByUserId(userId: number): number {
    try {
      const query = `DELETE FROM ${this.tableName} WHERE user_id = ? AND tenant_id = ?`;
      const result = this.execute(query, userId, getCurrentTenantId());
      return result.changes;
    } catch (error) {
      throw new DatabaseError("Failed to delete sessions by user ID", {
        cause: error,
      });
    }
  }

  /**
   * Delete session by token (logout)
   */
  deleteByToken(token: string): boolean {
    try {
      const query = `DELETE FROM ${this.tableName} /* tenant-exempt: session token is globally unique; tenant enforcement happens at JWT/middleware layer */ WHERE token = ?`;
      const result = this.execute(query, token);
      return result.changes > 0;
    } catch (error) {
      throw new DatabaseError("Failed to delete session by token", {
        cause: error,
      });
    }
  }

  /**
   * Delete all expired sessions (cleanup).
   *
   * Runs as a background maintenance sweep (electron-app main process
   * interval, and eventually a web cron), never inside a per-request/per-
   * tenant scope. It must purge every tenant's stale rows in one pass —
   * scoping it to "the current tenant" would either throw (no context in a
   * background timer) or, worse, silently leave every OTHER tenant's
   * expired sessions rotting in the table.
   */
  deleteExpiredSessions(): number {
    try {
      const now = new Date().toISOString();
      const query = `DELETE FROM ${this.tableName} /* tenant-exempt: global session expiry sweep — background maintenance job, must purge every tenant, not just the current context */ WHERE expires_at < ?`;
      const result = this.execute(query, now);
      return result.changes;
    } catch (error) {
      throw new DatabaseError("Failed to delete expired sessions", {
        cause: error,
      });
    }
  }

  /**
   * Delete short sessions idle past SESSION_DURATION.SHORT.
   *
   * The window is read from the constant rather than written here as a number:
   * this comment used to say "30+ min", which stopped being true the moment
   * the constant moved and would have quietly misled the next reader.
   *
   * Same rationale as `deleteExpiredSessions`: a global background sweep,
   * deliberately not tenant-scoped.
   */
  deleteInactiveSessions(): number {
    try {
      const cutoff = new Date(Date.now() - SESSION_DURATION.SHORT);
      const cutoffISO = cutoff.toISOString();

      const query = `
        DELETE FROM ${this.tableName}
        /* tenant-exempt: global session inactivity sweep — background maintenance job, must purge every tenant, not just the current context */
        WHERE remember_me = 0 AND last_activity_at < ?
      `;

      const result = this.execute(query, cutoffISO);
      return result.changes;
    } catch (error) {
      throw new DatabaseError("Failed to delete inactive sessions", {
        cause: error,
      });
    }
  }

  /**
   * Count active sessions for a user
   */
  countActiveByUserId(userId: number): number {
    try {
      const now = new Date().toISOString();
      const query = `
        SELECT COUNT(*) as count
        FROM ${this.tableName}
        WHERE user_id = ? AND expires_at > ? AND tenant_id = ?
      `;
      const result = this.queryOne<{ count: number }>(
        query,
        userId,
        now,
        getCurrentTenantId(),
      );
      return result?.count ?? 0;
    } catch (error) {
      throw new DatabaseError("Failed to count active sessions", {
        cause: error,
      });
    }
  }

  /**
   * Get session count by device type
   */
  countByDeviceType(deviceType: string): number {
    try {
      const now = new Date().toISOString();
      const query = `
        SELECT COUNT(*) as count
        FROM ${this.tableName}
        WHERE device_type = ? AND expires_at > ? AND tenant_id = ?
      `;
      const result = this.queryOne<{ count: number }>(
        query,
        deviceType,
        now,
        getCurrentTenantId(),
      );
      return result?.count ?? 0;
    } catch (error) {
      throw new DatabaseError("Failed to count sessions by device type", {
        cause: error,
      });
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let sessionRepositoryInstance: SessionRepository | null = null;

export function getSessionRepository(): SessionRepository {
  if (!sessionRepositoryInstance) {
    sessionRepositoryInstance = new SessionRepository();
  }
  return sessionRepositoryInstance;
}

/** Reset the singleton (for testing) */
export function resetSessionRepository(): void {
  sessionRepositoryInstance = null;
}
