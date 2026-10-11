/**
 * LIRA-306 — when merge rounds run (FR-017, O-new-14). Only the schedule;
 * the work is core's `OfflineMergeProcessor` (rule 13).
 *
 *  - after an upload (or a check-in reporting waiting work): one round for
 *    that shop after the gathering pause (`OFFLINE_MERGE_GATHER_MS`, default
 *    30 s, 0 in web e2e), so PCs that reconnect together interleave;
 *  - every 60 s: a sweep over every shop with waiting events (restart-safe);
 *  - one round per shop at a time (the processor's own lock).
 * Every timer is `unref()`ed and nothing starts under jest.
 */
import {
  OfflineMergeProcessor,
  getOfflineMergeGatherMs,
  createChildLogger,
} from "@liratek/core";
import { emitEvent } from "../websocket/io.js";
import { INVALIDATE_EVENT } from "../middleware/invalidateOnMutation.js";

const log = createChildLogger({ module: "offline-timer" });
export const OFFLINE_SWEEP_INTERVAL_MS = 60_000;

const pending = new Map<number, NodeJS.Timeout>();
let sweepTimer: NodeJS.Timeout | null = null;

function processor(): OfflineMergeProcessor {
  return new OfflineMergeProcessor({
    onRoundCommitted: (tenantId) =>
      emitEvent(tenantId, INVALIDATE_EVENT, { entity: "offline", action: "create", at: new Date().toISOString() }),
  });
}

export async function runOfflineRound(tenantId: number): Promise<void> {
  try {
    await processor().runRound(tenantId);
  } catch (error) {
    log.error({ error, tenantId }, "offline merge round failed");
  }
}

/** Start one round for the shop after the gathering pause (deduplicated). */
export function scheduleOfflineRound(tenantId: number): void {
  if (process.env.JEST_WORKER_ID && process.env.OFFLINE_TIMER_IN_TESTS !== "1") return;
  if (pending.has(tenantId)) return;
  const t = setTimeout(() => {
    pending.delete(tenantId);
    void runOfflineRound(tenantId);
  }, getOfflineMergeGatherMs());
  t.unref?.();
  pending.set(tenantId, t);
}

export function runOfflineSweepOnce(): void {
  try {
    for (const tenantId of processor().tenantsWithWork()) scheduleOfflineRound(tenantId);
  } catch (error) {
    log.error({ error }, "offline sweep failed");
  }
}

export function startOfflineProcessorTimer(): void {
  if (process.env.JEST_WORKER_ID) return;
  runOfflineSweepOnce();
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = setInterval(runOfflineSweepOnce, OFFLINE_SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
}

export function stopOfflineProcessorTimer(): void {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
  for (const t of pending.values()) clearTimeout(t);
  pending.clear();
}
