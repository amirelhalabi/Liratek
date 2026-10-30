/**
 * LIRA-364 — the monthly KPI snapshot timer, desktop side. A standalone shop
 * captures at start-up, synchronously and before the IPC handlers register,
 * so last month is saved before the new month's first sale can be; then
 * hourly, for an app left open past midnight. All the rules live in
 * `KpiSnapshotService.captureDue`. A PC paired with a web shop never
 * captures: the server's snapshot is the shop's one.
 */
import { getKpiSnapshotService, kpiLogger } from "@liratek/core";

const KPI_SNAPSHOT_INTERVAL_MS = 60 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;

export function startKpiSnapshotTimer(options: {
  standalone: boolean;
  capture?: () => unknown;
}): void {
  if (!options.standalone) return;
  const capture =
    options.capture ?? (() => getKpiSnapshotService().captureDue(new Date()));
  const run = () => {
    try {
      capture();
    } catch (error) {
      // Never stop the app over a snapshot; it is retried next hour.
      kpiLogger.error({ error }, "Monthly KPI snapshot failed");
    }
  };
  run();
  if (timer) clearInterval(timer);
  timer = setInterval(run, KPI_SNAPSHOT_INTERVAL_MS);
  timer.unref?.();
}

export function stopKpiSnapshotTimer(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
