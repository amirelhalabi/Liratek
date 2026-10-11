/**
 * LIRA-306 — paired PCs (`offline_devices`). Server side. Every statement is
 * tenant-scoped; the tenant comes from the context (device routes resolve it
 * from the key before calling, `runWithTenant`).
 */
import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";
import { getCurrentTenantId } from "../db/tenantContext.js";

export interface OfflineDeviceRow {
  id: number;
  tenant_id: number;
  device_no: number;
  name: string;
  key_id: string;
  key_hash: string;
  paired_by: number;
  paired_at: string;
  revoked_at: string | null;
  revoked_by: number | null;
  last_seen_at: string | null;
  last_state: "standby" | "blocked" | "offline" | "finishing" | null;
  last_pending_count: number;
  last_app_version: string | null;
  last_schema_version: number | null;
  last_skew_ms: number | null;
  last_online_skew_ms: number | null;
  next_expected_seq: number;
  created_at: string;
  updated_at: string;
}

export interface CheckinUpdate {
  state: "standby" | "blocked" | "offline" | "finishing";
  pendingCount: number;
  appVersion: string;
  schemaVersion: number;
  skewMs: number;
}

const nowIso = (): string => new Date().toISOString();

export class OfflineDeviceRepository {
  private get db(): Database.Database {
    return getDatabase();
  }

  /** Next PC number: one above the highest ever issued in this shop
   *  (revoked rows included — numbers are never reused). */
  nextDeviceNo(): number {
    const r = this.db
      .prepare(`SELECT COALESCE(MAX(device_no), 0) AS m FROM offline_devices WHERE tenant_id = ?`)
      .get(getCurrentTenantId()) as { m: number };
    return r.m + 1;
  }

  insert(d: { deviceNo: number; name: string; keyId: string; keyHash: string; pairedBy: number }): OfflineDeviceRow {
    const now = nowIso();
    const res = this.db
      .prepare(
        `INSERT INTO offline_devices (tenant_id, device_no, name, key_id, key_hash, paired_by, paired_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(getCurrentTenantId(), d.deviceNo, d.name, d.keyId, d.keyHash, d.pairedBy, now, now, now);
    return this.findById(Number(res.lastInsertRowid))!;
  }

  findById(id: number): OfflineDeviceRow | null {
    return (
      (this.db
        .prepare(`SELECT * FROM offline_devices WHERE id = ? AND tenant_id = ?`)
        .get(id, getCurrentTenantId()) as OfflineDeviceRow | undefined) ?? null
    );
  }

  findByKeyId(keyId: string): OfflineDeviceRow | null {
    return (
      (this.db
        .prepare(`SELECT * FROM offline_devices WHERE key_id = ? AND tenant_id = ?`)
        .get(keyId, getCurrentTenantId()) as OfflineDeviceRow | undefined) ?? null
    );
  }

  findByDeviceNo(deviceNo: number): OfflineDeviceRow | null {
    return (
      (this.db
        .prepare(`SELECT * FROM offline_devices WHERE device_no = ? AND tenant_id = ?`)
        .get(deviceNo, getCurrentTenantId()) as OfflineDeviceRow | undefined) ?? null
    );
  }

  list(): OfflineDeviceRow[] {
    return this.db
      .prepare(`SELECT * FROM offline_devices WHERE tenant_id = ? ORDER BY device_no`)
      .all(getCurrentTenantId()) as OfflineDeviceRow[];
  }

  /** New key for the SAME PC row: number, merge cursor and id range kept;
   *  the old key stops working (FR-001a). */
  rekey(id: number, k: { keyId: string; keyHash: string; pairedBy: number; name?: string }): OfflineDeviceRow | null {
    const now = nowIso();
    this.db
      .prepare(
        `UPDATE offline_devices
            SET key_id = ?, key_hash = ?, paired_by = ?, paired_at = ?, name = COALESCE(?, name),
                revoked_at = NULL, revoked_by = NULL, updated_at = ?
          WHERE id = ? AND tenant_id = ?`,
      )
      .run(k.keyId, k.keyHash, k.pairedBy, now, k.name ?? null, now, id, getCurrentTenantId());
    return this.findById(id);
  }

  revoke(id: number, by: number): boolean {
    const now = nowIso();
    const r = this.db
      .prepare(
        `UPDATE offline_devices SET revoked_at = ?, revoked_by = ?, updated_at = ?
          WHERE id = ? AND tenant_id = ? AND revoked_at IS NULL`,
      )
      .run(now, by, now, id, getCurrentTenantId());
    return r.changes > 0;
  }

  /** Revoke every active PC of the shop (e2e hygiene, admin "unpair all"). */
  revokeAll(by: number): number {
    const now = nowIso();
    return this.db
      .prepare(
        `UPDATE offline_devices SET revoked_at = ?, revoked_by = ?, updated_at = ?
          WHERE tenant_id = ? AND revoked_at IS NULL`,
      )
      .run(now, by, now, getCurrentTenantId()).changes;
  }

  recordCheckin(id: number, c: CheckinUpdate): void {
    const now = nowIso();
    this.db
      .prepare(
        `UPDATE offline_devices
            SET last_seen_at = ?, last_state = ?, last_pending_count = ?, last_app_version = ?,
                last_schema_version = ?, last_skew_ms = ?,
                last_online_skew_ms = CASE WHEN ? = 'standby' THEN ? ELSE last_online_skew_ms END,
                updated_at = ?
          WHERE id = ? AND tenant_id = ?`,
      )
      .run(
        now, c.state, c.pendingCount, c.appVersion, c.schemaVersion, c.skewMs, c.state, c.skewMs, now, id,
        getCurrentTenantId(),
      );
  }

  /** Upload time: last seen + the skew measured on this request. */
  recordUploadSeen(id: number, skewMs: number): void {
    const now = nowIso();
    this.db
      .prepare(
        `UPDATE offline_devices SET last_seen_at = ?, last_skew_ms = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
      )
      .run(now, skewMs, now, id, getCurrentTenantId());
  }

  setNextExpectedSeq(id: number, seq: number): void {
    this.db
      .prepare(`UPDATE offline_devices SET next_expected_seq = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`)
      .run(seq, nowIso(), id, getCurrentTenantId());
  }
}

let instance: OfflineDeviceRepository | null = null;
export function getOfflineDeviceRepository(): OfflineDeviceRepository {
  if (!instance) instance = new OfflineDeviceRepository();
  return instance;
}
export function resetOfflineDeviceRepository(): void {
  instance = null;
}
