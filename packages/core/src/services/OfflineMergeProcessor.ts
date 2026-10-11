/**
 * LIRA-306 — merge rounds (FR-017, R5). Server-only.
 *
 * One round per shop at a time (in-process lock — one Fly machine). The
 * round is a k-way merge (plan §D): each PC's candidate is its NEXT expected
 * event (`next_expected_seq`); the candidate with the smallest corrected
 * instant (`corrected_at ?? occurred_at`) is booked first, ties by PC number
 * then sequence — never looking past a PC's head, so a PC's own order always
 * wins over its clock. A missing sequence number stops that PC (a gap waits
 * for the event to arrive), a technical failure stops that PC for this
 * round, everything else (booked, held, refused, skipped) advances the
 * cursor — a business refusal never blocks the queue. PCs that have not
 * reconnected are never waited for (T053).
 *
 * Each event commits on its own (ReplayEngine); `onRoundCommitted` fires ONCE
 * per round that changed something (the backend broadcasts `data:invalidate`).
 */
import { runWithTenant, runWithoutTenant } from "../db/tenantContext.js";
import { listTenantDatabaseIds } from "../db/tenantDatabaseIds.js";
import { ReplayEngine } from "../offline/ReplayEngine.js";
import { getOfflineDeviceRepository, type OfflineDeviceRepository } from "../repositories/OfflineDeviceRepository.js";
import {
  getOfflineEventRepository,
  type OfflineEventRepository,
  type OfflineEventRow,
} from "../repositories/OfflineEventRepository.js";
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
        await runWithTenant(tenantId, () => this.merge(stoppedDevices, (n) => (processed += n)));
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

  /** The k-way merge over every PC with waiting events (plan §D). */
  private async merge(stopped: number[], count: (n: number) => void): Promise<void> {
    const heads = new Map<number, { deviceNo: number; seq: number; startSeq: number }>();
    for (const deviceId of this.events.devicesWithReceived()) {
      if (stopped.includes(deviceId)) continue;
      const device = this.devices.findById(deviceId);
      if (!device) continue;
      heads.set(deviceId, { deviceNo: device.device_no, seq: device.next_expected_seq, startSeq: device.next_expected_seq });
    }
    for (;;) {
      let best: { deviceId: number; ev: OfflineEventRow; at: number; deviceNo: number } | null = null;
      for (const [deviceId, h] of [...heads]) {
        // skip events already settled (e.g. refused at upload) up to the head
        let ev = this.events.findBySeq(deviceId, h.seq);
        while (ev && ev.status !== "received") {
          h.seq += 1;
          ev = this.events.findBySeq(deviceId, h.seq);
        }
        if (!ev) {
          // gap or end of this PC's queue
          if (h.seq !== h.startSeq) this.devices.setNextExpectedSeq(deviceId, h.seq);
          heads.delete(deviceId);
          continue;
        }
        const at = Date.parse(ev.corrected_at ?? ev.occurred_at);
        if (
          !best ||
          at < best.at ||
          (at === best.at && (h.deviceNo < best.deviceNo || (h.deviceNo === best.deviceNo && ev.device_seq < best.ev.device_seq)))
        ) {
          best = { deviceId, ev, at, deviceNo: h.deviceNo };
        }
      }
      if (!best) return;
      const h = heads.get(best.deviceId)!;
      const out = await this.engine.process(best.ev, { mode: "auto" });
      if (out.technical) {
        this.devices.setNextExpectedSeq(best.deviceId, h.seq);
        heads.delete(best.deviceId);
        stopped.push(best.deviceId);
        continue;
      }
      count(1);
      h.seq += 1;
      this.devices.setNextExpectedSeq(best.deviceId, h.seq);
      h.startSeq = h.seq;
      // Between events (never inside one — no window is open here) give
      // the event loop a turn, so web and phone requests are served while
      // a long backlog is booked (N1).
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
}
