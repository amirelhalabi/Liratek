/**
 * LIRA-306 — the paired PC's link to the server (FR-004, FR-006, FR-015;
 * contracts/rest-offline.md). One tick every 30 s:
 *
 *   1. check-in (state, waiting count, versions, PC clock) → stores the
 *      server's data version, last sequence, per-table maximum offline ids
 *      and held items in pairing.json (resume/seeding, FR-008a);
 *   2. standby/blocked: refresh the copy when due (`snapshotDue` or the
 *      newest copy ≥ 5 min old) → `mirror-<ts>.db`, integrity-checked, its
 *      `offline_copy_meta` matching the response headers and this shop;
 *      newest 2 kept, never the open one; never written after download;
 *   3. offline/finishing: upload waiting events (the sender, T132).
 *
 * Network failures never throw; they only grow `unreachableSeconds()`, which
 * gates "Work offline" (≥ 30 s, O-new-22). Everything Electron-specific
 * (fetch, timers, the DB constructor) is injected so ts-jest can load it.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { logger } from "@liratek/core";
import type { PairingStore } from "./pairingStore.js";
import {
  fileStamp,
  integrityOk,
  listMirrors,
  pruneMirrors,
  readCopyInfo,
  type DatabaseCtor,
} from "./offlineFiles.js";
import type { Sender } from "./sender.js";

export const CHECKIN_INTERVAL_MS = 30_000;
export const COPY_REFRESH_MS = 5 * 60_000;
export const DEVICE_KEY_HEADER_NAME = "X-LiraTek-Device-Key";

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    /** every request carries a timeout: a hung request counts as a failure */
    signal?: AbortSignal;
  },
) => Promise<FetchResponseLike>;

export const CHECKIN_TIMEOUT_MS = 15_000;
export const SNAPSHOT_TIMEOUT_MS = 180_000;

export type PcState = "standby" | "blocked" | "offline" | "finishing";

export interface SyncClientDeps {
  offlineDir: string;
  store: PairingStore;
  fetch: FetchLike;
  /** epoch ms */
  now: () => number;
  appVersion: string;
  appSchemaVersion: number;
  getState: () => PcState;
  pendingCount: () => number;
  /** the database file the app has open (never pruned) */
  openFile: () => string | null;
  DatabaseCtor: DatabaseCtor;
  sender?: Sender;
  /** runs after every tick (the finishing-mode Finisher) */
  onTick?: () => Promise<void>;
  setInterval?: (fn: () => void, ms: number) => NodeJS.Timeout;
  clearInterval?: (t: NodeJS.Timeout) => void;
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

interface CheckinData {
  serverSchemaVersion: number;
  serverTime: string;
  snapshotDue: boolean;
  maxSeq: number;
  maxOfflineIds: Record<string, number>;
  heldItems: Array<{ eventId: string; label: string; amount: number | null }>;
  renumberUnsent?: boolean;
}

export class SyncClient {
  private lastOkAt: number | null = null;
  /** result of the last attempt to reach the server (null = none yet) */
  private lastAttemptOk: boolean | null = null;
  /** first failed attempt after the last success */
  private firstFailAt: number | null = null;
  private startedAt: number;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> = Promise.resolve();
  private ticking = false;

  constructor(private readonly d: SyncClientDeps) {
    this.startedAt = d.now();
  }

  /** Begin the 30 s loop (one tick at once). */
  start(): void {
    this.markStarted();
    const set = this.d.setInterval ?? setInterval;
    this.timer = set(() => this.kick(), CHECKIN_INTERVAL_MS);
    this.kick();
  }

  stop(): void {
    if (this.timer) (this.d.clearInterval ?? clearInterval)(this.timer);
    this.timer = null;
  }

  markStarted(): void {
    this.startedAt = this.d.now();
  }

  /** Resolves when the current tick (if any) is finished. */
  idle(): Promise<void> {
    return this.running;
  }

  /** Run a tick now unless one is in flight (also used by `offline:send-now`). */
  kick(): Promise<void> {
    if (this.ticking) return this.running;
    this.ticking = true;
    this.running = this.tick().finally(() => {
      this.ticking = false;
    });
    return this.running;
  }

  /**
   * How long the server has been unreachable: 0 while the last attempt
   * succeeded; otherwise from the first failed attempt after the last
   * success (from start-up when it never answered). Check-ins are 30 s
   * apart, so "reachable" is the last attempt's result, never "answered in
   * the last second".
   */
  unreachableSeconds(): number {
    if (this.lastAttemptOk === true) return 0;
    const since =
      this.lastOkAt === null
        ? this.startedAt
        : (this.firstFailAt ?? this.d.now());
    return Math.max(0, Math.floor((this.d.now() - since) / 1000));
  }

  isReachable(): boolean {
    return this.lastAttemptOk === true;
  }

  /** The server answered (any envelope) — it is reachable. */
  noteReachable(): void {
    this.lastOkAt = this.d.now();
    this.lastAttemptOk = true;
    this.firstFailAt = null;
  }

  /** An attempt got no answer (network error or timeout). */
  noteUnreachable(): void {
    if (this.lastAttemptOk !== false) this.firstFailAt = this.d.now();
    this.lastAttemptOk = false;
  }

  private async tick(): Promise<void> {
    await this.checkin();
    const st = this.d.getState();
    if (
      (st === "offline" || st === "finishing") &&
      this.isReachable() &&
      this.d.sender
    ) {
      try {
        await this.d.sender.sendWaiting();
      } catch (error) {
        logger.warn({ error }, "offline upload attempt failed");
      }
    }
    if (this.d.onTick) {
      try {
        await this.d.onTick();
      } catch (error) {
        logger.warn({ error }, "offline tick hook failed");
      }
    }
  }

  private base(): { url: string; key: string } | null {
    const p = this.d.store.read();
    const key = this.d.store.deviceKey();
    if (!p || !key) return null;
    return { url: p.serverUrl.replace(/\/+$/, ""), key };
  }

  async checkin(): Promise<void> {
    const b = this.base();
    if (!b) return;
    let env: Envelope<CheckinData>;
    try {
      const res = await this.d.fetch(`${b.url}/api/offline/checkin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [DEVICE_KEY_HEADER_NAME]: b.key,
        },
        body: JSON.stringify({
          state: this.d.getState(),
          pendingCount: this.d.pendingCount(),
          appVersion: this.d.appVersion,
          schemaVersion: this.d.appSchemaVersion,
          pcClock: new Date(this.d.now()).toISOString(),
        }),
        signal: AbortSignal.timeout(CHECKIN_TIMEOUT_MS),
      });
      env = (await res.json()) as Envelope<CheckinData>;
    } catch (error) {
      logger.debug({ error }, "offline check-in: server unreachable");
      this.noteUnreachable();
      return;
    }
    this.noteReachable();
    if (!env.success || !env.data) {
      const revoked =
        env.code === "DEVICE_REVOKED" || env.code === "INVALID_DEVICE_KEY";
      this.d.store.update({
        lastError: revoked
          ? "This PC's key was revoked — re-pair this PC (an admin signs in on it)"
          : (env.error ?? "Check-in refused"),
      });
      return;
    }
    const data = env.data;
    this.d.store.update({
      serverSchemaVersion: data.serverSchemaVersion,
      serverMaxSeq: data.maxSeq,
      serverMaxOfflineIds: data.maxOfflineIds ?? {},
      heldItems: data.heldItems ?? [],
      lastError: null,
    });
    if (data.renumberUnsent && this.d.sender)
      await this.d.sender.renumberUnsent(data.maxSeq);

    const st = this.d.getState();
    if (
      (st === "standby" || st === "blocked") &&
      (data.snapshotDue || this.copyIsOld())
    ) {
      await this.refreshCopy();
    }
  }

  private copyIsOld(): boolean {
    const newest = listMirrors(this.d.offlineDir, this.d.DatabaseCtor)[0];
    if (!newest) return true;
    const p = this.d.store.read();
    const fetchedAt = p?.lastSnapshotAt
      ? Date.parse(p.lastSnapshotAt)
      : Date.parse(newest.builtAt);
    return this.d.now() - fetchedAt >= COPY_REFRESH_MS;
  }

  /** Download, verify and keep a fresh copy. Never throws. */
  async refreshCopy(): Promise<boolean> {
    const b = this.base();
    const p = this.d.store.read();
    if (!b || !p) return false;
    const part = path.join(
      this.d.offlineDir,
      `mirror-${fileStamp(this.d.now())}.db.part`,
    );
    try {
      const res = await this.d.fetch(
        `${b.url}/api/offline/snapshot?schemaVersion=${this.d.appSchemaVersion}`,
        {
          method: "GET",
          headers: { [DEVICE_KEY_HEADER_NAME]: b.key },
          signal: AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS),
        },
      );
      this.noteReachable();
      const type = res.headers.get("content-type") ?? "";
      if (type.includes("application/json")) {
        const env = (await res.json()) as Envelope<unknown>;
        this.d.store.update({
          lastError: env.error ?? "The server refused the copy",
        });
        return false;
      }
      const copyId = res.headers.get("x-copy-id");
      const tenant = Number(res.headers.get("x-snapshot-tenant-id"));
      if (!copyId || tenant !== p.tenantId) {
        logger.warn(
          { copyId, tenant },
          "offline copy refused: wrong shop or no copy id",
        );
        return false;
      }
      const gz = Buffer.from(await res.arrayBuffer());
      fs.mkdirSync(this.d.offlineDir, { recursive: true });
      fs.writeFileSync(part, zlib.gunzipSync(gz));
      if (!integrityOk(part, this.d.DatabaseCtor)) {
        logger.warn({ copyId }, "offline copy refused: integrity check failed");
        return false;
      }
      const info = readCopyInfo(part, this.d.DatabaseCtor);
      if (!info || info.copyId !== copyId || info.tenantId !== p.tenantId) {
        logger.warn(
          { copyId, info },
          "offline copy refused: identity does not match",
        );
        return false;
      }
      const final = part.replace(/\.part$/, "");
      fs.renameSync(part, final);
      this.d.store.update({
        copyId,
        lastSnapshotAt: new Date(this.d.now()).toISOString(),
        lastError: null,
      });
      pruneMirrors(this.d.offlineDir, this.d.openFile());
      logger.info(
        { copyId, file: path.basename(final) },
        "offline copy refreshed",
      );
      return true;
    } catch (error) {
      logger.warn({ error }, "offline copy refresh failed");
      return false;
    } finally {
      try {
        fs.unlinkSync(part);
      } catch {
        // renamed or never written
      }
    }
  }
}
