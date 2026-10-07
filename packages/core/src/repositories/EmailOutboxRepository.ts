/**
 * Email Outbox Repository — PLATFORM level (LIRA-267, migration v195).
 *
 * A durable, idempotent outbox for transactional email (research R2):
 *
 *   - `idempotency_key` is UNIQUE, so enqueueing the same logical email twice
 *     (a retried request, a double click) returns the existing row and
 *     inserts nothing.
 *   - A worker CLAIMS a row with a conditional `UPDATE … WHERE status =
 *     'pending'` and acts only if exactly one row changed. better-sqlite3 is
 *     synchronous and the database has a single writer, so two workers can
 *     never both send the same row.
 *   - A row left in `sending` by a crash is returned to `pending` by
 *     `recoverStuck` once its lock is older than the threshold.
 *
 * `email_outbox` has NO `tenant_id` (it belongs to the platform, not a shop),
 * so this repository is `tenantScoped: false` and every caller wraps it in
 * `runWithoutTenant`. "Now" is ALWAYS a UTC ISO string passed in by the
 * caller — never SQLite's `datetime('now')`, whose `YYYY-MM-DD HH:MM:SS`
 * format does not compare correctly against the ISO strings stored here.
 */

import { BaseRepository, type BaseEntity } from "./BaseRepository.js";
import { DatabaseError } from "../utils/errors.js";
import { emailLogger } from "../utils/logger.js";

// =============================================================================
// Types
// =============================================================================

export type EmailOutboxStatus = "pending" | "sending" | "accepted" | "failed";

export interface EmailOutboxEntity extends BaseEntity {
  id: number;
  idempotency_key: string;
  template: string;
  to_email: string;
  /** JSON object of template variables. Secrets (the invite link) are
   * removed by `scrubSecret` once the row reaches a final status. */
  data_json: string;
  status: EmailOutboxStatus;
  /** Every individual send attempt — for display/diagnosis only. */
  attempts: number;
  next_attempt_at: string;
  /** No new round starts after this time (the invite's expiry). */
  give_up_at: string;
  locked_at: string | null;
  last_error: string | null;
  provider_message_id: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

/** JSON-serialisable template variables. */
export type EmailTemplateData = Record<string, string | number | boolean | null>;

export interface EnqueueEmailData {
  idempotencyKey: string;
  template: string;
  toEmail: string;
  data: EmailTemplateData;
  /** UTC ISO. Also the first `next_attempt_at`: due immediately. */
  now: string;
  /** UTC ISO. */
  giveUpAt: string;
}

/** `last_error` is cut to this many characters. */
export const EMAIL_OUTBOX_MAX_ERROR_LENGTH = 1000;

const COLUMNS = [
  "id",
  "idempotency_key",
  "template",
  "to_email",
  "data_json",
  "status",
  "attempts",
  "next_attempt_at",
  "give_up_at",
  "locked_at",
  "last_error",
  "provider_message_id",
  "sent_at",
  "created_at",
  "updated_at",
].join(", ");

function truncateError(error: string): string {
  return error.length > EMAIL_OUTBOX_MAX_ERROR_LENGTH
    ? error.slice(0, EMAIL_OUTBOX_MAX_ERROR_LENGTH)
    : error;
}

// =============================================================================
// Repository
// =============================================================================

export class EmailOutboxRepository extends BaseRepository<EmailOutboxEntity> {
  constructor() {
    super("email_outbox", { tenantScoped: false });
  }

  protected getColumns(): string {
    return COLUMNS;
  }

  /**
   * Inserts a pending row due at `now`. On a duplicate `idempotencyKey` it
   * inserts nothing and returns the row that already holds that key.
   */
  enqueue(data: EnqueueEmailData): EmailOutboxEntity {
    try {
      const result = this.db
        .prepare(
          `INSERT INTO email_outbox
             (idempotency_key, template, to_email, data_json, status, attempts,
              next_attempt_at, give_up_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)
           ON CONFLICT(idempotency_key) DO NOTHING`,
        )
        .run(
          data.idempotencyKey,
          data.template,
          data.toEmail,
          JSON.stringify(data.data),
          data.now,
          data.giveUpAt,
          data.now,
          data.now,
        );
      if (result.changes === 0) {
        emailLogger.debug(
          { idempotencyKey: data.idempotencyKey },
          "email_outbox: duplicate idempotency key, returning existing row",
        );
      }
      const row = this.findByIdempotencyKey(data.idempotencyKey);
      if (!row) {
        throw new DatabaseError("Enqueued email row could not be reloaded");
      }
      return row;
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError("Failed to enqueue email", { cause: error });
    }
  }

  findByIdempotencyKey(key: string): EmailOutboxEntity | null {
    return (
      (this.db
        .prepare(
          `SELECT ${COLUMNS} FROM email_outbox WHERE idempotency_key = ?`,
        )
        .get(key) as EmailOutboxEntity | undefined) ?? null
    );
  }

  /**
   * Pending rows whose `next_attempt_at` has arrived, oldest first. Rows past
   * `give_up_at` are still returned: deciding to fail them is the worker's
   * call, so none is left stranded in `pending` forever.
   */
  findDue(now: string, limit: number): EmailOutboxEntity[] {
    return this.db
      .prepare(
        `SELECT ${COLUMNS} FROM email_outbox
          WHERE status = 'pending' AND next_attempt_at <= ?
          ORDER BY next_attempt_at ASC, id ASC
          LIMIT ?`,
      )
      .all(now, limit) as EmailOutboxEntity[];
  }

  /** pending -> sending. True only if THIS call made the change. */
  claim(id: number, now: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE email_outbox
            SET status = 'sending', locked_at = ?, updated_at = ?
          WHERE id = ? AND status = 'pending'`,
      )
      .run(now, now, id);
    return result.changes === 1;
  }

  /**
   * sending -> accepted. "Accepted" means the provider took the email, not
   * that it was delivered. `attemptsMade` is how many tries this round used.
   */
  markAccepted(
    id: number,
    providerMessageId: string | null,
    now: string,
    attemptsMade = 1,
  ): boolean {
    const result = this.db
      .prepare(
        `UPDATE email_outbox
            SET status = 'accepted', provider_message_id = ?, sent_at = ?,
                locked_at = NULL, attempts = attempts + ?, updated_at = ?
          WHERE id = ? AND status = 'sending'`,
      )
      .run(providerMessageId, now, attemptsMade, now, id);
    return result.changes === 1;
  }

  /** sending -> pending, due again at `nextAttemptAt`. */
  markRetry(
    id: number,
    error: string,
    nextAttemptAt: string,
    now: string,
    attemptsMade = 1,
  ): boolean {
    const result = this.db
      .prepare(
        `UPDATE email_outbox
            SET status = 'pending', next_attempt_at = ?, last_error = ?,
                locked_at = NULL, attempts = attempts + ?, updated_at = ?
          WHERE id = ? AND status IN ('pending', 'sending')`,
      )
      .run(nextAttemptAt, truncateError(error), attemptsMade, now, id);
    return result.changes === 1;
  }

  /** -> failed (permanent error, or the give-up time has passed). */
  markFailed(id: number, error: string, now: string, attemptsMade = 1): boolean {
    const result = this.db
      .prepare(
        `UPDATE email_outbox
            SET status = 'failed', last_error = ?, locked_at = NULL,
                attempts = attempts + ?, updated_at = ?
          WHERE id = ? AND status IN ('pending', 'sending')`,
      )
      .run(truncateError(error), attemptsMade, now, id);
    return result.changes === 1;
  }

  /**
   * Crash recovery: rows in `sending` whose lock is older than `olderThanMs`
   * go back to `pending` (their `next_attempt_at` is already in the past, so
   * they are due at once). The cutoff is computed here, in JS, and passed as
   * an ISO parameter. Returns how many rows were recovered.
   */
  recoverStuck(now: string, olderThanMs: number): number {
    const cutoff = new Date(Date.parse(now) - olderThanMs).toISOString();
    const result = this.db
      .prepare(
        `UPDATE email_outbox
            SET status = 'pending', locked_at = NULL, updated_at = ?
          WHERE status = 'sending' AND locked_at IS NOT NULL AND locked_at < ?`,
      )
      .run(now, cutoff);
    if (result.changes > 0) {
      emailLogger.warn(
        { recovered: result.changes },
        "email_outbox: recovered rows stuck in sending",
      );
    }
    return result.changes;
  }

  /**
   * Removes one key (the invite link) from `data_json`. True if the key was
   * present and removed. Read-modify-write inside a transaction; the JSON is
   * edited in JS so the key never becomes part of a SQL JSON path.
   */
  scrubSecret(id: number, key: string): boolean {
    return this.db.transaction((): boolean => {
      const row = this.db
        .prepare(`SELECT data_json FROM email_outbox WHERE id = ?`)
        .get(id) as { data_json: string } | undefined;
      if (!row) return false;
      const data = JSON.parse(row.data_json) as Record<string, unknown>;
      if (!Object.prototype.hasOwnProperty.call(data, key)) return false;
      delete data[key];
      this.db
        .prepare(`UPDATE email_outbox SET data_json = ? WHERE id = ?`)
        .run(JSON.stringify(data), id);
      return true;
    })();
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: EmailOutboxRepository | null = null;

export function getEmailOutboxRepository(): EmailOutboxRepository {
  if (!instance) instance = new EmailOutboxRepository();
  return instance;
}

export function resetEmailOutboxRepository(): void {
  instance = null;
}
