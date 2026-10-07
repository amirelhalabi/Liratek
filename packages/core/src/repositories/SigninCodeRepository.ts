/**
 * Sign-in Code Repository — PLATFORM level (v199, LIRA-287).
 *
 * "Email me a code" on www: one row per 6-digit code sent to an email. Only
 * `hashToken(email:code)` is stored (see SigninCodeService). A code is
 * usable while it is not used, not expired and has had fewer than
 * SIGNIN_CODE_MAX_ATTEMPTS wrong tries — defined once, `USABLE_CODE_WHERE`
 * (rule 14). `used_at` is also set when a newer code supersedes it.
 *
 * Unlike the link tokens, a code is looked up by EMAIL, never by hash: six
 * digits collide across emails, so the hash is only ever compared against
 * the one newest usable row of that email.
 *
 * The table has no `tenant_id` (a code belongs to an email, not a shop), so
 * `tenantScoped: false`; callers wrap it in `runWithoutTenant`. Times are
 * UTC ISO strings passed in by the caller.
 */

import { BaseRepository, type BaseEntity } from "./BaseRepository.js";
import { DatabaseError } from "../utils/errors.js";
import { USABLE_TOKEN_WHERE } from "./authTokenSql.js";
import { SIGNIN_CODE_MAX_ATTEMPTS } from "../constants/signinCode.js";

export interface SigninCodeEntity extends BaseEntity {
  id: number;
  email: string;
  code_hash: string;
  expires_at: string;
  attempts: number;
  used_at: string | null;
  requested_ip_hash: string | null;
  email_outbox_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSigninCodeData {
  /** Already normalised (trimmed + lowercased). */
  email: string;
  codeHash: string;
  expiresAt: string;
  requestedIpHash?: string | null;
  /** UTC ISO — written to created_at/updated_at. */
  now: string;
}

const COLUMNS = [
  "id",
  "email",
  "code_hash",
  "expires_at",
  "attempts",
  "used_at",
  "requested_ip_hash",
  "email_outbox_id",
  "created_at",
  "updated_at",
].join(", ");

/** Not used, not expired, not locked by wrong tries. Bind: now (ISO). */
const USABLE_CODE_WHERE = `${USABLE_TOKEN_WHERE} AND attempts < ${SIGNIN_CODE_MAX_ATTEMPTS}`;

export class SigninCodeRepository extends BaseRepository<SigninCodeEntity> {
  constructor() {
    super("signin_codes", { tenantScoped: false });
  }

  protected getColumns(): string {
    return COLUMNS;
  }

  createCode(data: CreateSigninCodeData): SigninCodeEntity {
    try {
      const result = this.db
        .prepare(
          `INSERT INTO signin_codes
             (email, code_hash, expires_at, requested_ip_hash, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          data.email,
          data.codeHash,
          data.expiresAt,
          data.requestedIpHash ?? null,
          data.now,
          data.now,
        );
      const created = this.findById(Number(result.lastInsertRowid));
      if (!created) {
        throw new DatabaseError("Created sign-in code could not be reloaded");
      }
      return created;
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError("Failed to create sign-in code", {
        cause: error,
      });
    }
  }

  linkOutbox(id: number, outboxId: number, now: string): void {
    this.db
      .prepare(
        `UPDATE signin_codes SET email_outbox_id = ?, updated_at = ? WHERE id = ?`,
      )
      .run(outboxId, now, id);
  }

  /** The newest usable code of this email, or null. */
  findUsableForEmail(email: string, now: string): SigninCodeEntity | null {
    return (
      (this.db
        .prepare(
          `SELECT ${COLUMNS} FROM signin_codes
            WHERE email = ? AND ${USABLE_CODE_WHERE}
            ORDER BY id DESC LIMIT 1`,
        )
        .get(email, now) as SigninCodeEntity | undefined) ?? null
    );
  }

  /** Counts one wrong try against a still-usable code. */
  recordFailedAttempt(id: number, now: string): void {
    this.db
      .prepare(
        `UPDATE signin_codes SET attempts = attempts + 1, updated_at = ?
          WHERE id = ? AND ${USABLE_CODE_WHERE}`,
      )
      .run(now, id, now);
  }

  /** Atomically uses the code. True only for the call that used it. */
  consume(id: number, now: string): boolean {
    return (
      this.db
        .prepare(
          `UPDATE signin_codes SET used_at = ?, updated_at = ?
            WHERE id = ? AND ${USABLE_CODE_WHERE}`,
        )
        .run(now, now, id, now).changes === 1
    );
  }

  /** Burns every open code of this email (a newer one replaces them). */
  invalidateForEmail(email: string, now: string): number {
    return this.db
      .prepare(
        `UPDATE signin_codes SET used_at = ?, updated_at = ?
          WHERE email = ? AND used_at IS NULL`,
      )
      .run(now, now, email).changes;
  }

  /** Codes sent to this email since `sinceIso` (the per-email limit). */
  countForEmailSince(email: string, sinceIso: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM signin_codes WHERE email = ? AND created_at >= ?`,
      )
      .get(email, sinceIso) as { n: number };
    return row.n;
  }

  /** Housekeeping: deletes rows that expired before `beforeIso`. */
  deleteExpiredBefore(beforeIso: string): number {
    return this.db
      .prepare(`DELETE FROM signin_codes WHERE expires_at < ?`)
      .run(beforeIso).changes;
  }
}

let instance: SigninCodeRepository | null = null;

export function getSigninCodeRepository(): SigninCodeRepository {
  if (!instance) instance = new SigninCodeRepository();
  return instance;
}

export function resetSigninCodeRepository(): void {
  instance = null;
}
