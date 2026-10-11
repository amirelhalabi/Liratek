/**
 * LIRA-306 — PC row id → server row id, per shop (`offline_id_map`). Never
 * swept: receipt numbers printed offline resolve through it (FR-040).
 */
import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";
import { getCurrentTenantId } from "../db/tenantContext.js";

export interface OfflineIdMapRow {
  id: number;
  offline_id: number;
  device_id: number;
  table_name: string;
  server_id: number;
  event_id: string;
  link_kind: "created" | "linked_existing";
}

const nowIso = (): string => new Date().toISOString();

export class OfflineIdMapRepository {
  private get db(): Database.Database {
    return getDatabase();
  }

  insert(m: {
    offlineId: number;
    deviceId: number;
    tableName: string;
    serverId: number;
    eventId: string;
    linkKind?: "created" | "linked_existing";
  }): void {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO offline_id_map (tenant_id, offline_id, device_id, table_name, server_id, event_id, link_kind, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(getCurrentTenantId(), m.offlineId, m.deviceId, m.tableName, m.serverId, m.eventId, m.linkKind ?? "created", now, now);
  }

  lookup(offlineId: number): number | undefined {
    const r = this.db
      .prepare(`SELECT server_id FROM offline_id_map WHERE offline_id = ? AND tenant_id = ?`)
      .get(offlineId, getCurrentTenantId()) as { server_id: number } | undefined;
    return r?.server_id;
  }

  findRow(offlineId: number): OfflineIdMapRow | null {
    return (
      (this.db
        .prepare(
          `SELECT id, offline_id, device_id, table_name, server_id, event_id, link_kind
             FROM offline_id_map WHERE offline_id = ? AND tenant_id = ?`,
        )
        .get(offlineId, getCurrentTenantId()) as OfflineIdMapRow | undefined) ?? null
    );
  }

  /** Highest offline id this PC has had mapped, per table (check-in seeding). */
  maxOfflineIdsByTable(deviceId: number): Record<string, number> {
    const rows = this.db
      .prepare(
        `SELECT table_name, MAX(offline_id) AS m FROM offline_id_map
          WHERE tenant_id = ? AND device_id = ? GROUP BY table_name ORDER BY table_name`,
      )
      .all(getCurrentTenantId(), deviceId) as Array<{ table_name: string; m: number }>;
    return Object.fromEntries(rows.map((r) => [r.table_name, r.m]));
  }
}

let instance: OfflineIdMapRepository | null = null;
export function getOfflineIdMapRepository(): OfflineIdMapRepository {
  if (!instance) instance = new OfflineIdMapRepository();
  return instance;
}
export function resetOfflineIdMapRepository(): void {
  instance = null;
}
