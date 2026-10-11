/**
 * LIRA-306 (FR-005, R15) — serves shop copies to paired PCs.
 *
 * One copy per shop is reused for `OFFLINE_SNAPSHOT_TTL_MS` (default 5 min)
 * by every PC of that shop; each fresh build is recorded in
 * `offline_snapshots` (the copy id an uploaded event names gives the
 * high-water marks). The shop is ALWAYS the current tenant context — never a
 * caller-supplied id — so one shop can never be served another's copy.
 *
 * No SQL here (rule 13): the copy is built by `db/tenantSnapshot.ts` and the
 * record written by `OfflineSnapshotRepository`. The cache is per process
 * and in memory (copies are gzip bytes; nothing left on disk). Server-only:
 * exported from `index.ts`, never `browser.ts` (rule 29).
 */
import {
  buildTenantSnapshot,
  type BuildTenantSnapshotOptions,
  type TenantSnapshot,
} from "../db/tenantSnapshot.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import {
  getOfflineSnapshotRepository,
  type OfflineSnapshotRepository,
} from "../repositories/OfflineSnapshotRepository.js";
import { getOfflineSnapshotTtlMs } from "../config/env.js";
import { MIGRATIONS } from "../db/migrations/index.js";
import { dbLogger } from "../utils/logger.js";

export interface OfflineSnapshotServiceDeps {
  build?: (opts: BuildTenantSnapshotOptions) => TenantSnapshot;
  /** Epoch ms. */
  now?: () => number;
  /** Default: the last entry of MIGRATIONS (same rule as the device/event services). */
  serverSchemaVersion?: () => number;
}

interface CacheEntry {
  snapshot: TenantSnapshot;
  builtAtMs: number;
}

export class OfflineSnapshotService {
  private readonly cache = new Map<number, CacheEntry>();
  private readonly build: (opts: BuildTenantSnapshotOptions) => TenantSnapshot;
  private readonly now: () => number;
  private readonly serverSchemaVersion: () => number;

  constructor(
    private readonly repo: OfflineSnapshotRepository,
    deps: OfflineSnapshotServiceDeps = {},
  ) {
    this.build = deps.build ?? buildTenantSnapshot;
    this.now = deps.now ?? Date.now;
    this.serverSchemaVersion =
      deps.serverSchemaVersion ?? (() => MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0);
  }

  /**
   * The current shop's copy: the cached one while younger than the TTL,
   * otherwise a fresh build (recorded with `deviceId`, the first PC served).
   */
  getSnapshot(opts: { deviceId: number | null }): TenantSnapshot {
    const tenantId = getCurrentTenantId();
    const now = this.now();
    const hit = this.cache.get(tenantId);
    if (hit && now - hit.builtAtMs < getOfflineSnapshotTtlMs()) {
      return hit.snapshot;
    }

    const snapshot = this.build({ tenantId });
    this.repo.insert({
      copyId: snapshot.copyId,
      deviceId: opts.deviceId,
      schemaVersion: snapshot.schemaVersion,
      builtAt: snapshot.builtAt,
      highWater: snapshot.highWater,
    });
    this.cache.set(tenantId, { snapshot, builtAtMs: now });
    dbLogger.info(
      { tenantId, copyId: snapshot.copyId, deviceId: opts.deviceId, buildMs: snapshot.buildMs },
      "offline snapshot served (fresh build)",
    );
    return snapshot;
  }

  /**
   * The route's entry point (T116): a PC whose data version differs from the
   * server's in EITHER direction gets VERSION_MISMATCH and nothing is built
   * or recorded (FR-007 — a copy of another version could not be opened by
   * that app, and its events would not fit).
   */
  serve(opts: {
    deviceId: number | null;
    pcSchemaVersion: number;
  }):
    | { success: true; snapshot: TenantSnapshot }
    | { success: false; code: "VERSION_MISMATCH"; error: string; serverSchemaVersion: number } {
    const server = this.serverSchemaVersion();
    if (opts.pcSchemaVersion !== server) {
      return {
        success: false,
        code: "VERSION_MISMATCH",
        error:
          opts.pcSchemaVersion < server
            ? "This PC's app is older than the server — install the update first"
            : "This PC's app is newer than the server — wait for the server update",
        serverSchemaVersion: server,
      };
    }
    return { success: true, snapshot: this.getSnapshot({ deviceId: opts.deviceId }) };
  }

  /** Drops the cached copy of one shop (or all). */
  clearCache(tenantId?: number): void {
    if (tenantId === undefined) this.cache.clear();
    else this.cache.delete(tenantId);
  }
}

let instance: OfflineSnapshotService | null = null;

export function getOfflineSnapshotService(): OfflineSnapshotService {
  if (!instance) instance = new OfflineSnapshotService(getOfflineSnapshotRepository());
  return instance;
}

export function resetOfflineSnapshotService(): void {
  instance = null;
}
