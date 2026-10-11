/**
 * LIRA-306 — the N5 manifest (FR-035, FR-036): what the working copy holds
 * in THIS PC's id range, per `MANIFEST_KEY_TABLES`, plus the reads that
 * tried to write. Sent on "Back to the web app"; the server compares it with
 * the rows its events say they created (OfflineEventService.compareManifest)
 * and lists any unexplained row as a `pc_data_mismatch` review item. Rows
 * created then deleted offline are simply absent. `localUnexplained` is the
 * same comparison against the PC's own outbox, for the log.
 *
 * Table names come only from the core list (never input) and every bound is
 * a `?` parameter.
 */
import type BetterSqlite3 from "better-sqlite3";
import {
  MANIFEST_KEY_TABLES,
  OFFLINE_ID_FLOOR,
  offlineTableIndex,
  type ManifestInput,
} from "@liratek/core";

const TABLE_STRIDE = 1_000_000_000;
const SAFE_NAME = /^[a-z_]+$/;

export interface BuiltManifest {
  body: ManifestInput & { tables: Record<string, number[]> };
  localUnexplained: Array<{ table: string; ids: number[] }>;
  tablesRead: number;
}

export function buildManifest(i: {
  db: BetterSqlite3.Database;
  deviceNo: number;
  copyId: string;
  readWrites: Array<{ channel: string; changes: number }>;
}): BuiltManifest {
  const existing = new Set(
    (
      i.db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
        .all() as Array<{ name: string }>
    ).map((r) => r.name),
  );
  const createdByOutbox = new Set(
    (
      i.db
        .prepare(`SELECT offline_id FROM offline_outbox_created`)
        .all() as Array<{ offline_id: number }>
    ).map((r) => r.offline_id),
  );
  const tables: Record<string, number[]> = {};
  const localUnexplained: Array<{ table: string; ids: number[] }> = [];
  let tablesRead = 0;
  for (const table of MANIFEST_KEY_TABLES) {
    if (!existing.has(table) || !SAFE_NAME.test(table)) continue;
    tablesRead += 1;
    const lo =
      i.deviceNo * OFFLINE_ID_FLOOR + offlineTableIndex(table) * TABLE_STRIDE;
    const ids = (
      i.db
        .prepare(`SELECT id FROM ${table} WHERE id > ? AND id < ? ORDER BY id`)
        .all(lo, lo + TABLE_STRIDE) as Array<{ id: number }>
    ).map((r) => r.id);
    if (ids.length === 0) continue;
    tables[table] = ids;
    const unexplained = ids.filter((id) => !createdByOutbox.has(id));
    if (unexplained.length > 0)
      localUnexplained.push({ table, ids: unexplained });
  }
  return {
    body: { copyId: i.copyId, tables, readWrites: i.readWrites },
    localUnexplained,
    tablesRead,
  };
}
