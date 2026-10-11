/**
 * LIRA-306 — the web review list (`offline_review_items`). Transitions only
 * from `open` (idempotent actions, R13).
 */
import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import type { OfflineReviewKind } from "../offline/reviewKinds.js";

export type OfflineReviewState = "open" | "applied" | "dismissed" | "reviewed";

export interface OfflineReviewRow {
  id: number;
  event_row_id: number | null;
  device_id: number;
  kind: OfflineReviewKind;
  state: OfflineReviewState;
  details_json: string;
  resolved_by: number | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

const nowIso = (): string => new Date().toISOString();

export class OfflineReviewRepository {
  private get db(): Database.Database {
    return getDatabase();
  }

  /** One atomic step for a review action (state check + writes). */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  insert(i: { eventRowId: number | null; deviceId: number; kind: OfflineReviewKind; details: unknown }): number {
    const now = nowIso();
    const r = this.db
      .prepare(
        `INSERT INTO offline_review_items (tenant_id, event_row_id, device_id, kind, details_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(getCurrentTenantId(), i.eventRowId, i.deviceId, i.kind, JSON.stringify(i.details ?? {}), now, now);
    return Number(r.lastInsertRowid);
  }

  findById(id: number): OfflineReviewRow | null {
    return (
      (this.db
        .prepare(`SELECT * FROM offline_review_items WHERE id = ? AND tenant_id = ?`)
        .get(id, getCurrentTenantId()) as OfflineReviewRow | undefined) ?? null
    );
  }

  list(f: { state?: OfflineReviewState; kind?: OfflineReviewKind }): OfflineReviewRow[] {
    return this.db
      .prepare(
        `SELECT * FROM offline_review_items
          WHERE tenant_id = ? AND (? IS NULL OR state = ?) AND (? IS NULL OR kind = ?)
          ORDER BY id`,
      )
      .all(getCurrentTenantId(), f.state ?? null, f.state ?? null, f.kind ?? null, f.kind ?? null) as OfflineReviewRow[];
  }

  listForEvent(eventRowId: number): OfflineReviewRow[] {
    return this.db
      .prepare(`SELECT * FROM offline_review_items WHERE tenant_id = ? AND event_row_id = ? ORDER BY id`)
      .all(getCurrentTenantId(), eventRowId) as OfflineReviewRow[];
  }

  openForEvent(eventRowId: number): OfflineReviewRow[] {
    return this.db
      .prepare(`SELECT * FROM offline_review_items WHERE tenant_id = ? AND event_row_id = ? AND state = 'open' ORDER BY id`)
      .all(getCurrentTenantId(), eventRowId) as OfflineReviewRow[];
  }

  /** O-new-29 — the PC's open sequence-conflict item (no event row). */
  findOpenSeqConflict(deviceId: number): OfflineReviewRow | null {
    return (
      (this.db
        .prepare(
          `SELECT * FROM offline_review_items
            WHERE tenant_id = ? AND device_id = ? AND state = 'open' AND event_row_id IS NULL
              AND json_extract(details_json, '$.code') = 'SEQ_CONFLICT'
            ORDER BY id LIMIT 1`,
        )
        .get(getCurrentTenantId(), deviceId) as OfflineReviewRow | undefined) ?? null
    );
  }

  /** O-new-29 — a renumber the admin asked for that the PC has not done yet. */
  findPendingRenumber(deviceId: number): OfflineReviewRow | null {
    return (
      (this.db
        .prepare(
          `SELECT * FROM offline_review_items
            WHERE tenant_id = ? AND device_id = ? AND state = 'applied' AND event_row_id IS NULL
              AND json_extract(details_json, '$.code') = 'SEQ_CONFLICT'
              AND json_extract(details_json, '$.renumberPending') = 1
            ORDER BY id LIMIT 1`,
        )
        .get(getCurrentTenantId(), deviceId) as OfflineReviewRow | undefined) ?? null
    );
  }

  updateDetails(id: number, details: unknown): void {
    this.db
      .prepare(`UPDATE offline_review_items SET details_json = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`)
      .run(JSON.stringify(details ?? {}), nowIso(), id, getCurrentTenantId());
  }

  /** open → state; false when the item is not open (already resolved). */
  resolve(id: number, state: Exclude<OfflineReviewState, "open">, by: number): boolean {
    const now = nowIso();
    return (
      this.db
        .prepare(
          `UPDATE offline_review_items SET state = ?, resolved_by = ?, resolved_at = ?, updated_at = ?
            WHERE id = ? AND tenant_id = ? AND state = 'open'`,
        )
        .run(state, by, now, now, id, getCurrentTenantId()).changes > 0
    );
  }
}

let instance: OfflineReviewRepository | null = null;
export function getOfflineReviewRepository(): OfflineReviewRepository {
  if (!instance) instance = new OfflineReviewRepository();
  return instance;
}
export function resetOfflineReviewRepository(): void {
  instance = null;
}
