/**
 * Shop Restores Repository — PLATFORM-only (LIRA-377, migration v231).
 *
 * The durable record of every web shop restore (time / file / undo) and its
 * state. It lives in the platform file because the shop file is the thing a
 * restore replaces: an audit row written into the shop file before the swap
 * would be lost by the swap itself. The row's `id` is also the restore
 * epoch the PCs compare at check-in.
 *
 * Platform scope is FORCED internally (`runWithoutTenant`), the same way
 * `SubscriptionRepository` does it: the restore routes run inside the shop's
 * own `runWithTenant(shopId)` scope, and in `TENANT_DB_MODE=per-tenant` that
 * scope resolves to the shop's file, which must never hold these rows. In
 * shared mode the bypass still resolves to the one file, so nothing changes.
 *
 * The shop is named by `target_tenant_id` (NOT `tenant_id`, like
 * `signin_directory`) so the split tool and the platform-split guard never
 * count these rows as shop data; it is always an explicit parameter.
 *
 * Every instant is a UTC ISO string supplied by the caller (rule 27) — no
 * clock here and no SQLite `datetime('now')`. State transitions are enforced
 * in the UPDATE's WHERE clause; each `mark*` returns whether a row changed:
 *
 *   prepared → running → done | failed
 *   prepared → failed        (preparation itself failed)
 *   prepared → expired       (not confirmed in time)
 *
 * SQL only — every policy question belongs to `ShopRestoreService` (rule 13).
 */

import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";
import { runWithoutTenant } from "../db/tenantContext.js";

// =============================================================================
// Types
// =============================================================================

export type ShopRestoreKind = "time" | "file" | "undo";

export type ShopRestoreStatus =
  | "prepared"
  | "running"
  | "done"
  | "failed"
  | "expired";

export interface ShopRestoreRow {
  id: number;
  target_tenant_id: number;
  kind: ShopRestoreKind;
  status: ShopRestoreStatus;
  /** UTC ISO instant the shop reflects after the restore. */
  restored_to: string | null;
  /** Browser offset (minutes to add to UTC) for showing `restored_to`. */
  client_tz_offset_min: number | null;
  requested_by_user_id: number | null;
  /** Snapshot "as at restore time" (rule 31) — never updated. */
  requested_by_name: string | null;
  candidate_path: string | null;
  before_copy_path: string | null;
  preview_json: string | null;
  id_floor_json: string | null;
  error: string | null;
  prepared_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreatePreparedRestoreInput {
  targetTenantId: number;
  kind: ShopRestoreKind;
  restoredTo: string | null;
  clientTzOffsetMin: number | null;
  requestedByUserId: number | null;
  requestedByName: string | null;
  candidatePath: string | null;
  previewJson: string | null;
  idFloorJson: string | null;
  /** UTC ISO; also the row's created_at / updated_at. */
  preparedAt: string;
}

export interface MarkRestoreDoneInput {
  finishedAt: string;
  beforeCopyPath: string | null;
}

/** "This restore is still open" — the one definition (rule 14); matches
 * the partial unique index `idx_shop_restores_one_open`. */
const OPEN_STATUSES_SQL = `status IN ('prepared', 'running')`;

const COLUMNS = `
  id, target_tenant_id, kind, status, restored_to, client_tz_offset_min,
  requested_by_user_id, requested_by_name, candidate_path, before_copy_path,
  preview_json, id_floor_json, error, prepared_at, started_at, finished_at,
  created_at, updated_at
`;

// =============================================================================
// Repository
// =============================================================================

export class ShopRestoresRepository {
  private get db(): Database.Database {
    return getDatabase();
  }

  /** Inserts a `prepared` row and returns it. Throws a UNIQUE constraint
   * error when the shop already has an open (prepared/running) restore. */
  createPrepared(data: CreatePreparedRestoreInput): ShopRestoreRow {
    return runWithoutTenant(() => {
      const result = this.db
        .prepare(
          `INSERT INTO shop_restores
             (target_tenant_id, kind, status, restored_to, client_tz_offset_min,
              requested_by_user_id, requested_by_name, candidate_path,
              preview_json, id_floor_json, prepared_at, created_at, updated_at)
           VALUES (?, ?, 'prepared', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          data.targetTenantId,
          data.kind,
          data.restoredTo,
          data.clientTzOffsetMin,
          data.requestedByUserId,
          data.requestedByName,
          data.candidatePath,
          data.previewJson,
          data.idFloorJson,
          data.preparedAt,
          data.preparedAt,
          data.preparedAt,
        );
      return this.getById(Number(result.lastInsertRowid))!;
    });
  }

  /** prepared → running. */
  markRunning(id: number, startedAt: string): boolean {
    return runWithoutTenant(
      () =>
        this.db
          .prepare(
            `UPDATE shop_restores
                SET status = 'running', started_at = ?, updated_at = ?
              WHERE id = ? AND status = 'prepared'`,
          )
          .run(startedAt, startedAt, id).changes === 1,
    );
  }

  /** running → done. */
  markDone(id: number, data: MarkRestoreDoneInput): boolean {
    return runWithoutTenant(
      () =>
        this.db
          .prepare(
            `UPDATE shop_restores
                SET status = 'done', finished_at = ?, before_copy_path = ?, updated_at = ?
              WHERE id = ? AND status = 'running'`,
          )
          .run(data.finishedAt, data.beforeCopyPath, data.finishedAt, id)
          .changes === 1,
    );
  }

  /** prepared | running → failed, with a plain message. */
  markFailed(id: number, error: string, finishedAt: string): boolean {
    return runWithoutTenant(
      () =>
        this.db
          .prepare(
            `UPDATE shop_restores
                SET status = 'failed', error = ?, finished_at = ?, updated_at = ?
              WHERE id = ? AND ${OPEN_STATUSES_SQL}`,
          )
          .run(error, finishedAt, finishedAt, id).changes === 1,
    );
  }

  /** prepared → expired (not confirmed in time). */
  markExpired(id: number, finishedAt: string): boolean {
    return runWithoutTenant(
      () =>
        this.db
          .prepare(
            `UPDATE shop_restores
                SET status = 'expired', finished_at = ?, updated_at = ?
              WHERE id = ? AND status = 'prepared'`,
          )
          .run(finishedAt, finishedAt, id).changes === 1,
    );
  }

  getById(id: number): ShopRestoreRow | null {
    return runWithoutTenant(
      () =>
        (this.db
          .prepare(`SELECT ${COLUMNS} FROM shop_restores WHERE id = ?`)
          .get(id) as ShopRestoreRow | undefined) ?? null,
    );
  }

  /** The shop's open (prepared/running) restore, if any — at most one. */
  getOpenForTenant(tenantId: number): ShopRestoreRow | null {
    return runWithoutTenant(
      () =>
        (this.db
          .prepare(
            `SELECT ${COLUMNS} FROM shop_restores
              WHERE target_tenant_id = ? AND ${OPEN_STATUSES_SQL}
              ORDER BY id DESC LIMIT 1`,
          )
          .get(tenantId) as ShopRestoreRow | undefined) ?? null,
    );
  }

  /** The shop's newest finished (`done`) restore — the epoch PCs compare. */
  latestDone(tenantId: number): ShopRestoreRow | null {
    return runWithoutTenant(
      () =>
        (this.db
          .prepare(
            `SELECT ${COLUMNS} FROM shop_restores
              WHERE target_tenant_id = ? AND status = 'done'
              ORDER BY id DESC LIMIT 1`,
          )
          .get(tenantId) as ShopRestoreRow | undefined) ?? null,
    );
  }

  /** Done restores of the shop that kept a before-restore copy, finished at
   * or after `sinceIso` (UTC ISO), newest first. */
  listBeforeCopies(tenantId: number, sinceIso: string): ShopRestoreRow[] {
    return runWithoutTenant(
      () =>
        this.db
          .prepare(
            `SELECT ${COLUMNS} FROM shop_restores
              WHERE target_tenant_id = ? AND status = 'done'
                AND before_copy_path IS NOT NULL
                AND finished_at >= ?
              ORDER BY finished_at DESC, id DESC`,
          )
          .all(tenantId, sinceIso) as ShopRestoreRow[],
    );
  }

  /** Every shop's `prepared` rows prepared before `iso` — the expiry sweep. */
  listPreparedOlderThan(iso: string): ShopRestoreRow[] {
    return runWithoutTenant(
      () =>
        this.db
          .prepare(
            /* tenant-exempt: platform-only table; cross-shop expiry sweep */
            `SELECT ${COLUMNS} FROM shop_restores
              WHERE status = 'prepared' AND prepared_at < ?
              ORDER BY id`,
          )
          .all(iso) as ShopRestoreRow[],
    );
  }
}

let instance: ShopRestoresRepository | null = null;

export function getShopRestoresRepository(): ShopRestoresRepository {
  if (!instance) instance = new ShopRestoresRepository();
  return instance;
}

export function resetShopRestoresRepository(): void {
  instance = null;
}
