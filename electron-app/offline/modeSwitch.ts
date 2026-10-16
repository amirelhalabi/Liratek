/**
 * LIRA-306 — mode switches (plan diagram B; FR-008, FR-039). A mode change
 * is stored in pairing.json and the app relaunches (one connection and the
 * core singletons per process).
 *
 *   go-offline   standby → offline: working copy from the newest copy
 *   back-to-web  offline → finishing (the handler checks reachability)
 *   Finisher     finishing → standby once everything is sent and the
 *                manifest accepted; → offline after 30 s without the server
 */
import { logger, type ManifestInput } from "@liratek/core";
import type { PairingStore } from "./pairingStore.js";
import { createWorkingCopy, finishWorkingCopy } from "./workingCopy.js";
import type { DatabaseCtor } from "./offlineFiles.js";

export const FINISHING_GIVE_UP_SECONDS = 30;

type Reply = {
  success: boolean;
  data?: unknown;
  error?: string;
  code?: string;
};

export function makeGoOffline(d: {
  offlineDir: string;
  store: PairingStore;
  DatabaseCtor: DatabaseCtor;
  now: () => number;
  newestMirror: () => string | null;
  relaunch: () => void;
}): () => Promise<Reply> {
  return async () => {
    const p = d.store.read();
    const mirror = d.newestMirror();
    if (!p || !mirror)
      return { success: false, error: "No usable copy on this PC" };
    createWorkingCopy({
      offlineDir: d.offlineDir,
      mirrorFile: mirror,
      deviceNo: p.deviceNo,
      tenantId: p.tenantId,
      pairingLastUsed: p.lastUsedIds,
      serverMaxOfflineIds: p.serverMaxOfflineIds,
      DatabaseCtor: d.DatabaseCtor,
      now: d.now,
    });
    d.store.update({ mode: "offline" });
    logger.info({ deviceNo: p.deviceNo }, "offline mode started");
    d.relaunch();
    return { success: true, data: {} };
  };
}

export function makeBackToWeb(d: {
  store: PairingStore;
  relaunch: () => void;
}): () => Promise<Reply> {
  return async () => {
    d.store.update({ mode: "finishing" });
    logger.info("offline: back to the web app — finishing");
    d.relaunch();
    return { success: true, data: {} };
  };
}

export interface FinisherDeps {
  offlineDir: string;
  store: PairingStore;
  deviceNo: number;
  DatabaseCtor: DatabaseCtor;
  now: () => number;
  isReachable: () => boolean;
  unreachableSeconds: () => number;
  sendWaiting: () => Promise<{ sent: number; waiting: number }>;
  buildManifest: () => ManifestInput;
  /** true when the server accepted the manifest (matched or not) */
  sendManifest: (body: ManifestInput) => Promise<boolean>;
  /** the highest sequence in the outbox */
  lastSeq: () => number;
  /** close the working copy connection before moving the file */
  closeDb: () => void;
  clearReadLog: () => void;
  relaunch: () => void;
}

/** Runs on the sync tick in finishing mode. */
export class Finisher {
  private done = false;

  constructor(private readonly d: FinisherDeps) {}

  async tick(): Promise<void> {
    if (this.done) return;
    if (!this.d.isReachable()) {
      if (this.d.unreachableSeconds() >= FINISHING_GIVE_UP_SECONDS) {
        this.done = true;
        this.d.store.update({ mode: "offline" });
        logger.warn(
          "offline: server lost while finishing — back to offline mode",
        );
        this.d.relaunch();
      }
      return;
    }
    const { waiting } = await this.d.sendWaiting();
    if (waiting > 0) return;
    const accepted = await this.d.sendManifest(this.d.buildManifest());
    if (!accepted) return;

    this.done = true;
    const lastSeq = this.d.lastSeq();
    this.d.closeDb();
    const p = this.d.store.read();
    const lastUsed = finishWorkingCopy({
      offlineDir: this.d.offlineDir,
      deviceNo: this.d.deviceNo,
      previousLastUsed: p?.lastUsedIds ?? {},
      DatabaseCtor: this.d.DatabaseCtor,
      now: this.d.now,
    });
    this.d.store.update({
      mode: "standby",
      lastUsedIds: lastUsed,
      lastSeq: Math.max(lastSeq, p?.lastSeq ?? 0),
      lastPeriod: {
        finishedAt: new Date(this.d.now()).toISOString(),
        settledAt: null,
      },
    });
    this.d.clearReadLog();
    logger.info({ lastSeq }, "offline work finished — back to standby");
    this.d.relaunch();
  }
}
