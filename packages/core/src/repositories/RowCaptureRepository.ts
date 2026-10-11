/**
 * LIRA-306 — which rows an action created (R4, FR-020). Read
 * `sqlite_sequence` before and after the action INSIDE the same transaction,
 * then select the ids that still exist in (before, after] per table. Rows
 * created and deleted within the window are therefore not reported. The same
 * code runs on the PC (recording) and on the server (replay).
 *
 * Only `MANIFEST_KEY_TABLES` are read (every id-range table minus
 * `MAP_EXCLUDED_TABLES`); all of them carry `tenant_id`.
 */
import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { MANIFEST_KEY_TABLES } from "../offline/tables.js";

export type SequenceSnapshot = Record<string, number>;

const SAFE_NAME = /^[a-z_]+$/;

export class RowCaptureRepository {
  private get db(): Database.Database {
    return getDatabase();
  }

  /** Current `sqlite_sequence` value of every captured table (0 if none). */
  snapshotSequences(): SequenceSnapshot {
    const rows = this.db.prepare(`SELECT name, seq FROM sqlite_sequence`).all() as Array<{
      name: string;
      seq: number;
    }>;
    const byName = new Map(rows.map((r) => [r.name, r.seq]));
    const out: SequenceSnapshot = {};
    for (const t of MANIFEST_KEY_TABLES) out[t] = byName.get(t) ?? 0;
    return out;
  }

  /** Ids created since `before`, per table, ascending; tables with none are omitted. */
  createdSince(before: SequenceSnapshot): Record<string, number[]> {
    const after = this.snapshotSequences();
    const tenantId = getCurrentTenantId();
    const out: Record<string, number[]> = {};
    for (const t of MANIFEST_KEY_TABLES) {
      const lo = before[t] ?? 0;
      const hi = after[t] ?? 0;
      if (hi <= lo || !SAFE_NAME.test(t)) continue;
      const ids = (
        this.db
          .prepare(`SELECT id FROM ${t} WHERE tenant_id = ? AND id > ? AND id <= ? ORDER BY id`)
          .all(tenantId, lo, hi) as Array<{ id: number }>
      ).map((r) => r.id);
      if (ids.length > 0) out[t] = ids;
    }
    return out;
  }

  /** Products whose stock count is below zero (the "stock count was off"
   *  probe around a replayed booking, FR-028). */
  negativeStock(): Map<number, { name: string; stock: number }> {
    const rows = this.db
      .prepare(`SELECT id, name, stock_quantity FROM products WHERE tenant_id = ? AND stock_quantity < 0`)
      .all(getCurrentTenantId()) as Array<{ id: number; name: string; stock_quantity: number }>;
    return new Map(rows.map((r) => [r.id, { name: r.name, stock: r.stock_quantity }]));
  }

  /** Highest id per table (copy high-water marks, R15). */
  highWaterMarks(): SequenceSnapshot {
    return this.snapshotSequences();
  }
}

let instance: RowCaptureRepository | null = null;
export function getRowCaptureRepository(): RowCaptureRepository {
  if (!instance) instance = new RowCaptureRepository();
  return instance;
}
export function resetRowCaptureRepository(): void {
  instance = null;
}
