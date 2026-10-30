/**
 * LIRA-364 — storage for the monthly KPI snapshot: one `kpi_snapshots` row
 * per shop per Beirut month, one `kpi_snapshot_values` row per KPI. Snapshots
 * are written once and never updated or deleted by the app.
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

  exists(month: string): boolean {
    return !!this.db
      .prepare(`SELECT 1 FROM kpi_snapshots WHERE tenant_id = ? AND month = ?`)
      .get(getCurrentTenantId(), month);
  }

  /** Any transaction saved at or after `utc` (`YYYY-MM-DD HH:MM:SS`). */
  hasTransactionsSince(utc: string): boolean {
    return !!this.db
      .prepare(
        `SELECT 1 FROM transactions WHERE tenant_id = ? AND created_at >= ? LIMIT 1`,
      )
      .get(getCurrentTenantId(), utc);
  }

  /** The shop's current USD→LBP buy/sell rate; nulls when none is set. */
  getUsdLbpRates(): { buy: number | null; sell: number | null } {
    const row = this.db
      .prepare(
        `SELECT buy_rate AS buy, sell_rate AS sell FROM exchange_rates WHERE tenant_id = ? AND to_code = 'LBP'`,
      )
      .get(getCurrentTenantId()) as { buy: number; sell: number } | undefined;
    return { buy: row?.buy ?? null, sell: row?.sell ?? null };
  }

  /**
   * Saves a month with all its values in one transaction. Returns false when
   * the month already exists (`UNIQUE (tenant_id, month)`): a second run is a
   * no-op, never a second row.
   */
  insertSnapshot(snapshot: NewKpiSnapshot): boolean {
    const tenantId = getCurrentTenantId();
    return this.db.transaction(() => {
      const res = this.db
        .prepare(
          `INSERT INTO kpi_snapshots (tenant_id, month, taken_at, is_late, usd_lbp_buy_rate, usd_lbp_sell_rate)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (tenant_id, month) DO NOTHING`,
        )
        .run(
          tenantId,
          snapshot.month,
          snapshot.taken_at,
          snapshot.is_late ? 1 : 0,
          snapshot.usd_lbp_buy_rate,
          snapshot.usd_lbp_sell_rate,
        );
      if (res.changes === 0) return false;
      const snapshotId = Number(res.lastInsertRowid);
      const insertValue = this.db.prepare(
        `INSERT INTO kpi_snapshot_values (tenant_id, snapshot_id, kpi_key, amount_usd, amount_lbp)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const [key, amount] of Object.entries(snapshot.values)) {
        insertValue.run(tenantId, snapshotId, key, amount.usd, amount.lbp);
      }
      return true;
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
