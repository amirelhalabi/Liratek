/**
 * IdempotencyService — "book once" for money submissions that carry an
 * Idempotency-Key (LIRA-289 FR-017). No SQL here (rule 13); the repository
 * owns the table and the transaction.
 *
 * Rules:
 *   - same key + same user + same route within the shop → the first reply is
 *     replayed and the booking does NOT run again;
 *   - only a successful reply is stored, so a retry after a refusal (e.g. a
 *     wallet that was short, then topped up) runs fresh;
 *   - check, booking and stored reply happen in one transaction.
 */

import { runWithTenant, runWithoutTenant } from "../db/tenantContext.js";
import { listTenantDatabaseIds } from "../db/tenantDatabaseIds.js";
import { authLogger } from "../utils/logger.js";
import {
  getIdempotencyRepository,
  type IdempotencyRepository,
  type IdempotencyScope,
} from "../repositories/IdempotencyRepository.js";

/** 8–128 letters, digits or dashes — what the phone sends (a UUID per tap). */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;

/** Stored replies are kept this long, then swept. */
export const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface IdempotentOutcome<T> {
  /** True when this reply is the stored reply of an earlier identical submission. */
  replayed: boolean;
  result: T;
}

export class IdempotencyService {
  private readonly repo: Pick<
    IdempotencyRepository,
    "findResponse" | "saveResponse" | "atomically" | "deleteOlderThan"
  >;

  constructor(repo?: IdempotencyService["repo"]) {
    this.repo = repo ?? getIdempotencyRepository();
  }

  isValidKey(key: string): boolean {
    return IDEMPOTENCY_KEY_PATTERN.test(key);
  }

  /**
   * Runs `book` at most once per scope. `now` is the UTC ISO time stored with
   * the reply. Throws only if `book` throws (the transaction rolls back).
   */
  run<T extends { success: boolean }>(
    scope: IdempotencyScope,
    now: string,
    book: () => T,
  ): IdempotentOutcome<T> {
    return this.repo.atomically(() => {
      const stored = this.repo.findResponse(scope);
      if (stored !== null) {
        return { replayed: true, result: JSON.parse(stored) as T };
      }
      const result = book();
      if (result.success) {
        this.repo.saveResponse(scope, JSON.stringify(result), now);
      }
      return { replayed: false, result };
    });
  }

  /** Deletes stored replies older than 24 h in the CURRENT database. */
  sweep(nowIso: string): number {
    const nowMs = Date.parse(nowIso);
    if (Number.isNaN(nowMs)) throw new Error(`IdempotencyService: invalid now "${nowIso}"`);
    const cutoff = new Date(nowMs - IDEMPOTENCY_RETENTION_MS).toISOString();
    return this.repo.deleteOlderThan(cutoff);
  }

  /**
   * The hourly housekeeping across every database: the main file, then each
   * shop file in per-tenant mode (same fan-out as the auth-token sweep, kept
   * separate so neither can fail the other). Never throws.
   */
  sweepAll(nowIso: string): { deleted: number; failed: number } {
    let deleted = 0;
    let failed = 0;
    try {
      deleted += runWithoutTenant(() => this.sweep(nowIso));
    } catch (error) {
      failed += 1;
      authLogger.error({ error }, "idempotency cleanup failed for the main database");
    }
    for (const tenantId of listTenantDatabaseIds() ?? []) {
      try {
        deleted += runWithTenant(tenantId, () => this.sweep(nowIso));
      } catch (error) {
        failed += 1;
        authLogger.error({ error, tenantId }, "idempotency cleanup failed for a tenant database");
      }
    }
    return { deleted, failed };
  }
}

let instance: IdempotencyService | null = null;

export function getIdempotencyService(): IdempotencyService {
  if (!instance) instance = new IdempotencyService();
  return instance;
}

export function resetIdempotencyService(): void {
  instance = null;
}
