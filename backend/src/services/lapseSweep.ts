/**
 * The lapse timer: active -> grace at the period end, grace -> read_only when
 * grace runs out.
 *
 * All the policy lives in `SubscriptionService.runLapseSweep()` (rule 13);
 * this is only the schedule, and it exists on the SERVER alone. A desktop
 * install must never sweep its own row: that row is a cached copy of the
 * server's answer, so a desktop-side sweep would let a shop lapse itself
 * offline — the opposite of the fail-open model — and would then be
 * overwritten on the next sync anyway.
 *
 * Deliberately a plain interval rather than a cron dependency. The sweep is
 * idempotent (each transition is selected by the status it is LEAVING), so
 * running it twice, or at a slightly wrong minute, or twice after a restart,
 * all equal running it once. That property is what makes the cheapest possible
 * scheduler adequate here.
 */

import { getSubscriptionService, runWithoutTenant } from "@liratek/core";
import { logger } from "../server.js";

/**
 * Hourly. The transitions are day-granular, so this is ~24x more often than
 * strictly needed — which is the point: a missed hour is invisible, and there
 * is no catch-up logic to get wrong because the sweep is a function of the
 * current time and the stored deadlines, not of how many times it has run.
 */
export const LAPSE_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;

export function runSweepOnce(): void {
  try {
    // Control-plane work across every tenant, so explicitly outside any
    // tenant context — the same rule TenantRepository follows.
    const result = runWithoutTenant(() =>
      getSubscriptionService().runLapseSweep(),
    );

    if (result.toGrace.length > 0 || result.toReadOnly.length > 0) {
      logger.warn(result, "subscriptions lapsed");
    }
  } catch (error) {
    // A failed sweep must never take the server down. The consequence of
    // skipping one is that a lapse lands an hour late, which nobody notices.
    logger.error({ error }, "lapse sweep failed");
  }
}

export function startLapseSweep(): void {
  // Once at boot, so a server that was down over a deadline catches up
  // immediately rather than an hour later.
  runSweepOnce();

  if (timer) clearInterval(timer);
  timer = setInterval(runSweepOnce, LAPSE_SWEEP_INTERVAL_MS);
  // Never hold the process open on shutdown for a billing timer.
  timer.unref?.();
}

export function stopLapseSweep(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
