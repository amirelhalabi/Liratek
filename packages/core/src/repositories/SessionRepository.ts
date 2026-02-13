/**
 * Session Repository
 *
 * Handles all database operations for user sessions.
 * Supports both Electron and Web authentication with unified session management.
 */

import { BaseRepository } from "./BaseRepository.js";
import { DatabaseError } from "../utils/errors.js";
import crypto from "crypto";

// =============================================================================
// Types
// =============================================================================

export interface SessionEntity {
  id: number;
  user_id: number;
  token: string;
  device_type: "electron" | "web" | "mobile" | "unknown";
  device_info: string | null;
  ip_address: string | null;
  remember_me: number; // SQLite boolean (0 or 1)
  created_at: string; // ISO datetime string
  last_activity_at: string; // ISO datetime string
  expires_at: string; // ISO datetime string
}

export interface CreateSessionData {
  user_id: number;
  device_type?: "electron" | "web" | "mobile" | "unknown";
  device_info?: string;
  ip_address?: string;
  remember_me?: boolean;
}

export interface UpdateSessionData {
  last_activity_at?: string;
  expires_at?: string;
}

// Session duration constants
export const SESSION_DURATION = {
  SHORT: 30 * 60 * 1000, // 30 minutes in milliseconds
  LONG: 24 * 60 * 60 * 1000, // 1 day in milliseconds
};

// =============================================================================
// Repository
// =============================================================================

export class SessionRepository extends BaseRepository<SessionEntity> {
  constructor() {
    super("sessions");
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
   * Calculate expiration date based on remember_me flag
   */
  private calculateExpiresAt(rememberMe: boolean): string {
    const duration = rememberMe
      ? SESSION_DURATION.LONG
      : SESSION_DURATION.SHORT;
    const expiresAt = new Date(Date.now() + duration);
    return expiresAt.toISOString();
  }

  // ---------------------------------------------------------------------------
  // Session Management
  // ---------------------------------------------------------------------------

  /**
   * Create a new session for a user
   */
  createSession(data: CreateSessionData): SessionEntity {
    try {
      const token = this.generateToken();
      const rememberMe = data.remember_me ? 1 : 0;
      const expiresAt = this.calculateExpiresAt(data.remember_me || false);
      const now = new Date().toISOString();

      const query = `
        INSERT INTO ${this.tableName} 
        (user_id, token, device_type, device_info, ip_address, remember_me, created_at, last_activity_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const result = this.execute(
        query,
        data.user_id,
        token,
        data.device_type || "unknown",
        data.device_info || null,
        data.ip_address || null,
        rememberMe,
        now,
        now,
        expiresAt,
      );

      const insertedId = result.lastInsertRowid as number;
      return this.findByIdOrFail(insertedId);
    } catch (error) {
      throw new DatabaseError("Failed to create session", { cause: error });
    }
  }

  /**
   * Find session by token
   */
  findByToken(token: string): SessionEntity | null {
    try {
      const query = `SELECT * FROM ${this.tableName} WHERE token = ?`;
      return this.queryOne<SessionEntity>(query, token);
    } catch (error) {
      throw new DatabaseError("Failed to find session by token", {
        cause: error,
      });
    }
  }

  /**
   * Validate session by token (checks expiration)
   * Returns session if valid, null if expired or not found
   */
  validateSession(token: string): SessionEntity | null {
    try {
      const session = this.findByToken(token);
      if (!session) {
        return null;
      }

      const now = new Date();
      const expiresAt = new Date(session.expires_at);

      // Check if session is expired
      if (now > expiresAt) {
        // Delete expired session
        this.delete(session.id);
        return null;
      }

      // For short sessions (remember_me = 0), check last activity
      if (session.remember_me === 0) {
        const lastActivity = new Date(session.last_activity_at);
        const timeSinceActivity = now.getTime() - lastActivity.getTime();

        if (timeSinceActivity > SESSION_DURATION.SHORT) {
          // Session expired due to inactivity
          this.delete(session.id);
          return null;
        }
      }

      return session;
    } catch (error) {
      throw new DatabaseError("Failed to validate session", { cause: error });
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

      // For short sessions, extend expires_at based on new activity
      let newExpiresAt = session.expires_at;
      if (session.remember_me === 0) {
        const newExpires = new Date(now.getTime() + SESSION_DURATION.SHORT);
        newExpiresAt = newExpires.toISOString();
      }

      const query = `
        UPDATE ${this.tableName}
        SET last_activity_at = ?, expires_at = ?
        WHERE id = ?
      `;

      const result = this.execute(query, nowISO, newExpiresAt, sessionId);
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
        SELECT * FROM ${this.tableName}
        WHERE user_id = ?
        ORDER BY last_activity_at DESC
      `;
      return this.query<SessionEntity>(query, userId);
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
        SELECT * FROM ${this.tableName}
        WHERE user_id = ? AND expires_at > ?
        ORDER BY last_activity_at DESC
      `;
      return this.query<SessionEntity>(query, userId, now);
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
      const query = `DELETE FROM ${this.tableName} WHERE user_id = ?`;
      const result = this.execute(query, userId);
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
      const query = `DELETE FROM ${this.tableName} WHERE token = ?`;
      const result = this.execute(query, token);
      return result.changes > 0;
    } catch (error) {
      throw new DatabaseError("Failed to delete session by token", {
        cause: error,
      });
    }
  }

  /**
   * Delete all expired sessions (cleanup)
   */
  deleteExpiredSessions(): number {
    try {
      const now = new Date().toISOString();
      const query = `DELETE FROM ${this.tableName} WHERE expires_at < ?`;
      const result = this.execute(query, now);
      return result.changes;
    } catch (error) {
      throw new DatabaseError("Failed to delete expired sessions", {
        cause: error,
      });
    }
  }

  /**
   * Delete inactive short sessions (30+ min of inactivity)
   */
  deleteInactiveSessions(): number {
    try {
      const cutoff = new Date(Date.now() - SESSION_DURATION.SHORT);
      const cutoffISO = cutoff.toISOString();

      const query = `
        DELETE FROM ${this.tableName}
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
        WHERE user_id = ? AND expires_at > ?
      `;
      const result = this.queryOne<{ count: number }>(query, userId, now);
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
        WHERE device_type = ? AND expires_at > ?
      `;
      const result = this.queryOne<{ count: number }>(query, deviceType, now);
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
