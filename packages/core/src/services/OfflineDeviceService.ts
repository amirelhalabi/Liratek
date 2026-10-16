/**
 * LIRA-306 — paired PCs and their device keys (FR-001, FR-001a, FR-003,
 * FR-004, O-new-8 — approved by the owner at gate G0, 2026-10-11).
 *
 * Pairing: an admin signs in on the PC with the shop address, username and
 * password (MobileAuthService.loginWithShop — same rules and the same
 * generic INVALID_CREDENTIALS as the phone app). The sign-in session is
 * revoked at once: the PC keeps only its device key
 * `ltd_<tenantId>_<keyId>_<secret>`; the server stores sha256(secret).
 * Re-pairing with the PC's own number re-keys the SAME row (number, merge
 * cursor and id range kept; the old key stops working).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { runWithTenant } from "../db/tenantContext.js";
import { MIGRATIONS } from "../db/migrations/index.js";
import { getOfflineSnapshotTtlMs } from "../config/env.js";
import { OFFLINE_PC_MAX } from "../offline/idRange.js";
import { policyEntry } from "../offline/channelPolicy.js";
import {
  getOfflineDeviceRepository,
  type OfflineDeviceRepository,
} from "../repositories/OfflineDeviceRepository.js";
import { getOfflineEventRepository, type OfflineEventRepository } from "../repositories/OfflineEventRepository.js";
import { getOfflineSnapshotRepository, type OfflineSnapshotRepository } from "../repositories/OfflineSnapshotRepository.js";
import { checkinSchema, pairDeviceSchema, type CheckinInput, type PairDeviceInput } from "../validators/offline.js";
import type { MobileAuthService } from "./MobileAuthService.js";
import { offlineLogger } from "../utils/logger.js";
import { getUserRepository } from "../repositories/UserRepository.js";

const KEY_RE = /^ltd_(\d{1,9})_([0-9a-f]{12})_([0-9a-f]{64})$/;

export interface ParsedDeviceKey {
  tenantId: number;
  keyId: string;
  secret: string;
}

/** The format check — no database read for a malformed key. */
export function parseDeviceKey(key: unknown): ParsedDeviceKey | null {
  if (typeof key !== "string") return null;
  const m = KEY_RE.exec(key);
  if (!m) return null;
  return { tenantId: Number(m[1]), keyId: m[2], secret: m[3] };
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export type VerifyKeyResult =
  | { ok: true; tenantId: number; deviceId: number; deviceNo: number; keyId: string }
  | { ok: false; code: "INVALID_DEVICE_KEY" | "DEVICE_REVOKED" | "SHOP_INACTIVE"; error: string };

export interface PairResult {
  success: boolean;
  data?: {
    deviceKey: string;
    deviceNo: number;
    tenantId: number;
    shopName: string;
    shopSlug: string;
    serverSchemaVersion: number;
  };
  error?: string;
  code?: string;
}

export interface CheckinResult {
  success: boolean;
  data?: {
    serverSchemaVersion: number;
    serverTime: string;
    snapshotDue: boolean;
    maxSeq: number;
    maxOfflineIds: Record<string, number>;
    heldItems: Array<{ eventId: string; label: string; amount: number | null }>;
    renumberUnsent: boolean;
  };
  error?: string;
  code?: string;
}

export interface OfflineDeviceServiceDeps {
  mobileAuth: Pick<MobileAuthService, "loginWithShop">;
  auth: { logout(token: string): unknown };
  devices?: OfflineDeviceRepository;
  events?: OfflineEventRepository;
  snapshots?: OfflineSnapshotRepository;
  reviews?: OfflineReviewRepository;
  serverSchemaVersion?: () => number;
  /** The platform's status for a shop; defaults to UserRepository.getTenantStatus. */
  shopStatus?: (tenantId: number) => "active" | "suspended" | "archived" | null;
}


import type { PairedDeviceView } from "../offline/views.js";
import { getOfflineReviewRepository, type OfflineReviewRepository } from "../repositories/OfflineReviewRepository.js";
export type { PairedDeviceView } from "../offline/views.js";

export class OfflineDeviceService {
  private readonly mobileAuth: OfflineDeviceServiceDeps["mobileAuth"];
  private readonly auth: OfflineDeviceServiceDeps["auth"];
  private readonly devices: OfflineDeviceRepository;
  private readonly events: OfflineEventRepository;
  private readonly snapshots: OfflineSnapshotRepository;
  private readonly reviews: OfflineReviewRepository;
  private readonly schemaVersion: () => number;
  private readonly shopStatus: NonNullable<OfflineDeviceServiceDeps["shopStatus"]>;

  constructor(deps: OfflineDeviceServiceDeps) {
    this.mobileAuth = deps.mobileAuth;
    this.auth = deps.auth;
    this.devices = deps.devices ?? getOfflineDeviceRepository();
    this.events = deps.events ?? getOfflineEventRepository();
    this.snapshots = deps.snapshots ?? getOfflineSnapshotRepository();
    this.reviews = deps.reviews ?? getOfflineReviewRepository();
    this.schemaVersion = deps.serverSchemaVersion ?? (() => MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0);
    this.shopStatus = deps.shopStatus ?? ((tenantId) => getUserRepository().getTenantStatus(tenantId));
  }

  async pair(input: PairDeviceInput, meta: { ipAddress?: string } = {}): Promise<PairResult> {
    const v = pairDeviceSchema.safeParse(input);
    if (!v.success) return { success: false, code: "VALIDATION_ERROR", error: v.error.issues[0]?.message ?? "Invalid" };
    const body = v.data;
    const login = await this.mobileAuth.loginWithShop({
      shop: body.shop,
      username: body.username,
      password: body.password,
      deviceInfo: `LiraTek desktop (offline pairing): ${body.deviceName}`,
      ...(meta.ipAddress ? { ipAddress: meta.ipAddress } : {}),
    });
    if (!login.ok) {
      return {
        success: false,
        code: login.reason,
        error: login.reason === "ADMIN_ONLY" ? "Only an admin can pair a PC" : "Wrong shop, username or password",
      };
    }
    const tenantId = login.shop.id;
    // The PC never keeps a user session — only its device key.
    try {
      await runWithTenant(tenantId, () => this.auth.logout(login.sessionToken));
    } catch {
      // best effort; the token is never returned
    }

    const keyId = randomBytes(6).toString("hex");
    const secret = randomBytes(32).toString("hex");
    const keyHash = sha256(secret);
    const outcome = runWithTenant(tenantId, (): PairResult | { deviceNo: number } => {
      if (body.deviceNo !== undefined) {
        const existing = this.devices.findByDeviceNo(body.deviceNo);
        if (!existing) return { success: false, code: "UNKNOWN_DEVICE", error: `There is no PC number ${body.deviceNo} in this shop` };
        this.devices.rekey(existing.id, { keyId, keyHash, pairedBy: login.user.id, name: body.deviceName });
        return { deviceNo: existing.device_no };
      }
      const deviceNo = this.devices.nextDeviceNo();
      if (deviceNo > OFFLINE_PC_MAX) return { success: false, code: "TOO_MANY_DEVICES", error: "This shop has paired the maximum number of PCs" };
      this.devices.insert({ deviceNo, name: body.deviceName, keyId, keyHash, pairedBy: login.user.id });
      return { deviceNo };
    });
    if ("success" in outcome) return outcome;
    offlineLogger.info({ tenantId, deviceNo: outcome.deviceNo, rekey: body.deviceNo !== undefined }, "PC paired");
    return {
      success: true,
      data: {
        deviceKey: `ltd_${tenantId}_${keyId}_${secret}`,
        deviceNo: outcome.deviceNo,
        tenantId,
        shopName: login.shop.name,
        shopSlug: login.shop.slug,
        serverSchemaVersion: this.schemaVersion(),
      },
    };
  }

  /** Authenticate a device key (constant-time hash compare). Resolves the
   *  tenant from the key itself, never from anything else in the request. */
  verifyKey(key: unknown): VerifyKeyResult {
    const parsed = parseDeviceKey(key);
    const invalid = { ok: false as const, code: "INVALID_DEVICE_KEY" as const, error: "This PC's key is not valid" };
    if (!parsed) return invalid;
    let row;
    try {
      row = runWithTenant(parsed.tenantId, () => this.devices.findByKeyId(parsed.keyId));
    } catch {
      return invalid;
    }
    if (!row) return invalid;
    const a = Buffer.from(sha256(parsed.secret), "hex");
    const b = Buffer.from(row.key_hash, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return invalid;
    if (row.revoked_at) return { ok: false, code: "DEVICE_REVOKED", error: "This PC was unpaired — pair it again" };
    // Same rule as a web session (AuthService.validateSession): a suspended
    // or archived shop's PCs are refused on their next contact, without
    // unpairing them, so the key works again if the shop is re-activated.
    // A PC that stays offline keeps its local copy; only the server door shuts.
    let status: ReturnType<typeof this.shopStatus>;
    try {
      status = this.shopStatus(parsed.tenantId);
    } catch {
      return invalid;
    }
    if (status !== "active") {
      return { ok: false, code: "SHOP_INACTIVE", error: "This shop is not active — contact LiraTek support" };
    }
    return { ok: true, tenantId: parsed.tenantId, deviceId: row.id, deviceNo: row.device_no, keyId: parsed.keyId };
  }

  /** Inside the shop's context. */
  revoke(deviceId: number, by: number): boolean {
    return this.devices.revoke(deviceId, by);
  }

  /** Settings › paired PCs (FR-002) — inside the shop's context. Never the key. */
  listDevices(): { success: true; data: { devices: PairedDeviceView[] } } {
    const devices = this.devices.list().map((d) => ({
      id: d.id,
      deviceNo: d.device_no,
      name: d.name,
      pairedAt: d.paired_at,
      lastSeenAt: d.last_seen_at,
      state: d.last_state,
      pendingCount: d.last_pending_count,
      appVersion: d.last_app_version,
      revokedAt: d.revoked_at,
      seqConflict: this.seqConflictOf(d.id),
      renumberRequested: this.reviews.findPendingRenumber(d.id) !== null,
    }));
    return { success: true, data: { devices } };
  }

  private seqConflictOf(deviceId: number): PairedDeviceView["seqConflict"] {
    const item = this.reviews.findOpenSeqConflict(deviceId);
    if (!item) return null;
    let d: { seq?: number | null; reason?: string } = {};
    try {
      d = JSON.parse(item.details_json) as typeof d;
    } catch {
      d = {};
    }
    return { itemId: item.id, seq: d.seq ?? null, reason: d.reason ?? "Sequence conflict", at: item.created_at };
  }

  /**
   * "Renumber this PC's unsent work" (O-new-29, R6): the PC's next check-ins
   * answer `renumberUnsent: true`; the PC renumbers every unsent event above
   * the server's max sequence (keeping event ids) and sends again. The flag
   * clears when an upload from that PC is stored without a conflict.
   */
  requestRenumber(deviceId: number, by: number): { success: boolean; data?: { renumberRequested: true }; error?: string; code?: string } {
    if (!this.devices.findById(deviceId)) return { success: false, code: "NOT_FOUND", error: "PC not found" };
    const item = this.reviews.findOpenSeqConflict(deviceId);
    if (!item) {
      if (this.reviews.findPendingRenumber(deviceId)) return { success: true, data: { renumberRequested: true } };
      return { success: false, code: "NO_CONFLICT", error: "This PC has no numbering problem" };
    }
    const d = JSON.parse(item.details_json || "{}") as Record<string, unknown>;
    this.reviews.updateDetails(item.id, { ...d, renumberPending: true });
    this.reviews.resolve(item.id, "applied", by);
    return { success: true, data: { renumberRequested: true } };
  }

  /** Revoke from Settings (FR-002); events already received are still processed. */
  revokeDevice(deviceId: number, by: number): { success: boolean; data?: { revoked: true }; error?: string; code?: string } {
    const row = this.devices.findById(deviceId);
    if (!row) return { success: false, code: "NOT_FOUND", error: "PC not found" };
    if (!row.revoked_at) this.devices.revoke(deviceId, by);
    return { success: true, data: { revoked: true } };
  }

  /** Inside the shop's context (FR-004). */
  checkin(deviceId: number, input: CheckinInput): CheckinResult {
    const v = checkinSchema.safeParse(input);
    if (!v.success) return { success: false, code: "VALIDATION_ERROR", error: v.error.issues[0]?.message ?? "Invalid" };
    const now = Date.now();
    const skewMs = now - Date.parse(v.data.pcClock);
    this.devices.recordCheckin(deviceId, {
      state: v.data.state,
      pendingCount: v.data.pendingCount,
      appVersion: v.data.appVersion,
      schemaVersion: v.data.schemaVersion,
      skewMs: Number.isFinite(skewMs) ? skewMs : 0,
    });
    const maxOfflineIds: Record<string, number> = {};
    const heldItems: Array<{ eventId: string; label: string; amount: number | null }> = [];
    for (const e of this.events.listForDevice(deviceId, 0, 1_000_000)) {
      try {
        const created = JSON.parse(e.created_json) as Record<string, number[]>;
        for (const [table, ids] of Object.entries(created)) {
          for (const id of ids) if (id > (maxOfflineIds[table] ?? 0)) maxOfflineIds[table] = id;
        }
      } catch {
        // a malformed record cannot raise the maxima
      }
      if (e.status === "held") {
        heldItems.push({ eventId: e.event_id, label: policyEntry(e.channel)?.label ?? e.channel, amount: null });
      }
    }
    const latest = this.snapshots.latest();
    const snapshotDue = !latest || now - Date.parse(latest.built_at) >= getOfflineSnapshotTtlMs();
    return {
      success: true,
      data: {
        serverSchemaVersion: this.schemaVersion(),
        serverTime: new Date(now).toISOString(),
        snapshotDue,
        maxSeq: this.events.maxSeq(deviceId),
        maxOfflineIds,
        heldItems,
        renumberUnsent: this.reviews.findPendingRenumber(deviceId) !== null,
      },
    };
  }
}
