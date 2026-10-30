/**
 * LIRA-364 — the monthly KPI snapshot timer, web side. Every hour (and once at
 * boot) each shop with a live database is asked to save the Beirut month that
 * just ended. All the rules live in `KpiSnapshotService.captureDue` (rule 13);
 * this is only the schedule, copied from `lapseSweep.ts`: a plain interval is
 * enough because the capture is idempotent, so a restart, a missed hour or a
 * double run all equal one run, and a failed shop is simply retried next hour.
 */

import {
  getKpiSnapshotService,
  getTenantRepository,
  runWithTenant,
  runWithoutTenant,
} from "@liratek/core";
import { logger } from "../server.js";

export const KPI_SNAPSHOT_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** Shops without a live database: being created, or archived. */
const SKIPPED_STATUSES = new Set(["provisioning", "archived"]);

export interface KpiSweepDeps {
  listTenants: () => Array<{ id: number; status: string }>;
  capture: (tenantId: number, now: Date) => unknown;
}

const defaultDeps: KpiSweepDeps = {
  // Control-plane read across every shop, so outside any tenant context.
  listTenants: () =>
    runWithoutTenant(() => getTenantRepository().listAllRows()),
  // Inside the shop's context, so repositories open that shop's own file.
  capture: (tenantId, now) =>
    runWithTenant(tenantId, () => getKpiSnapshotService().captureDue(now)),
};

let timer: NodeJS.Timeout | null = null;

export function runKpiSnapshotSweepOnce(
  now: Date = new Date(),
  deps: KpiSweepDeps = defaultDeps,
): void {
  let tenants: Array<{ id: number; status: string }>;
  try {
    tenants = deps.listTenants();
  } catch (error) {
    logger.error({ error }, "KPI snapshot sweep could not list shops");
    return;
  }
  for (const tenant of tenants) {
    if (SKIPPED_STATUSES.has(tenant.status)) continue;
    try {
      deps.capture(tenant.id, now);
    } catch (error) {
      // One shop failing must not stop the others; it is retried next hour.
      logger.error(
        { error, tenantId: tenant.id },
        "KPI snapshot failed for shop",
      );
    }
  }
}

export function startKpiSnapshotSweep(): void {
  // Once at boot, so a server that was down over a month end catches up now.
  runKpiSnapshotSweepOnce();

  if (timer) clearInterval(timer);
  timer = setInterval(
    () => runKpiSnapshotSweepOnce(),
    KPI_SNAPSHOT_SWEEP_INTERVAL_MS,
  );
  timer.unref?.();
}

export function stopKpiSnapshotSweep(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
