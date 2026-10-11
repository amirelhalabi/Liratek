/**
 * LIRA-306 — uploaded events and their outcomes (`offline_events`). Insert is
 * idempotent by event id (same payload hash → duplicate; other hash →
 * reused); the same (PC, seq) under another id is a sequence conflict and is
 * NOT stored (FR-015, FR-024).
 */
import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import type { OfflineEventStatus } from "../offline/reviewKinds.js";

export interface OfflineEventRow {
  id: number;
  tenant_id: number;
  device_id: number;
  event_id: string;
  device_seq: number;
  channel: string;
  payload_json: string;
  payload_hash: string;
  actor_user_id: number;
  occurred_at: string;
  corrected_at: string | null;
  client_day: string;
  client_tz_offset_minutes: number;
  copy_id: string;
  app_version: string;
  schema_version: number;
  schema_shape_json: string;
  rates_json: string;
  created_json: string;
  depends_on_json: string;
  status: OfflineEventStatus;
  attempts: number;
  result_json: string | null;
  error: string | null;
  processed_at: string | null;
  resolved_by: number | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewOfflineEventRow {
  deviceId: number;
  eventId: string;
  seq: number;
  channel: string;
  payloadJson: string;
  payloadHash: string;
  actorUserId: number;
  occurredAt: string;
  clientDay: string;
  clientTzOffsetMinutes: number;
  copyId: string;
  appVersion: string;
  schemaVersion: number;
  schemaShapeJson: string;
  ratesJson: string;
  createdJson: string;
  dependsOnJson: string;
  /** after PC clock correction (skew.ts), when it differs from occurredAt */
  correctedAt?: string | null;
}

export type InsertEventOutcome = "inserted" | "duplicate" | "reused" | "seq_conflict";

const nowIso = (): string => new Date().toISOString();

export class OfflineEventRepository {
  private get db(): Database.Database {
    return getDatabase();
  }

  insertReceived(
    e: NewOfflineEventRow,
    as?: { status: "refused"; error: string },
  ): { outcome: InsertEventOutcome; row: OfflineEventRow | null } {
    const tenantId = getCurrentTenantId();
    const existing = this.findByEventId(e.eventId);
    if (existing) {
      return { outcome: existing.payload_hash === e.payloadHash ? "duplicate" : "reused", row: existing };
    }
    const atSeq = this.findBySeq(e.deviceId, e.seq);
    if (atSeq) return { outcome: "seq_conflict", row: atSeq };
    const now = nowIso();
    const res = this.db
      .prepare(
        `INSERT INTO offline_events (tenant_id, device_id, event_id, device_seq, channel, payload_json, payload_hash,
           actor_user_id, occurred_at, corrected_at, client_day, client_tz_offset_minutes, copy_id, app_version, schema_version,
           schema_shape_json, rates_json, created_json, depends_on_json, status, error, processed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        tenantId, e.deviceId, e.eventId, e.seq, e.channel, e.payloadJson, e.payloadHash, e.actorUserId,
        e.occurredAt, e.correctedAt ?? null, e.clientDay, e.clientTzOffsetMinutes, e.copyId, e.appVersion, e.schemaVersion,
        e.schemaShapeJson, e.ratesJson, e.createdJson, e.dependsOnJson, as?.status ?? "received",
        as?.error ?? null, as ? now : null, now, now,
      );
    return { outcome: "inserted", row: this.findById(Number(res.lastInsertRowid)) };
  }

  findById(id: number): OfflineEventRow | null {
    return (
      (this.db
        .prepare(`SELECT * FROM offline_events WHERE id = ? AND tenant_id = ?`)
        .get(id, getCurrentTenantId()) as OfflineEventRow | undefined) ?? null
    );
  }

  findByEventId(eventId: string): OfflineEventRow | null {
    return (
      (this.db
        .prepare(`SELECT * FROM offline_events WHERE event_id = ? AND tenant_id = ?`)
        .get(eventId, getCurrentTenantId()) as OfflineEventRow | undefined) ?? null
    );
  }

  findBySeq(deviceId: number, seq: number): OfflineEventRow | null {
    return (
      (this.db
        .prepare(`SELECT * FROM offline_events WHERE device_id = ? AND device_seq = ? AND tenant_id = ?`)
        .get(deviceId, seq, getCurrentTenantId()) as OfflineEventRow | undefined) ?? null
    );
  }

  findManyByEventIds(eventIds: readonly string[]): OfflineEventRow[] {
    if (eventIds.length === 0) return [];
    const marks = eventIds.map(() => "?").join(", ");
    return this.db
      .prepare(`SELECT * FROM offline_events WHERE tenant_id = ? AND event_id IN (${marks})`)
      .all(getCurrentTenantId(), ...eventIds) as OfflineEventRow[];
  }

  /** Outcomes for the PC, from a sequence number (status polling). */
  listForDevice(deviceId: number, fromSeq: number, limit = 500): OfflineEventRow[] {
    return this.db
      .prepare(
        `SELECT * FROM offline_events WHERE tenant_id = ? AND device_id = ? AND device_seq >= ?
          ORDER BY device_seq LIMIT ?`,
      )
      .all(getCurrentTenantId(), deviceId, fromSeq, limit) as OfflineEventRow[];
  }

  /** HELD events that list any of `eventIds` among their dependencies,
   *  in each PC's own order (released by the review service, FR-034). */
  listHeldDependingOn(eventIds: readonly string[]): OfflineEventRow[] {
    if (eventIds.length === 0) return [];
    const marks = eventIds.map(() => "?").join(", ");
    return this.db
      .prepare(
        `SELECT e.* FROM offline_events e
          WHERE e.tenant_id = ? AND e.status = 'held'
            AND EXISTS (SELECT 1 FROM json_each(e.depends_on_json) d WHERE d.value IN (${marks}))
          ORDER BY e.device_id, e.device_seq`,
      )
      .all(getCurrentTenantId(), ...eventIds) as OfflineEventRow[];
  }

  /** Processed events for the review page's history (newest first). */
  listHistory(f: { deviceId?: number; from?: string; to?: string; status?: OfflineEventStatus; limit?: number }): OfflineEventRow[] {
    return this.db
      .prepare(
        `SELECT * FROM offline_events
          WHERE tenant_id = ? AND status != 'received'
            AND (? IS NULL OR device_id = ?)
            AND (? IS NULL OR client_day >= ?)
            AND (? IS NULL OR client_day <= ?)
            AND (? IS NULL OR status = ?)
          ORDER BY COALESCE(corrected_at, occurred_at) DESC, id DESC
          LIMIT ?`,
      )
      .all(
        getCurrentTenantId(),
        f.deviceId ?? null,
        f.deviceId ?? null,
        f.from ?? null,
        f.from ?? null,
        f.to ?? null,
        f.to ?? null,
        f.status ?? null,
        f.status ?? null,
        f.limit ?? 500,
      ) as OfflineEventRow[];
  }

  /** Every `created_json` this PC's stored events carry (N5 cross-check). */
  createdJsonForDevice(deviceId: number): string[] {
    return (
      this.db
        .prepare(`SELECT created_json FROM offline_events WHERE tenant_id = ? AND device_id = ? ORDER BY device_seq`)
        .all(getCurrentTenantId(), deviceId) as Array<{ created_json: string }>
    ).map((r) => r.created_json);
  }

  maxSeq(deviceId: number): number {
    const r = this.db
      .prepare(`SELECT COALESCE(MAX(device_seq), 0) AS m FROM offline_events WHERE tenant_id = ? AND device_id = ?`)
      .get(getCurrentTenantId(), deviceId) as { m: number };
    return r.m;
  }

  /** PCs that have events still waiting to be processed. */
  devicesWithReceived(): number[] {
    return (
      this.db
        .prepare(
          `SELECT DISTINCT device_id FROM offline_events WHERE tenant_id = ? AND status = 'received' ORDER BY device_id`,
        )
        .all(getCurrentTenantId()) as Array<{ device_id: number }>
    ).map((r) => r.device_id);
  }

  /** Control plane (merge sweep): shops with events waiting. Call inside
   *  runWithoutTenant() on the shared platform database. */
  tenantsWithReceived(): number[] {
    return (
      this.db
        .prepare(
          `SELECT DISTINCT tenant_id FROM offline_events /* tenant-exempt: merge sweep lists every shop with waiting events (control plane, runWithoutTenant) */ WHERE status = 'received' ORDER BY tenant_id`,
        )
        .all() as Array<{ tenant_id: number }>
    ).map((r) => r.tenant_id);
  }

  /** Booked/applied events of a PC (their stored results feed the
   *  duplicate candidate exclusion, R8). */
  listBookedForDevice(deviceId: number): OfflineEventRow[] {
    return this.db
      .prepare(
        `SELECT * FROM offline_events WHERE tenant_id = ? AND device_id = ? AND status IN ('booked','applied')
          ORDER BY device_seq`,
      )
      .all(getCurrentTenantId(), deviceId) as OfflineEventRow[];
  }

  updateOutcome(
    id: number,
    o: { status: OfflineEventStatus; resultJson: string | null; error: string | null; correctedAt?: string | null },
  ): void {
    const now = nowIso();
    this.db
      .prepare(
        `UPDATE offline_events
            SET status = ?, result_json = ?, error = ?, corrected_at = COALESCE(?, corrected_at),
                processed_at = ?, updated_at = ?
          WHERE id = ? AND tenant_id = ?`,
      )
      .run(o.status, o.resultJson, o.error, o.correctedAt ?? null, now, now, id, getCurrentTenantId());
  }

  incrementAttempts(id: number, error: string): number {
    this.db
      .prepare(
        `UPDATE offline_events SET attempts = attempts + 1, error = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
      )
      .run(error, nowIso(), id, getCurrentTenantId());
    return this.findById(id)?.attempts ?? 0;
  }

  /** A new refusal / hold reason without changing the status (Apply refused again). */
  setError(id: number, error: string): void {
    this.db
      .prepare(`UPDATE offline_events SET error = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`)
      .run(error, nowIso(), id, getCurrentTenantId());
  }

  /** Status only (review actions: dismissed, skipped kept, …). */
  setStatus(id: number, status: OfflineEventStatus, by: number | null): void {
    const now = nowIso();
    this.db
      .prepare(
        `UPDATE offline_events SET status = ?, resolved_by = COALESCE(?, resolved_by), resolved_at = CASE WHEN ? IS NULL THEN resolved_at ELSE ? END, updated_at = ?
          WHERE id = ? AND tenant_id = ?`,
      )
      .run(status, by, by, now, now, id, getCurrentTenantId());
  }

  markResolved(id: number, by: number): void {
    const now = nowIso();
    this.db
      .prepare(`UPDATE offline_events SET resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`)
      .run(by, now, now, id, getCurrentTenantId());
  }
}

let instance: OfflineEventRepository | null = null;
export function getOfflineEventRepository(): OfflineEventRepository {
  if (!instance) instance = new OfflineEventRepository();
  return instance;
}
export function resetOfflineEventRepository(): void {
  instance = null;
}
