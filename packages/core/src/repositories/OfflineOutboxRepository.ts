/**
 * LIRA-306 — the PC's outbox inside the working copy (`offline_outbox`,
 * `offline_outbox_created`). All outbox SQL lives here (rule 13); the
 * desktop recorder orchestrates. `maxSeq()` must be read inside the same
 * write transaction that appends (FR-011).
 */
import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import type { OfflineEventStatus } from "../offline/reviewKinds.js";

export interface OutboxRow {
  id: number;
  event_id: string;
  device_seq: number;
  channel: string;
  payload_json: string;
  payload_hash: string;
  actor_user_id: number;
  occurred_at: string;
  client_day: string;
  client_tz_offset_minutes: number;
  copy_id: string;
  app_version: string;
  schema_version: number;
  schema_shape_json: string;
  rates_json: string;
  created_json: string;
  depends_on_json: string;
  delivery: "waiting" | "acked" | "done";
  server_status: OfflineEventStatus | null;
  attempts: number;
  last_error: string | null;
}

export interface NewOutboxRow {
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
}

const FINAL: readonly OfflineEventStatus[] = ["booked", "applied", "dismissed", "skipped", "held", "refused"];
const nowIso = (): string => new Date().toISOString();

export class OfflineOutboxRepository {
  private get db(): Database.Database {
    return getDatabase();
  }

  maxSeq(): number {
    const r = this.db
      .prepare(`SELECT COALESCE(MAX(device_seq), 0) AS m FROM offline_outbox WHERE tenant_id = ?`)
      .get(getCurrentTenantId()) as { m: number };
    return r.m;
  }

  append(o: NewOutboxRow): void {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO offline_outbox (tenant_id, event_id, device_seq, channel, payload_json, payload_hash, actor_user_id,
           occurred_at, client_day, client_tz_offset_minutes, copy_id, app_version, schema_version, schema_shape_json,
           rates_json, created_json, depends_on_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        getCurrentTenantId(), o.eventId, o.seq, o.channel, o.payloadJson, o.payloadHash, o.actorUserId, o.occurredAt,
        o.clientDay, o.clientTzOffsetMinutes, o.copyId, o.appVersion, o.schemaVersion, o.schemaShapeJson, o.ratesJson,
        o.createdJson, o.dependsOnJson, now, now,
      );
  }

  findByEventId(eventId: string): OutboxRow | null {
    return (
      (this.db
        .prepare(`SELECT * FROM offline_outbox WHERE event_id = ? AND tenant_id = ?`)
        .get(eventId, getCurrentTenantId()) as OutboxRow | undefined) ?? null
    );
  }

  listWaiting(limit: number): OutboxRow[] {
    return this.db
      .prepare(`SELECT * FROM offline_outbox WHERE tenant_id = ? AND delivery = 'waiting' ORDER BY device_seq LIMIT ?`)
      .all(getCurrentTenantId(), limit) as OutboxRow[];
  }

  waitingCount(): number {
    const r = this.db
      .prepare(`SELECT COUNT(*) AS n FROM offline_outbox WHERE tenant_id = ? AND delivery = 'waiting'`)
      .get(getCurrentTenantId()) as { n: number };
    return r.n;
  }

  markAcked(eventIds: readonly string[]): void {
    const stmt = this.db.prepare(
      `UPDATE offline_outbox SET delivery = 'acked', updated_at = ? WHERE event_id = ? AND tenant_id = ? AND delivery = 'waiting'`,
    );
    const now = nowIso();
    const tenantId = getCurrentTenantId();
    for (const id of eventIds) stmt.run(now, id, tenantId);
  }

  /** Copy the server outcome; a booked/applied/dismissed event is done. */
  setServerStatus(eventId: string, status: OfflineEventStatus, error: string | null): void {
    const done = status === "booked" || status === "applied" || status === "dismissed";
    this.db
      .prepare(
        `UPDATE offline_outbox
            SET server_status = ?, last_error = ?, delivery = CASE WHEN ? THEN 'done' ELSE (CASE WHEN delivery = 'waiting' AND ? THEN 'acked' ELSE delivery END) END,
                updated_at = ?
          WHERE event_id = ? AND tenant_id = ?`,
      )
      .run(status, error, done ? 1 : 0, FINAL.includes(status) ? 1 : 0, nowIso(), eventId, getCurrentTenantId());
  }

  insertCreated(rows: ReadonlyArray<{ offlineId: number; tableName: string }>, eventId: string): void {
    const now = nowIso();
    const stmt = this.db.prepare(
      `INSERT INTO offline_outbox_created (tenant_id, offline_id, table_name, event_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const tenantId = getCurrentTenantId();
    for (const r of rows) stmt.run(tenantId, r.offlineId, r.tableName, eventId, now, now);
  }

  /** Which earlier events created these offline ids (→ `depends_on`). */
  eventsCreating(offlineIds: readonly number[]): string[] {
    if (offlineIds.length === 0) return [];
    const marks = offlineIds.map(() => "?").join(", ");
    return (
      this.db
        .prepare(
          `SELECT DISTINCT event_id FROM offline_outbox_created WHERE tenant_id = ? AND offline_id IN (${marks}) ORDER BY event_id`,
        )
        .all(getCurrentTenantId(), ...offlineIds) as Array<{ event_id: string }>
    ).map((r) => r.event_id);
  }

  maxCreatedByTable(): Record<string, number> {
    const rows = this.db
      .prepare(
        `SELECT table_name, MAX(offline_id) AS m FROM offline_outbox_created WHERE tenant_id = ? GROUP BY table_name ORDER BY table_name`,
      )
      .all(getCurrentTenantId()) as Array<{ table_name: string; m: number }>;
    return Object.fromEntries(rows.map((r) => [r.table_name, r.m]));
  }
}

let instance: OfflineOutboxRepository | null = null;
export function getOfflineOutboxRepository(): OfflineOutboxRepository {
  if (!instance) instance = new OfflineOutboxRepository();
  return instance;
}
export function resetOfflineOutboxRepository(): void {
  instance = null;
}
