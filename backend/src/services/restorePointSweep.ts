/**
 * LIRA-377 T028 — the restore-point sweep timer. All the policy lives in
 * core's `ShopRestoreService.sweep(now)` (rule 13): prepared restores not
 * confirmed within 15 minutes are expired and their candidates deleted;
 * before-restore copies older than 7 days are deleted except the newest per
 * shop; orphaned work files (a crash mid-prepare) are removed after an hour.
 * This file is only the schedule, shaped like `sessionSweep.ts`. Idempotent,
 * so a missed or doubled tick equals one run. No-op outside per-tenant mode.
 */
import { shopRestoreService } from "../restore/restoreService.js";
import { logger } from "../server.js";

/** A prepared restore lives 15 minutes; a 5-minute tick frees it by ~20. */
export const RESTORE_POINT_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;

export function runRestorePointSweepOnce(): void {
  try {
    const svc = shopRestoreService();
    if (!svc) return;
    svc.sweep(new Date().toISOString());
  } catch (error) {
    // Never take the server down over housekeeping; the next tick retries.
    logger.error({ error }, "restore point sweep failed");
  }
}

export function startRestorePointSweep(): void {
  runRestorePointSweepOnce();
  if (timer) clearInterval(timer);
  timer = setInterval(runRestorePointSweepOnce, RESTORE_POINT_SWEEP_INTERVAL_MS);
  timer.unref?.();
}

export function stopRestorePointSweep(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
