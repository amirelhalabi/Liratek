/**
 * Test helper (not a test): a real-schema database with one paired PC and a
 * way to store an event the way the upload route would.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { runWithTenant } from "../../db/tenantContext";
import { OfflineDeviceRepository } from "../../repositories/OfflineDeviceRepository";
import { OfflineEventRepository, type OfflineEventRow } from "../../repositories/OfflineEventRepository";
import { OfflineSnapshotRepository } from "../../repositories/OfflineSnapshotRepository";
import { describeShape } from "../schemaShape";
import { policyEntry, recordedSchema } from "../channelPolicy";
import { canonicalJson } from "../canonicalJson";
import { offlineEventHash } from "../../services/OfflineEventService";

const CREATE_DB_SQL = fs.readFileSync(path.join(__dirname, "../../../../../electron-app/create_db.sql"), "utf8");

type G = typeof globalThis & { __LIRATEK_TEST_DB__?: Database.Database };

export const COPY_ID = "11111111-1111-4111-8111-111111111111";
export const RATES = { LBP: { sell: 90000, buy: 89500, market: 89750, direction: 1 as const } };

export function installReplayDb(): { db: Database.Database; deviceId: number } {
  const db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  db.exec(`
    INSERT OR IGNORE INTO tenants (id, name, slug, status) VALUES (2, 'Other', 'other', 'active');
    INSERT OR IGNORE INTO users (id, tenant_id, username, password_hash, role, is_active) VALUES (2, 1, 'cashier', '', 'staff', 1);
  `);
  (globalThis as G).__LIRATEK_TEST_DB__ = db;
  const deviceId = runWithTenant(1, () =>
    new OfflineDeviceRepository().insert({ deviceNo: 1, name: "PC 1", keyId: "aaaaaaaaaaa1", keyHash: "h", pairedBy: 1 }).id,
  );
  return { db, deviceId };
}

/** Pair another PC of shop 1 (its PC number is `deviceNo`). */
export function addDevice(deviceNo: number): number {
  return runWithTenant(1, () =>
    new OfflineDeviceRepository().insert({
      deviceNo,
      name: `PC ${deviceNo}`,
      keyId: `bbbbbbbbbb${String(deviceNo).padStart(2, "0")}`,
      keyHash: "h",
      pairedBy: 1,
    }).id,
  );
}

/** The copy the harness's events name (`COPY_ID`), with its high-water marks. */
export function insertCopy(builtAt: string, highWater: Record<string, number>, copyId = COPY_ID): void {
  runWithTenant(1, () =>
    new OfflineSnapshotRepository().insert({ copyId, deviceId: null, schemaVersion: 210, builtAt, highWater }),
  );
}

export function uninstallReplayDb(db: Database.Database): void {
  delete (globalThis as G).__LIRATEK_TEST_DB__;
  db.close();
}

let seq = 0;
export function resetSeq(): void {
  seq = 0;
}

export interface StoreEventOptions {
  deviceId: number;
  channel: string;
  payload: Record<string, unknown>;
  actorUserId?: number;
  occurredAt?: string;
  clientDay?: string;
  clientTzOffsetMinutes?: number;
  created?: Record<string, number[]>;
  dependsOn?: string[];
  schemaShape?: unknown;
  rates?: unknown;
  seq?: number;
  eventId?: string;
  correctedAt?: string | null;
  copyId?: string;
}

export function storeEvent(o: StoreEventOptions): OfflineEventRow {
  seq += 1;
  const n = o.seq ?? seq;
  const eventId = o.eventId ?? `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const schema = recordedSchema(o.channel);
  const occurredAt = o.occurredAt ?? "2026-10-10T20:50:00.000Z";
  // default actor (O-new-7 checks roles): the cashier (user 2, staff) when
  // the channel allows staff, else the admin (user 1).
  const actor = o.actorUserId ?? (policyEntry(o.channel)?.roles?.includes("staff") ? 2 : 1);
  return runWithTenant(1, () => {
    const r = new OfflineEventRepository().insertReceived({
      deviceId: o.deviceId,
      eventId,
      seq: n,
      channel: o.channel,
      payloadJson: canonicalJson(o.payload),
      payloadHash: offlineEventHash({ payload: o.payload, channel: o.channel, actorUserId: actor, occurredAt }),
      actorUserId: actor,
      occurredAt,
      clientDay: o.clientDay ?? "2026-10-10",
      clientTzOffsetMinutes: o.clientTzOffsetMinutes ?? 180,
      copyId: o.copyId ?? COPY_ID,
      appVersion: "1.0.0",
      schemaVersion: 210,
      schemaShapeJson: canonicalJson(o.schemaShape ?? (schema ? describeShape(schema) : { type: "object" })),
      ratesJson: canonicalJson(o.rates ?? RATES),
      createdJson: canonicalJson(o.created ?? {}),
      dependsOnJson: JSON.stringify(o.dependsOn ?? []),
      correctedAt: o.correctedAt ?? null,
    });
    return r.row!;
  });
}
