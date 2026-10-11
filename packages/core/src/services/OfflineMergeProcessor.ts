/**
 * LIRA-306 — merge rounds (FR-017, R5). Server-only.
 *
 * One round per shop at a time (in-process lock — one Fly machine). For each
 * PC with waiting events the round books them strictly in the PC's own
 * sequence starting at its cursor (`next_expected_seq`): a missing sequence
 * number stops that PC (a gap waits for the event to arrive), a technical
 * failure stops that PC for this round, everything else (booked, held,
 * refused, skipped) advances the cursor — a business refusal never blocks
 * the queue. This is the single-PC path; the cross-PC time-ordered k-way
 * merge is T053.
 *
 * Each event commits on its own (ReplayEngine); `onRoundCommitted` fires ONCE
 * per round that changed something (the backend broadcasts `data:invalidate`).
 */
import { runWithTenant, runWithoutTenant } from "../db/tenantContext.js";
import { listTenantDatabaseIds } from "../db/tenantDatabaseIds.js";
import { ReplayEngine } from "../offline/ReplayEngine.js";
import { getOfflineDeviceRepository, type OfflineDeviceRepository } from "../repositories/OfflineDeviceRepository.js";
import { getOfflineEventRepository, type OfflineEventRepository } from "../repositories/OfflineEventRepository.js";
import { offlineLogger } from "../utils/logger.js";

export interface RoundReport {
  tenantId: number;
  processed: number;
  ms: number;
  perSecond: number;
  stoppedDevices: number[];
}

export interface OfflineMergeProcessorDeps {
  engine?: ReplayEngine;
  devices?: OfflineDeviceRepository;
  events?: OfflineEventRepository;
  onRoundCommitted?: (tenantId: number) => void;
  onRoundDone?: (r: RoundReport) => void;
}

const running = new Set<number>();
/** Shops whose round was asked for while one was running (re-run it). */
const rerun = new Set<number>();

export class OfflineMergeProcessor {
  private readonly engine: ReplayEngine;
  private readonly devices: OfflineDeviceRepository;
  private readonly events: OfflineEventRepository;
  private readonly onRoundCommitted?: (tenantId: number) => void;
  private readonly onRoundDone?: (r: RoundReport) => void;

  constructor(deps: OfflineMergeProcessorDeps = {}) {
    this.engine = deps.engine ?? new ReplayEngine();
    this.devices = deps.devices ?? getOfflineDeviceRepository();
    this.events = deps.events ?? getOfflineEventRepository();
    this.onRoundCommitted = deps.onRoundCommitted;
    this.onRoundDone = deps.onRoundDone;
  }

  /** True while a round for this shop is running. */
  static isRunning(tenantId: number): boolean {
    return running.has(tenantId);
  }

  /** Shops with events waiting (the periodic sweep, restart-safe). */
  tenantsWithWork(): number[] {
    const perTenant = listTenantDatabaseIds();
    if (perTenant) {
      return perTenant.filter((id) => {
        try {
          return runWithTenant(id, () => this.events.devicesWithReceived().length > 0);
        } catch {
          return false;
        }
      });
    }
    return runWithoutTenant(() => this.events.tenantsWithReceived());
  }

  async runRound(tenantId: number): Promise<RoundReport> {
    const started = Date.now();
    if (running.has(tenantId)) {
      // The running round re-checks before it ends, so this work is not
      // left for the 60 s sweep.
      rerun.add(tenantId);
      return { tenantId, processed: 0, ms: 0, perSecond: 0, stoppedDevices: [] };
    }
    running.add(tenantId);
    let processed = 0;
    const stoppedDevices: number[] = [];
    try {
      do {
        rerun.delete(tenantId);
        const deviceIds = runWithTenant(tenantId, () => this.events.devicesWithReceived());
        for (const deviceId of deviceIds) {
          if (stoppedDevices.includes(deviceId)) continue;
          const stopped = await runWithTenant(tenantId, () => this.drainDevice(deviceId, (n) => (processed += n)));
          if (stopped) stoppedDevices.push(deviceId);
        }
      } while (rerun.has(tenantId));
    } finally {
      running.delete(tenantId);
      rerun.delete(tenantId);
    }
    const ms = Date.now() - started;
    const report: RoundReport = {
      tenantId,
      processed,
      ms,
      perSecond: processed === 0 ? 0 : Math.round((processed * 1000) / Math.max(ms, 1)),
      stoppedDevices,
    };
    if (processed > 0) {
      offlineLogger.info(report, "offline merge round");
      this.onRoundCommitted?.(tenantId);
    }
    this.onRoundDone?.(report);
    return report;
  }

  /** Book one PC's queue from its cursor. Returns true when it stopped on a
   *  technical failure (a gap or the end of the queue is a normal stop). */
  private async drainDevice(deviceId: number, count: (n: number) => void): Promise<boolean> {
    const device = this.devices.findById(deviceId);
    if (!device) return false;
    let seq = device.next_expected_seq;
    for (;;) {
      const ev = this.events.findBySeq(deviceId, seq);
      if (!ev) break; // gap or end
      if (ev.status === "received") {
        const out = await this.engine.process(ev, { mode: "auto" });
        if (out.technical) {
          this.devices.setNextExpectedSeq(deviceId, seq);
          return true;
        }
        count(1);
        // Between events (never inside one — no window is open here) give
        // the event loop a turn, so web and phone requests are served while
        // a long backlog is booked (N1).
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      seq += 1;
    }
    if (seq !== device.next_expected_seq) this.devices.setNextExpectedSeq(deviceId, seq);
    return false;
  }
}
