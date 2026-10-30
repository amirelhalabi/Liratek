/**
 * LIRA-364 — storage for the monthly KPI snapshot: one `kpi_snapshots` row
 * per shop per Beirut month, one `kpi_snapshot_values` row per KPI. A month is
 * written once, except the shop's first month: its early save is replaced
 * once by the month-end balances. The app never deletes a month.
 */
import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import type { KpiKey, KpiSnapshotView } from "../constants/kpiDefinitions.js";

export interface NewKpiSnapshot {
  month: string;
  taken_at: string;
  is_late: boolean;
  usd_lbp_buy_rate: number | null;
  usd_lbp_sell_rate: number | null;
  values: Record<KpiKey, { usd: number; lbp: number }>;
}

export class KpiSnapshotRepository {
  /** Explicit override for tests only; default resolves live (per tenant). */
  private readonly _db?: Database.Database;

  constructor(db?: Database.Database) {
    this._db = db;
  }

  private get db(): Database.Database {
    return this._db ?? getDatabase();
  }

  /** When `month` was saved (UTC `YYYY-MM-DD HH:MM:SS`); null when it was not. */
  getTakenAt(month: string): string | null {
    const row = this.db
      .prepare(
        `SELECT taken_at FROM kpi_snapshots WHERE tenant_id = ? AND month = ?`,
      )
      .get(getCurrentTenantId(), month) as { taken_at: string } | undefined;
    return row?.taken_at ?? null;
  }

  /** Any transaction saved at or after `utc` (`YYYY-MM-DD HH:MM:SS`). */
  hasTransactionsSince(utc: string): boolean {
    return !!this.db
      .prepare(
        `SELECT 1 FROM transactions WHERE tenant_id = ? AND created_at >= ? LIMIT 1`,
      )
      .get(getCurrentTenantId(), utc);
  }

  /**
   * Saves a month with all its values in one transaction. With `replace`, an
   * existing month takes the new time, rates and values (the start month's
   * early save, at its month end); without it, an existing month is left as
   * it is (`UNIQUE (tenant_id, month)`), never saved twice.
   */
  saveSnapshot(snapshot: NewKpiSnapshot, replace: boolean): void {
    const tenantId = getCurrentTenantId();
    this.db.transaction(() => {
      const res = this.db
        .prepare(
          `INSERT INTO kpi_snapshots (tenant_id, month, taken_at, is_late, usd_lbp_buy_rate, usd_lbp_sell_rate)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (tenant_id, month) DO ${
             replace
               ? `UPDATE SET taken_at = excluded.taken_at, is_late = excluded.is_late,
                  usd_lbp_buy_rate = excluded.usd_lbp_buy_rate,
                  usd_lbp_sell_rate = excluded.usd_lbp_sell_rate,
                  updated_at = datetime('now')`
               : "NOTHING"
           }`,
        )
        .run(
          tenantId,
          snapshot.month,
          snapshot.taken_at,
          snapshot.is_late ? 1 : 0,
          snapshot.usd_lbp_buy_rate,
          snapshot.usd_lbp_sell_rate,
        );
      // Already saved and not replaced: kept exactly as it is.
      if (res.changes === 0) return;
      const row = this.db
        .prepare(
          `SELECT id FROM kpi_snapshots WHERE tenant_id = ? AND month = ?`,
        )
        .get(tenantId, snapshot.month) as { id: number };
      const saveValue = this.db.prepare(
        `INSERT INTO kpi_snapshot_values (tenant_id, snapshot_id, kpi_key, amount_usd, amount_lbp)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (snapshot_id, kpi_key) DO UPDATE SET
           amount_usd = excluded.amount_usd, amount_lbp = excluded.amount_lbp,
           updated_at = datetime('now')`,
      );
      for (const [key, amount] of Object.entries(snapshot.values)) {
        saveValue.run(tenantId, row.id, key, amount.usd, amount.lbp);
      }
    })();
  }

  /** Every saved month, newest first, with its values. */
  listSnapshots(): KpiSnapshotView[] {
    const tenantId = getCurrentTenantId();
    const rows = this.db
      .prepare(
        `SELECT id, month, taken_at, is_late, usd_lbp_buy_rate, usd_lbp_sell_rate
           FROM kpi_snapshots WHERE tenant_id = ? ORDER BY month DESC`,
      )
      .all(tenantId) as Array<{
      id: number;
      month: string;
      taken_at: string;
      is_late: number;
      usd_lbp_buy_rate: number | null;
      usd_lbp_sell_rate: number | null;
    }>;
    const values = this.db
      .prepare(
        `SELECT snapshot_id, kpi_key, amount_usd, amount_lbp
           FROM kpi_snapshot_values WHERE tenant_id = ?`,
      )
      .all(tenantId) as Array<{
      snapshot_id: number;
      kpi_key: KpiKey;
      amount_usd: number;
      amount_lbp: number;
    }>;
    const bySnapshot = new Map<number, KpiSnapshotView["values"]>();
    for (const v of values) {
      const entry = bySnapshot.get(v.snapshot_id) ?? {};
      entry[v.kpi_key] = { usd: v.amount_usd, lbp: v.amount_lbp };
      bySnapshot.set(v.snapshot_id, entry);
    }
    return rows.map((r) => ({
      month: r.month,
      taken_at: r.taken_at,
      is_late: r.is_late === 1,
      usd_lbp_buy_rate: r.usd_lbp_buy_rate,
      usd_lbp_sell_rate: r.usd_lbp_sell_rate,
      values: bySnapshot.get(r.id) ?? {},
    }));
  }
}

let instance: KpiSnapshotRepository | null = null;
export function getKpiSnapshotRepository(): KpiSnapshotRepository {
  if (!instance) instance = new KpiSnapshotRepository();
  return instance;
}
export function resetKpiSnapshotRepository(): void {
  instance = null;
}
