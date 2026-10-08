/**
 * Password Reset Token Repository — TENANT-scoped (v196, LIRA-275/276).
 *
 * Single-use "choose a new password" links. Only `sha256(token)` is stored.
 * `consume()` is a conditional UPDATE (`used_at IS NULL AND expires_at >
 * now`), so a token works exactly once even under a race. A reset is one
 * step: the caller validates the new password FIRST, then consumes, then
 * sets the password and calls `invalidateForUser()` so every other open link
 * for that user dies with it.
 *
 * Scoping: issuing/invalidating/counting run in the CURRENT shop. The
 * by-token methods are cross-tenant in SQL — the token is the capability and
 * the row's `tenant_id` names the shop; the caller checks it against the
 * request host and does the password change inside `runWithTenant`. In
 * per-tenant DB mode the caller must already be inside the host shop's scope.
 *
 * Time format: every timestamp, including `created_at`, is a UTC ISO string
 * the caller passes in (see `authTokenSql.ts`).
 */

import { BaseRepository, type BaseEntity } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { DatabaseError } from "../utils/errors.js";
import { EXPIRED_BEFORE_WHERE, USABLE_TOKEN_WHERE } from "./authTokenSql.js";

export interface PasswordResetTokenEntity extends BaseEntity {
  id: number;
  tenant_id: number;
  user_id: number;
  token_hash: string;
  expires_at: string;
  used_at: string | null;
  /** sha256 of the requesting IP (never the IP itself), or null. */
  requested_ip_hash: string | null;
  email_outbox_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface CreatePasswordResetTokenData {
  /** A user of the CURRENT shop. */
  userId: number;
  tokenHash: string;
  expiresAt: string;
  requestedIpHash?: string | null;
  /** UTC ISO — written to created_at/updated_at. */
  now: string;
}

const COLUMNS = [
  "id",
  "tenant_id",
  "user_id",
  "token_hash",
  "expires_at",
  "used_at",
  "requested_ip_hash",
  "email_outbox_id",
  "created_at",
  "updated_at",
].join(", ");

export class PasswordResetTokenRepository extends BaseRepository<PasswordResetTokenEntity> {
  constructor() {
    super("password_reset_tokens", { tenantScoped: true });
  }

  protected getColumns(): string {
    return COLUMNS;
  }

  /** Issues a token for a user of the CURRENT shop. */
  createToken(data: CreatePasswordResetTokenData): PasswordResetTokenEntity {
    try {
      const result = this.db
        .prepare(
          `INSERT INTO password_reset_tokens
             (tenant_id, user_id, token_hash, expires_at, requested_ip_hash,
              created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          getCurrentTenantId(),
          data.userId,
          data.tokenHash,
          data.expiresAt,
          data.requestedIpHash ?? null,
          data.now,
          data.now,
        );
      const created = this.findById(Number(result.lastInsertRowid));
      if (!created) {
        throw new DatabaseError("Created reset token could not be reloaded");
      }
      return created;
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError("Failed to create password reset token", {
        cause: error,
      });
    }
  }

  /** Points the token at the outbox row that emails it. Current shop. */
  linkOutbox(id: number, outboxId: number, now: string): boolean {
    return (
      this.db
        .prepare(
          `UPDATE password_reset_tokens SET email_outbox_id = ?, updated_at = ?
            WHERE id = ? AND tenant_id = ?`,
        )
        .run(outboxId, now, id, getCurrentTenantId()).changes === 1
    );
  }

  /** The token if it is still usable at `now`, across shops (see header). */
  findUsableByTokenHash(
    tokenHash: string,
    now: string,
  ): PasswordResetTokenEntity | null {
    return (
      (this.db
        .prepare(
          `SELECT ${COLUMNS} FROM password_reset_tokens /* tenant-exempt: lookup by 256-bit token hash; the tenant_id of the row names the shop */ WHERE token_hash = ? AND ${USABLE_TOKEN_WHERE}`,
        )
        .get(tokenHash, now) as PasswordResetTokenEntity | undefined) ?? null
    );
  }

  /**
   * Atomically uses the token. Returns the row (user + shop) when THIS call
   * consumed it; null when unknown, expired or already used.
   */
  consume(tokenHash: string, now: string): PasswordResetTokenEntity | null {
    const result = this.db
      .prepare(
        `UPDATE password_reset_tokens /* tenant-exempt: consume by 256-bit token hash; the tenant_id of the row names the shop */
            SET used_at = ?, updated_at = ?
          WHERE token_hash = ? AND ${USABLE_TOKEN_WHERE}`,
      )
      .run(now, now, tokenHash, now);
    if (result.changes !== 1) return null;
    return (
      (this.db
        .prepare(
          `SELECT ${COLUMNS} FROM password_reset_tokens /* tenant-exempt: re-read of the row this call just consumed */ WHERE token_hash = ?`,
        )
        .get(tokenHash) as PasswordResetTokenEntity | undefined) ?? null
    );
  }

  /** Burns every open token of a CURRENT-shop user. Returns how many. */
  invalidateForUser(userId: number, now: string): number {
    return this.db
      .prepare(
        `UPDATE password_reset_tokens SET used_at = ?, updated_at = ?
          WHERE user_id = ? AND tenant_id = ? AND used_at IS NULL`,
      )
      .run(now, now, userId, getCurrentTenantId()).changes;
  }

  /** Tokens issued for one CURRENT-shop user at or after `sinceIso`. */
  countForUserSince(userId: number, sinceIso: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM password_reset_tokens
          WHERE user_id = ? AND tenant_id = ? AND created_at >= ?`,
      )
      .get(userId, getCurrentTenantId(), sinceIso) as { n: number };
    return row.n;
  }

  /**
   * Housekeeping: deletes rows that expired before `beforeIso`, in EVERY
   * shop of the current file — the cleanup sweep is a global background
   * job (same rationale as `SessionRepository.deleteExpiredSessions`).
   */
  deleteExpiredBefore(beforeIso: string): number {
    return this.db
      .prepare(
        `DELETE FROM password_reset_tokens /* tenant-exempt: global expired-token cleanup sweep — background maintenance job, must purge every tenant, not just the current context */ WHERE ${EXPIRED_BEFORE_WHERE}`,
      )
      .run(beforeIso).changes;
  }
}

let instance: PasswordResetTokenRepository | null = null;

export function getPasswordResetTokenRepository(): PasswordResetTokenRepository {
  if (!instance) instance = new PasswordResetTokenRepository();
  return instance;
}

export function resetPasswordResetTokenRepository(): void {
  instance = null;
}
