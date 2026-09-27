/**
 * The session-sweep timer: purges expired and long-idle auth sessions from
 * every database this process serves (the platform file, and — in
 * `per-tenant` mode — every shop file too). All the fan-out policy lives in
 * `SessionSweepService.sweepAll()` (`@liratek/core`, rule 13); this is only
 * the schedule, mirroring `lapseSweep.ts`'s shape exactly.
 *
 * Desktop already runs its own version of this (`electron-app/main.ts`'s
 * `startSessionCleanup`, every 5 minutes) — that one only ever needs a
 * single file, so it calls the repository directly rather than through this
 * service. This timer is the WEB backend's equivalent, and is new: before
 * this, nothing on the web backend ever swept expired sessions at all, so
 * `sessions` only ever grew. Every run is idempotent (a session either still
 * matches the DELETE predicate or it doesn't), so a missed tick, a double
 * tick, or a tick right after a restart all equal running it once — same
 * property `lapseSweep.ts` relies on for the cheapest-possible scheduler to
 * be adequate here.
 */
import { getSessionSweepService } from "@liratek/core";
import { logger } from "../server.js";

/** Matches desktop's `startSessionCleanup` interval exactly (`main.ts`). */
export const SESSION_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;

export function runSessionSweepOnce(): void {
  try {
    const result = getSessionSweepService().sweepAll();
    const totalCleaned = result.expiredCount + result.inactiveCount;

    if (totalCleaned > 0 || result.failedTenantIds.length > 0) {
      logger.info(result, "session sweep completed");
    }
  } catch (error) {
    // A failed sweep must never take the server down. The consequence of
    // skipping one is that stale sessions linger an extra 5 minutes, which
    // nobody notices — same reasoning as `lapseSweep.ts`.
    logger.error({ error }, "session sweep failed");
  }
}

export function startSessionSweep(): void {
  // Once at boot, so a server that was down for a while catches up
  // immediately rather than waiting a full interval.
  runSessionSweepOnce();

  if (timer) clearInterval(timer);
  timer = setInterval(runSessionSweepOnce, SESSION_SWEEP_INTERVAL_MS);
  // Never hold the process open on shutdown for a maintenance timer.
  timer.unref?.();
}

export function stopSessionSweep(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
