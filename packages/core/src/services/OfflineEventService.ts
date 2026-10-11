/**
 * LIRA-306 — the server's event store front door (FR-015, FR-016, FR-024).
 *
 * `upload()` stores every event ONCE (by event id) and acknowledges it
 * before any processing; processing is asynchronous (OfflineMergeProcessor).
 *   - same event id, same content      → acked again, nothing stored
 *   - same event id, other content     → rejected EVENT_ID_REUSED
 *   - same (PC, seq), other event id   → rejected SEQ_CONFLICT (not stored)
 *   - unknown / non-recordable channel → stored as `refused` + review item,
 *                                        acked (the PC's sequence stays gap-free)
 *   - PC data version newer than ours  → whole upload refused VERSION_AHEAD
 * The device id comes from the authenticated device key (never the body).
 */
import { createHash } from "node:crypto";
import { MIGRATIONS } from "../db/migrations/index.js";
import { classOf } from "../offline/channelPolicy.js";
import { canonicalJson } from "../offline/canonicalJson.js";
import type { OfflineEventStatus } from "../offline/reviewKinds.js";
import {
  getOfflineDeviceRepository,
  type OfflineDeviceRepository,
} from "../repositories/OfflineDeviceRepository.js";
import {
  getOfflineEventRepository,
  type OfflineEventRepository,
  type NewOfflineEventRow,
} from "../repositories/OfflineEventRepository.js";
import {
  getOfflineReviewRepository,
  type OfflineReviewRepository,
} from "../repositories/OfflineReviewRepository.js";
import {
  getOfflineSnapshotRepository,
  type OfflineSnapshotRepository,
} from "../repositories/OfflineSnapshotRepository.js";
import { correctEventTime } from "../offline/skew.js";
import { getOfflineSkewCorrectMs } from "../config/env.js";
import {
  manifestSchema,
  uploadEventsSchema,
  type ManifestInput,
  type UploadEventsInput,
  type OfflineEvent,
} from "../validators/offline.js";
import { isOfflineId } from "../offline/idRange.js";
import { offlineLogger } from "../utils/logger.js";

export interface UploadResult {
  success: boolean;
  data?: { acked: string[]; rejected: Array<{ eventId: string; code: string; error: string }> };
  error?: string;
  code?: string;
}

export interface EventOutcomeView {
  eventId: string;
  seq: number;
  status: OfflineEventStatus;
  error: string | null;
  serverIds: Record<string, number[]> | null;
}

export interface OfflineEventServiceDeps {
  devices?: OfflineDeviceRepository;
  events?: OfflineEventRepository;
  reviews?: OfflineReviewRepository;
  snapshots?: OfflineSnapshotRepository;
  /** The data version this server runs (default: the last migration). */
  serverSchemaVersion?: () => number;
  /** Called after an upload stored something (starts the gathering pause). */
  onStored?: (tenantDeviceId: number) => void;
}

/** sha256 over the content that must not change under one event id. */
export function offlineEventHash(e: Pick<OfflineEvent, "payload" | "channel" | "actorUserId" | "occurredAt">): string {
  return createHash("sha256")
    .update(canonicalJson(e.payload))
    .update("\u0000")
    .update(e.channel)
    .update("\u0000")
    .update(String(e.actorUserId))
    .update("\u0000")
    .update(e.occurredAt)
    .digest("hex");
}

export class OfflineEventService {
  private readonly devices: OfflineDeviceRepository;
  private readonly events: OfflineEventRepository;
  private readonly reviews: OfflineReviewRepository;
  private readonly snapshots: OfflineSnapshotRepository;
  private readonly schemaVersion: () => number;
  private readonly onStored?: (deviceId: number) => void;

  constructor(deps: OfflineEventServiceDeps = {}) {
    this.devices = deps.devices ?? getOfflineDeviceRepository();
    this.events = deps.events ?? getOfflineEventRepository();
    this.reviews = deps.reviews ?? getOfflineReviewRepository();
    this.snapshots = deps.snapshots ?? getOfflineSnapshotRepository();
    this.schemaVersion = deps.serverSchemaVersion ?? (() => MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0);
    this.onStored = deps.onStored;
  }

  upload(deviceId: number, input: UploadEventsInput): UploadResult {
    const parsed = uploadEventsSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid upload", code: "VALIDATION_ERROR" };
    }
    const body = parsed.data;
    const serverVersion = this.schemaVersion();
    if (body.schemaVersion > serverVersion) {
      return {
        success: false,
        code: "VERSION_AHEAD",
        error: `This PC runs a newer data version (${body.schemaVersion}) than the server (${serverVersion}). Its work stays on the PC until the server is updated.`,
      };
    }
    const receivedAt = new Date().toISOString();
    const rawSkew = Date.parse(receivedAt) - Date.parse(body.pcClock);
    const skewMs = Number.isFinite(rawSkew) ? rawSkew : 0;
    const onlineSkewMs = this.devices.findById(deviceId)?.last_online_skew_ms ?? null;
    this.devices.recordUploadSeen(deviceId, skewMs);

    const acked: string[] = [];
    const rejected: Array<{ eventId: string; code: string; error: string }> = [];
    let stored = 0;
    let conflicted = false;
    const copyBuilt = new Map<string, string | null>();
    for (const e of body.events) {
      if (conflicted) {
        // A sequence conflict means the PC lost its state: nothing after it
        // in this upload is stored, so only THIS PC's queue stops (R6).
        rejected.push({
          eventId: e.eventId,
          code: "SEQ_CONFLICT",
          error: "An earlier item of this upload conflicts with what the server already has — sending stopped.",
        });
        continue;
      }
      if (!copyBuilt.has(e.copyId)) copyBuilt.set(e.copyId, this.snapshots.findByCopyId(e.copyId)?.built_at ?? null);
      // Clock correction (FR-022): measured on THIS upload — the only moment
      // the right skew exists.
      const skew = correctEventTime({
        occurredAt: e.occurredAt,
        uploadSkewMs: skewMs,
        onlineSkewMs,
        receivedAt,
        copyBuiltAt: copyBuilt.get(e.copyId) ?? null,
        previousOccurredAt: this.events.findBySeq(deviceId, e.seq - 1)?.occurred_at ?? null,
        toleranceMs: getOfflineSkewCorrectMs(),
      });
      const row = {
        ...this.toRow(deviceId, e, body.appVersion, body.schemaVersion),
        correctedAt: skew.correctedAt !== e.occurredAt ? skew.correctedAt : null,
      };
      const cls = classOf(e.channel);
      const refusal =
        cls === "unclassified"
          ? { status: "refused" as const, error: `UNKNOWN_CHANNEL: "${e.channel}" is not a channel this server knows` }
          : cls === "offline" || cls === "checkpoint"
            ? undefined
            : { status: "refused" as const, error: `NOT_RECORDABLE: "${e.channel}" cannot be done offline` };
      const r = this.events.insertReceived(row, refusal);
      if (r.outcome === "inserted") {
        stored += 1;
        if (skew.note && r.row && !refusal) {
          this.reviews.insert({ eventRowId: r.row.id, deviceId, kind: "clock_corrected", details: skew.note });
        }
        if (refusal && r.row) {
          this.reviews.insert({
            eventRowId: r.row.id,
            deviceId,
            kind: "refused",
            details: { reason: refusal.error, channel: e.channel, payload: e.payload },
          });
        }
        acked.push(e.eventId);
      } else if (r.outcome === "duplicate") {
        acked.push(e.eventId);
      } else if (r.outcome === "reused") {
        rejected.push({
          eventId: e.eventId,
          code: "EVENT_ID_REUSED",
          error: "This event id was already received with different content.",
        });
      } else {
        conflicted = true;
        rejected.push({
          eventId: e.eventId,
          code: "SEQ_CONFLICT",
          error: `Sequence ${e.seq} of this PC was already received under another event id.`,
        });
      }
    }
    offlineLogger.info({ deviceId, received: body.events.length, stored, rejected: rejected.length }, "offline upload");
    if (stored > 0) this.onStored?.(deviceId);
    return { success: true, data: { acked, rejected } };
  }

  /**
   * N5 cross-check (FR-035, FR-036): every row in the PC's range that its
   * working copy holds must be explained by an event it sent (`created`).
   * Rows created then deleted offline are absent from the manifest and fine.
   * Any unexplained row, or any write a read screen made, adds ONE
   * `pc_data_mismatch` review item listing tables, ids and read writes.
   */
  compareManifest(
    deviceId: number,
    input: ManifestInput,
  ): {
    success: boolean;
    data?: { matched: boolean; unexplained: Array<{ table: string; ids: number[] }> };
    error?: string;
    code?: string;
  } {
    const parsed = manifestSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid manifest", code: "VALIDATION_ERROR" };
    }
    const explained = new Set<number>();
    for (const json of this.events.createdJsonForDevice(deviceId)) {
      try {
        const created = JSON.parse(json) as Record<string, unknown>;
        for (const ids of Object.values(created)) {
          if (Array.isArray(ids)) for (const id of ids) if (typeof id === "number") explained.add(id);
        }
      } catch {
        /* a malformed stored record explains nothing */
      }
    }
    const unexplained = Object.keys(parsed.data.tables)
      .sort()
      .map((table) => ({
        table,
        ids: parsed.data.tables[table].filter((id) => isOfflineId(id) && !explained.has(id)).sort((a, b) => a - b),
      }))
      .filter((t) => t.ids.length > 0);
    const readWrites = parsed.data.readWrites.filter((w) => w.changes > 0);
    const matched = unexplained.length === 0 && readWrites.length === 0;
    if (!matched) {
      this.reviews.insert({
        eventRowId: null,
        deviceId,
        kind: "pc_data_mismatch",
        details: { copyId: parsed.data.copyId, unexplained, readWrites },
      });
      offlineLogger.warn({ deviceId, unexplained: unexplained.length, readWrites: readWrites.length }, "offline manifest mismatch");
    }
    return { success: true, data: { matched, unexplained } };
  }

  statusSince(deviceId: number, fromSeq: number): { success: true; data: { outcomes: EventOutcomeView[] } } {
    const outcomes = this.events.listForDevice(deviceId, fromSeq).map((e) => {
      let serverIds: Record<string, number[]> | null = null;
      if (e.result_json) {
        try {
          serverIds = (JSON.parse(e.result_json) as { serverIds?: Record<string, number[]> }).serverIds ?? null;
        } catch {
          serverIds = null;
        }
      }
      return { eventId: e.event_id, seq: e.device_seq, status: e.status, error: e.error, serverIds };
    });
    return { success: true, data: { outcomes } };
  }

  private toRow(deviceId: number, e: OfflineEvent, appVersion: string, schemaVersion: number): NewOfflineEventRow {
    return {
      deviceId,
      eventId: e.eventId,
      seq: e.seq,
      channel: e.channel,
      payloadJson: canonicalJson(e.payload),
      payloadHash: offlineEventHash(e),
      actorUserId: e.actorUserId,
      occurredAt: e.occurredAt,
      clientDay: e.clientDay,
      clientTzOffsetMinutes: e.clientTzOffsetMinutes,
      copyId: e.copyId,
      appVersion,
      schemaVersion,
      schemaShapeJson: canonicalJson(e.schemaShape),
      ratesJson: canonicalJson(e.rates),
      createdJson: canonicalJson(e.created),
      dependsOnJson: JSON.stringify(e.dependsOn),
    };
  }
}

let instance: OfflineEventService | null = null;
export function getOfflineEventService(): OfflineEventService {
  if (!instance) instance = new OfflineEventService();
  return instance;
}
export function resetOfflineEventService(): void {
  instance = null;
}
