/**
 * LIRA-364 — the Monthly progress read, desktop side (REST twin:
 * `GET /api/kpi/snapshots`). Admin-only, read-only: snapshots are created by
 * the automatic capture alone, so there is no write channel at all.
 */
import { ipcMain } from "electron";
import {
  getKpiSnapshotService,
  kpiLogger,
  type KpiProgressResponse,
} from "@liratek/core";
import { requireRole } from "../session.js";

export function registerKpiHandlers(): void {
  ipcMain.handle("kpi:list-snapshots", (e): KpiProgressResponse => {
    const auth = requireRole(e.sender.id, ["admin"]);
    if (!auth.ok) return { success: false, error: auth.error };
    try {
      return { success: true, ...getKpiSnapshotService().getProgress() };
    } catch (error) {
      kpiLogger.error({ error }, "kpi:list-snapshots failed");
      return { success: false, error: "Failed to load monthly progress" };
    }
  });
}
