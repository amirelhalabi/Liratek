/**
 * Schedules `TenantDatabasePool.closeIdle()` on a repeating timer (Phase A,
 * `docs/plans/ongoing_plans/PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` § 11.1).
 *
 * Split out of `connection.ts` into its own leaf module for the same reason
 * `tenantDbResolver.ts` is: `connection.ts` uses `import.meta.url` and can
 * never be `require()`-d for real under backend jest (see that file's header
 * comment). Zero imports here that trip that limitation, so the scheduling
 * logic itself — not just the routing decision — is unit-testable with a
 * fake timer function instead of only ever mocked away.
 */
export interface IdleSweepPool {
  closeIdle(): void;
}

/** Node's `setInterval`, narrowed to the one overload this module calls. */
export type SetIntervalFn = (
  callback: () => void,
  ms: number,
) => NodeJS.Timeout;

/**
 * Calls `pool.closeIdle()` every `intervalMs`, forever, until the returned
 * `stop()` is called. The timer is `.unref()`'d so a live sweep never keeps
 * the process alive on its own (a normal shutdown, or a test process, exits
 * on its own schedule regardless of whether `stop()` was ever called).
 *
 * `setIntervalFn` is injectable so tests can drive the sweep without a real
 * timer — production always uses the default (Node's own `setInterval`).
 */
export function startIdleSweep(
  pool: IdleSweepPool,
  intervalMs: number,
  setIntervalFn: SetIntervalFn = setInterval,
): () => void {
  const timer = setIntervalFn(() => pool.closeIdle(), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
