/**
 * Email Verification Token Repository — TENANT-scoped (v196, LIRA-279).
 *
 * Single-use "verify this email" links. Each token stores the address it
 * was sent to (`email`), and `consume()` returns it so the caller can mark
 * THAT address verified via `UserRepository.markEmailVerified(userId,
 * email, now)` — which refuses if the user has changed their email since.
 *
 * Same scoping and time rules as `PasswordResetTokenRepository`: issuing and
 * invalidating are current-shop; the by-token methods are cross-tenant in
 * SQL (the token is the capability, `tenant_id` names the shop).
 */

import { BaseRepository, type BaseEntity } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { DatabaseError } from "../utils/errors.js";
import { USABLE_TOKEN_WHERE } from "./authTokenSql.js";
import { normalizeEmail } from "./UserRepository.js";

export interface EmailVerificationTokenEntity extends BaseEntity {
  id: number;
  tenant_id: number;
  user_id: number;
  email: string;
  token_hash: string;
  expires_at: string;
  used_at: string | null;
  email_outbox_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface CreateEmailVerificationTokenData {
  /** A user of the CURRENT shop. */
  userId: number;
  /** The address the link is sent to (normalised here). */
  email: string;
  tokenHash: string;
  expiresAt: string;
  /** UTC ISO — written to created_at/updated_at. */
  now: string;
}

const COLUMNS = [
  "id",
  "tenant_id",
  "user_id",
  "email",
  "token_hash",
  "expires_at",
  "used_at",
  "email_outbox_id",
  "created_at",
  "updated_at",
].join(", ");

export class EmailVerificationTokenRepository extends BaseRepository<EmailVerificationTokenEntity> {
  constructor() {
    super("email_verification_tokens", { tenantScoped: true });
  }

  protected getColumns(): string {
    return COLUMNS;
  }

  /** Issues a token for a user of the CURRENT shop. */
  createToken(
    data: CreateEmailVerificationTokenData,
  ): EmailVerificationTokenEntity {
    try {
      const result = this.db
        .prepare(
          `INSERT INTO email_verification_tokens
             (tenant_id, user_id, email, token_hash, expires_at,
              created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          getCurrentTenantId(),
          data.userId,
          normalizeEmail(data.email),
          data.tokenHash,
          data.expiresAt,
          data.now,
          data.now,
        );
      const created = this.findById(Number(result.lastInsertRowid));
      if (!created) {
        throw new DatabaseError(
          "Created verification token could not be reloaded",
        );
      }
      return created;
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError("Failed to create email verification token", {
        cause: error,
      });
    }
  }

  /** Points the token at the outbox row that emails it. Current shop. */
  linkOutbox(id: number, outboxId: number, now: string): boolean {
    return (
      this.db
        .prepare(
          `UPDATE email_verification_tokens SET email_outbox_id = ?, updated_at = ?
            WHERE id = ? AND tenant_id = ?`,
        )
        .run(outboxId, now, id, getCurrentTenantId()).changes === 1
    );
  }

  /** The token if it is still usable at `now`, across shops. */
  findUsableByTokenHash(
    tokenHash: string,
    now: string,
  ): EmailVerificationTokenEntity | null {
    return (
      (this.db
        .prepare(
          `SELECT ${COLUMNS} FROM email_verification_tokens /* tenant-exempt: lookup by 256-bit token hash; the tenant_id of the row names the shop */ WHERE token_hash = ? AND ${USABLE_TOKEN_WHERE}`,
        )
        .get(tokenHash, now) as EmailVerificationTokenEntity | undefined) ??
      null
    );
  }

  /** Atomically uses the token; returns the row (with its `email`) when
   * THIS call consumed it, else null. */
  consume(tokenHash: string, now: string): EmailVerificationTokenEntity | null {
    const result = this.db
      .prepare(
        `UPDATE email_verification_tokens /* tenant-exempt: consume by 256-bit token hash; the tenant_id of the row names the shop */
            SET used_at = ?, updated_at = ?
          WHERE token_hash = ? AND ${USABLE_TOKEN_WHERE}`,
      )
      .run(now, now, tokenHash, now);
    if (result.changes !== 1) return null;
    return (
      (this.db
        .prepare(
          `SELECT ${COLUMNS} FROM email_verification_tokens /* tenant-exempt: re-read of the row this call just consumed */ WHERE token_hash = ?`,
        )
        .get(tokenHash) as EmailVerificationTokenEntity | undefined) ?? null
    );
  }

  /** Burns every open link of a CURRENT-shop user (e.g. on email change). */
  invalidateForUser(userId: number, now: string): number {
    return this.db
      .prepare(
        `UPDATE email_verification_tokens SET used_at = ?, updated_at = ?
          WHERE user_id = ? AND tenant_id = ? AND used_at IS NULL`,
      )
      .run(now, now, userId, getCurrentTenantId()).changes;
  }

  /** Links issued for one CURRENT-shop user at or after `sinceIso`. */
  countForUserSince(userId: number, sinceIso: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM email_verification_tokens
          WHERE user_id = ? AND tenant_id = ? AND created_at >= ?`,
      )
      .get(userId, getCurrentTenantId(), sinceIso) as { n: number };
    return row.n;
  }
}

let instance: EmailVerificationTokenRepository | null = null;

export function getEmailVerificationTokenRepository(): EmailVerificationTokenRepository {
  if (!instance) instance = new EmailVerificationTokenRepository();
  return instance;
}

export function resetEmailVerificationTokenRepository(): void {
  instance = null;
}
