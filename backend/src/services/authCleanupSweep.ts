/**
 * The auth-row cleanup timer: deletes sign-in codes, www -> shop hand-off
 * tokens, password-reset and email-verification links once they have been
 * expired for a grace period (7 days). Before this, nothing ever deleted
 * them, so those tables only grew.
 *
 * All the policy (which tables, the grace, the per-tenant fan-out) lives in
 * `AuthTokenCleanupService.sweepAll()` (`@liratek/core`, rule 13); this is
 * only the schedule, shaped like `sessionSweep.ts`/`lapseSweep.ts`. Each run
 * is idempotent (a row either matches the DELETE predicate or it doesn't),
 * so a missed, doubled or post-restart tick all equal running it once.
 *
 * The boot run is delayed slightly rather than run inline: nothing is urgent
 * about a week-old expired row, so it should not compete with startup.
 */
import { getAuthTokenCleanupService, getIdempotencyService } from "@liratek/core";
import { logger } from "../server.js";

/** Hourly — far more often than a 7-day grace needs; a missed hour is invisible. */
export const AUTH_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
/** The first run, shortly after boot. */
export const AUTH_CLEANUP_BOOT_DELAY_MS = 30 * 1000;

let bootTimer: NodeJS.Timeout | null = null;
let intervalTimer: NodeJS.Timeout | null = null;

export function runAuthCleanupOnce(): void {
  try {
    // A background job, not a request path: the server's own clock is the
    // right "now" here (rule 27 concerns values a client could supply).
    const result = getAuthTokenCleanupService().sweepAll(
      new Date().toISOString(),
    );
    const deleted =
      result.signinCodes +
      result.ssoHandoffTokens +
      result.passwordResetTokens +
      result.emailVerificationTokens;

    if (
      deleted > 0 ||
      result.platformFailed ||
      result.failedTenantIds.length > 0
    ) {
      logger.info(result, "auth token cleanup completed");
    }
  } catch (error) {
    // A failed sweep must never take the server down; expired rows simply
    // wait for the next tick.
    logger.error({ error }, "auth token cleanup failed");
  }

  // LIRA-289: stored Idempotency-Key replies older than 24 h. Its own pass,
  // so a failure here never affects the auth-token cleanup above.
  try {
    const idem = getIdempotencyService().sweepAll(new Date().toISOString());
    if (idem.deleted > 0 || idem.failed > 0) {
      logger.info(idem, "idempotency key cleanup completed");
    }
  } catch (error) {
    logger.error({ error }, "idempotency key cleanup failed");
  }
}

export function startAuthCleanupSweep(): void {
  stopAuthCleanupSweep();

  bootTimer = setTimeout(() => {
    bootTimer = null;
    runAuthCleanupOnce();
  }, AUTH_CLEANUP_BOOT_DELAY_MS);
  // Never hold the process open on shutdown for a maintenance timer.
  bootTimer.unref?.();

  intervalTimer = setInterval(runAuthCleanupOnce, AUTH_CLEANUP_INTERVAL_MS);
  intervalTimer.unref?.();
}

export function stopAuthCleanupSweep(): void {
  if (bootTimer) clearTimeout(bootTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  bootTimer = null;
  intervalTimer = null;
}
