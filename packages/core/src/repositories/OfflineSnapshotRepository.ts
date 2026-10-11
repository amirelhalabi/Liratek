/**
 * LIRA-306 — shop copies served to PCs (`offline_snapshots`): the copy id
 * an event names gives the per-table high-water marks ("created during this
 * outage", R8).
 */
import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";
import { getCurrentTenantId } from "../db/tenantContext.js";

export interface OfflineSnapshotRow {
  id: number;
  copy_id: string;
  device_id: number | null;
  schema_version: number;
  built_at: string;
  high_water_json: string;
  highWater: Record<string, number>;
}

const nowIso = (): string => new Date().toISOString();

function withHighWater(r: Omit<OfflineSnapshotRow, "highWater"> | undefined): OfflineSnapshotRow | null {
  if (!r) return null;
  let highWater: Record<string, number> = {};
  try {
    highWater = JSON.parse(r.high_water_json) as Record<string, number>;
  } catch {
    highWater = {};
  }
  return { ...r, highWater };
}

export class OfflineSnapshotRepository {
  private get db(): Database.Database {
    return getDatabase();
  }

  insert(s: {
    copyId: string;
    deviceId: number | null;
    schemaVersion: number;
    builtAt: string;
    highWater: Record<string, number>;
  }): void {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO offline_snapshots (tenant_id, copy_id, device_id, schema_version, built_at, high_water_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(getCurrentTenantId(), s.copyId, s.deviceId, s.schemaVersion, s.builtAt, JSON.stringify(s.highWater), now, now);
  }

  findByCopyId(copyId: string): OfflineSnapshotRow | null {
    return withHighWater(
      this.db
        .prepare(
          `SELECT id, copy_id, device_id, schema_version, built_at, high_water_json
             FROM offline_snapshots WHERE copy_id = ? AND tenant_id = ?`,
        )
        .get(copyId, getCurrentTenantId()) as Omit<OfflineSnapshotRow, "highWater"> | undefined,
    );
  }

  latest(): OfflineSnapshotRow | null {
    return withHighWater(
      this.db
        .prepare(
          `SELECT id, copy_id, device_id, schema_version, built_at, high_water_json
             FROM offline_snapshots WHERE tenant_id = ? ORDER BY built_at DESC, id DESC LIMIT 1`,
        )
        .get(getCurrentTenantId()) as Omit<OfflineSnapshotRow, "highWater"> | undefined,
    );
  }
}

let instance: OfflineSnapshotRepository | null = null;
export function getOfflineSnapshotRepository(): OfflineSnapshotRepository {
  if (!instance) instance = new OfflineSnapshotRepository();
  return instance;
}
export function resetOfflineSnapshotRepository(): void {
  instance = null;
}
